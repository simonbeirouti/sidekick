import { FormEvent, KeyboardEvent, useEffect, useId, useState } from "react";
import { AlertCircle, LoaderCircle, SendHorizontal, Sparkles } from "lucide-react";

import { sendAgentMessage, type ChatMessage } from "@/lib/agentChat";
import { type ChatProvider } from "@/lib/chatModel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  getTargetBrowserState,
  LAYOUT_PRESETS,
  listenToTargetBrowser,
  navigateTarget,
  setLayoutPreset,
  type LayoutPreset,
  type TargetBrowserState,
} from "./lib/targetBrowser";

const DEFAULT_PROVIDER = (import.meta.env.VITE_LLM_PROVIDER ?? "openai") as ChatProvider;
const LAYOUT_PRESET_LABELS: Record<LayoutPreset, string> = {
  "70-30": "70/30",
  "50-50": "50/50",
  "30-70": "30/70",
};

function App() {
  const [browser, setBrowser] = useState<TargetBrowserState | null>(null);
  const [input, setInput] = useState("https://developer.mozilla.org");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [agentError, setAgentError] = useState("");
  const [provider, setProvider] = useState<ChatProvider>(DEFAULT_PROVIDER);
  const [submitting, setSubmitting] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "assistant-intro",
      role: "assistant",
      content:
        "Ask me about the page on the right and I’ll answer using the visible page context.",
    },
  ]);
  const activeLayoutPreset = browser?.layoutPreset ?? "50-50";
  const draftId = useId();

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      try {
        const initialState = await getTargetBrowserState();
        if (mounted) {
          setBrowser(initialState);
          setInput(initialState.currentUrl);
        }
      } catch (loadError) {
        if (mounted) {
          setError(getErrorMessage(loadError));
        }
      }
    };

    void setup();

    const unlistenPromise = listenToTargetBrowser((state) => {
      if (!mounted) {
        return;
      }

      setBrowser(state);
      if (!state.loading) {
        setInput(state.currentUrl);
        setSubmitting(false);
      }
    });

    return () => {
      mounted = false;
      void unlistenPromise.then((unlisten) => unlisten());
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

  async function submitDraft(nextDraft: string) {
    if (!nextDraft || isResponding) {
      return;
    }

    setAgentError("");
    setDraft("");
    setIsResponding(true);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: nextDraft,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);

    try {
      const response = await sendAgentMessage(nextMessages, provider);
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response,
        },
      ]);
    } catch (chatError) {
      setAgentError(getErrorMessage(chatError));
      setMessages((currentMessages) =>
        currentMessages.filter((message) => message.id !== userMessage.id),
      );
      setDraft(nextDraft);
    } finally {
      setIsResponding(false);
    }
  }

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitDraft(draft.trim());
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
                    Inspecting the page and drafting a reply
                  </div>
                </article>
              ) : null}
            </div>

            <form className="grid gap-3" onSubmit={handleChatSubmit}>
              <Label htmlFor={draftId} className="text-muted-foreground">
                Ask about what you see on the right
              </Label>
              <Textarea
                id={draftId}
                className="rounded-none min-h-28 border-border bg-background px-4 py-3 text-foreground"
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="What is this page about? What are the main headings? What should I focus on?"
                disabled={isResponding}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="m-0 text-xs text-muted-foreground">
                  Shift+Enter for a new line. Enter to send.
                </p>
                <Button
                  type="submit"
                  size="lg"
                  className="h-11 rounded-none bg-primary text-sm font-semibold text-primary-foreground shadow-[0_10px_24px_rgba(32,78,74,0.25)] hover:bg-primary/90"
                  disabled={isResponding || draft.trim().length === 0}
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
                <AlertTitle>Couldn&apos;t get a grounded answer</AlertTitle>
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

export default App;

function getErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while updating the embedded browser.";
}