import type { TargetPageSnapshot } from "./targetBrowser";

const MAX_TEXT_PREVIEW_LENGTH = 2200;
const MAX_LIST_ITEMS = 8;

function joinList(items: string[]) {
  return items.slice(0, MAX_LIST_ITEMS).map((item) => `- ${item}`).join("\n");
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

  if (snapshot.interactiveLabels.length > 0) {
    sections.push(`Interactive elements:\n${joinList(snapshot.interactiveLabels)}`);
  }

  const textPreview = snapshot.visibleText.trim().slice(0, MAX_TEXT_PREVIEW_LENGTH);
  if (textPreview) {
    sections.push(`Visible text:\n${textPreview}`);
  } else {
    sections.push("Visible text: unavailable");
  }

  return sections.join("\n\n");
}
