import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";

type EnvSource = Record<string, string | undefined>;
export type ChatProvider = "openai" | "ollama";

export type ChatModelConfig =
  | {
      provider: "openai";
      model: string;
      apiKey: string;
    }
  | {
      provider: "ollama";
      model: string;
      baseUrl: string;
    };

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_OLLAMA_MODEL = "llama3.2";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export function resolveChatModelConfig(
  env: EnvSource = import.meta.env as unknown as EnvSource,
  providerOverride?: ChatProvider,
): ChatModelConfig {
  const provider = (providerOverride ?? env.VITE_LLM_PROVIDER ?? "openai").toLowerCase();

  if (provider === "ollama") {
    return {
      provider: "ollama",
      model: env.VITE_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
      baseUrl: env.VITE_OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL,
    };
  }

  if (provider !== "openai") {
    throw new Error(
      `Unsupported VITE_LLM_PROVIDER "${provider}". Use "openai" or "ollama".`,
    );
  }

  const apiKey = env.VITE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing VITE_OPENAI_API_KEY for the OpenAI chat provider.",
    );
  }

  return {
    provider: "openai",
    model: env.VITE_OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    apiKey,
  };
}

export function getChatModel(
  env: EnvSource = import.meta.env as unknown as EnvSource,
  providerOverride?: ChatProvider,
) {
  const config = resolveChatModelConfig(env, providerOverride);

  if (config.provider === "openai") {
    return new ChatOpenAI({
      model: config.model,
      apiKey: config.apiKey,
    });
  }

  return new ChatOllama({
    model: config.model,
    baseUrl: config.baseUrl,
  });
}
