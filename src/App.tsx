import { FormEvent, KeyboardEvent, startTransition, useEffect, useId, useState } from "react";
import {
  AlertCircle,
  LoaderCircle,
  MousePointerClick,
  SendHorizontal,
  Sparkles,
  WandSparkles,
} from "lucide-react";

import {
  resumeHumanReview,
  sendAgentMessage,
  type AgentReply,
  type HumanReviewDecision,
  type HumanReviewRequest,
} from "@/lib/agentChat";
import { type ChatProvider } from "@/lib/chatModel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  getFocusedAssetContext,
  getTargetBrowserState,
  LAYOUT_PRESETS,
  listenToFocusedAsset,
  listenToTargetBrowser,
  navigateTarget,
  setAssetPickerEnabled,
  setLayoutPreset,
  type FocusedAssetContext,
  type LayoutPreset,
  type PageActionRequest,
  type PageActionResult,
  type TargetBrowserState,
} from "./lib/targetBrowser";

const DEFAULT_PROVIDER = (import.meta.env.VITE_LLM_PROVIDER ?? "openai") as ChatProvider;
const LAYOUT_PRESET_LABELS: Record<LayoutPreset, string> = {
  "70-30": "70/30",
  "50-50": "50/50",
  "30-70": "30/70",
};

type TranscriptMessage =
  | {
      id: string;
      role: "user";
      type: "text";
      content: string;
    }
  | {
      id: string;
      role: "assistant";
      type: "text";
      content: string;
    }
  | {
      id: string;
      role: "assistant";
      type: "action";
      content: string;
      action: PageActionResult;
    }
  | {
      id: string;
      role: "assistant";
      type: "review";
      content: string;
      review: HumanReviewRequest;
    };

type ReviewDraft = {
  actionJson: string;
  feedback: string;
};

function App() {
  const [browser, setBrowser] = useState<TargetBrowserState | null>(null);
  const [focusedAsset, setFocusedAsset] = useState<FocusedAssetContext | null>(null);
  const [input, setInput] = useState("https://developer.mozilla.org");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [agentError, setAgentError] = useState("");
  const [provider, setProvider] = useState<ChatProvider>(DEFAULT_PROVIDER);
  const [submitting, setSubmitting] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [pendingReview, setPendingReview] = useState<HumanReviewRequest | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [messages, setMessages] = useState<TranscriptMessage[]>([
    {
      id: "assistant-intro",
      role: "assistant",
      type: "text",
      content:
        "Ask me to summarize the page, review a picked asset, or interact with the page on the right.",
    },
  ]);
  const [threadId] = useState(() => crypto.randomUUID());
  const activeLayoutPreset = browser?.layoutPreset ?? "50-50";
  const draftId = useId();

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      try {
        const [initialState, initialFocusedAsset] = await Promise.all([
          getTargetBrowserState(),
          getFocusedAssetContext(),
        ]);

        if (!mounted) {
          return;
        }

        setBrowser(initialState);
        setFocusedAsset(initialFocusedAsset);
        setInput(initialState.currentUrl);
      } catch (loadError) {
        if (mounted) {
          setError(getErrorMessage(loadError));
        }
      }
    };

    void setup();

    const unlistenBrowserPromise = listenToTargetBrowser((state) => {
      if (!mounted) {
        return;
      }

      setBrowser(state);
      if (!state.loading) {
        setInput(state.currentUrl);
        setSubmitting(false);
      }
    });

    const unlistenFocusedAssetPromise = listenToFocusedAsset((nextFocusedAsset) => {
      if (mounted) {
        setFocusedAsset(nextFocusedAsset);
      }
    });

    return () => {
      mounted = false;
      void unlistenBrowserPromise.then((unlisten) => unlisten());
      void unlistenFocusedAssetPromise.then((unlisten) => unlisten());
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const nextState = await navigateTarget(input);
      setBrowser(nextState);
      setInput(nextState.requestedUrl);
      setFocusedAsset(null);
    } catch (submitError) {
      setSubmitting(false);
      setError(getErrorMessage(submitError));
    }
  }

  async function handleLayoutPresetChange(nextPreset: LayoutPreset) {
    if (nextPreset === activeLayoutPreset) {
      return;
    }

    setError("");

    try {
      const nextState = await setLayoutPreset(nextPreset);
      setBrowser(nextState);
    } catch (resizeError) {
      setError(getErrorMessage(resizeError));
    }
  }

  function appendMessage(message: TranscriptMessage) {
    startTransition(() => {
      setMessages((currentMessages) => [...currentMessages, message]);
    });
  }

  function applyAgentReply(reply: AgentReply) {
    if (reply.kind === "answer") {
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        type: "text",
        content: reply.message,
      });
      setPendingReview(null);
      return;
    }

    if (reply.kind === "action-executed") {
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        type: "action",
        content: reply.message,
        action: reply.action,
      });
      setPendingReview(null);
      return;
    }

    setPendingReview(reply.review);
    setReviewDrafts((currentDrafts) => ({
      ...currentDrafts,
      [reply.review.id]:
        currentDrafts[reply.review.id] ?? {
          actionJson: JSON.stringify(reply.review.proposedAction, null, 2),
          feedback: "",
        },
    }));
    appendMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      type: "review",
      content: reply.message,
      review: reply.review,
    });
  }

  async function submitDraft(nextDraft: string) {
    if (!nextDraft || isResponding || pendingReview) {
      return;
    }

    setAgentError("");
    setDraft("");
    setIsResponding(true);

    appendMessage({
      id: crypto.randomUUID(),
      role: "user",
      type: "text",
      content: nextDraft,
    });

    try {
      const response = await sendAgentMessage(nextDraft, provider, threadId);
      applyAgentReply(response);
    } catch (chatError) {
      setAgentError(getErrorMessage(chatError));
      setDraft(nextDraft);
    } finally {
      setIsResponding(false);
    }
  }

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitDraft(draft.trim());
  }

  async function handleToggleAssetPicker() {
    if (!browser) {
      return;
    }

    setError("");

    try {
      const nextState = await setAssetPickerEnabled(!browser.assetPickerEnabled);
      setBrowser(nextState);
    } catch (pickerError) {
      setError(getErrorMessage(pickerError));
    }
  }

  async function handleReviewDecision(
    review: HumanReviewRequest,
    type: HumanReviewDecision["type"],
  ) {
    if (isResponding) {
      return;
    }

    setAgentError("");
    setIsResponding(true);

    try {
      const draftState = reviewDrafts[review.id];
      const decision =
        type === "approve"
          ? ({ type: "approve" } satisfies HumanReviewDecision)
          : type === "edit"
            ? ({
                type: "edit",
                action: parsePageActionRequest(draftState?.actionJson ?? ""),
              } satisfies HumanReviewDecision)
            : ({
                type: "reject",
                message: draftState?.feedback.trim() || "Rejected from the assistant panel.",
              } satisfies HumanReviewDecision);

      const response = await resumeHumanReview(review, decision, provider, threadId);
      setPendingReview(null);
      applyAgentReply(response);
    } catch (reviewError) {
      setAgentError(getErrorMessage(reviewError));
    } finally {
      setIsResponding(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitDraft(draft.trim());
    }
  }

  return (
    <main className="min-h-screen overflow-hidden p-2 md:p-3 lg:p-6">
      <section className="@container flex min-h-[calc(100vh-1rem)] w-full min-w-0 flex-col gap-4 border border-border/80 bg-background/90 p-4 text-foreground shadow-[0_20px_60px_rgba(39,52,68,0.12),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-[10px] md:min-h-[calc(100vh-1.5rem)] md:d:p-5 lg:min-h-[calc(100vh-3rem)] lg:gap-5 lg:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="m-0 text-[1.35rem] leading-none font-semibold tracking-[-0.05em] text-foreground @min-[421px]:text-[1.7rem] lg:text-[2.4rem]">
            Sidekick page chat
          </h1>

          <div className="flex min-w-[220px] items-center gap-2">
            <Label htmlFor="provider-select" className="text-sm font-medium text-muted-foreground">
              Provider
            </Label>
            <Select value={provider} onValueChange={(value) => setProvider(value as ChatProvider)}>
              <SelectTrigger
                id="provider-select"
                className="h-10 w-[160px] border-border bg-card px-3 text-foreground"
              >
                <SelectValue placeholder="Choose provider" />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="ollama">Ollama</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card className="rounded-none flex min-h-0 flex-1 flex-col border border-border/80 bg-card/85 shadow-sm">
          <CardHeader className="pb-3">
            <div className="border border-border bg-muted/40 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="m-0 text-[0.72rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Current page context
                  </p>
                  <p className="mt-1 text-sm font-semibold text-card-foreground">
                    {browser?.pageTitle || "Page title will appear after the first inspection"}
                  </p>
                  <p className="mt-1 break-words text-[0.82rem] text-muted-foreground">
                    {browser?.currentUrl ?? "Waiting for the native webview to load"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={browser?.assetPickerEnabled ? "default" : "outline"}
                    className="rounded-none"
                    onClick={() => {
                      void handleToggleAssetPicker();
                    }}
                    disabled={!browser}
                  >
                    {browser?.assetPickerEnabled ? (
                      <>
                        <MousePointerClick className="size-4" />
                        Picker live
                      </>
                    ) : (
                      <>
                        <WandSparkles className="size-4" />
                        {focusedAsset ? "Pick another asset" : "Pick from page"}
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {focusedAsset?.element ? (
                  <Badge variant="outline" className="rounded-none border-border px-3 py-1 text-xs">
                    Selected: {summarizeFocusedAsset(focusedAsset)}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="rounded-none border-dashed px-3 py-1 text-xs">
                    No asset selected
                  </Badge>
                )}

                {browser?.assetPickerEnabled ? (
                  <p className="m-0 text-xs text-muted-foreground">
                    Hover the page on the right and click an element to lock the selection.
                  </p>
                ) : null}
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex min-h-[300px] flex-1 flex-col gap-3 overflow-y-auto border border-border bg-muted/30 p-3">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "assistant"
                      ? "max-w-[92%] self-start bg-card px-4 py-3 text-sm text-card-foreground shadow-[0_8px_24px_rgba(26,39,52,0.06)]"
                      : "max-w-[92%] self-end bg-primary px-4 py-3 text-sm text-primary-foreground shadow-[0_10px_24px_rgba(32,78,74,0.22)]"
                  }
                >
                  <div className="mb-1 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] opacity-75">
                    {message.role === "assistant" ? (
                      <>
                        <Sparkles className="size-3.5" />
                        Sidekick
                      </>
                    ) : (
                      "You"
                    )}
                  </div>

                  <p className="m-0 whitespace-pre-wrap leading-6">{message.content}</p>

                  {message.type === "action" ? (
                    <div className="mt-3 border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                      <p className="m-0 font-semibold text-card-foreground">
                        Action result: {message.action.action.kind}
                      </p>
                      <p className="mt-1 m-0">
                        {message.action.success ? "Completed" : "Failed"} on{" "}
                        {message.action.browser.pageTitle || message.action.browser.currentUrl}
                      </p>
                      {message.action.focusedAsset?.element ? (
                        <p className="mt-1 m-0">
                          Focused asset: {summarizeFocusedAsset(message.action.focusedAsset)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {message.type === "review" ? (
                    <ReviewCard
                      review={message.review}
                      draft={reviewDrafts[message.review.id]}
                      disabled={isResponding}
                      onDraftChange={(nextDraft) => {
                        setReviewDrafts((currentDrafts) => ({
                          ...currentDrafts,
                          [message.review.id]: nextDraft,
                        }));
                      }}
                      onDecision={(decision) => {
                        void handleReviewDecision(message.review, decision);
                      }}
                    />
                  ) : null}
                </article>
              ))}

              {isResponding ? (
                <article className="max-w-[92%] self-start bg-card px-4 py-3 text-sm text-card-foreground shadow-[0_8px_24px_rgba(26,39,52,0.06)]">
                  <div className="mb-1 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] opacity-75">
                    <Sparkles className="size-3.5" />
                    Sidekick
                  </div>
                  <div className="flex items-center gap-2">
                    <LoaderCircle className="size-4 animate-spin" />
                    Inspecting the page and working through the next step
                  </div>
                </article>
              ) : null}
            </div>

            <form className="grid gap-3" onSubmit={handleChatSubmit}>
              <Label htmlFor={draftId} className="text-muted-foreground">
                Ask about the page, the selected asset, or tell Sidekick what to do next
              </Label>
              <Textarea
                id={draftId}
                className="rounded-none min-h-28 border-border bg-background px-4 py-3 text-foreground"
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Summarize this page. Review the selected asset. Click the next practice button."
                disabled={isResponding || pendingReview !== null}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p className="m-0 text-xs text-muted-foreground">
                    Shift+Enter for a new line. Enter to send.
                  </p>
                  {pendingReview ? (
                    <p className="m-0 text-xs text-amber-700">
                      Resolve the pending review card before sending another request.
                    </p>
                  ) : null}
                </div>
                <Button
                  type="submit"
                  size="lg"
                  className="h-11 rounded-none bg-primary text-sm font-semibold text-primary-foreground shadow-[0_10px_24px_rgba(32,78,74,0.25)] hover:bg-primary/90"
                  disabled={isResponding || pendingReview !== null || draft.trim().length === 0}
                >
                  {isResponding ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      Thinking
                    </>
                  ) : (
                    <>
                      <SendHorizontal className="size-4" />
                      Send
                    </>
                  )}
                </Button>
              </div>
            </form>

            {agentError ? (
              <Alert variant="destructive" className="border-destructive/20 bg-destructive/5">
                <AlertCircle className="size-4" />
                <AlertTitle>Couldn&apos;t complete the grounded step</AlertTitle>
                <AlertDescription>{agentError}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-none border border-border/80 bg-card/85 shadow-sm">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold text-card-foreground">
              Target Page
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={handleSubmit}>
              <Label htmlFor="target-url" className="text-muted-foreground">
                URL
              </Label>
              <Input
                id="target-url"
                className="h-11 border-border bg-background text-foreground rounded-none"
                value={input}
                onChange={(event) => setInput(event.currentTarget.value)}
                placeholder="Enter a URL"
                autoComplete="off"
              />
              <Button
                type="submit"
                size="lg"
                className="h-11 rounded-none bg-primary text-sm font-semibold text-primary-foreground shadow-[0_10px_24px_rgba(32,78,74,0.25)] hover:bg-primary/90"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Loading
                  </>
                ) : (
                  "Open on right"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-none border border-border/80 bg-card/85 shadow-sm">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-semibold text-card-foreground">
                Pane Layout
              </CardTitle>
              <span className="border border-border px-3 py-1 text-xs font-semibold text-muted-foreground">
                {LAYOUT_PRESET_LABELS[activeLayoutPreset]}
              </span>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 pt-3">
            <div className="grid grid-cols-3 gap-2">
              {LAYOUT_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant={preset === activeLayoutPreset ? "default" : "outline"}
                  className="h-11 text-sm font-semibold rounded-none"
                  onClick={() => {
                    void handleLayoutPresetChange(preset);
                  }}
                >
                  {LAYOUT_PRESET_LABELS[preset]}
                </Button>
              ))}
            </div>
            <p className="m-0 text-xs text-muted-foreground">
              Assistant on the left, target page on the right. Native panes stay flush with no overlap.
            </p>
          </CardContent>
        </Card>

        {error ? (
          <Alert variant="destructive" className="border-destructive/20 bg-destructive/5">
            <AlertCircle className="size-4" />
            <AlertTitle>Couldn&apos;t update the embedded browser</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </section>
    </main>
  );
}

type ReviewCardProps = {
  review: HumanReviewRequest;
  draft: ReviewDraft | undefined;
  disabled: boolean;
  onDraftChange: (nextDraft: ReviewDraft) => void;
  onDecision: (decision: HumanReviewDecision["type"]) => void;
};

function ReviewCard({ review, draft, disabled, onDraftChange, onDecision }: ReviewCardProps) {
  const canEdit = review.allowedDecisions.includes("edit");
  const canReject = review.allowedDecisions.includes("reject");

  return (
    <div className="mt-3 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">
        Human Review Needed
      </p>
      <p className="mt-2 m-0 whitespace-pre-wrap">{review.reason}</p>
      <div className="mt-2 rounded-none border border-amber-200 bg-white/80 p-3 text-xs text-slate-700">
        <p className="m-0 font-semibold text-slate-900">Proposed action</p>
        <p className="mt-1 m-0">{formatActionLabel(review.proposedAction)}</p>
      </div>

      {canEdit ? (
        <div className="mt-3 grid gap-2">
          <Label className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">
            Editable action JSON
          </Label>
          <Textarea
            className="min-h-28 rounded-none border-amber-200 bg-white text-xs"
            value={draft?.actionJson ?? JSON.stringify(review.proposedAction, null, 2)}
            onChange={(event) =>
              onDraftChange({
                actionJson: event.currentTarget.value,
                feedback: draft?.feedback ?? "",
              })
            }
            disabled={disabled}
          />
        </div>
      ) : null}

      {canReject ? (
        <div className="mt-3 grid gap-2">
          <Label className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">
            Rejection feedback
          </Label>
          <Textarea
            className="min-h-20 rounded-none border-amber-200 bg-white text-xs"
            value={draft?.feedback ?? ""}
            onChange={(event) =>
              onDraftChange({
                actionJson: draft?.actionJson ?? JSON.stringify(review.proposedAction, null, 2),
                feedback: event.currentTarget.value,
              })
            }
            placeholder="Tell Sidekick what should change instead."
            disabled={disabled}
          />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          className="rounded-none"
          onClick={() => onDecision("approve")}
          disabled={disabled}
        >
          Approve
        </Button>
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            className="rounded-none"
            onClick={() => onDecision("edit")}
            disabled={disabled}
          >
            Edit and run
          </Button>
        ) : null}
        {canReject ? (
          <Button
            type="button"
            variant="destructive"
            className="rounded-none"
            onClick={() => onDecision("reject")}
            disabled={disabled}
          >
            Reject
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default App;

function parsePageActionRequest(rawValue: string): PageActionRequest {
  const parsed = JSON.parse(rawValue) as Partial<PageActionRequest> | null;
  if (!parsed || typeof parsed !== "object" || typeof parsed.kind !== "string") {
    throw new Error("The edited action JSON is invalid.");
  }

  if (parsed.kind === "click" && typeof parsed.elementId === "string") {
    return {
      kind: "click",
      elementId: parsed.elementId,
    };
  }

  if (
    parsed.kind === "type" &&
    typeof parsed.elementId === "string" &&
    typeof parsed.text === "string"
  ) {
    return {
      kind: "type",
      elementId: parsed.elementId,
      text: parsed.text,
      submit: parsed.submit === true,
    };
  }

  if (parsed.kind === "scroll" && typeof parsed.amount === "number") {
    return {
      kind: "scroll",
      amount: Math.trunc(parsed.amount),
    };
  }

  throw new Error("The edited action JSON must match the page action shape.");
}

function summarizeFocusedAsset(context: FocusedAssetContext) {
  return (
    context.element?.label ||
    context.element?.text ||
    context.element?.placeholder ||
    context.element?.tagName ||
    "Unknown asset"
  );
}

function formatActionLabel(action: PageActionRequest) {
  if (action.kind === "scroll") {
    return `Scroll the page by ${action.amount}px.`;
  }

  if (action.kind === "type") {
    return `Type into ${action.elementId}${action.submit ? " and submit" : ""}.`;
  }

  return `Click ${action.elementId}.`;
}

function getErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while updating the embedded browser.";
}
