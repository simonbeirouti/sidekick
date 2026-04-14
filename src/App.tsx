import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { AuthScreen } from "@/components/AuthScreen";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import {
  deleteCurrentAccount,
  restoreAuthSession,
  signInWithPassword,
  signOutOfAccount,
  signUpWithPassword,
  type AuthCredentials,
  type AuthState,
} from "@/lib/auth";
import { loadPersistedAppState, persistAuthState, persistPreferences } from "@/lib/appStore";
import { type ChatProvider } from "@/lib/chatModel";
import { activateWorkspaceShell, deactivateWorkspaceShell } from "@/lib/targetBrowser";

const DEFAULT_PROVIDER = (import.meta.env.VITE_LLM_PROVIDER ??
  "openai") as ChatProvider;

function App() {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [provider, setProvider] = useState<ChatProvider>(DEFAULT_PROVIDER);
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const persisted = await loadPersistedAppState(DEFAULT_PROVIDER);

        if (!mounted) {
          return;
        }

        setProvider(persisted.preferences.chatProvider);

        if (!persisted.auth) {
          setAuthState(null);
          setIsBootstrapping(false);
          return;
        }

        try {
          const restored = await restoreAuthSession(persisted.auth.session);

          if (!mounted) {
            return;
          }

          await activateWorkspaceShell();
          setAuthState(restored);
          await persistAuthState(restored);
        } catch {
          await deactivateWorkspaceShell().catch(() => undefined);
          await persistAuthState(null);

          if (!mounted) {
            return;
          }

          setAuthState(null);
        }
      } catch (error) {
        if (mounted) {
          setAuthError(getErrorMessage(error));
        }
      } finally {
        if (mounted) {
          setIsBootstrapping(false);
        }
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleProviderChange(nextProvider: ChatProvider) {
    setProvider(nextProvider);

    try {
      await persistPreferences({ chatProvider: nextProvider });
    } catch (error) {
      setAuthError(getErrorMessage(error));
    }
  }

  async function handleSignIn(credentials: AuthCredentials) {
    setAuthError("");
    setAuthSubmitting(true);

    try {
      const nextAuthState = await signInWithPassword(credentials);
      await activateWorkspaceShell();
      await persistAuthState(nextAuthState);
      setAuthState(nextAuthState);
    } catch (error) {
      setAuthError(getErrorMessage(error));
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleSignUp(credentials: AuthCredentials) {
    setAuthError("");
    setAuthSubmitting(true);

    try {
      const nextAuthState = await signUpWithPassword(credentials);
      await activateWorkspaceShell();
      await persistAuthState(nextAuthState);
      setAuthState(nextAuthState);
    } catch (error) {
      setAuthError(getErrorMessage(error));
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleSignOut() {
    if (!authState) {
      return;
    }

    setAuthError("");
    setAuthSubmitting(true);

    try {
      await signOutOfAccount(authState.session);
    } catch (error) {
      setAuthError(getErrorMessage(error));
    } finally {
      await deactivateWorkspaceShell().catch(() => undefined);
      await persistAuthState(null);
      setAuthState(null);
      setAuthSubmitting(false);
    }
  }

  async function handleDeleteAccount() {
    if (!authState) {
      return;
    }

    setAuthError("");
    setAuthSubmitting(true);

    try {
      await deleteCurrentAccount(authState.session);
      await deactivateWorkspaceShell().catch(() => undefined);
      await persistAuthState(null);
      setAuthState(null);
    } catch (error) {
      setAuthError(getErrorMessage(error));
    } finally {
      setAuthSubmitting(false);
    }
  }

  if (isBootstrapping) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(245,221,187,0.92),rgba(255,248,237,0.9)_38%,rgba(214,232,228,0.88)_100%)]">
        <div className="flex items-center gap-3 border border-black/10 bg-white/80 px-4 py-3 text-sm font-medium text-slate-800 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Restoring the Sidekick shell
        </div>
      </main>
    );
  }

  if (!authState) {
    return (
      <AuthScreen
        error={authError}
        submitting={authSubmitting}
        onSignIn={handleSignIn}
        onSignUp={handleSignUp}
      />
    );
  }

  return (
    <WorkspaceShell
      key={authState.user.id}
      authState={authState}
      provider={provider}
      accountBusy={authSubmitting}
      accountError={authError}
      onProviderChange={handleProviderChange}
      onSignOut={handleSignOut}
      onDeleteAccount={handleDeleteAccount}
    />
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

  return "Something went wrong while updating the application state.";
}
