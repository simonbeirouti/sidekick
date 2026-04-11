use std::{
    sync::{Condvar, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{
    webview::{PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const MAIN_WEBVIEW_LABEL: &str = "main";
const TARGET_WEBVIEW_LABEL: &str = "target-webview";
const DEFAULT_TARGET_URL: &str = "https://developer.mozilla.org/en-US/docs/Web/API/WebView";
const MIN_WINDOW_WIDTH: f64 = 1068.0;
const MIN_ASSISTANT_PANEL_WIDTH: f64 = 320.0;
const MIN_TARGET_PANEL_WIDTH: f64 = 320.0;
const TARGET_BROWSER_EVENT: &str = "target-browser://state-changed";
const TARGET_ASSET_EVENT: &str = "target-browser://focused-asset-changed";
const PAGE_SNAPSHOT_TIMEOUT_MS: u64 = 5_000;
const PAGE_ACTION_TIMEOUT_MS: u64 = 5_000;

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
    current_url: Mutex<String>,
    loading: Mutex<bool>,
    layout_preset: Mutex<LayoutPreset>,
    page_title: Mutex<String>,
    asset_picker_enabled: Mutex<bool>,
    focused_asset: Mutex<Option<FocusedAssetContext>>,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            current_url: Mutex::new(DEFAULT_TARGET_URL.to_string()),
            loading: Mutex::new(false),
            layout_preset: Mutex::new(LayoutPreset::default()),
            page_title: Mutex::new(String::new()),
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
    assistant_position: LogicalPosition<f64>,
    assistant_size: LogicalSize<f64>,
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
    let webview = app
        .get_webview(TARGET_WEBVIEW_LABEL)
        .ok_or_else(|| AppError::Message("Target webview is not ready yet.".into()))?;

    let normalized = parsed_url.to_string();

    *state.loading.lock().unwrap() = true;
    *state.current_url.lock().unwrap() = normalized.clone();
    state.page_title.lock().unwrap().clear();
    *state.asset_picker_enabled.lock().unwrap() = false;
    *state.focused_asset.lock().unwrap() = None;

    webview.navigate(parsed_url)?;
    emit_focused_asset(&app, state.inner())?;

    let payload = snapshot_state(state.inner(), normalized)?;
    app.emit(TARGET_BROWSER_EVENT, payload.clone())?;
    Ok(payload)
}

#[tauri::command]
fn get_target_browser_state(
    state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    let requested_url = state.current_url.lock().unwrap().clone();
    snapshot_state(state.inner(), requested_url)
}

#[tauri::command]
fn get_target_page_snapshot(
    app: AppHandle,
    browser_state: State<'_, BrowserState>,
    capture_state: State<'_, SnapshotCaptureState>,
) -> Result<TargetPageSnapshot, AppError> {
    capture_page_snapshot(&app, browser_state.inner(), capture_state.inner())
}

#[tauri::command]
fn get_focused_asset_context(
    browser_state: State<'_, BrowserState>,
) -> Result<Option<FocusedAssetContext>, AppError> {
    Ok(browser_state.focused_asset.lock().unwrap().clone())
}

#[tauri::command]
fn submit_page_snapshot(
    request_id: String,
    snapshot: TargetPageSnapshot,
    capture_state: State<'_, SnapshotCaptureState>,
    browser_state: State<'_, BrowserState>,
) -> Result<(), AppError> {
    *browser_state.page_title.lock().unwrap() = snapshot.title.clone();

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

    let requested_url = state.current_url.lock().unwrap().clone();
    let payload = snapshot_state(state.inner(), requested_url)?;
    app.emit(TARGET_BROWSER_EVENT, payload.clone())?;
    Ok(payload)
}

#[tauri::command]
fn set_asset_picker_enabled(
    enabled: bool,
    app: AppHandle,
    browser_state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    let webview = app
        .get_webview(TARGET_WEBVIEW_LABEL)
        .ok_or_else(|| AppError::Message("Target webview is not ready yet.".into()))?;

    *browser_state.asset_picker_enabled.lock().unwrap() = enabled;
    webview.eval(&build_asset_picker_script(enabled)?)?;

    let requested_url = browser_state.current_url.lock().unwrap().clone();
    let payload = snapshot_state(browser_state.inner(), requested_url)?;
    app.emit(TARGET_BROWSER_EVENT, payload.clone())?;
    Ok(payload)
}

#[tauri::command]
fn perform_page_action(
    action: PageActionRequest,
    app: AppHandle,
    browser_state: State<'_, BrowserState>,
    capture_state: State<'_, SnapshotCaptureState>,
    action_state: State<'_, ActionExecutionState>,
) -> Result<PageActionResult, AppError> {
    let outcome = execute_page_action(&app, action_state.inner(), &action)?;

    if let Some(focused_asset) = outcome.focused_asset.clone() {
        *browser_state.focused_asset.lock().unwrap() = Some(focused_asset);
        emit_focused_asset(&app, browser_state.inner())?;
    }

    let snapshot = capture_page_snapshot(&app, browser_state.inner(), capture_state.inner())?;
    let requested_url = browser_state.current_url.lock().unwrap().clone();
    let browser = snapshot_state(browser_state.inner(), requested_url)?;

    Ok(PageActionResult {
        action,
        success: outcome.success,
        message: outcome.message,
        browser,
        snapshot,
        focused_asset: browser_state.focused_asset.lock().unwrap().clone(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BrowserState::default())
        .manage(SnapshotCaptureState::default())
        .manage(ActionExecutionState::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            create_target_webview(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            navigate_target,
            get_target_browser_state,
            get_target_page_snapshot,
            get_focused_asset_context,
            submit_page_snapshot,
            submit_focused_asset_context,
            submit_page_action_result,
            set_layout_preset,
            set_asset_picker_enabled,
            perform_page_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn create_target_webview(app: &AppHandle) -> Result<(), AppError> {
    if app.get_webview(TARGET_WEBVIEW_LABEL).is_some() {
        return Ok(());
    }

    let main_window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window was not found.".into()))?;

    let page_events = app.clone();
    let builder = WebviewBuilder::new(
        TARGET_WEBVIEW_LABEL,
        WebviewUrl::External(DEFAULT_TARGET_URL.parse::<Url>()?),
    )
    .on_page_load(move |_webview, payload| {
        let loading = matches!(payload.event(), PageLoadEvent::Started);
        let current_url = payload.url().to_string();

        if let Some(state) = page_events.try_state::<BrowserState>() {
            *state.loading.lock().unwrap() = loading;
            *state.current_url.lock().unwrap() = current_url.clone();

            if loading {
                state.page_title.lock().unwrap().clear();
                *state.asset_picker_enabled.lock().unwrap() = false;
                *state.focused_asset.lock().unwrap() = None;
                let _ = page_events.emit(TARGET_ASSET_EVENT, Option::<FocusedAssetContext>::None);
            }

            if let Ok(snapshot) = snapshot_state(state.inner(), current_url) {
                let _ = page_events.emit(TARGET_BROWSER_EVENT, snapshot);
            }
        }
    });

    let state = app.state::<BrowserState>();
    let layout = layout_for_window(&main_window, state.inner())?;
    main_window.add_child(builder, layout.target_position, layout.target_size)?;

    let resize_handle = app.clone();
    main_window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
        ) {
            let _ = update_webview_layouts(&resize_handle);
        }
    });

    update_webview_layouts(app)?;
    Ok(())
}

fn update_webview_layouts(app: &AppHandle) -> Result<(), AppError> {
    let main_window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window was not found.".into()))?;
    let assistant_webview = app
        .get_webview(MAIN_WEBVIEW_LABEL)
        .ok_or_else(|| AppError::Message("Assistant webview was not found.".into()))?;
    let target_webview = app
        .get_webview(TARGET_WEBVIEW_LABEL)
        .ok_or_else(|| AppError::Message("Target webview was not found.".into()))?;

    let state = app.state::<BrowserState>();
    let layout = layout_for_window(&main_window, state.inner())?;

    assistant_webview.set_position(layout.assistant_position)?;
    assistant_webview.set_size(layout.assistant_size)?;
    target_webview.set_position(layout.target_position)?;
    target_webview.set_size(layout.target_size)?;
    Ok(())
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

    if assistant_width < MIN_ASSISTANT_PANEL_WIDTH || target_width < MIN_TARGET_PANEL_WIDTH {
        return Err(AppError::Message(
            "Window is too narrow to keep both panes visible.".into(),
        ));
    }

    Ok(PaneLayout {
        assistant_position: LogicalPosition::new(0.0, 0.0),
        assistant_size: LogicalSize::new(assistant_width, inner_size.height),
        target_position: LogicalPosition::new(assistant_width, 0.0),
        target_size: LogicalSize::new(target_width, inner_size.height),
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

fn snapshot_state(
    state: &BrowserState,
    requested_url: String,
) -> Result<TargetBrowserState, AppError> {
    Ok(TargetBrowserState {
        current_url: state.current_url.lock().unwrap().clone(),
        requested_url,
        loading: *state.loading.lock().unwrap(),
        layout_preset: *state.layout_preset.lock().unwrap(),
        page_title: state.page_title.lock().unwrap().clone(),
        asset_picker_enabled: *state.asset_picker_enabled.lock().unwrap(),
    })
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
    let webview = app
        .get_webview(TARGET_WEBVIEW_LABEL)
        .ok_or_else(|| AppError::Message("Target webview is not ready yet.".into()))?;

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

    *browser_state.page_title.lock().unwrap() = snapshot.title.clone();

    let requested_url = browser_state.current_url.lock().unwrap().clone();
    app.emit(
        TARGET_BROWSER_EVENT,
        snapshot_state(browser_state, requested_url)?,
    )?;

    Ok(snapshot)
}

fn execute_page_action(
    app: &AppHandle,
    action_state: &ActionExecutionState,
    action: &PageActionRequest,
) -> Result<PageActionOutcome, AppError> {
    let webview = app
        .get_webview(TARGET_WEBVIEW_LABEL)
        .ok_or_else(|| AppError::Message("Target webview is not ready yet.".into()))?;

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
    TargetPageSnapshot {
        url: state.current_url.lock().unwrap().clone(),
        title: state.page_title.lock().unwrap().clone(),
        loading: *state.loading.lock().unwrap(),
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
        assert_close(layout.assistant_size.width, 896.0, "assistant width");
        assert_close(layout.target_position.x, 896.0, "target x");
        assert_close(layout.target_size.width, 384.0, "target width");
        assert_close(layout.assistant_size.height, 820.0, "assistant height");
        assert_close(layout.target_size.height, 820.0, "target height");
    }

    #[test]
    fn computes_50_50_layout_for_standard_window() {
        let layout =
            layout_for_size(LogicalSize::new(1280.0, 820.0), LayoutPreset::Split50_50).unwrap();

        assert_close(layout.assistant_size.width, 640.0, "assistant width");
        assert_close(layout.target_position.x, 640.0, "target x");
        assert_close(layout.target_size.width, 640.0, "target width");
    }

    #[test]
    fn computes_30_70_layout_for_standard_window() {
        let layout =
            layout_for_size(LogicalSize::new(1280.0, 820.0), LayoutPreset::Split30_70).unwrap();

        assert_close(layout.assistant_size.width, 384.0, "assistant width");
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

        assert!(layout.assistant_size.width >= MIN_ASSISTANT_PANEL_WIDTH);
        assert!(layout.target_size.width >= MIN_TARGET_PANEL_WIDTH);
        assert_close(
            layout.assistant_size.width + layout.target_size.width,
            MIN_WINDOW_WIDTH,
            "total width",
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

            assert_close(layout.assistant_position.x, 0.0, "assistant x");
            assert_close(
                layout.target_position.x,
                layout.assistant_size.width,
                "target starts after assistant",
            );
            assert_close(
                layout.assistant_size.width + layout.target_size.width,
                1440.0,
                "panes cover full width",
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
