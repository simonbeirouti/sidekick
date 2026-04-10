import { describe, expect, it } from "vitest";

import { formatTargetPageSnapshot } from "./pageSnapshot";

describe("formatTargetPageSnapshot", () => {
  it("includes the core snapshot sections", () => {
    const formatted = formatTargetPageSnapshot({
      url: "https://example.com/lesson",
      title: "Example Lesson",
      loading: false,
      capturedAt: "2026-04-10T12:00:00.000Z",
      visibleText: "This is the main lesson content.",
      headings: ["Lesson Overview", "Practice"],
      interactiveLabels: ["Start quiz", "Next page"],
      extractionError: null,
    });

    expect(formatted).toContain("URL: https://example.com/lesson");
    expect(formatted).toContain("Title: Example Lesson");
    expect(formatted).toContain("Headings:");
    expect(formatted).toContain("Interactive elements:");
    expect(formatted).toContain("Visible text:");
  });

  it("surfaces fallback extraction state", () => {
    const formatted = formatTargetPageSnapshot({
      url: "https://example.com",
      title: "",
      loading: true,
      capturedAt: "2026-04-10T12:00:00.000Z",
      visibleText: "",
      headings: [],
      interactiveLabels: [],
      extractionError: "Page inspection timed out.",
    });

    expect(formatted).toContain("limited view");
    expect(formatted).toContain("Visible text: unavailable");
  });
});
