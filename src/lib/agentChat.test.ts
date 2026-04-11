import { describe, expect, it } from "vitest";

import { assessSensitiveAction } from "./agentChat";
import type { TargetPageSnapshot } from "./targetBrowser";

const baseSnapshot: TargetPageSnapshot = {
  url: "https://example.com/login",
  title: "Example Login",
  loading: false,
  capturedAt: "2026-04-10T12:00:00.000Z",
  visibleText: "Sign in to continue. Enter your password.",
  headings: ["Sign in"],
  interactiveElements: [
    {
      id: "password-input",
      tagName: "input",
      role: null,
      inputType: "password",
      text: "",
      label: "Password",
      href: null,
      src: null,
      placeholder: "Password",
      isTextInput: true,
      rect: { x: 0, y: 0, width: 200, height: 40 },
    },
    {
      id: "next-button",
      tagName: "button",
      role: "button",
      inputType: null,
      text: "Next",
      label: "Next",
      href: null,
      src: null,
      placeholder: null,
      isTextInput: false,
      rect: { x: 0, y: 50, width: 120, height: 40 },
    },
  ],
  extractionError: null,
};

describe("assessSensitiveAction", () => {
  it("flags password entry as sensitive", () => {
    expect(
      assessSensitiveAction(
        {
          kind: "type",
          elementId: "password-input",
          text: "hunter2",
        },
        baseSnapshot,
      ),
    ).toContain("password");
  });

  it("allows simple scroll actions", () => {
    expect(
      assessSensitiveAction(
        {
          kind: "scroll",
          amount: 480,
        },
        baseSnapshot,
      ),
    ).toBeNull();
  });
});
