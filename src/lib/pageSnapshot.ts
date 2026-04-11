import type { FocusedAssetContext, TargetElementDescriptor, TargetPageSnapshot } from "./targetBrowser";

const MAX_TEXT_PREVIEW_LENGTH = 2200;
const MAX_FOCUSED_TEXT_PREVIEW_LENGTH = 2200;
const MAX_LIST_ITEMS = 8;

function joinList(items: string[]) {
  return items.slice(0, MAX_LIST_ITEMS).map((item) => `- ${item}`).join("\n");
}

function formatElementDescriptor(element: TargetElementDescriptor) {
  const primary = element.label || element.text || element.placeholder || element.tagName;
  const parts = [
    primary,
    `${element.tagName}${element.role ? ` (${element.role})` : ""}`,
  ];

  if (element.href) {
    parts.push(`href=${element.href}`);
  }

  if (element.src) {
    parts.push(`src=${element.src}`);
  }

  return `- ${parts.join(" | ")}`;
}

export function formatTargetPageSnapshot(snapshot: TargetPageSnapshot) {
  const sections = [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title || "Untitled page"}`,
    `Loading: ${snapshot.loading ? "yes" : "no"}`,
    `Captured at: ${snapshot.capturedAt}`,
  ];

  if (snapshot.extractionError) {
    sections.push(`Extraction status: limited view (${snapshot.extractionError})`);
  }

  if (snapshot.headings.length > 0) {
    sections.push(`Headings:\n${joinList(snapshot.headings)}`);
  }

  if (snapshot.interactiveElements.length > 0) {
    sections.push(
      `Interactive elements:\n${snapshot.interactiveElements
        .slice(0, MAX_LIST_ITEMS)
        .map(formatElementDescriptor)
        .join("\n")}`,
    );
  }

  const textPreview = snapshot.visibleText.trim().slice(0, MAX_TEXT_PREVIEW_LENGTH);
  if (textPreview) {
    sections.push(`Visible text:\n${textPreview}`);
  } else {
    sections.push("Visible text: unavailable");
  }

  return sections.join("\n\n");
}

export function formatFocusedAssetContext(context: FocusedAssetContext | null) {
  if (!context) {
    return "Focused asset: none selected.";
  }

  const sections = [
    `Captured at: ${context.capturedAt}`,
    `Selected asset: ${
      context.element
        ? context.element.label || context.element.text || context.element.placeholder || context.element.tagName
        : "Unknown element"
    }`,
  ];

  if (context.parentSection) {
    sections.push(`Parent section: ${context.parentSection}`);
  }

  if (context.headings.length > 0) {
    sections.push(`Nearby headings:\n${joinList(context.headings)}`);
  }

  const nearbyText = context.nearbyText.trim().slice(0, MAX_FOCUSED_TEXT_PREVIEW_LENGTH);
  if (nearbyText) {
    sections.push(`Nearby text:\n${nearbyText}`);
  }

  if (context.extractionError) {
    sections.push(`Extraction status: limited view (${context.extractionError})`);
  }

  return sections.join("\n\n");
}
