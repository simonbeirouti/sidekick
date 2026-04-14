import { GalleryVerticalEnd, LockKeyhole, ShieldCheck } from "lucide-react";

import { LoginForm } from "@/components/login-form";
import type { AuthCredentials } from "@/lib/auth";

type AuthScreenProps = {
  error: string;
  submitting: boolean;
  onSignIn: (credentials: AuthCredentials) => Promise<void>;
  onSignUp: (credentials: AuthCredentials) => Promise<void>;
};

export function AuthScreen({
  error,
  submitting,
  onSignIn,
  onSignUp,
}: AuthScreenProps) {
  return (
    <main className="grid h-dvh w-screen overflow-hidden bg-background lg:grid-cols-2">
      <section className="flex flex-col gap-8 p-6 md:p-10">
        <div className="flex items-center justify-center gap-3 md:justify-start">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <GalleryVerticalEnd className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Sidekick</p>
            <p className="text-xs text-muted-foreground">
              Desktop AI workspace
            </p>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <LoginForm
              error={error}
              submitting={submitting}
              onSignIn={onSignIn}
              onSignUp={onSignUp}
            />
          </div>
        </div>
      </section>

      <aside className="relative hidden overflow-hidden bg-muted lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.7),transparent_42%),linear-gradient(160deg,hsl(var(--muted))_0%,hsl(215_32%_88%)_48%,hsl(212_40%_78%)_100%)]" />
        <div className="relative flex h-full flex-col justify-between p-10 text-slate-900">
          <div className="max-w-md space-y-4">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-600">
              Side-by-side shell
            </p>
            <h1 className="text-4xl font-semibold tracking-[-0.04em] text-balance">
              Sign in, then return straight to the two-pane workspace.
            </h1>
            <p className="text-base leading-7 text-slate-700">
              Authentication stays separate from the main shell. Once the
              session is valid, Sidekick restores the assistant and target site
              in the same desktop window.
            </p>
          </div>

          <div className="grid gap-4">
            <FeaturePanel
              icon={<ShieldCheck className="size-4" />}
              title="Local Supabase auth"
              description="Use the real account lifecycle during local desktop development."
            />
            <FeaturePanel
              icon={<LockKeyhole className="size-4" />}
              title="Native session restore"
              description="Tauri persists app state locally so the workspace can recover cleanly."
            />
          </div>
        </div>
      </aside>
    </main>
  );
}

type FeaturePanelProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
};

function FeaturePanel({ icon, title, description }: FeaturePanelProps) {
  return (
    <div className="max-w-md rounded-xl border border-white/50 bg-white/55 p-5 backdrop-blur">
      <div className="mb-3 flex size-9 items-center justify-center rounded-md bg-white text-slate-900 shadow-sm">
        {icon}
      </div>
      <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-700">{description}</p>
    </div>
  );
}
