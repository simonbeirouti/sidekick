import { LazyStore } from "@tauri-apps/plugin-store";

import type { AuthState } from "./auth";
import type { ChatProvider } from "./chatModel";

const STORE_PATH = "app-state.json";
const store = new LazyStore(STORE_PATH, {
  autoSave: 100,
  defaults: {},
});

type PersistedPreferences = {
  chatProvider: ChatProvider;
};

export type PersistedAppState = {
  auth: AuthState | null;
  preferences: PersistedPreferences;
};

export async function loadPersistedAppState(
  defaultProvider: ChatProvider,
): Promise<PersistedAppState> {
  await store.init();

  const auth = (await store.get<AuthState>("auth")) ?? null;
  const rawPreferences =
    (await store.get<Partial<PersistedPreferences>>("preferences")) ?? {};
  const chatProvider =
    rawPreferences.chatProvider === "ollama" ||
    rawPreferences.chatProvider === "openai"
      ? rawPreferences.chatProvider
      : defaultProvider;

  return {
    auth,
    preferences: {
      chatProvider,
    },
  };
}

export async function persistAuthState(auth: AuthState | null) {
  await store.init();

  if (auth) {
    await store.set("auth", auth);
  } else {
    await store.delete("auth");
  }

  await store.save();
}

export async function persistPreferences(preferences: PersistedPreferences) {
  await store.init();
  await store.set("preferences", preferences);
  await store.save();
}
