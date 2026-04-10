import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type TargetBrowserState = {
  currentUrl: string;
  requestedUrl: string;
  loading: boolean;
  leftPanelRatio: number;
};

const TARGET_BROWSER_EVENT = "target-browser://state-changed";

export function getTargetBrowserState() {
  return invoke<TargetBrowserState>("get_target_browser_state");
}

export function navigateTarget(url: string) {
  return invoke<TargetBrowserState>("navigate_target", { url });
}

export function setLeftPanelRatio(ratio: number) {
  return invoke<TargetBrowserState>("set_left_panel_ratio", { ratio });
}

export function listenToTargetBrowser(
  handler: (state: TargetBrowserState) => void,
) {
  return listen<TargetBrowserState>(TARGET_BROWSER_EVENT, (event) => {
    handler(event.payload);
  });
}
