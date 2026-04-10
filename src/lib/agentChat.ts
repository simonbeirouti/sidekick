import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";

import { getChatModel, type ChatProvider } from "./chatModel";
import { formatTargetPageSnapshot } from "./pageSnapshot";
import { getTargetPageSnapshot } from "./targetBrowser";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

const pageContextTool = tool(
  async () => {
    const snapshot = await getTargetPageSnapshot();
    return formatTargetPageSnapshot(snapshot);
  },
  {
    name: "get_visible_page_context",
    description:
      "Read the visible content, headings, and interactive labels from the current right-side page.",
    schema: z.object({}),
  },
);

const agentInstances = new Map<ChatProvider, ReturnType<typeof createAgent>>();

function getAgent(provider: ChatProvider) {
  const cachedAgent = agentInstances.get(provider);
  if (cachedAgent) {
    return cachedAgent;
  }

  const agent = createAgent({
      model: getChatModel(undefined, provider),
      tools: [pageContextTool],
      systemPrompt: [
        "You are Sidekick, a read-only study assistant inside a dual-pane desktop app.",
        "Use the get_visible_page_context tool whenever the user asks about the current page.",
        "Ground your answer in the tool output and say when page visibility is limited.",
        "Do not claim to click, type, navigate, or modify the page.",
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

export async function sendAgentMessage(messages: ChatMessage[], provider: ChatProvider) {
  const agent = getAgent(provider);
  const result = await agent.invoke({
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  });

  const finalMessage = result.messages[result.messages.length - 1];
  const content = getTextContent(finalMessage?.content).trim();

  if (!content) {
    throw new Error("The assistant returned an empty response.");
  }

  return content;
}
