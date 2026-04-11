import { type HITLRequest, type HITLResponse, type Interrupt, createAgent, humanInTheLoopMiddleware, tool } from "langchain";
import { Command, MemorySaver } from "@langchain/langgraph";
import { z } from "zod";

import { getChatModel, type ChatProvider } from "./chatModel";
import { formatFocusedAssetContext, formatTargetPageSnapshot } from "./pageSnapshot";
import {
  getFocusedAssetContext,
  getTargetPageSnapshot,
  performPageAction,
  type PageActionRequest,
  type PageActionResult,
  type TargetElementDescriptor,
  type TargetPageSnapshot,
} from "./targetBrowser";

const actionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("click"),
    elementId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("type"),
    elementId: z.string().min(1),
    text: z.string(),
    submit: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("scroll"),
    amount: z.number().int(),
  }),
]);

const SENSITIVE_KEYWORDS =
  /\b(sign in|log in|login|password|captcha|verify|verification|otp|2fa|two-factor|auth|authentication|passcode)\b/i;

type ReviewDecisionType = "approve" | "edit" | "reject";

export type HumanReviewRequest = {
  id: string;
  toolName: string;
  reason: string;
  proposedAction: PageActionRequest;
  allowedDecisions: ReviewDecisionType[];
};

export type HumanReviewDecision =
  | {
      type: "approve";
    }
  | {
      type: "edit";
      action: PageActionRequest;
    }
  | {
      type: "reject";
      message?: string;
    };

export type AgentReply =
  | {
      kind: "answer";
      message: string;
    }
  | {
      kind: "action-executed";
      message: string;
      action: PageActionResult;
    }
  | {
      kind: "needs-human-review";
      review: HumanReviewRequest;
      message: string;
    };

const agentInstances = new Map<ChatProvider, ReturnType<typeof createAgent>>();
const lastActionResults = new Map<string, PageActionResult>();

let activeThreadId: string | null = null;

function rememberActionResult(result: PageActionResult) {
  if (!activeThreadId) {
    return result;
  }

  lastActionResults.set(activeThreadId, result);
  return result;
}

function formatPageActionResult(result: PageActionResult) {
  return [
    `Action: ${result.action.kind}`,
    `Status: ${result.success ? "success" : "failed"}`,
    `Message: ${result.message}`,
    `Page: ${result.browser.pageTitle || "Untitled page"}`,
    `URL: ${result.browser.currentUrl}`,
  ].join("\n");
}

function getElementForAction(
  snapshot: TargetPageSnapshot,
  action: PageActionRequest,
) {
  if (action.kind === "scroll") {
    return null;
  }

  return snapshot.interactiveElements.find((element) => element.id === action.elementId) ?? null;
}

function matchesSensitiveKeywords(snapshot: TargetPageSnapshot, element: TargetElementDescriptor | null) {
  const haystack = [
    snapshot.url,
    snapshot.title,
    snapshot.headings.join(" "),
    snapshot.visibleText.slice(0, 1600),
    element?.label ?? "",
    element?.text ?? "",
    element?.placeholder ?? "",
    element?.href ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return SENSITIVE_KEYWORDS.test(haystack);
}

export function assessSensitiveAction(
  action: PageActionRequest,
  snapshot: TargetPageSnapshot,
) {
  if (action.kind === "scroll") {
    return null;
  }

  const element = getElementForAction(snapshot, action);

  if (element?.inputType?.toLowerCase() === "password") {
    return "This action targets a password field.";
  }

  if (action.kind === "type" && element?.isTextInput) {
    const fieldText = [element.label, element.text, element.placeholder].join(" ");
    if (SENSITIVE_KEYWORDS.test(fieldText)) {
      return "This input looks like a login or verification field.";
    }
  }

  if (matchesSensitiveKeywords(snapshot, element)) {
    return "This page appears to be in a login, verification, or CAPTCHA flow.";
  }

  return null;
}

const wholePageContextTool = tool(
  async () => {
    const snapshot = await getTargetPageSnapshot();
    return formatTargetPageSnapshot(snapshot);
  },
  {
    name: "get_visible_page_context",
    description:
      "Read the visible content, headings, and structured interactive elements from the current right-side page.",
    schema: z.object({}),
  },
);

const focusedAssetContextTool = tool(
  async () => {
    const context = await getFocusedAssetContext();
    return formatFocusedAssetContext(context);
  },
  {
    name: "get_focused_asset_context",
    description:
      "Read the currently selected asset or element from the page picker, including nearby text and headings.",
    schema: z.object({}),
  },
);

const performPageActionTool = tool(
  async (action) => {
    const typedAction = action as PageActionRequest;
    const snapshot = await getTargetPageSnapshot();
    const sensitiveReason = assessSensitiveAction(typedAction, snapshot);

    if (sensitiveReason) {
      throw new Error(`${sensitiveReason} Use perform_sensitive_page_action instead.`);
    }

    const result = rememberActionResult(await performPageAction(typedAction));
    return formatPageActionResult(result);
  },
  {
    name: "perform_page_action",
    description:
      "Execute a low-risk page action such as clicking a button, typing into a non-sensitive field, or scrolling the page.",
    schema: actionSchema,
  },
);

const performSensitivePageActionTool = tool(
  async (action) => {
    const result = rememberActionResult(await performPageAction(action as PageActionRequest));
    return formatPageActionResult(result);
  },
  {
    name: "perform_sensitive_page_action",
    description:
      "Execute a page action that may involve login, verification, CAPTCHA, or other sensitive steps and should be reviewed by a human first.",
    schema: actionSchema,
  },
);

function getAgent(provider: ChatProvider) {
  const cachedAgent = agentInstances.get(provider);
  if (cachedAgent) {
    return cachedAgent;
  }

  const agent = createAgent({
    model: getChatModel(undefined, provider),
    tools: [
      wholePageContextTool,
      focusedAssetContextTool,
      performPageActionTool,
      performSensitivePageActionTool,
    ],
    checkpointer: new MemorySaver(),
    middleware: [
      humanInTheLoopMiddleware({
        interruptOn: {
          perform_sensitive_page_action: {
            allowedDecisions: ["approve", "edit", "reject"],
            description:
              "This action may affect login, verification, or other sensitive page state. Review it before it runs.",
          },
        },
      }),
    ],
    systemPrompt: [
      "You are Sidekick, an AI assistant inside a dual-pane desktop app.",
      "When the user asks for a page summary or general question, use get_visible_page_context.",
      "When an asset is selected and the user asks about 'this', 'selected', or a specific element, use get_focused_asset_context first to keep the response grounded and token efficient.",
      "Use perform_page_action for clearly low-risk click, type, and scroll actions.",
      "Use perform_sensitive_page_action for login fields, password entry, OTP, CAPTCHA, verification, or any action that could submit sensitive information.",
      "After any action, explain what happened using the tool result. If the page view is limited, say so clearly.",
    ].join(" "),
  });

  agentInstances.set(provider, agent);
  return agent;
}

function getTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getThreadConfig(threadId: string) {
  return {
    configurable: {
      thread_id: threadId,
    },
  };
}

export function buildHumanReviewRequest(interrupt: Interrupt<HITLRequest>): HumanReviewRequest {
  const actionRequest = interrupt.value.actionRequests[0];
  const reviewConfig = interrupt.value.reviewConfigs[0];

  return {
    id: interrupt.id,
    toolName: actionRequest.name,
    reason:
      actionRequest.description ??
      "This page action needs approval before it can continue.",
    proposedAction: actionSchema.parse(actionRequest.args) as PageActionRequest,
    allowedDecisions: reviewConfig.allowedDecisions,
  };
}

function parseAgentReply(
  result: {
    messages: unknown[];
    __interrupt__?: Interrupt<HITLRequest>[];
  },
  threadId: string,
): AgentReply {
  const interrupt = result.__interrupt__?.[0];
  if (interrupt) {
    const review = buildHumanReviewRequest(interrupt);
    return {
      kind: "needs-human-review",
      review,
      message: review.reason,
    };
  }

  const action = lastActionResults.get(threadId);
  lastActionResults.delete(threadId);

  const finalMessage = result.messages[result.messages.length - 1] as
    | { content?: unknown }
    | undefined;
  const content = getTextContent(finalMessage?.content).trim();

  if (action) {
    return {
      kind: "action-executed",
      message: content || action.message,
      action,
    };
  }

  if (!content) {
    throw new Error("The assistant returned an empty response.");
  }

  return {
    kind: "answer",
    message: content,
  };
}

export async function sendAgentMessage(
  message: string,
  provider: ChatProvider,
  threadId: string,
) {
  const agent = getAgent(provider);
  lastActionResults.delete(threadId);
  activeThreadId = threadId;

  try {
    const result = await agent.invoke(
      {
        messages: [{ role: "user", content: message }],
      },
      getThreadConfig(threadId),
    );

    return parseAgentReply(result as { messages: unknown[]; __interrupt__?: Interrupt<HITLRequest>[] }, threadId);
  } finally {
    activeThreadId = null;
  }
}

export async function resumeHumanReview(
  review: HumanReviewRequest,
  decision: HumanReviewDecision,
  provider: ChatProvider,
  threadId: string,
) {
  const agent = getAgent(provider);
  lastActionResults.delete(threadId);
  activeThreadId = threadId;

  const resume: HITLResponse = {
    decisions: [
      decision.type === "approve"
        ? { type: "approve" }
        : decision.type === "edit"
          ? {
              type: "edit",
              editedAction: {
                name: review.toolName,
                args: decision.action,
              },
            }
          : {
              type: "reject",
              message: decision.message,
            },
    ],
  };

  try {
    const result = await agent.invoke(
      new Command({ resume }),
      getThreadConfig(threadId),
    );

    return parseAgentReply(result as { messages: unknown[]; __interrupt__?: Interrupt<HITLRequest>[] }, threadId);
  } finally {
    activeThreadId = null;
  }
}
