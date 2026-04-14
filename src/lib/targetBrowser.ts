import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export const LAYOUT_PRESETS = ["70-30", "50-50", "30-70"] as const;

export type LayoutPreset = (typeof LAYOUT_PRESETS)[number];

export type ElementBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TargetElementDescriptor = {
  id: string;
  tagName: string;
  role: string | null;
  inputType: string | null;
  text: string;
  label: string;
  href: string | null;
  src: string | null;
  placeholder: string | null;
  isTextInput: boolean;
  rect: ElementBounds | null;
};

export type TargetBrowserState = {
  currentUrl: string;
  requestedUrl: string;
  loading: boolean;
  layoutPreset: LayoutPreset;
  pageTitle: string;
  assetPickerEnabled: boolean;
  activeTabId: string;
  tabs: BrowserTabState[];
};

export type BrowserTabState = {
  id: string;
  currentUrl: string;
  requestedUrl: string;
  loading: boolean;
  pageTitle: string;
};

export type TargetPageSnapshot = {
  url: string;
  title: string;
  loading: boolean;
  capturedAt: string;
  visibleText: string;
  headings: string[];
  interactiveElements: TargetElementDescriptor[];
  extractionError: string | null;
};

export type FocusedAssetContext = {
  element: TargetElementDescriptor | null;
  nearbyText: string;
  headings: string[];
  parentSection: string | null;
  capturedAt: string;
  extractionError: string | null;
};

export type PageActionRequest =
  | {
      kind: "click";
      elementId: string;
    }
  | {
      kind: "type";
      elementId: string;
      text: string;
      submit?: boolean;
    }
  | {
      kind: "scroll";
      amount: number;
    };

export type PageActionResult = {
  action: PageActionRequest;
  success: boolean;
  message: string;
  browser: TargetBrowserState;
  snapshot: TargetPageSnapshot;
  focusedAsset: FocusedAssetContext | null;
};

const TARGET_BROWSER_EVENT = "target-browser://state-changed";
const TARGET_ASSET_EVENT = "target-browser://focused-asset-changed";

export function activateWorkspaceShell() {
  return invoke<TargetBrowserState>("activate_workspace_shell");
}

export function deactivateWorkspaceShell() {
  return invoke<void>("deactivate_workspace_shell");
}

export function getTargetBrowserState() {
  return invoke<TargetBrowserState>("get_target_browser_state");
}

export function navigateTarget(url: string) {
  return invoke<TargetBrowserState>("navigate_target", { url });
}

export function openTargetTab(url?: string) {
  return invoke<TargetBrowserState>("open_target_tab", { url });
}

export function activateTargetTab(tabId: string) {
  return invoke<TargetBrowserState>("activate_target_tab", { tabId });
}

export function closeTargetTab(tabId: string) {
  return invoke<TargetBrowserState>("close_target_tab", { tabId });
}

export function reloadTarget() {
  return invoke<TargetBrowserState>("reload_target");
}

export function navigateTargetBack() {
  return invoke<TargetBrowserState>("navigate_target_back");
}

export function navigateTargetForward() {
  return invoke<TargetBrowserState>("navigate_target_forward");
}

export function setLayoutPreset(preset: LayoutPreset) {
  return invoke<TargetBrowserState>("set_layout_preset", { preset });
}

export function getTargetPageSnapshot() {
  return invoke<TargetPageSnapshot>("get_target_page_snapshot");
}

export function getFocusedAssetContext() {
  return invoke<FocusedAssetContext | null>("get_focused_asset_context");
}

export function setAssetPickerEnabled(enabled: boolean) {
  return invoke<TargetBrowserState>("set_asset_picker_enabled", { enabled });
}

export function performPageAction(action: PageActionRequest) {
  return invoke<PageActionResult>("perform_page_action", { action });
}

export function listenToTargetBrowser(
  handler: (state: TargetBrowserState) => void,
) {
  return listen<TargetBrowserState>(TARGET_BROWSER_EVENT, (event) => {
    handler(event.payload);
  });
}

export function listenToFocusedAsset(
  handler: (state: FocusedAssetContext | null) => void,
) {
  return listen<FocusedAssetContext | null>(TARGET_ASSET_EVENT, (event) => {
    handler(event.payload);
  });
}
