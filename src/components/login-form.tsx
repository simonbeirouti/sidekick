import { FormEvent, useId, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AuthCredentials } from "@/lib/auth";

export function LoginForm({
  error,
  submitting,
  onSignIn,
  onSignUp,
  className,
  ...props
}: LoginFormProps) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const emailId = useId();
  const passwordId = useId();
  const displayNameId = useId();
  const isSignUp = mode === "sign-up";
  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 6 &&
    (!isSignUp || displayName.trim().length > 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const credentials: AuthCredentials = {
      email: email.trim(),
      password,
      displayName: isSignUp ? displayName.trim() : undefined,
    };

    if (isSignUp) {
      await onSignUp(credentials);
      return;
    }

    await onSignIn(credentials);
  }

  return (
    <form
      className={cn("flex flex-col gap-6", className)}
      onSubmit={(event) => void handleSubmit(event)}
      {...props}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">
            {isSignUp ? "Create your account" : "Login to your account"}
          </h1>
          <p className="text-sm text-balance text-muted-foreground">
            {isSignUp
              ? "Enter your details to create a Sidekick account."
              : "Enter your email below to login to your account."}
          </p>
        </div>
        <Field className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={isSignUp ? "outline" : "default"}
            onClick={() => setMode("sign-in")}
            disabled={submitting}
          >
            Sign in
          </Button>
          <Button
            type="button"
            variant={isSignUp ? "default" : "outline"}
            onClick={() => setMode("sign-up")}
            disabled={submitting}
          >
            Create account
          </Button>
        </Field>
        {isSignUp ? (
          <Field>
            <FieldLabel htmlFor={displayNameId}>Display name</FieldLabel>
            <Input
              id={displayNameId}
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
              placeholder="Student name"
              autoComplete="name"
              disabled={submitting}
              required
            />
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor={emailId}>Email</FieldLabel>
          <Input
            id={emailId}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            placeholder="student@example.com"
            autoComplete="email"
            disabled={submitting}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
          <Input
            id={passwordId}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            placeholder="At least 6 characters"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            disabled={submitting}
            required
          />
        </Field>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Authentication failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Field>
          <Button type="submit" disabled={submitting || !canSubmit}>
            {submitting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Working
              </>
            ) : (
              <>
                {isSignUp ? "Create account" : "Login"}
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
          <FieldDescription className="text-center">
            {isSignUp ? "Already have an account?" : "Don&apos;t have an account?"}{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => setMode(isSignUp ? "sign-in" : "sign-up")}
              disabled={submitting}
            >
              {isSignUp ? "Sign in" : "Sign up"}
            </button>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}

type AuthMode = "sign-in" | "sign-up";

type LoginFormProps = Omit<React.ComponentProps<"form">, "onSubmit"> & {
  error: string;
  submitting: boolean;
  onSignIn: (credentials: AuthCredentials) => Promise<void>;
  onSignUp: (credentials: AuthCredentials) => Promise<void>;
};
