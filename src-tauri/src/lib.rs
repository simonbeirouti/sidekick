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

struct BrowserState {
    current_url: Mutex<String>,
    loading: Mutex<bool>,
    layout_preset: Mutex<LayoutPreset>,
    page_title: Mutex<String>,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            current_url: Mutex::new(DEFAULT_TARGET_URL.to_string()),
            loading: Mutex::new(false),
            layout_preset: Mutex::new(LayoutPreset::default()),
            page_title: Mutex::new(String::new()),
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TargetBrowserState {
    current_url: String,
    requested_url: String,
    loading: bool,
    layout_preset: LayoutPreset,
    page_title: String,
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
    interactive_labels: Vec<String>,
    extraction_error: Option<String>,
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

    {
        let mut loading = state.loading.lock().unwrap();
        *loading = true;
    }

    {
        let mut current_url = state.current_url.lock().unwrap();
        *current_url = normalized.clone();
    }

    {
        let mut page_title = state.page_title.lock().unwrap();
        page_title.clear();
    }

    webview.navigate(parsed_url)?;

    let payload = snapshot_state(&state, normalized)?;
    app.emit("target-browser://state-changed", payload.clone())?;
    Ok(payload)
}

#[tauri::command]
fn get_target_browser_state(state: State<'_, BrowserState>) -> Result<TargetBrowserState, AppError> {
    let requested_url = state.current_url.lock().unwrap().clone();
    Ok(snapshot_state(&state, requested_url)?)
}

#[tauri::command]
fn get_target_page_snapshot(
    app: AppHandle,
    browser_state: State<'_, BrowserState>,
    capture_state: State<'_, SnapshotCaptureState>,
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

    webview.eval(build_snapshot_script(&request_id)?)?;

    let pending = capture_state.pending.lock().unwrap();
    let (mut pending, _) = capture_state
        .ready
        .wait_timeout_while(pending, Duration::from_millis(1_500), |pending| {
            pending.request_id.as_deref() == Some(request_id.as_str()) && pending.response.is_none()
        })
        .map_err(|_| AppError::Message("Waiting for the page snapshot failed.".into()))?;

    let snapshot = pending
        .response
        .clone()
        .unwrap_or_else(|| fallback_snapshot(&browser_state, Some("Page inspection timed out.".into())));

    pending.request_id = None;
    pending.response = None;
    drop(pending);

    {
        let mut page_title = browser_state.page_title.lock().unwrap();
        *page_title = snapshot.title.clone();
    }

    let requested_url = browser_state.current_url.lock().unwrap().clone();
    app.emit(
        "target-browser://state-changed",
        snapshot_state(&browser_state, requested_url)?,
    )?;

    Ok(snapshot)
}

#[tauri::command]
fn submit_page_snapshot(
    request_id: String,
    snapshot: TargetPageSnapshot,
    capture_state: State<'_, SnapshotCaptureState>,
    browser_state: State<'_, BrowserState>,
) -> Result<(), AppError> {
    {
        let mut page_title = browser_state.page_title.lock().unwrap();
        *page_title = snapshot.title.clone();
    }

    let mut pending = capture_state.pending.lock().unwrap();
    if pending.request_id.as_deref() == Some(request_id.as_str()) {
        pending.response = Some(snapshot);
        capture_state.ready.notify_all();
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

    {
        let mut current_preset = state.layout_preset.lock().unwrap();
        *current_preset = next_preset;
    }

    update_webview_layouts(&app)?;

    let requested_url = state.current_url.lock().unwrap().clone();
    let payload = snapshot_state(&state, requested_url)?;
    app.emit("target-browser://state-changed", payload.clone())?;
    Ok(payload)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BrowserState::default())
        .manage(SnapshotCaptureState::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            create_target_webview(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            navigate_target,
            get_target_browser_state,
            get_target_page_snapshot,
            submit_page_snapshot,
            set_layout_preset
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
            if let Ok(mut state_loading) = state.loading.lock() {
                *state_loading = loading;
            }

            if let Ok(mut state_url) = state.current_url.lock() {
                *state_url = current_url.clone();
            }

            if loading {
                if let Ok(mut page_title) = state.page_title.lock() {
                    page_title.clear();
                }
            }

            if let Ok(snapshot) = snapshot_state(&state, current_url) {
                let _ = page_events.emit("target-browser://state-changed", snapshot);
            }
        }
    });

    let state = app.state::<BrowserState>();
    let layout = layout_for_window(&main_window, &state)?;
    main_window.add_child(builder, layout.target_position, layout.target_size)?;

    let resize_handle = app.clone();
    main_window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) {
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
    let layout = layout_for_window(&main_window, &state)?;

    assistant_webview.set_position(layout.assistant_position)?;
    assistant_webview.set_size(layout.assistant_size)?;
    target_webview.set_position(layout.target_position)?;
    target_webview.set_size(layout.target_size)?;
    Ok(())
}

fn layout_for_window(
    window: &tauri::Window,
    state: &BrowserState,
) -> Result<PaneLayout, AppError> {
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
        return Err(AppError::Message("Enter a URL to load on the right side.".into()));
    }

    if let Ok(url) = Url::parse(trimmed) {
        return Ok(url);
    }

    Ok(Url::parse(&format!("https://{trimmed}"))?)
}

fn snapshot_state(
    state: &State<'_, BrowserState>,
    requested_url: String,
) -> Result<TargetBrowserState, AppError> {
    Ok(TargetBrowserState {
        current_url: state.current_url.lock().unwrap().clone(),
        requested_url,
        loading: *state.loading.lock().unwrap(),
        layout_preset: *state.layout_preset.lock().unwrap(),
        page_title: state.page_title.lock().unwrap().clone(),
    })
}

fn fallback_snapshot(state: &BrowserState, extraction_error: Option<String>) -> TargetPageSnapshot {
    TargetPageSnapshot {
        url: state.current_url.lock().unwrap().clone(),
        title: state.page_title.lock().unwrap().clone(),
        loading: *state.loading.lock().unwrap(),
        captured_at: unix_timestamp(),
        visible_text: String::new(),
        headings: Vec::new(),
        interactive_labels: Vec::new(),
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

            const normalizeText = (value, maxLength) =>
              (value ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, maxLength);

            const isVisible = (element) => {{
              if (!(element instanceof HTMLElement)) {{
                return false;
              }}

              const style = window.getComputedStyle(element);
              return style.display !== "none" && style.visibility !== "hidden";
            }};

            const dedupe = (values, maxItems) => {{
              const unique = [];
              for (const value of values) {{
                if (value && !unique.includes(value)) {{
                  unique.push(value);
                }}
                if (unique.length >= maxItems) {{
                  break;
                }}
              }}
              return unique;
            }};

            const collectInteractiveLabels = () => {{
              const selectors = [
                "button",
                "a[href]",
                "input",
                "textarea",
                "select",
                "[role='button']",
              ];

              return dedupe(
                Array.from(document.querySelectorAll(selectors.join(",")))
                  .filter(isVisible)
                  .map((element) =>
                    normalizeText(
                      element.getAttribute("aria-label") ||
                        element.getAttribute("title") ||
                        element.innerText ||
                        element.textContent ||
                        element.getAttribute("value") ||
                        element.getAttribute("placeholder"),
                      120,
                    ),
                  )
                  .filter(Boolean),
                24,
              );
            }};

            const snapshot = {{
              url: window.location.href,
              title: document.title || "",
              loading: document.readyState !== "complete",
              capturedAt: new Date().toISOString(),
              visibleText: normalizeText(document.body?.innerText || document.body?.textContent || "", 6000),
              headings: dedupe(
                Array.from(document.querySelectorAll("h1, h2, h3"))
                  .filter(isVisible)
                  .map((element) => normalizeText(element.textContent, 160))
                  .filter(Boolean),
                12,
              ),
              interactiveLabels: collectInteractiveLabels(),
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
                interactiveLabels: [],
                extractionError: String(error),
              }};

              try {{
                await invoke("submit_page_snapshot", {{ requestId, snapshot: fallbackSnapshot }});
              }} catch (_ignored) {{}}
            }});
          }})();
        "#
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
        let layout =
            layout_for_size(LogicalSize::new(MIN_WINDOW_WIDTH, 640.0), LayoutPreset::Split30_70)
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
}
