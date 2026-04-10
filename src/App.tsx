import { FormEvent, useEffect, useState, type CSSProperties } from "react";
import "./App.css";
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
      className="app-shell"
      style={{ "--left-pane-percent": `${leftPanelPercent}%` } as CSSProperties}
    >
      <section className="pane left-pane">
        <section className="control-panel">
          <p className="eyebrow">Sidekick Shell</p>
          <h1>Dual-webview workspace</h1>
          <p className="intro">
            The left side is our React control surface. The right side is a native
            Tauri webview that can be pointed at any learning site we want to work
            alongside.
          </p>

          <form className="url-form" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="target-url">
              Target page
            </label>
            <input
              id="target-url"
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              placeholder="Enter a URL"
              autoComplete="off"
            />
            <button type="submit" disabled={submitting}>
              {submitting ? "Loading..." : "Open on right"}
            </button>
          </form>

          <div className="pane-size-card">
            <div className="pane-size-header">
              <p className="field-label">Pane width</p>
              <p className="pane-size-value">{leftPanelPercent}%</p>
            </div>
            <input
              className="pane-slider"
              type="range"
              min="30"
              max="70"
              step="1"
              value={leftPanelPercent}
              onChange={(event) => {
                void handlePaneResize(Number(event.currentTarget.value));
              }}
            />
          </div>

          <div className="preset-grid">
            {[
              "https://developer.mozilla.org",
              "https://www.wikipedia.org",
              "https://www.khanacademy.org",
            ].map((url) => (
              <button
                key={url}
                className="preset-button"
                type="button"
                onClick={() => {
                  setInput(url);
                  setError("");
                }}
              >
                {new URL(url).host.replace("www.", "")}
              </button>
            ))}
          </div>

          <div className="status-card">
            <span className={`status-dot ${browser?.loading ? "live" : "idle"}`} />
            <div>
              <p className="status-label">Right-side webview</p>
              <p className="status-value">
                {browser?.loading ? "Loading a page" : "Ready"}
              </p>
            </div>
          </div>

          <dl className="meta">
            <div>
              <dt>Current URL</dt>
              <dd>{browser?.currentUrl ?? "Starting embedded browser..."}</dd>
            </div>
            <div>
              <dt>Requested URL</dt>
              <dd>{browser?.requestedUrl ?? "Waiting for input"}</dd>
            </div>
          </dl>

          {error ? <p className="error-message">{error}</p> : null}

          <div className="notes">
            <p>First build milestone</p>
            <ul>
              <li>Two webviews share the same desktop window.</li>
              <li>The right side can be changed from the left control panel.</li>
              <li>The backend keeps navigation and page-load state in sync.</li>
            </ul>
          </div>
        </section>
      </section>
      <section className="pane right-pane" aria-hidden="true">
        <div className="browser-placeholder">
          <p className="browser-placeholder-label">Embedded Browser</p>
          <p className="browser-placeholder-url">
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
