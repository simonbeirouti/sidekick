import { invoke } from "@tauri-apps/api/core";

export type AuthUser = {
  id: string;
  email: string | null;
  role: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  userMetadata: Record<string, unknown> | null;
  appMetadata: Record<string, unknown> | null;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number | null;
  tokenType: string;
};

export type AuthState = {
  session: AuthSession;
  user: AuthUser;
};

export type AuthCredentials = {
  email: string;
  password: string;
  displayName?: string;
};

export function signInWithPassword(credentials: AuthCredentials) {
  return invoke<AuthState>("auth_sign_in_with_password", {
    email: credentials.email,
    password: credentials.password,
  });
}

export function signUpWithPassword(credentials: AuthCredentials) {
  return invoke<AuthState>("auth_sign_up_with_password", {
    email: credentials.email,
    password: credentials.password,
    displayName: credentials.displayName,
  });
}

export function restoreAuthSession(session: AuthSession) {
  return invoke<AuthState>("auth_restore_session", { session });
}

export function signOutOfAccount(session: AuthSession) {
  return invoke<void>("auth_sign_out", { session });
}

export function deleteCurrentAccount(session: AuthSession) {
  return invoke<void>("auth_delete_current_account", { session });
}
