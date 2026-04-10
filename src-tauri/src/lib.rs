use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    webview::{PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TARGET_WEBVIEW_LABEL: &str = "target-webview";
const DEFAULT_TARGET_URL: &str = "https://developer.mozilla.org/en-US/docs/Web/API/WebView";
const MIN_LEFT_PANEL_WIDTH: f64 = 320.0;
const MIN_TARGET_PANEL_WIDTH: f64 = 320.0;
const DEFAULT_LEFT_PANEL_RATIO: f64 = 0.5;
const MIN_LEFT_PANEL_RATIO: f64 = 0.3;
const MAX_LEFT_PANEL_RATIO: f64 = 0.7;

struct BrowserState {
    current_url: Mutex<String>,
    loading: Mutex<bool>,
    left_panel_ratio: Mutex<f64>,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            current_url: Mutex::new(DEFAULT_TARGET_URL.to_string()),
            loading: Mutex::new(false),
            left_panel_ratio: Mutex::new(DEFAULT_LEFT_PANEL_RATIO),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TargetBrowserState {
    current_url: String,
    requested_url: String,
    loading: bool,
    left_panel_ratio: f64,
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

#[tauri::command]
fn navigate_target(url: String, app: AppHandle, state: State<'_, BrowserState>) -> Result<TargetBrowserState, AppError> {
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
fn set_left_panel_ratio(
    ratio: f64,
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<TargetBrowserState, AppError> {
    let normalized_ratio = ratio.clamp(MIN_LEFT_PANEL_RATIO, MAX_LEFT_PANEL_RATIO);

    {
        let mut current_ratio = state.left_panel_ratio.lock().unwrap();
        *current_ratio = normalized_ratio;
    }

    update_target_webview_layout(&app)?;

    let requested_url = state.current_url.lock().unwrap().clone();
    let payload = snapshot_state(&state, requested_url)?;
    app.emit("target-browser://state-changed", payload.clone())?;
    Ok(payload)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BrowserState::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            create_target_webview(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            navigate_target,
            get_target_browser_state,
            set_left_panel_ratio
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

            if let Ok(snapshot) = snapshot_state(&state, current_url) {
                let _ = page_events.emit("target-browser://state-changed", snapshot);
            }
        }
    });

    let state = app.state::<BrowserState>();
    let (_, target_position, target_size) = layout_for_window(&main_window, &state)?;
    main_window.add_child(builder, target_position, target_size)?;

    let resize_handle = app.clone();
    main_window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) {
            let _ = update_target_webview_layout(&resize_handle);
        }
    });

    update_target_webview_layout(app)?;
    Ok(())
}

fn update_target_webview_layout(app: &AppHandle) -> Result<(), AppError> {
    let main_window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window was not found.".into()))?;
    let target_webview = app
        .get_webview(TARGET_WEBVIEW_LABEL)
        .ok_or_else(|| AppError::Message("Target webview was not found.".into()))?;

    let state = app.state::<BrowserState>();
    let (_, target_position, target_size) = layout_for_window(&main_window, &state)?;
    target_webview.set_position(target_position)?;
    target_webview.set_size(target_size)?;
    Ok(())
}

fn layout_for_window(
    window: &tauri::Window,
    state: &BrowserState,
) -> Result<(f64, LogicalPosition<f64>, LogicalSize<f64>), AppError> {
    let scale_factor = window.scale_factor()?;
    let inner_size = window.inner_size()?.to_logical::<f64>(scale_factor);
    let left_panel_ratio = *state.left_panel_ratio.lock().unwrap();

    let left_panel_width = (inner_size.width * left_panel_ratio)
        .max(MIN_LEFT_PANEL_WIDTH)
        .min(inner_size.width - MIN_TARGET_PANEL_WIDTH);
    let target_width = (inner_size.width - left_panel_width).max(MIN_TARGET_PANEL_WIDTH);
    let target_position = LogicalPosition::new(left_panel_width, 0.0);
    let target_size = LogicalSize::new(target_width, inner_size.height);

    Ok((left_panel_width, target_position, target_size))
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
        left_panel_ratio: *state.left_panel_ratio.lock().unwrap(),
    })
}
