import {
  FormEvent,
  KeyboardEvent,
  startTransition,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Globe,
  LoaderCircle,
  MousePointerClick,
  Plus,
  RefreshCcw,
  SendHorizontal,
  Sparkles,
  WandSparkles,
  X,
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
import { cn } from "@/lib/utils";

import {
  activateTargetTab,
  closeTargetTab,
  getFocusedAssetContext,
  getTargetBrowserState,
  LAYOUT_PRESETS,
  listenToFocusedAsset,
  listenToTargetBrowser,
  navigateTarget,
  navigateTargetBack,
  navigateTargetForward,
  openTargetTab,
  reloadTarget,
  setAssetPickerEnabled,
  setLayoutPreset,
  type BrowserTabState,
  type FocusedAssetContext,
  type LayoutPreset,
  type PageActionRequest,
  type PageActionResult,
  type TargetBrowserState,
} from "./lib/targetBrowser";

const DEFAULT_PROVIDER = (import.meta.env.VITE_LLM_PROVIDER ??
  "openai") as ChatProvider;
const TARGET_CHROME_HEIGHT_PX = 156;
const LAYOUT_PRESET_LABELS: Record<LayoutPreset, string> = {
  "70-30": "70/30",
  "50-50": "50/50",
  "30-70": "30/70",
};
const COLUMN_TEMPLATE_BY_PRESET: Record<LayoutPreset, string> = {
  "70-30": "70fr 30fr",
  "50-50": "50fr 50fr",
  "30-70": "30fr 70fr",
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
  const [focusedAsset, setFocusedAsset] = useState<FocusedAssetContext | null>(
    null,
  );
  const [input, setInput] = useState("https://developer.mozilla.org");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [agentError, setAgentError] = useState("");
  const [provider, setProvider] = useState<ChatProvider>(DEFAULT_PROVIDER);
  const [submitting, setSubmitting] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [pendingReview, setPendingReview] = useState<HumanReviewRequest | null>(
    null,
  );
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>(
    {},
  );
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
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const activeTab =
    browser?.tabs.find((tab) => tab.id === browser.activeTabId) ??
    browser?.tabs[0] ??
    null;

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
        setInput(initialState.requestedUrl || initialState.currentUrl);
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
      setInput(state.requestedUrl || state.currentUrl);
      setSubmitting(false);
    });

    const unlistenFocusedAssetPromise = listenToFocusedAsset(
      (nextFocusedAsset) => {
        if (mounted) {
          setFocusedAsset(nextFocusedAsset);
        }
      },
    );

    return () => {
      mounted = false;
      void unlistenBrowserPromise.then((unlisten) => unlisten());
      void unlistenFocusedAssetPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!browser?.activeTabId || !tabStripRef.current) {
      return;
    }

    const activeTabElement = tabStripRef.current.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(browser.activeTabId)}"]`,
    );

    activeTabElement?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [browser?.activeTabId, browser?.tabs.length]);

  async function handleNavigateSubmit(event: FormEvent<HTMLFormElement>) {
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

  async function handleOpenTab() {
    setError("");
    setSubmitting(true);

    try {
      const nextState = await openTargetTab();
      setBrowser(nextState);
      setInput(nextState.requestedUrl);
      setFocusedAsset(null);
    } catch (openError) {
      setError(getErrorMessage(openError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleActivateTab(tabId: string) {
    if (!browser || tabId === browser.activeTabId) {
      return;
    }

    setError("");

    try {
      const nextState = await activateTargetTab(tabId);
      setBrowser(nextState);
      setInput(nextState.requestedUrl || nextState.currentUrl);
      setFocusedAsset(null);
    } catch (activateError) {
      setError(getErrorMessage(activateError));
    }
  }

  async function handleCloseTab(tabId: string) {
    setError("");

    try {
      const nextState = await closeTargetTab(tabId);
      setBrowser(nextState);
      setInput(nextState.requestedUrl || nextState.currentUrl);
      setFocusedAsset(null);
    } catch (closeError) {
      setError(getErrorMessage(closeError));
    }
  }

  async function handleHistoryNavigation(direction: "back" | "forward") {
    setError("");

    try {
      const nextState =
        direction === "back"
          ? await navigateTargetBack()
          : await navigateTargetForward();
      setBrowser(nextState);
      setFocusedAsset(null);
    } catch (navigationError) {
      setError(getErrorMessage(navigationError));
    }
  }

  async function handleReload() {
    setError("");

    try {
      const nextState = await reloadTarget();
      setBrowser(nextState);
      setFocusedAsset(null);
    } catch (reloadError) {
      setError(getErrorMessage(reloadError));
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
      [reply.review.id]: currentDrafts[reply.review.id] ?? {
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
      const nextState = await setAssetPickerEnabled(
        !browser.assetPickerEnabled,
      );
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
                message:
                  draftState?.feedback.trim() ||
                  "Rejected from the assistant panel.",
              } satisfies HumanReviewDecision);

      const response = await resumeHumanReview(
        review,
        decision,
        provider,
        threadId,
      );
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
    <main className="h-dvh min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(216,226,240,0.95),rgba(243,246,249,0.85)_42%,rgba(228,235,241,0.9)_100%) text-foreground">
      <section
        className="grid h-full w-full min-w-0 min-h-0"
        style={{
          gridTemplateColumns: COLUMN_TEMPLATE_BY_PRESET[activeLayoutPreset],
          gridTemplateRows: `${TARGET_CHROME_HEIGHT_PX}px minmax(0, 1fr)`,
        }}
      >
        <div className="row-span-2 min-h-0 min-w-0 overflow-hidden border-r border-border/80 bg-background/88">
          <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden p-4 lg:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="m-0 pt-2 text-[1.45rem] leading-none font-semibold tracking-[-0.05em] text-foreground lg:text-[2rem]">
                  Sidekick page chat
                </h1>
                <p className="mt-2 mb-0 text-sm text-muted-foreground">
                  Chat and reasoning stay on the left while browser controls now
                  live beside the active page.
                </p>
              </div>

              <div className="flex min-w-55 items-center gap-2">
                <Label
                  htmlFor="provider-select"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Provider
                </Label>
                <Select
                  value={provider}
                  onValueChange={(value) => setProvider(value as ChatProvider)}
                >
                  <SelectTrigger
                    id="provider-select"
                    className="h-10 w-40 border-border bg-card px-3 text-foreground"
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

            <Card className="rounded-none border border-border/80 bg-card/85 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="m-0 text-[0.72rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Current page context
                    </p>
                    <p className="mt-1 text-sm font-semibold text-card-foreground">
                      {browser?.pageTitle ||
                        "Page title will appear after the first inspection"}
                    </p>
                    <p className="mt-1 wrap-break-words text-[0.82rem] text-muted-foreground">
                      {browser?.currentUrl ??
                        "Waiting for the native webview to load"}
                    </p>
                  </div>

                  <span className="border border-border px-3 py-1 text-xs font-semibold text-muted-foreground">
                    {LAYOUT_PRESET_LABELS[activeLayoutPreset]}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {focusedAsset?.element ? (
                    <Badge
                      variant="outline"
                      className="rounded-none border-border px-3 py-1 text-xs"
                    >
                      Selected: {summarizeFocusedAsset(focusedAsset)}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="rounded-none border-dashed px-3 py-1 text-xs"
                    >
                      No asset selected
                    </Badge>
                  )}

                  {activeTab ? (
                    <Badge
                      variant="outline"
                      className="rounded-none border-border px-3 py-1 text-xs"
                    >
                      Active tab: {tabLabel(activeTab)}
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>
            </Card>

            <Card className="rounded-none flex min-h-0 flex-1 flex-col border border-border/80 bg-card/85 shadow-sm">
              <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border border-border bg-muted/30 p-3">
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

                      <p className="m-0 whitespace-pre-wrap leading-6">
                        {message.content}
                      </p>

                      {message.type === "action" ? (
                        <div className="mt-3 border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                          <p className="m-0 font-semibold text-card-foreground">
                            Action result: {message.action.action.kind}
                          </p>
                          <p className="mt-1 m-0">
                            {message.action.success ? "Completed" : "Failed"} on{" "}
                            {message.action.browser.pageTitle ||
                              message.action.browser.currentUrl}
                          </p>
                          {message.action.focusedAsset?.element ? (
                            <p className="mt-1 m-0">
                              Focused asset:{" "}
                              {summarizeFocusedAsset(
                                message.action.focusedAsset,
                              )}
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
                    Ask about the page, the selected asset, or tell Sidekick
                    what to do next
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
                          Resolve the pending review card before sending another
                          request.
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="submit"
                      size="lg"
                      className="h-11 rounded-none bg-primary text-sm font-semibold text-primary-foreground shadow-[0_10px_24px_rgba(32,78,74,0.25)] hover:bg-primary/90"
                      disabled={
                        isResponding ||
                        pendingReview !== null ||
                        draft.trim().length === 0
                      }
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
                  <Alert
                    variant="destructive"
                    className="border-destructive/20 bg-destructive/5"
                  >
                    <AlertCircle className="size-4" />
                    <AlertTitle>
                      Couldn&apos;t complete the grounded step
                    </AlertTitle>
                    <AlertDescription>{agentError}</AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>

            <Card className="rounded-none border border-border/80 bg-card/85 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-sm font-semibold text-card-foreground">
                  Pane Layout
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 pt-3">
                <div className="grid grid-cols-3 gap-2">
                  {LAYOUT_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant={
                        preset === activeLayoutPreset ? "default" : "outline"
                      }
                      className="h-11 rounded-none text-sm font-semibold"
                      onClick={() => {
                        void handleLayoutPresetChange(preset);
                      }}
                    >
                      {LAYOUT_PRESET_LABELS[preset]}
                    </Button>
                  ))}
                </div>
                <p className="m-0 text-xs text-muted-foreground">
                  The app shell now spans the full window so the right pane can
                  carry its own browser chrome.
                </p>
              </CardContent>
            </Card>

            {error ? (
              <Alert
                variant="destructive"
                className="border-destructive/20 bg-destructive/5"
              >
                <AlertCircle className="size-4" />
                <AlertTitle>
                  Couldn&apos;t update the embedded browser
                </AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>

        <div className="min-w-0 overflow-hidden border-b border-border/80 bg-[linear-gradient(180deg,rgba(247,249,251,0.98),rgba(239,244,248,0.96))] backdrop-blur">
          <div className="flex h-full flex-col gap-2.5 p-2">
            <div className="flex min-w-0 items-center gap-2">
              <div ref={tabStripRef} className="min-w-0 flex-1 overflow-x-auto">
                <div className="flex w-max min-w-full items-center gap-2">
                  {browser?.tabs.map((tab) => {
                    const isActive = tab.id === browser.activeTabId;

                    return (
                      <button
                        key={tab.id}
                        data-tab-id={tab.id}
                        type="button"
                        className={cn(
                          "group flex h-10 items-center gap-2.5 border px-3 text-left text-sm font-medium leading-none tracking-[-0.01em] transition",
                          isActive
                            ? "w-[256px] border-black bg-black text-white shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
                            : "w-[156px] border-border bg-white/75 text-slate-700 hover:border-slate-400 hover:bg-white",
                        )}
                        onClick={() => {
                          void handleActivateTab(tab.id);
                        }}
                      >
                        <Globe className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {tabLabel(tab)}
                        </span>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center justify-center rounded-full p-1 opacity-70 transition hover:opacity-100",
                            browser.tabs.length <= 1 &&
                              "pointer-events-none opacity-30",
                          )}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (browser.tabs.length > 1) {
                              void handleCloseTab(tab.id);
                            }
                          }}
                        >
                          <X className="size-3.5" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-10 shrink-0 rounded-none px-3"
                onClick={() => {
                  void handleOpenTab();
                }}
                disabled={submitting}
              >
                <Plus className="size-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-10 w-10 rounded-none bg-white/70"
                onClick={() => {
                  void handleHistoryNavigation("back");
                }}
                disabled={!browser}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-10 w-10 rounded-none bg-white/70"
                onClick={() => {
                  void handleHistoryNavigation("forward");
                }}
                disabled={!browser}
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-10 w-10 rounded-none bg-white/70"
                onClick={() => {
                  void handleReload();
                }}
                disabled={!browser}
              >
                <RefreshCcw className="size-4" />
              </Button>

              <form
                className="flex min-w-0 flex-1 items-center gap-2"
                onSubmit={handleNavigateSubmit}
              >
                <Input
                  id="target-url"
                  className="h-10 rounded-none border-border bg-white/88 text-foreground"
                  value={input}
                  onChange={(event) => setInput(event.currentTarget.value)}
                  placeholder="Enter a URL"
                  autoComplete="off"
                />
              </form>

              <Button
                type="button"
                variant={browser?.assetPickerEnabled ? "default" : "outline"}
                className={cn(
                  "h-10 rounded-none px-4",
                  browser?.assetPickerEnabled
                    ? "border-slate-400 bg-slate-200 text-slate-950 hover:bg-slate-300"
                    : "bg-white/70",
                )}
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
                    Pick
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="min-w-0 border-l border-border/70 bg-transparent" />
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

function ReviewCard({
  review,
  draft,
  disabled,
  onDraftChange,
  onDecision,
}: ReviewCardProps) {
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
            value={
              draft?.actionJson ??
              JSON.stringify(review.proposedAction, null, 2)
            }
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
                actionJson:
                  draft?.actionJson ??
                  JSON.stringify(review.proposedAction, null, 2),
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
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.kind !== "string"
  ) {
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

function tabLabel(tab: BrowserTabState) {
  return tab.pageTitle || tab.currentUrl || tab.requestedUrl || "New tab";
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
