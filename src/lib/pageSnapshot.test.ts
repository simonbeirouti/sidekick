import { describe, expect, it } from "vitest";

import { formatFocusedAssetContext, formatTargetPageSnapshot } from "./pageSnapshot";

describe("formatTargetPageSnapshot", () => {
  it("includes the core snapshot sections", () => {
    const formatted = formatTargetPageSnapshot({
      url: "https://example.com/lesson",
      title: "Example Lesson",
      loading: false,
      capturedAt: "2026-04-10T12:00:00.000Z",
      visibleText: "This is the main lesson content.",
      headings: ["Lesson Overview", "Practice"],
      interactiveElements: [
        {
          id: "sk-1",
          tagName: "button",
          role: "button",
          inputType: null,
          text: "Start quiz",
          label: "Start quiz",
          href: null,
          src: null,
          placeholder: null,
          isTextInput: false,
          rect: { x: 0, y: 0, width: 120, height: 40 },
        },
      ],
      extractionError: null,
    });

    expect(formatted).toContain("URL: https://example.com/lesson");
    expect(formatted).toContain("Title: Example Lesson");
    expect(formatted).toContain("Headings:");
    expect(formatted).toContain("Interactive elements:");
    expect(formatted).toContain("Start quiz");
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
      interactiveElements: [],
      extractionError: "Page inspection timed out.",
    });

    expect(formatted).toContain("limited view");
    expect(formatted).toContain("Visible text: unavailable");
  });
});

describe("formatFocusedAssetContext", () => {
  it("formats selected asset context", () => {
    const formatted = formatFocusedAssetContext({
      element: {
        id: "sk-2",
        tagName: "img",
        role: null,
        inputType: null,
        text: "",
        label: "Neuron diagram",
        href: null,
        src: "https://example.com/neuron.png",
        placeholder: null,
        isTextInput: false,
        rect: { x: 10, y: 20, width: 300, height: 200 },
      },
      nearbyText: "This diagram explains the parts of a neuron.",
      headings: ["The Nervous System"],
      parentSection: "Biology basics",
      capturedAt: "2026-04-10T12:00:00.000Z",
      extractionError: null,
    });

    expect(formatted).toContain("Selected asset: Neuron diagram");
    expect(formatted).toContain("Parent section: Biology basics");
    expect(formatted).toContain("Nearby headings:");
    expect(formatted).toContain("Nearby text:");
  });
});
