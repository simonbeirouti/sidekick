use std::{
    env,
    sync::{Condvar, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map as JsonMap, Value as JsonValue};
use supabase_client_sdk::prelude::{
    Session as SupabaseSession, SupabaseClient, SupabaseClientAuthExt, SupabaseClientQueryExt,
    SupabaseConfig, User as SupabaseUser,
};
use tauri::{
    webview::{PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const DEFAULT_TARGET_URL: &str = "https://developer.mozilla.org/en-US/docs/Web/API/WebView";
const MIN_WINDOW_WIDTH: f64 = 1068.0;
const MIN_ASSISTANT_PANEL_WIDTH: f64 = 320.0;
const MIN_TARGET_PANEL_WIDTH: f64 = 320.0;
const TARGET_CHROME_HEIGHT: f64 = 104.0;
const TARGET_BROWSER_EVENT: &str = "target-browser://state-changed";
const TARGET_ASSET_EVENT: &str = "target-browser://focused-asset-changed";
const TARGET_WEBVIEW_LABEL_PREFIX: &str = "target-webview-";
const DEFAULT_TARGET_TAB_TITLE: &str = "New tab";
const PAGE_SNAPSHOT_TIMEOUT_MS: u64 = 5_000;
const PAGE_ACTION_TIMEOUT_MS: u64 = 5_000;
const LOCAL_SUPABASE_URL: &str = "http://127.0.0.1:64321";
const LOCAL_SUPABASE_PUBLISHABLE_KEY: &str = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const LOCAL_SUPABASE_SECRET_KEY: &str = "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

const DOM_BRIDGE_BOOTSTRAP: &str = r#"
const BRIDGE_KEY = "__SIDEKICK_BRIDGE__";
if (!window[BRIDGE_KEY]) {
  const bridgeState = {
    nextId: 0,
    pickerEnabled: false,
    overlay: null,
    cleanupPicker: null,
  };

  const normalizeText = (value, maxLength = 240) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);

  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

  const ensureElementId = (element) => {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    if (!element.dataset.sidekickId) {
      bridgeState.nextId += 1;
      element.dataset.sidekickId = `sk-${bridgeState.nextId}`;
    }

    return element.dataset.sidekickId;
  };

  const describeElement = (element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const id = ensureElementId(element);
    const tagName = element.tagName.toLowerCase();
    const role = element.getAttribute("role");
    const text = normalizeText(element.innerText || element.textContent, 160);
    const label = normalizeText(
      element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.getAttribute("value") ||
        element.getAttribute("placeholder") ||
        text,
      160,
    );
    const href =
      element instanceof HTMLAnchorElement
        ? element.href
        : element.getAttribute("href");
    const src =
      element instanceof HTMLImageElement
        ? element.currentSrc || element.src
        : element.getAttribute("src");
    const inputType =
      element instanceof HTMLInputElement
        ? element.getAttribute("type") || "text"
        : null;
    const placeholder = element.getAttribute("placeholder");
    const isTextInput =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element.isContentEditable;

    return {
      id,
      tagName,
      role,
      inputType,
      text,
      label,
      href: href || null,
      src: src || null,
      placeholder: placeholder || null,
      isTextInput,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  };

  const dedupeById = (items, maxItems = 24) => {
    const seen = new Set();
    const output = [];

    for (const item of items) {
      if (!item || seen.has(item.id)) {
        continue;
      }

      seen.add(item.id);
      output.push(item);

      if (output.length >= maxItems) {
        break;
      }
    }

    return output;
  };

  const resolveElementTarget = (target) => {
    let current =
      target instanceof HTMLElement
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;

    while (current && !(current instanceof HTMLElement)) {
      current = current.parentElement;
    }

    return current;
  };

  const hasMeaningfulContent = (element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false;
    }

    if (
      element === document.body ||
      element === document.documentElement ||
      element.id === "__sidekick_picker_overlay__"
    ) {
      return false;
    }

    const text = normalizeText(element.innerText || element.textContent || "", 480);
    const hasStructuredContent = Boolean(
      element.querySelector("img, picture, video, canvas, svg, table, ul, ol"),
    );

    return text.length >= 40 || hasStructuredContent;
  };

  const collectInteractiveElements = () => {
    const selectors = [
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[contenteditable='true']",
    ];

    return dedupeById(
      Array.from(document.querySelectorAll(selectors.join(",")))
        .map((element) => describeElement(element))
        .filter(Boolean),
      24,
    );
  };

  const collectHeadings = (root) =>
    Array.from(root.querySelectorAll("h1, h2, h3"))
      .filter((element) => isVisible(element))
      .map((element) => normalizeText(element.textContent, 160))
      .filter(Boolean)
      .slice(0, 6);

  const describeParentSection = (element) => {
    const section = element.closest("section, article, form, main, nav, aside");
    if (!(section instanceof HTMLElement)) {
      return null;
    }

    return (
      normalizeText(
        section.getAttribute("aria-label") ||
          section.querySelector("h1, h2, h3")?.textContent ||
          section.id ||
          section.className,
        160,
      ) || null
    );
  };

  const buildFocusedContext = (element, extractionError = null) => {
    const descriptor = describeElement(element);

    if (!descriptor) {
      return {
        element: null,
        nearbyText: "",
        headings: [],
        parentSection: null,
        capturedAt: new Date().toISOString(),
        extractionError: extractionError || "Element is no longer available.",
      };
    }

    const container =
      (element.matches("article, section, form, main, li, figure, table, div")
        ? element
        : element.closest("article, section, form, main, li, figure, table, div")) ||
      element;
    const nearbyText = normalizeText(
      container.innerText || container.textContent || "",
      2400,
    );

    return {
      element: descriptor,
      nearbyText,
      headings: container instanceof Element ? collectHeadings(container) : [],
      parentSection: describeParentSection(element),
      capturedAt: new Date().toISOString(),
      extractionError,
    };
  };

  const ensureOverlay = () => {
    if (bridgeState.overlay) {
      return bridgeState.overlay;
    }

    const overlay = document.createElement("div");
    overlay.id = "__sidekick_picker_overlay__";
    overlay.style.position = "fixed";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "2147483647";
    overlay.style.border = "2px solid rgba(16, 185, 129, 0.95)";
    overlay.style.background = "rgba(16, 185, 129, 0.12)";
    overlay.style.boxShadow = "0 0 0 1px rgba(255,255,255,0.55)";
    overlay.style.opacity = "0";
    overlay.style.left = "0px";
    overlay.style.top = "0px";
    document.documentElement.appendChild(overlay);
    bridgeState.overlay = overlay;
    return overlay;
  };

  const hideOverlay = () => {
    const overlay = ensureOverlay();
    overlay.style.opacity = "0";
    overlay.style.width = "0px";
    overlay.style.height = "0px";
  };

  const positionOverlay = (element) => {
    const overlay = ensureOverlay();

    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      hideOverlay();
      return;
    }

    const rect = element.getBoundingClientRect();
    overlay.style.opacity = "1";
    overlay.style.left = `${Math.max(rect.left, 0)}px`;
    overlay.style.top = `${Math.max(rect.top, 0)}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  };

  const findPickableElement = (target) => {
    const element = resolveElementTarget(target);
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    const directMatch = element.closest(
      [
        "button",
        "a[href]",
        "input",
        "textarea",
        "select",
        "[role='button']",
        "[role='link']",
        "[contenteditable='true']",
        "img",
        "picture",
        "video",
        "canvas",
        "svg",
        "figure",
        "figcaption",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "li",
        "blockquote",
        "pre",
        "code",
        "td",
        "th",
        "article",
        "section",
        "main",
        "aside",
        "nav",
        "form",
        "table",
        "[aria-label]",
        "[data-testid]",
        "[data-test]",
      ].join(", "),
    );

    if (directMatch instanceof HTMLElement && isVisible(directMatch)) {
      return directMatch;
    }

    let current = element;
    while (current instanceof HTMLElement && current !== document.body) {
      if (
        ["div", "section", "article", "main", "aside", "nav", "form"].includes(
          current.tagName.toLowerCase(),
        ) &&
        hasMeaningfulContent(current)
      ) {
        return current;
      }

      current = current.parentElement;
    }

    if (hasMeaningfulContent(element)) {
      return element;
    }

    return null;
  };

  const disablePicker = () => {
    bridgeState.pickerEnabled = false;

    if (typeof bridgeState.cleanupPicker === "function") {
      bridgeState.cleanupPicker();
      bridgeState.cleanupPicker = null;
    }

    hideOverlay();
  };

  const enablePicker = (invoke) => {
    disablePicker();
    bridgeState.pickerEnabled = true;

    const handleMouseMove = (event) => {
      if (!bridgeState.pickerEnabled) {
        return;
      }

      positionOverlay(findPickableElement(event.target));
    };

    const handleClick = (event) => {
      if (!bridgeState.pickerEnabled) {
        return;
      }

      const element = findPickableElement(event.target);
      if (!(element instanceof HTMLElement)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }

      positionOverlay(element);

      if (typeof invoke === "function") {
        invoke("submit_focused_asset_context", {
          context: buildFocusedContext(element),
        }).catch(() => {});
      }
    };

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      disablePicker();

      if (typeof invoke === "function") {
        invoke("submit_focused_asset_context", { context: null }).catch(() => {});
      }
    };

    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleClick, true);
    window.addEventListener("keydown", handleKeyDown, true);

    bridgeState.cleanupPicker = () => {
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  };

  window[BRIDGE_KEY] = {
    normalizeText,
    isVisible,
    ensureElementId,
    describeElement,
    collectInteractiveElements,
    buildFocusedContext,
    setPickerEnabled: (enabled, invoke) => {
      if (enabled) {
        enablePicker(invoke);
      } else {
        disablePicker();
      }
    },
    findElementById: (id) =>
      document.querySelector(`[data-sidekick-id="${CSS.escape(id)}"]`),
  };
}

const sidekickBridge = window[BRIDGE_KEY];
"#;

struct BrowserState {
    tabs: Mutex<Vec<BrowserTabState>>,
    active_tab_id: Mutex<String>,
    next_tab_index: Mutex<u64>,
    layout_preset: Mutex<LayoutPreset>,
    asset_picker_enabled: Mutex<bool>,
    focused_asset: Mutex<Option<FocusedAssetContext>>,
}

impl Default for BrowserState {
    fn default() -> Self {
        let initial_tab = BrowserTabState {
            id: "tab-1".into(),
            current_url: DEFAULT_TARGET_URL.to_string(),
            requested_url: DEFAULT_TARGET_URL.to_string(),
            loading: false,
            page_title: String::new(),
        };

        Self {
            tabs: Mutex::new(vec![initial_tab.clone()]),
            active_tab_id: Mutex::new(initial_tab.id),
            next_tab_index: Mutex::new(2),
            layout_preset: Mutex::new(LayoutPreset::default()),
            asset_picker_enabled: Mutex::new(false),
            focused_asset: Mutex::new(None),
        }
    }
}

#[derive(Default)]
struct SnapshotCaptureState {
    sequence: Mutex<u64>,
    pending: Mutex<PendingSnapshot>,
    ready: Condvar,
}

#[derive(Default)]
struct PendingSnapshot {
    request_id: Option<String>,
    response: Option<TargetPageSnapshot>,
}

#[derive(Default)]
struct ActionExecutionState {
    sequence: Mutex<u64>,
    pending: Mutex<PendingAction>,
    ready: Condvar,
}

#[derive(Default)]
struct PendingAction {
    request_id: Option<String>,
    response: Option<PageActionOutcome>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
enum LayoutPreset {
    #[default]
    #[serde(rename = "50-50")]
    Split50_50,
    #[serde(rename = "70-30")]
    Split70_30,
    #[serde(rename = "30-70")]
    Split30_70,
}

impl LayoutPreset {
    fn left_ratio(self) -> f64 {
        match self {
            Self::Split70_30 => 0.7,
            Self::Split50_50 => 0.5,
            Self::Split30_70 => 0.3,
        }
    }
}

impl std::str::FromStr for LayoutPreset {
    type Err = AppError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "70-30" => Ok(Self::Split70_30),
            "50-50" => Ok(Self::Split50_50),
            "30-70" => Ok(Self::Split30_70),
            _ => Err(AppError::Message(format!(
                "Unsupported layout preset '{value}'. Choose 70-30, 50-50, or 30-70."
            ))),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TargetBrowserState {
    current_url: String,
    requested_url: String,
    loading: bool,
    layout_preset: LayoutPreset,
    page_title: String,
    asset_picker_enabled: bool,
    active_tab_id: String,
    tabs: Vec<BrowserTabState>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTabState {
    id: String,
    current_url: String,
    requested_url: String,
    loading: bool,
    page_title: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ElementBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TargetElementDescriptor {
    id: String,
    tag_name: String,
    role: Option<String>,
    input_type: Option<String>,
    text: String,
    label: String,
    href: Option<String>,
    src: Option<String>,
    placeholder: Option<String>,
    is_text_input: bool,
    rect: Option<ElementBounds>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TargetPageSnapshot {
    url: String,
    title: String,
    loading: bool,
    captured_at: String,
    visible_text: String,
    headings: Vec<String>,
    interactive_elements: Vec<TargetElementDescriptor>,
    extraction_error: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusedAssetContext {
    element: Option<TargetElementDescriptor>,
    nearby_text: String,
    headings: Vec<String>,
    parent_section: Option<String>,
    captured_at: String,
    extraction_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum PageActionRequest {
    Click {
        element_id: String,
    },
    Type {
        element_id: String,
        text: String,
        submit: Option<bool>,
    },
    Scroll {
        amount: i64,
    },
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageActionOutcome {
    success: bool,
    message: String,
    focused_asset: Option<FocusedAssetContext>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageActionResult {
    action: PageActionRequest,
    success: bool,
    message: String,
    browser: TargetBrowserState,
    snapshot: TargetPageSnapshot,
    focused_asset: Option<FocusedAssetContext>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSession {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    expires_at: Option<i64>,
    token_type: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthUser {
    id: String,
    email: Option<String>,
    role: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    user_metadata: Option<JsonMap<String, JsonValue>>,
    app_metadata: Option<JsonMap<String, JsonValue>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthState {
    session: AuthSession,
    user: AuthUser,
}

impl From<SupabaseSession> for AuthSession {
    fn from(session: SupabaseSession) -> Self {
        Self {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: session.expires_in,
            expires_at: session.expires_at,
            token_type: session.token_type,
        }
    }
}

impl From<AuthSession> for SupabaseSession {
    fn from(session: AuthSession) -> Self {
        Self {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: session.expires_in,
            expires_at: session.expires_at,
            token_type: session.token_type,
            user: SupabaseUser {
                id: String::new(),
                aud: None,
                role: None,
                email: None,
                phone: None,
                email_confirmed_at: None,
                phone_confirmed_at: None,
                confirmation_sent_at: None,
                recovery_sent_at: None,
                last_sign_in_at: None,
                created_at: None,
                updated_at: None,
                user_metadata: None,
                app_metadata: None,
                identities: None,
                factors: None,
                is_anonymous: None,
            },
        }
    }
}

impl From<SupabaseUser> for AuthUser {
    fn from(user: SupabaseUser) -> Self {
        Self {
            id: user.id,
            email: user.email,
            role: user.role,
            created_at: user.created_at.map(|value| value.to_rfc3339()),
            updated_at: user.updated_at.map(|value| value.to_rfc3339()),
            user_metadata: json_value_to_map(user.user_metadata),
            app_metadata: json_value_to_map(user.app_metadata),
        }
    }
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error(transparent)]
    Url(#[from] url::ParseError),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Clone, Copy, Debug)]
struct PaneLayout {
    target_position: LogicalPosition<f64>,
    target_size: LogicalSize<f64>,
}

#[tauri::command]
fn navigate_target(
    url: String,
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    let parsed_url = normalize_url(&url)?;
    let normalized = parsed_url.to_string();
    let active_tab_id = active_tab_id(state.inner());
    let webview = webview_for_tab(&app, &active_tab_id)?;

    update_tab(state.inner(), &active_tab_id, |tab| {
        tab.loading = true;
        tab.current_url = normalized.clone();
        tab.requested_url = normalized.clone();
        tab.page_title.clear();
    })?;
    clear_focus_and_picker(&app, state.inner())?;

    webview.navigate(parsed_url)?;
    emit_browser_state(&app, state.inner())
}

#[tauri::command]
fn get_target_browser_state(
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    ensure_active_target_webview(&app, state.inner())?;
    snapshot_state(state.inner())
}

#[tauri::command]
fn get_target_page_snapshot(
    app: AppHandle,
    browser_state: State<'_, BrowserState>,
    capture_state: State<'_, SnapshotCaptureState>,
) -> Result<TargetPageSnapshot, AppError> {
    ensure_active_target_webview(&app, browser_state.inner())?;
    capture_page_snapshot(&app, browser_state.inner(), capture_state.inner())
}

#[tauri::command]
fn get_focused_asset_context(
    browser_state: State<'_, BrowserState>,
) -> Result<Option<FocusedAssetContext>, AppError> {
    Ok(browser_state.focused_asset.lock().unwrap().clone())
}

#[tauri::command]
fn activate_workspace_shell(
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    ensure_active_target_webview(&app, state.inner())?;
    emit_browser_state(&app, state.inner())
}

#[tauri::command]
fn deactivate_workspace_shell(
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<(), AppError> {
    close_all_target_webviews(&app, state.inner())?;
    reset_browser_state(state.inner());
    update_webview_layouts(&app)?;
    Ok(())
}

#[tauri::command]
async fn open_target_tab(
    url: Option<String>,
    app: AppHandle,
) -> Result<TargetBrowserState, AppError> {
    let parsed_url = normalize_url(url.as_deref().unwrap_or(DEFAULT_TARGET_URL))?;
    let normalized = parsed_url.to_string();
    let tab_id = {
        let state = app.state::<BrowserState>();
        let next_tab_id = next_tab_id(state.inner());
        state
            .tabs
            .lock()
            .unwrap()
            .push(new_browser_tab(next_tab_id.clone(), normalized.clone()));
        *state.active_tab_id.lock().unwrap() = next_tab_id.clone();
        next_tab_id
    };

    {
        let state = app.state::<BrowserState>();
        clear_focus_and_picker(&app, state.inner())?;
    }

    let app_handle = app.clone();
    let tab_id_for_build = tab_id.clone();
    let normalized_for_build = normalized.clone();
    tauri::async_runtime::spawn_blocking(move || {
        create_target_webview_for_tab(&app_handle, &tab_id_for_build, &normalized_for_build)
    })
    .await
    .map_err(|error| AppError::Message(error.to_string()))??;

    update_webview_layouts(&app)?;
    let state = app.state::<BrowserState>();
    emit_browser_state(&app, state.inner())
}

#[tauri::command]
fn activate_target_tab(
    tab_id: String,
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    if !has_tab(state.inner(), &tab_id) {
        return Err(AppError::Message("The requested tab was not found.".into()));
    }

    *state.active_tab_id.lock().unwrap() = tab_id;
    clear_focus_and_picker(&app, state.inner())?;
    update_webview_layouts(&app)?;
    emit_browser_state(&app, state.inner())
}

#[tauri::command]
fn close_target_tab(
    tab_id: String,
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    let mut tabs = state.tabs.lock().unwrap();
    let tab_position = tabs
        .iter()
        .position(|tab| tab.id == tab_id)
        .ok_or_else(|| AppError::Message("The requested tab was not found.".into()))?;

    if tabs.len() == 1 {
        return Err(AppError::Message(
            "Keep at least one tab open in the browser pane.".into(),
        ));
    }

    let was_active = active_tab_id(state.inner()) == tab_id;
    tabs.remove(tab_position);

    if was_active {
        let next_index = tab_position
            .saturating_sub(1)
            .min(tabs.len().saturating_sub(1));
        *state.active_tab_id.lock().unwrap() = tabs[next_index].id.clone();
    }
    drop(tabs);

    clear_focus_and_picker(&app, state.inner())?;

    if let Some(webview) = app.get_webview(&build_target_webview_label(&tab_id)) {
        webview.close()?;
    }

    update_webview_layouts(&app)?;
    emit_browser_state(&app, state.inner())
}

#[tauri::command]
fn reload_target(
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    let tab_id = active_tab_id(state.inner());
    update_tab(state.inner(), &tab_id, |tab| {
        tab.loading = true;
    })?;
    clear_focus_and_picker(&app, state.inner())?;
    webview_for_tab(&app, &tab_id)?.reload()?;
    emit_browser_state(&app, state.inner())
}

#[tauri::command]
fn navigate_target_back(
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    let tab_id = active_tab_id(state.inner());
    update_tab(state.inner(), &tab_id, |tab| {
        tab.loading = true;
    })?;
    clear_focus_and_picker(&app, state.inner())?;
    webview_for_tab(&app, &tab_id)?.eval("window.history.back();")?;
    emit_browser_state(&app, state.inner())
}

#[tauri::command]
fn navigate_target_forward(
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    let tab_id = active_tab_id(state.inner());
    update_tab(state.inner(), &tab_id, |tab| {
        tab.loading = true;
    })?;
    clear_focus_and_picker(&app, state.inner())?;
    webview_for_tab(&app, &tab_id)?.eval("window.history.forward();")?;
    emit_browser_state(&app, state.inner())
}

#[tauri::command]
fn submit_page_snapshot(
    request_id: String,
    snapshot: TargetPageSnapshot,
    capture_state: State<'_, SnapshotCaptureState>,
    browser_state: State<'_, BrowserState>,
) -> Result<(), AppError> {
    let tab_id = active_tab_id(browser_state.inner());
    update_tab(browser_state.inner(), &tab_id, |tab| {
        tab.page_title = snapshot.title.clone();
        tab.current_url = snapshot.url.clone();
        tab.requested_url = snapshot.url.clone();
        tab.loading = snapshot.loading;
    })?;

    let mut pending = capture_state.pending.lock().unwrap();
    if pending.request_id.as_deref() == Some(request_id.as_str()) {
        pending.response = Some(snapshot);
        capture_state.ready.notify_all();
    }

    Ok(())
}

#[tauri::command]
fn submit_focused_asset_context(
    context: Option<FocusedAssetContext>,
    app: AppHandle,
    browser_state: State<'_, BrowserState>,
) -> Result<(), AppError> {
    *browser_state.focused_asset.lock().unwrap() = context.clone();
    app.emit(TARGET_ASSET_EVENT, context)?;
    Ok(())
}

#[tauri::command]
fn submit_page_action_result(
    request_id: String,
    result: PageActionOutcome,
    action_state: State<'_, ActionExecutionState>,
) -> Result<(), AppError> {
    let mut pending = action_state.pending.lock().unwrap();
    if pending.request_id.as_deref() == Some(request_id.as_str()) {
        pending.response = Some(result);
        action_state.ready.notify_all();
    }

    Ok(())
}

#[tauri::command]
fn set_layout_preset(
    preset: String,
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    let next_preset = preset.parse::<LayoutPreset>()?;
    *state.layout_preset.lock().unwrap() = next_preset;

    update_webview_layouts(&app)?;

    emit_browser_state(&app, state.inner())
}

#[tauri::command]
fn set_asset_picker_enabled(
    enabled: bool,
    app: AppHandle,
    browser_state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    *browser_state.asset_picker_enabled.lock().unwrap() = enabled;
    disable_picker_on_all(&app, browser_state.inner())?;

    if enabled {
        let tab_id = active_tab_id(browser_state.inner());
        webview_for_tab(&app, &tab_id)?.eval(&build_asset_picker_script(true)?)?;
    }

    emit_browser_state(&app, browser_state.inner())
}

#[tauri::command]
fn perform_page_action(
    action: PageActionRequest,
    app: AppHandle,
    browser_state: State<'_, BrowserState>,
    capture_state: State<'_, SnapshotCaptureState>,
    action_state: State<'_, ActionExecutionState>,
) -> Result<PageActionResult, AppError> {
    let outcome = execute_page_action(&app, browser_state.inner(), action_state.inner(), &action)?;

    if let Some(focused_asset) = outcome.focused_asset.clone() {
        *browser_state.focused_asset.lock().unwrap() = Some(focused_asset);
        emit_focused_asset(&app, browser_state.inner())?;
    }

    let snapshot = capture_page_snapshot(&app, browser_state.inner(), capture_state.inner())?;
    let browser = snapshot_state(browser_state.inner())?;

    Ok(PageActionResult {
        action,
        success: outcome.success,
        message: outcome.message,
        browser,
        snapshot,
        focused_asset: browser_state.focused_asset.lock().unwrap().clone(),
    })
}

#[tauri::command]
async fn auth_sign_in_with_password(email: String, password: String) -> Result<AuthState, AppError> {
    let auth = create_supabase_auth_client(false)?;
    let session = auth
        .sign_in_with_password_email(email.trim(), password.trim())
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;

    Ok(build_auth_state(session.user.clone(), session))
}

#[tauri::command]
async fn auth_sign_up_with_password(
    email: String,
    password: String,
    display_name: Option<String>,
) -> Result<AuthState, AppError> {
    let auth = create_supabase_auth_client(false)?;
    let trimmed_email = email.trim().to_string();
    let trimmed_password = password.trim().to_string();
    let trimmed_display_name = display_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let response = if let Some(display_name) = trimmed_display_name {
        auth.sign_up_with_email_and_data(
            &trimmed_email,
            &trimmed_password,
            Some(json!({ "display_name": display_name })),
        )
        .await
        .map_err(|error| AppError::Message(error.to_string()))?
    } else {
        auth.sign_up_with_email(&trimmed_email, &trimmed_password)
            .await
            .map_err(|error| AppError::Message(error.to_string()))?
    };

    if let Some(session) = response.session {
        return Ok(build_auth_state(session.user.clone(), session));
    }

    let session = auth
        .sign_in_with_password_email(&trimmed_email, &trimmed_password)
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;

    Ok(build_auth_state(session.user.clone(), session))
}

#[tauri::command]
async fn auth_restore_session(session: AuthSession) -> Result<AuthState, AppError> {
    let auth = create_supabase_auth_client(false)?;
    auth.set_session(session.into()).await;

    match auth.refresh_current_session().await {
        Ok(refreshed_session) => Ok(build_auth_state(
            refreshed_session.user.clone(),
            refreshed_session,
        )),
        Err(refresh_error) => {
            let current_session = auth
                .get_session()
                .await
                .ok_or_else(|| AppError::Message("No stored session was found.".into()))?;
            let user = auth.get_session_user().await.map_err(|_| {
                AppError::Message(format!(
                    "Could not restore the stored session: {refresh_error}"
                ))
            })?;

            Ok(build_auth_state(user, current_session))
        }
    }
}

#[tauri::command]
async fn auth_sign_out(session: AuthSession) -> Result<(), AppError> {
    let auth = create_supabase_auth_client(false)?;
    auth.set_session(session.into()).await;
    auth.sign_out_current()
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;
    Ok(())
}

#[tauri::command]
async fn auth_delete_current_account(session: AuthSession) -> Result<(), AppError> {
    let auth = create_supabase_auth_client(false)?;
    auth.set_session(session.into()).await;

    let current_user = auth
        .get_session_user()
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;
    let user_id = current_user.id.clone();
    let deleted_at = current_iso_timestamp();

    let _ = auth.sign_out_current().await;

    let service_client = create_supabase_rest_client(true)?;
    let service_auth = create_supabase_auth_client(true)?;

    service_client
        .rpc(
            "soft_delete_sidekick_account",
            json!({
                "target_user_id": user_id.clone(),
                "target_deleted_at": deleted_at,
            }),
        )
        .map_err(|error| AppError::Message(error.to_string()))?
        .execute()
        .await
        .into_result()
        .map_err(|error| AppError::Message(error.to_string()))?;

    service_auth
        .admin()
        .delete_user_with_options(&user_id, true)
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(BrowserState::default())
        .manage(SnapshotCaptureState::default())
        .manage(ActionExecutionState::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            register_resize_handler(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            activate_workspace_shell,
            deactivate_workspace_shell,
            navigate_target,
            get_target_browser_state,
            get_target_page_snapshot,
            get_focused_asset_context,
            open_target_tab,
            activate_target_tab,
            close_target_tab,
            reload_target,
            navigate_target_back,
            navigate_target_forward,
            submit_page_snapshot,
            submit_focused_asset_context,
            submit_page_action_result,
            set_layout_preset,
            set_asset_picker_enabled,
            perform_page_action,
            auth_sign_in_with_password,
            auth_sign_up_with_password,
            auth_restore_session,
            auth_sign_out,
            auth_delete_current_account
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn register_resize_handler(app: &AppHandle) -> Result<(), AppError> {
    let main_window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window was not found.".into()))?;
    let resize_handle = app.clone();

    update_webview_layouts(app)?;

    main_window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
        ) {
            let _ = update_webview_layouts(&resize_handle);
        }
    });

    Ok(())
}

fn create_target_webview_for_tab(app: &AppHandle, tab_id: &str, url: &str) -> Result<(), AppError> {
    let label = build_target_webview_label(tab_id);
    if app.get_webview(&label).is_some() {
        return Ok(());
    }

    let main_window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window was not found.".into()))?;

    let page_events = app.clone();
    let tab_id_for_load = tab_id.to_string();
    let title_events = app.clone();
    let tab_id_for_title = tab_id.to_string();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url.parse::<Url>()?))
        .on_page_load(move |_webview, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            let current_url = payload.url().to_string();

            if let Some(state) = page_events.try_state::<BrowserState>() {
                let _ = update_tab(state.inner(), &tab_id_for_load, |tab| {
                    tab.loading = loading;
                    tab.current_url = current_url.clone();
                    tab.requested_url = current_url.clone();
                    if loading {
                        tab.page_title.clear();
                    }
                });

                if active_tab_id(state.inner()) == tab_id_for_load && loading {
                    *state.asset_picker_enabled.lock().unwrap() = false;
                    *state.focused_asset.lock().unwrap() = None;
                    let _ =
                        page_events.emit(TARGET_ASSET_EVENT, Option::<FocusedAssetContext>::None);
                }

                let _ = emit_browser_state(&page_events, state.inner());
            }
        })
        .on_document_title_changed(move |_webview, title| {
            if let Some(state) = title_events.try_state::<BrowserState>() {
                let _ = update_tab(state.inner(), &tab_id_for_title, |tab| {
                    tab.page_title = title.clone();
                });
                let _ = emit_browser_state(&title_events, state.inner());
            }
        });

    let state = app.state::<BrowserState>();
    let layout = layout_for_window(&main_window, state.inner())?;
    main_window.add_child(builder, layout.target_position, layout.target_size)?;

    update_webview_layouts(app)?;
    Ok(())
}

fn update_webview_layouts(app: &AppHandle) -> Result<(), AppError> {
    let main_window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window was not found.".into()))?;

    let state = app.state::<BrowserState>();
    let layout = layout_for_window(&main_window, state.inner())?;
    let active_tab_id = active_tab_id(state.inner());
    let tabs = state.tabs.lock().unwrap().clone();

    for tab in tabs {
        if let Some(webview) = app.get_webview(&build_target_webview_label(&tab.id)) {
            if tab.id == active_tab_id {
                webview.show()?;
                webview.set_position(layout.target_position)?;
                webview.set_size(layout.target_size)?;
            } else {
                webview.hide()?;
            }
        }
    }

    Ok(())
}

fn ensure_active_target_webview(app: &AppHandle, state: &BrowserState) -> Result<(), AppError> {
    let active_tab = active_tab(state)?;
    create_target_webview_for_tab(app, &active_tab.id, &active_tab.current_url)
}

fn close_all_target_webviews(app: &AppHandle, state: &BrowserState) -> Result<(), AppError> {
    let tabs = state.tabs.lock().unwrap().clone();

    for tab in tabs {
        if let Some(webview) = app.get_webview(&build_target_webview_label(&tab.id)) {
            webview.close()?;
        }
    }

    Ok(())
}

fn reset_browser_state(state: &BrowserState) {
    let initial_tab = new_browser_tab("tab-1".into(), DEFAULT_TARGET_URL.to_string());

    *state.tabs.lock().unwrap() = vec![initial_tab.clone()];
    *state.active_tab_id.lock().unwrap() = initial_tab.id;
    *state.next_tab_index.lock().unwrap() = 2;
    *state.layout_preset.lock().unwrap() = LayoutPreset::default();
    *state.asset_picker_enabled.lock().unwrap() = false;
    *state.focused_asset.lock().unwrap() = None;
}

fn layout_for_window(window: &tauri::Window, state: &BrowserState) -> Result<PaneLayout, AppError> {
    let scale_factor = window.scale_factor()?;
    let inner_size = window.inner_size()?.to_logical::<f64>(scale_factor);
    let layout_preset = *state.layout_preset.lock().unwrap();

    layout_for_size(inner_size, layout_preset)
}

fn layout_for_size(
    inner_size: LogicalSize<f64>,
    layout_preset: LayoutPreset,
) -> Result<PaneLayout, AppError> {
    if inner_size.width < MIN_WINDOW_WIDTH {
        return Err(AppError::Message(
            "Window is too narrow for the configured split presets.".into(),
        ));
    }

    let assistant_width = inner_size.width * layout_preset.left_ratio();
    let target_width = inner_size.width - assistant_width;
    let target_height = (inner_size.height - TARGET_CHROME_HEIGHT).max(0.0);

    if assistant_width < MIN_ASSISTANT_PANEL_WIDTH || target_width < MIN_TARGET_PANEL_WIDTH {
        return Err(AppError::Message(
            "Window is too narrow to keep both panes visible.".into(),
        ));
    }

    Ok(PaneLayout {
        target_position: LogicalPosition::new(assistant_width, TARGET_CHROME_HEIGHT),
        target_size: LogicalSize::new(target_width, target_height),
    })
}

#[cfg(test)]
fn assert_close(actual: f64, expected: f64, label: &str) {
    let delta = (actual - expected).abs();
    assert!(
        delta < 0.001,
        "{label} mismatch: expected {expected}, got {actual} (delta {delta})"
    );
}

fn normalize_url(value: &str) -> Result<Url, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Message(
            "Enter a URL to load on the right side.".into(),
        ));
    }

    if let Ok(url) = Url::parse(trimmed) {
        return Ok(url);
    }

    Ok(Url::parse(&format!("https://{trimmed}"))?)
}

fn new_browser_tab(id: String, url: String) -> BrowserTabState {
    BrowserTabState {
        id,
        current_url: url.clone(),
        requested_url: url,
        loading: true,
        page_title: DEFAULT_TARGET_TAB_TITLE.into(),
    }
}

fn next_tab_id(state: &BrowserState) -> String {
    let mut next_tab_index = state.next_tab_index.lock().unwrap();
    let tab_id = format!("tab-{}", *next_tab_index);
    *next_tab_index += 1;
    tab_id
}

fn active_tab_id(state: &BrowserState) -> String {
    state.active_tab_id.lock().unwrap().clone()
}

fn active_tab(state: &BrowserState) -> Result<BrowserTabState, AppError> {
    let tab_id = active_tab_id(state);
    state
        .tabs
        .lock()
        .unwrap()
        .iter()
        .find(|tab| tab.id == tab_id)
        .cloned()
        .ok_or_else(|| AppError::Message("The active tab was not found.".into()))
}

fn has_tab(state: &BrowserState, tab_id: &str) -> bool {
    state
        .tabs
        .lock()
        .unwrap()
        .iter()
        .any(|tab| tab.id == tab_id)
}

fn update_tab<F>(state: &BrowserState, tab_id: &str, updater: F) -> Result<(), AppError>
where
    F: FnOnce(&mut BrowserTabState),
{
    let mut tabs = state.tabs.lock().unwrap();
    let tab = tabs
        .iter_mut()
        .find(|tab| tab.id == tab_id)
        .ok_or_else(|| AppError::Message("The requested tab was not found.".into()))?;
    updater(tab);
    Ok(())
}

fn build_target_webview_label(tab_id: &str) -> String {
    format!("{TARGET_WEBVIEW_LABEL_PREFIX}{tab_id}")
}

fn webview_for_tab(app: &AppHandle, tab_id: &str) -> Result<tauri::Webview, AppError> {
    app.get_webview(&build_target_webview_label(tab_id))
        .ok_or_else(|| AppError::Message("Target webview is not ready yet.".into()))
}

fn disable_picker_on_all(app: &AppHandle, state: &BrowserState) -> Result<(), AppError> {
    let script = build_asset_picker_script(false)?;
    let tab_ids = state
        .tabs
        .lock()
        .unwrap()
        .iter()
        .map(|tab| tab.id.clone())
        .collect::<Vec<_>>();

    for tab_id in tab_ids {
        if let Some(webview) = app.get_webview(&build_target_webview_label(&tab_id)) {
            let _ = webview.eval(&script);
        }
    }

    Ok(())
}

fn clear_focus_and_picker(app: &AppHandle, state: &BrowserState) -> Result<(), AppError> {
    *state.asset_picker_enabled.lock().unwrap() = false;
    *state.focused_asset.lock().unwrap() = None;
    disable_picker_on_all(app, state)?;
    emit_focused_asset(app, state)?;
    Ok(())
}

fn snapshot_state(state: &BrowserState) -> Result<TargetBrowserState, AppError> {
    let active_tab = active_tab(state)?;
    let tabs = state.tabs.lock().unwrap().clone();

    Ok(TargetBrowserState {
        current_url: active_tab.current_url,
        requested_url: active_tab.requested_url,
        loading: active_tab.loading,
        layout_preset: *state.layout_preset.lock().unwrap(),
        page_title: active_tab.page_title,
        asset_picker_enabled: *state.asset_picker_enabled.lock().unwrap(),
        active_tab_id: active_tab_id(state),
        tabs,
    })
}

fn emit_browser_state(
    app: &AppHandle,
    state: &BrowserState,
) -> Result<TargetBrowserState, AppError> {
    let payload = snapshot_state(state)?;
    app.emit(TARGET_BROWSER_EVENT, payload.clone())?;
    Ok(payload)
}

fn emit_focused_asset(app: &AppHandle, state: &BrowserState) -> Result<(), AppError> {
    app.emit(
        TARGET_ASSET_EVENT,
        state.focused_asset.lock().unwrap().clone(),
    )?;
    Ok(())
}

fn capture_page_snapshot(
    app: &AppHandle,
    browser_state: &BrowserState,
    capture_state: &SnapshotCaptureState,
) -> Result<TargetPageSnapshot, AppError> {
    let tab_id = active_tab_id(browser_state);
    let webview = webview_for_tab(app, &tab_id)?;

    let request_id = {
        let mut sequence = capture_state.sequence.lock().unwrap();
        *sequence += 1;
        format!("snapshot-{}", *sequence)
    };

    {
        let mut pending = capture_state.pending.lock().unwrap();
        pending.request_id = Some(request_id.clone());
        pending.response = None;
    }

    webview.eval(&build_snapshot_script(&request_id)?)?;

    let pending = capture_state.pending.lock().unwrap();
    let (mut pending, _) = capture_state
        .ready
        .wait_timeout_while(
            pending,
            Duration::from_millis(PAGE_SNAPSHOT_TIMEOUT_MS),
            |pending| {
                pending.request_id.as_deref() == Some(request_id.as_str())
                    && pending.response.is_none()
            },
        )
        .map_err(|_| AppError::Message("Waiting for the page snapshot failed.".into()))?;

    let snapshot = pending.response.clone().unwrap_or_else(|| {
        fallback_snapshot(browser_state, Some("Page inspection timed out.".into()))
    });

    pending.request_id = None;
    pending.response = None;
    drop(pending);

    update_tab(browser_state, &tab_id, |tab| {
        tab.page_title = snapshot.title.clone();
        tab.current_url = snapshot.url.clone();
        tab.requested_url = snapshot.url.clone();
        tab.loading = snapshot.loading;
    })?;
    let _ = emit_browser_state(app, browser_state)?;

    Ok(snapshot)
}

fn execute_page_action(
    app: &AppHandle,
    browser_state: &BrowserState,
    action_state: &ActionExecutionState,
    action: &PageActionRequest,
) -> Result<PageActionOutcome, AppError> {
    let tab_id = active_tab_id(browser_state);
    let webview = webview_for_tab(app, &tab_id)?;

    let request_id = {
        let mut sequence = action_state.sequence.lock().unwrap();
        *sequence += 1;
        format!("action-{}", *sequence)
    };

    {
        let mut pending = action_state.pending.lock().unwrap();
        pending.request_id = Some(request_id.clone());
        pending.response = None;
    }

    webview.eval(&build_page_action_script(&request_id, action)?)?;

    let pending = action_state.pending.lock().unwrap();
    let (mut pending, _) = action_state
        .ready
        .wait_timeout_while(
            pending,
            Duration::from_millis(PAGE_ACTION_TIMEOUT_MS),
            |pending| {
                pending.request_id.as_deref() == Some(request_id.as_str())
                    && pending.response.is_none()
            },
        )
        .map_err(|_| AppError::Message("Waiting for the page action result failed.".into()))?;

    let outcome = pending.response.clone().unwrap_or(PageActionOutcome {
        success: false,
        message: "Page action timed out.".into(),
        focused_asset: None,
    });

    pending.request_id = None;
    pending.response = None;

    Ok(outcome)
}

fn fallback_snapshot(state: &BrowserState, extraction_error: Option<String>) -> TargetPageSnapshot {
    let active_tab = active_tab(state).unwrap_or_else(|_| BrowserTabState {
        id: "fallback".into(),
        current_url: DEFAULT_TARGET_URL.into(),
        requested_url: DEFAULT_TARGET_URL.into(),
        loading: false,
        page_title: String::new(),
    });

    TargetPageSnapshot {
        url: active_tab.current_url,
        title: active_tab.page_title,
        loading: active_tab.loading,
        captured_at: unix_timestamp(),
        visible_text: String::new(),
        headings: Vec::new(),
        interactive_elements: Vec::new(),
        extraction_error,
    }
}

fn build_snapshot_script(request_id: &str) -> Result<String, AppError> {
    let request_id =
        serde_json::to_string(request_id).map_err(|error| AppError::Message(error.to_string()))?;

    Ok(format!(
        r#"
          (() => {{
            const requestId = {request_id};
            const invoke = window.__TAURI_INTERNALS__?.invoke;
            {bootstrap}

            const snapshot = {{
              url: window.location.href,
              title: document.title || "",
              loading: document.readyState !== "complete",
              capturedAt: new Date().toISOString(),
              visibleText: sidekickBridge.normalizeText(
                document.body?.innerText || document.body?.textContent || "",
                6000,
              ),
              headings: Array.from(document.querySelectorAll("h1, h2, h3"))
                .filter((element) => sidekickBridge.isVisible(element))
                .map((element) => sidekickBridge.normalizeText(element.textContent, 160))
                .filter(Boolean)
                .slice(0, 12),
              interactiveElements: sidekickBridge.collectInteractiveElements(),
              extractionError: null,
            }};

            if (typeof invoke !== "function") {{
              return;
            }}

            invoke("submit_page_snapshot", {{ requestId, snapshot }}).catch(async (error) => {{
              const fallbackSnapshot = {{
                url: window.location.href,
                title: document.title || "",
                loading: document.readyState !== "complete",
                capturedAt: new Date().toISOString(),
                visibleText: "",
                headings: [],
                interactiveElements: [],
                extractionError: String(error),
              }};

              try {{
                await invoke("submit_page_snapshot", {{ requestId, snapshot: fallbackSnapshot }});
              }} catch (_ignored) {{}}
            }});
          }})();
        "#,
        bootstrap = DOM_BRIDGE_BOOTSTRAP,
    ))
}

fn build_asset_picker_script(enabled: bool) -> Result<String, AppError> {
    let enabled =
        serde_json::to_string(&enabled).map_err(|error| AppError::Message(error.to_string()))?;

    Ok(format!(
        r#"
          (() => {{
            const invoke = window.__TAURI_INTERNALS__?.invoke;
            const enabled = {enabled};
            {bootstrap}
            sidekickBridge.setPickerEnabled(enabled, invoke);
          }})();
        "#,
        bootstrap = DOM_BRIDGE_BOOTSTRAP,
    ))
}

fn build_page_action_script(
    request_id: &str,
    action: &PageActionRequest,
) -> Result<String, AppError> {
    let request_id =
        serde_json::to_string(request_id).map_err(|error| AppError::Message(error.to_string()))?;
    let action_json =
        serde_json::to_string(action).map_err(|error| AppError::Message(error.to_string()))?;

    Ok(format!(
        r#"
          (() => {{
            const requestId = {request_id};
            const action = {action_json};
            const invoke = window.__TAURI_INTERNALS__?.invoke;
            {bootstrap}

            const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

            const submitResult = async (result) => {{
              if (typeof invoke !== "function") {{
                return;
              }}

              await invoke("submit_page_action_result", {{ requestId, result }});
            }};

            const dispatchInputEvents = (element) => {{
              element.dispatchEvent(new InputEvent("input", {{ bubbles: true, composed: true }}));
              element.dispatchEvent(new Event("change", {{ bubbles: true }}));
            }};

            const run = async () => {{
              try {{
                let focusedAsset = null;

                if (action.kind === "click") {{
                  const element = sidekickBridge.findElementById(action.elementId);
                  if (!(element instanceof HTMLElement)) {{
                    throw new Error(`Could not find element ${{action.elementId}}.`);
                  }}

                  sidekickBridge.ensureElementId(element);
                  element.scrollIntoView({{ block: "center", inline: "center" }});
                  if (typeof element.focus === "function") {{
                    element.focus({{ preventScroll: true }});
                  }}
                  element.click();
                  focusedAsset = sidekickBridge.buildFocusedContext(element);
                }} else if (action.kind === "type") {{
                  const element = sidekickBridge.findElementById(action.elementId);
                  if (!(element instanceof HTMLElement)) {{
                    throw new Error(`Could not find element ${{action.elementId}}.`);
                  }}

                  sidekickBridge.ensureElementId(element);
                  element.scrollIntoView({{ block: "center", inline: "center" }});
                  if (typeof element.focus === "function") {{
                    element.focus({{ preventScroll: true }});
                  }}

                  if (element instanceof HTMLInputElement) {{
                    const valueSetter = Object.getOwnPropertyDescriptor(
                      HTMLInputElement.prototype,
                      "value",
                    )?.set;

                    valueSetter?.call(element, action.text);
                    dispatchInputEvents(element);
                  }} else if (element instanceof HTMLTextAreaElement) {{
                    const valueSetter = Object.getOwnPropertyDescriptor(
                      HTMLTextAreaElement.prototype,
                      "value",
                    )?.set;

                    valueSetter?.call(element, action.text);
                    dispatchInputEvents(element);
                  }} else if (element.isContentEditable) {{
                    element.textContent = action.text;
                    dispatchInputEvents(element);
                  }} else {{
                    throw new Error(`Element ${{action.elementId}} is not a text input.`);
                  }}

                  if (action.submit) {{
                    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {{
                      const form = element.form;
                      if (form && typeof form.requestSubmit === "function") {{
                        form.requestSubmit();
                      }} else {{
                        element.dispatchEvent(
                          new KeyboardEvent("keydown", {{
                            bubbles: true,
                            cancelable: true,
                            key: "Enter",
                          }}),
                        );
                      }}
                    }}
                  }}

                  focusedAsset = sidekickBridge.buildFocusedContext(element);
                }} else if (action.kind === "scroll") {{
                  window.scrollBy({{ top: action.amount, left: 0, behavior: "auto" }});
                }} else {{
                  throw new Error(`Unsupported action: ${{action.kind}}`);
                }}

                await wait(action.kind === "scroll" ? 120 : 260);

                await submitResult({{
                  success: true,
                  message:
                    action.kind === "scroll"
                      ? `Scrolled the page by ${{action.amount}}px.`
                      : `Completed ${{action.kind}} on ${{action.elementId}}.`,
                  focusedAsset,
                }});
              }} catch (error) {{
                await submitResult({{
                  success: false,
                  message: String(error),
                  focusedAsset: null,
                }});
              }}
            }};

            void run();
          }})();
        "#,
        bootstrap = DOM_BRIDGE_BOOTSTRAP,
    ))
}

fn resolve_supabase_value(primary_key: &str, fallback_key: &str, default: &str) -> String {
    env::var(primary_key)
        .or_else(|_| env::var(fallback_key))
        .unwrap_or_else(|_| default.to_string())
}

fn supabase_url() -> String {
    resolve_supabase_value("SIDEKICK_SUPABASE_URL", "SUPABASE_URL", LOCAL_SUPABASE_URL)
}

fn supabase_publishable_key() -> String {
    resolve_supabase_value(
        "SIDEKICK_SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_PUBLISHABLE_KEY",
        LOCAL_SUPABASE_PUBLISHABLE_KEY,
    )
}

fn supabase_secret_key() -> String {
    resolve_supabase_value(
        "SIDEKICK_SUPABASE_SECRET_KEY",
        "SUPABASE_SECRET_KEY",
        LOCAL_SUPABASE_SECRET_KEY,
    )
}

fn create_supabase_rest_client(use_secret_key: bool) -> Result<SupabaseClient, AppError> {
    let key = if use_secret_key {
        supabase_secret_key()
    } else {
        supabase_publishable_key()
    };

    SupabaseClient::new(SupabaseConfig::new(supabase_url(), key))
        .map_err(|error| AppError::Message(error.to_string()))
}

fn create_supabase_auth_client(
    use_secret_key: bool,
) -> Result<supabase_client_sdk::prelude::AuthClient, AppError> {
    create_supabase_rest_client(use_secret_key)?
        .auth()
        .map_err(|error| AppError::Message(error.to_string()))
}

fn current_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn json_value_to_map(value: Option<JsonValue>) -> Option<JsonMap<String, JsonValue>> {
    match value {
        Some(JsonValue::Object(map)) => Some(map),
        _ => None,
    }
}

fn build_auth_state(user: SupabaseUser, session: SupabaseSession) -> AuthState {
    AuthState {
        session: AuthSession::from(session),
        user: AuthUser::from(user),
    }
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_70_30_layout_for_standard_window() {
        let layout =
            layout_for_size(LogicalSize::new(1280.0, 820.0), LayoutPreset::Split70_30).unwrap();

        assert_close(layout.assistant_position.x, 0.0, "assistant x");
        assert_close(layout.assistant_size.width, 1280.0, "assistant width");
        assert_close(layout.target_position.x, 896.0, "target x");
        assert_close(layout.target_size.width, 384.0, "target width");
        assert_close(layout.assistant_size.height, 820.0, "assistant height");
        assert_close(layout.target_position.y, TARGET_CHROME_HEIGHT, "target y");
        assert_close(layout.target_size.height, 664.0, "target height");
    }

    #[test]
    fn computes_50_50_layout_for_standard_window() {
        let layout =
            layout_for_size(LogicalSize::new(1280.0, 820.0), LayoutPreset::Split50_50).unwrap();

        assert_close(layout.assistant_size.width, 1280.0, "assistant width");
        assert_close(layout.target_position.x, 640.0, "target x");
        assert_close(layout.target_size.width, 640.0, "target width");
    }

    #[test]
    fn computes_30_70_layout_for_standard_window() {
        let layout =
            layout_for_size(LogicalSize::new(1280.0, 820.0), LayoutPreset::Split30_70).unwrap();

        assert_close(layout.assistant_size.width, 1280.0, "assistant width");
        assert_close(layout.target_position.x, 384.0, "target x");
        assert_close(layout.target_size.width, 896.0, "target width");
    }

    #[test]
    fn keeps_exact_split_at_minimum_width() {
        let layout = layout_for_size(
            LogicalSize::new(MIN_WINDOW_WIDTH, 640.0),
            LayoutPreset::Split30_70,
        )
        .unwrap();

        assert!(
            MIN_WINDOW_WIDTH * LayoutPreset::Split30_70.left_ratio() >= MIN_ASSISTANT_PANEL_WIDTH
        );
        assert!(layout.target_size.width >= MIN_TARGET_PANEL_WIDTH);
        assert_close(
            layout.assistant_size.width,
            MIN_WINDOW_WIDTH,
            "assistant width",
        );
    }

    #[test]
    fn panes_never_overlap_or_leave_gaps() {
        let presets = [
            LayoutPreset::Split70_30,
            LayoutPreset::Split50_50,
            LayoutPreset::Split30_70,
        ];

        for preset in presets {
            let layout = layout_for_size(LogicalSize::new(1440.0, 900.0), preset).unwrap();
            let expected_target_x = 1440.0 * preset.left_ratio();

            assert_close(layout.assistant_position.x, 0.0, "assistant x");
            assert_close(
                layout.assistant_size.width,
                1440.0,
                "assistant covers shell",
            );
            assert_close(
                layout.target_position.x,
                expected_target_x,
                "target starts after split",
            );
            assert_close(
                layout.target_size.width + layout.target_position.x,
                1440.0,
                "target reaches right edge",
            );
            assert_close(
                layout.target_position.y,
                TARGET_CHROME_HEIGHT,
                "target sits below chrome",
            );
        }
    }

    #[test]
    fn asset_picker_script_supports_text_content_targets() {
        let script = build_asset_picker_script(true).unwrap();

        assert!(script.contains("resolveElementTarget"));
        assert!(script.contains("target instanceof Node"));
        assert!(script.contains("\"p\""));
        assert!(script.contains("hasMeaningfulContent"));
    }

    #[test]
    fn snapshot_timeout_is_extended_for_heavier_pages() {
        assert!(PAGE_SNAPSHOT_TIMEOUT_MS >= 5_000);
        assert!(PAGE_ACTION_TIMEOUT_MS >= 5_000);
    }
}
