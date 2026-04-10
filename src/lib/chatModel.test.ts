import { describe, expect, it } from "vitest";

import { resolveChatModelConfig } from "./chatModel";

describe("resolveChatModelConfig", () => {
  it("builds ollama config with defaults", () => {
    expect(resolveChatModelConfig({ VITE_LLM_PROVIDER: "ollama" })).toEqual({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
    });
  });

  it("allows an explicit provider override", () => {
    expect(
      resolveChatModelConfig(
        {
          VITE_LLM_PROVIDER: "openai",
          VITE_OLLAMA_MODEL: "qwen3",
        },
        "ollama",
      ),
    ).toEqual({
      provider: "ollama",
      model: "qwen3",
      baseUrl: "http://127.0.0.1:11434",
    });
  });

  it("requires an API key for openai", () => {
    expect(() => resolveChatModelConfig({ VITE_LLM_PROVIDER: "openai" })).toThrow(
      "Missing VITE_OPENAI_API_KEY",
    );
  });

  it("uses the openai model override when provided", () => {
    expect(
      resolveChatModelConfig({
        VITE_LLM_PROVIDER: "openai",
        VITE_OPENAI_API_KEY: "test-key",
        VITE_OPENAI_MODEL: "gpt-4.1",
      }),
    ).toEqual({
      provider: "openai",
      model: "gpt-4.1",
      apiKey: "test-key",
    });
  });
});
