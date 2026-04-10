import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export const LAYOUT_PRESETS = ["70-30", "50-50", "30-70"] as const;

export type LayoutPreset = (typeof LAYOUT_PRESETS)[number];

export type TargetBrowserState = {
  currentUrl: string;
  requestedUrl: string;
  loading: boolean;
  layoutPreset: LayoutPreset;
  pageTitle: string;
};

export type TargetPageSnapshot = {
  url: string;
  title: string;
  loading: boolean;
  capturedAt: string;
  visibleText: string;
  headings: string[];
  interactiveLabels: string[];
  extractionError: string | null;
};

const TARGET_BROWSER_EVENT = "target-browser://state-changed";

export function getTargetBrowserState() {
  return invoke<TargetBrowserState>("get_target_browser_state");
}

export function navigateTarget(url: string) {
  return invoke<TargetBrowserState>("navigate_target", { url });
}

export function setLayoutPreset(preset: LayoutPreset) {
  return invoke<TargetBrowserState>("set_layout_preset", { preset });
}

export function getTargetPageSnapshot() {
  return invoke<TargetPageSnapshot>("get_target_page_snapshot");
}

export function listenToTargetBrowser(
  handler: (state: TargetBrowserState) => void,
) {
  return listen<TargetBrowserState>(TARGET_BROWSER_EVENT, (event) => {
    handler(event.payload);
  });
}