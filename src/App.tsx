import { FormEvent, useEffect, useState, type CSSProperties } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";

import {
  getTargetBrowserState,
  listenToTargetBrowser,
  navigateTarget,
  setLeftPanelRatio,
  type TargetBrowserState,
} from "./lib/targetBrowser";

function App() {
  const [browser, setBrowser] = useState<TargetBrowserState | null>(null);
  const [input, setInput] = useState("https://developer.mozilla.org");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const leftPanelPercent = Math.round((browser?.leftPanelRatio ?? 0.5) * 100);

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

  async function handlePaneResize(nextPercent: number) {
    setError("");

    try {
      const nextState = await setLeftPanelRatio(nextPercent / 100);
      setBrowser(nextState);
    } catch (resizeError) {
      setError(getErrorMessage(resizeError));
    }
  }

  return (
    <main
      className="grid min-h-screen gap-0 overflow-hidden p-2 md:p-3 lg:p-6"
      style={
        {
          gridTemplateColumns: `minmax(320px, ${leftPanelPercent}%) minmax(320px, 1fr)`,
        } as CSSProperties
      }
    >
      <section className="min-w-0 pr-1 md:pr-2 lg:pr-3">
        <section className="@container flex min-h-[calc(100vh-1rem)] w-full flex-col gap-4 rounded-[20px] border border-black/8 bg-[rgba(255,252,247,0.9)] p-4 shadow-[0_20px_60px_rgba(39,52,68,0.12),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-[10px] md:min-h-[calc(100vh-1.5rem)] md:rounded-[22px] md:p-5 lg:min-h-[calc(100vh-3rem)] lg:gap-5 lg:rounded-[28px] lg:p-7">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <Badge
                variant="outline"
                className="rounded-full border-[#52614d]/20 bg-[#eef4ea] px-3 py-1 text-[0.7rem] uppercase tracking-[0.18em] text-[#52614d]"
              >
                Sidekick Shell
              </Badge>
              <Badge
                variant="secondary"
                className="rounded-full bg-white/80 px-3 py-1 text-[0.72rem] font-semibold text-[#3f5146]"
              >
                v1 shell
              </Badge>
            </div>

            <div className="space-y-2">
              <h1 className="m-0 text-[1.35rem] leading-none font-semibold tracking-[-0.05em] text-[#171717] @min-[421px]:text-[1.7rem] lg:text-[2.4rem]">
                Dual-webview workspace
              </h1>
              <p className="m-0 max-w-2xl text-[0.88rem] text-[#46515b] @min-[421px]:text-[0.94rem] lg:text-base">
                The left side is our React control surface. The right side is a native
                Tauri webview that can be pointed at any learning site we want to work
                alongside.
              </p>
            </div>
          </div>

          <Card className="border border-black/6 bg-white/80 shadow-sm">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm font-semibold text-[#25313a]">
                Target Page
              </CardTitle>
              <CardDescription>
                Choose the page we should open in the embedded browser.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={handleSubmit}>
                <Label htmlFor="target-url" className="text-[#52614d]">
                  URL
                </Label>
                <Input
                  id="target-url"
                  className="h-11 rounded-2xl border-black/8 bg-white"
                  value={input}
                  onChange={(event) => setInput(event.currentTarget.value)}
                  placeholder="Enter a URL"
                  autoComplete="off"
                />
                <Button
                  type="submit"
                  size="lg"
                  className="h-11 rounded-2xl bg-[linear-gradient(135deg,#204e4a_0%,#366a5a_100%)] text-sm font-semibold text-[#f7f5ef] shadow-[0_10px_24px_rgba(32,78,74,0.25)] hover:opacity-95"
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

          <Card className="border border-black/6 bg-white/80 shadow-sm">
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-semibold text-[#25313a]">
                    Pane Width
                  </CardTitle>
                  <CardDescription>
                    Adjust how much space the assistant panel occupies.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="rounded-full px-3">
                  {leftPanelPercent}%
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-1">
              <Slider
                value={[leftPanelPercent]}
                min={30}
                max={70}
                step={1}
                onValueChange={(value) => {
                  const [next] = Array.isArray(value) ? value : [value];
                  if (typeof next === "number") {
                    void handlePaneResize(next);
                  }
                }}
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-2 @min-[421px]:grid-cols-2 lg:grid-cols-3">
            {[
              "https://developer.mozilla.org",
              "https://www.wikipedia.org",
              "https://www.khanacademy.org",
            ].map((url) => (
              <Button
                key={url}
                type="button"
                variant="secondary"
                className="h-auto rounded-[18px] border border-[#bdd5c9]/40 bg-[rgba(189,213,201,0.28)] px-3 py-3 text-sm font-semibold text-[#21443f] shadow-none hover:bg-[rgba(189,213,201,0.45)]"
                onClick={() => {
                  setInput(url);
                  setError("");
                }}
              >
                {new URL(url).host.replace("www.", "")}
              </Button>
            ))}
          </div>

          <Card className="border border-black/6 bg-white/80 shadow-sm">
            <CardContent className="flex items-center gap-3 pt-4">
              <Badge
                variant={browser?.loading ? "default" : "secondary"}
                className={
                  browser?.loading
                    ? "rounded-full bg-[#1f8f68] px-2.5 text-white"
                    : "rounded-full bg-[#eef2f4] px-2.5 text-[#52616d]"
                }
              >
                {browser?.loading ? "Loading" : "Ready"}
              </Badge>
              <div>
                <p className="m-0 text-[0.74rem] font-bold tracking-[0.03em] text-[#52614d] lg:text-[0.85rem]">
                  Right-side webview
                </p>
                <p className="mt-0.5 text-base font-semibold text-[#171717]">
                  {browser?.loading ? "Loading a page" : "Connected"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-black/6 bg-white/80 shadow-sm">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm font-semibold text-[#25313a]">
                Session Metadata
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-[0.74rem] font-bold tracking-[0.03em] text-[#52614d] lg:text-[0.85rem]">
                  Current URL
                </p>
                <p className="break-words text-[0.88rem] text-[#24313c] @min-[421px]:text-[0.94rem] lg:text-base">
                  {browser?.currentUrl ?? "Starting embedded browser..."}
                </p>
              </div>
              <Separator />
              <div className="space-y-1.5">
                <p className="text-[0.74rem] font-bold tracking-[0.03em] text-[#52614d] lg:text-[0.85rem]">
                  Requested URL
                </p>
                <p className="break-words text-[0.88rem] text-[#24313c] @min-[421px]:text-[0.94rem] lg:text-base">
                  {browser?.requestedUrl ?? "Waiting for input"}
                </p>
              </div>
            </CardContent>
          </Card>

          {error ? (
            <Alert variant="destructive" className="border-destructive/20 bg-destructive/5">
              <AlertCircle className="size-4" />
              <AlertTitle>Couldn&apos;t update the embedded browser</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Card className="mt-auto border border-black/6 bg-[linear-gradient(180deg,rgba(235,243,250,0.95),rgba(245,248,240,0.95))] shadow-sm">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm font-semibold text-[#25313a]">
                First Build Milestone
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="pl-4 text-[0.88rem] text-[#37444f] @min-[421px]:text-[0.94rem] lg:text-base">
                <li>Two webviews share the same desktop window.</li>
                <li>The right side can be changed from the left control panel.</li>
                <li>The backend keeps navigation and page-load state in sync.</li>
              </ul>
            </CardContent>
          </Card>
        </section>
      </section>

      <section className="min-w-0 pl-1 md:pl-2 lg:pl-3" aria-hidden="true">
        <div className="flex min-h-[calc(100vh-1rem)] flex-col justify-end rounded-[20px] bg-[linear-gradient(180deg,rgba(21,28,35,0.92),rgba(18,22,30,0.96))] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),0_20px_60px_rgba(9,14,21,0.24)] md:min-h-[calc(100vh-1.5rem)] md:rounded-[22px] md:p-5 lg:min-h-[calc(100vh-3rem)] lg:rounded-[28px] lg:p-6">
          <p className="mb-1.5 text-[0.78rem] font-bold uppercase tracking-[0.14em] text-[rgba(210,221,229,0.72)]">
            Embedded Browser
          </p>
          <p className="m-0 break-words text-sm text-[#f3f7fb] lg:text-base">
            {browser?.currentUrl ?? "Waiting for the native webview to load"}
          </p>
        </div>
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
