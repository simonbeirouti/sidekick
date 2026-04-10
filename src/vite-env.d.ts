/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LLM_PROVIDER?: "openai" | "ollama";
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_OPENAI_MODEL?: string;
  readonly VITE_OLLAMA_MODEL?: string;
  readonly VITE_OLLAMA_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
