use crate::watcher;
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use notify::RecommendedWatcher;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;

#[derive(Clone, Debug)]
struct RuntimeConfig {
    input_path: String,
    cwd: PathBuf,
    preferences: ReaderPreferences,
    watch: bool,
    allow_html: bool,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            input_path: ".".to_string(),
            cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            preferences: ReaderPreferences::default(),
            watch: true,
            allow_html: false,
        }
    }
}

#[derive(Default)]
struct RuntimeState {
    config: RuntimeConfig,
    document_path: Option<PathBuf>,
    initial_error: Option<MdvError>,
    watcher: Option<RecommendedWatcher>,
}

pub struct SharedState {
    inner: Mutex<RuntimeState>,
    ai_runs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for SharedState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(RuntimeState::default()),
            ai_runs: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    path: String,
    file_name: String,
    directory: String,
    content: String,
    watching: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialState {
    preferences: ReaderPreferences,
    watch: bool,
    allow_html: bool,
    document: Option<DocumentPayload>,
    error: Option<MdvError>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdvError {
    kind: String,
    message: String,
    path: Option<String>,
    cwd: Option<String>,
    details: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    path: String,
    file_name: String,
    directory: String,
    size_bytes: u64,
    modified_millis: Option<u128>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderBookmark {
    #[serde(default)]
    id: String,
    #[serde(default)]
    label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    target: Option<ReaderBookmarkTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scroll_y: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    heading_id: Option<String>,
    #[serde(default)]
    created_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReaderBookmarkTarget {
    Heading {
        heading_id: String,
        scroll_y_fallback: u32,
    },
    Offset {
        scroll_y: u32,
    },
}

impl Default for ReaderBookmarkTarget {
    fn default() -> Self {
        Self::Offset { scroll_y: 0 }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    #[serde(default = "default_ai_provider_id")]
    active_provider_id: String,
    #[serde(default = "default_ai_providers")]
    providers: Vec<AiProvider>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProvider {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default = "default_ai_provider_kind")]
    kind: String,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    reasoning: String,
    #[serde(default)]
    has_api_key: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    provider_id: String,
    prompt: String,
    #[serde(default)]
    context_items: Vec<ContextItem>,
    #[serde(default)]
    conversation_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextItem {
    kind: String,
    label: String,
    text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiStreamPayload {
    run_id: String,
    delta: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiCompletePayload {
    run_id: String,
    usage: Option<serde_json::Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiErrorPayload {
    run_id: String,
    message: String,
    details: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderPreferences {
    #[serde(default = "default_theme")]
    theme: String,
    #[serde(default = "default_font_preset")]
    font_preset: String,
    #[serde(default = "default_font_size")]
    font_size: u16,
    #[serde(default = "default_line_height")]
    line_height: f32,
    #[serde(default = "default_content_width")]
    content_width: u16,
    #[serde(default = "default_outline_visible")]
    outline_visible: bool,
    #[serde(default)]
    bookmarks: HashMap<String, Vec<ReaderBookmark>>,
    #[serde(default)]
    ai: AiSettings,
}

impl Default for ReaderPreferences {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            font_preset: default_font_preset(),
            font_size: default_font_size(),
            line_height: default_line_height(),
            content_width: default_content_width(),
            outline_visible: default_outline_visible(),
            bookmarks: HashMap::new(),
            ai: AiSettings::default(),
        }
    }
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            active_provider_id: default_ai_provider_id(),
            providers: default_ai_providers(),
        }
    }
}

impl MdvError {
    pub(crate) fn new(kind: &str, message: impl Into<String>) -> Self {
        Self {
            kind: kind.to_string(),
            message: message.into(),
            path: None,
            cwd: None,
            details: None,
        }
    }

    fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    fn with_cwd(mut self, cwd: &Path) -> Self {
        self.cwd = Some(cwd.display().to_string());
        self
    }

    pub(crate) fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }
}

pub fn initialize_state(app: &AppHandle) {
    let config = parse_cli_args();
    let resolved = resolve_document_path(&config.input_path, &config.cwd);
    let mut runtime = RuntimeState {
        config: config.clone(),
        ..RuntimeState::default()
    };

    match resolved {
        Ok(path) => {
            if config.watch {
                if let Ok(file_watcher) = watcher::start(app.clone(), path.clone()) {
                    runtime.watcher = Some(file_watcher);
                }
            }

            runtime.document_path = Some(path);
        }
        Err(error) => runtime.initial_error = Some(error),
    }

    let state = app.state::<SharedState>();
    *state.inner.lock().expect("runtime state poisoned") = runtime;
}

#[tauri::command]
pub fn get_initial_state(state: State<'_, SharedState>) -> InitialState {
    let snapshot = {
        let inner = state.inner.lock().expect("runtime state poisoned");
        (
            inner.config.clone(),
            inner.document_path.clone(),
            inner.initial_error.clone(),
            inner.watcher.is_some(),
        )
    };

    let (config, document_path, initial_error, watching) = snapshot;
    let (document, error) = match document_path.as_ref() {
        Some(path) => match read_document_at(path, watching) {
            Ok(document) => (Some(document), initial_error),
            Err(error) => (None, Some(error)),
        },
        None => (None, initial_error),
    };

    InitialState {
        preferences: config.preferences,
        watch: config.watch,
        allow_html: config.allow_html,
        document,
        error,
    }
}

#[tauri::command]
pub fn reload_document(state: State<'_, SharedState>) -> Result<DocumentPayload, MdvError> {
    let (path, watching) = {
        let inner = state.inner.lock().expect("runtime state poisoned");
        (
            inner.document_path.clone().ok_or_else(|| {
                MdvError::new("NoDocument", "No Markdown file is currently open.")
            })?,
            inner.watcher.is_some(),
        )
    };

    read_document_at(&path, watching)
}

#[tauri::command]
pub fn read_markdown(path: String) -> Result<String, MdvError> {
    fs::read_to_string(&path).map_err(|error| read_error(Path::new(&path), error))
}

#[tauri::command]
pub fn resolve_input_path(input_path: String) -> Result<String, MdvError> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    resolve_document_path(&input_path, &cwd).map(|path| path.display().to_string())
}

#[tauri::command]
pub fn open_document(
    app: AppHandle,
    state: State<'_, SharedState>,
    path: String,
) -> Result<DocumentPayload, MdvError> {
    open_document_from_input(&app, &state, &path)
}

#[tauri::command]
pub fn pick_markdown_file(
    app: AppHandle,
    state: State<'_, SharedState>,
) -> Result<Option<DocumentPayload>, MdvError> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("Open Markdown")
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file()
    else {
        return Ok(None);
    };

    open_document_from_input(&app, &state, &path.display().to_string()).map(Some)
}

#[tauri::command]
pub fn get_file_metadata(path: String) -> Result<FileMetadata, MdvError> {
    metadata_for_path(&PathBuf::from(path))
}

#[tauri::command]
pub fn watch_file(
    app: AppHandle,
    state: State<'_, SharedState>,
    path: String,
) -> Result<DocumentPayload, MdvError> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let resolved = resolve_document_path(&path, &cwd)?;
    let watcher = watcher::start(app, resolved.clone())?;
    let document = read_document_at(&resolved, true)?;

    let mut inner = state.inner.lock().expect("runtime state poisoned");
    inner.config.input_path = path;
    inner.document_path = Some(resolved);
    inner.initial_error = None;
    inner.watcher = Some(watcher);

    Ok(document)
}

#[tauri::command]
pub fn resolve_image_src(src: String, markdown_path: String) -> Result<String, MdvError> {
    if is_browser_safe_src(&src) {
        return Ok(src);
    }

    let markdown_path = PathBuf::from(markdown_path);
    let base_dir = markdown_path.parent().ok_or_else(|| {
        MdvError::new(
            "InvalidAssetBase",
            "Could not resolve Markdown file directory.",
        )
        .with_path(markdown_path.display().to_string())
    })?;
    let base_dir = base_dir
        .canonicalize()
        .map_err(|error| read_error(base_dir, error))?;

    let asset_path = local_asset_path(&src)?;
    let candidate = if asset_path.is_absolute() {
        asset_path
    } else {
        base_dir.join(asset_path)
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|error| read_error(&candidate, error))?;

    if !canonical.starts_with(&base_dir) {
        return Err(MdvError::new(
            "PermissionDenied",
            "Image path is outside the opened Markdown directory.",
        )
        .with_path(canonical.display().to_string()));
    }

    let mime = mime_guess::from_path(&canonical).first_or_octet_stream();
    if !mime.essence_str().starts_with("image/") {
        return Err(
            MdvError::new("InvalidImage", "Referenced asset is not an image.")
                .with_path(canonical.display().to_string()),
        );
    }

    let bytes = fs::read(&canonical).map_err(|error| read_error(&canonical, error))?;
    Ok(format!(
        "data:{};base64,{}",
        mime.essence_str(),
        STANDARD.encode(bytes)
    ))
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), MdvError> {
    let parsed = Url::parse(&url).map_err(|error| {
        MdvError::new("InvalidUrl", "Invalid external URL.").with_details(error.to_string())
    })?;

    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err(MdvError::new(
            "UnsupportedUrl",
            "Only http, https, and mailto links can be opened externally.",
        )
        .with_path(url));
    }

    open::that(parsed.as_str()).map_err(|error| {
        MdvError::new("OpenUrlError", "Could not open external URL.")
            .with_details(error.to_string())
    })
}

#[tauri::command]
pub fn save_theme_preference(
    theme: String,
    state: State<'_, SharedState>,
) -> Result<String, MdvError> {
    let theme = normalize_theme(&theme);
    let mut preferences = {
        let inner = state.inner.lock().expect("runtime state poisoned");
        inner.config.preferences.clone()
    };
    preferences.theme = theme.clone();
    let preferences = normalize_reader_preferences(preferences);

    save_preferences(&preferences)?;

    let mut inner = state.inner.lock().expect("runtime state poisoned");
    inner.config.preferences = preferences;

    Ok(theme)
}

#[tauri::command]
pub fn save_reader_preferences(
    preferences: ReaderPreferences,
    state: State<'_, SharedState>,
) -> Result<ReaderPreferences, MdvError> {
    let preferences = normalize_reader_preferences(preferences);
    save_preferences(&preferences)?;

    let mut inner = state.inner.lock().expect("runtime state poisoned");
    inner.config.preferences = preferences.clone();

    Ok(preferences)
}

#[tauri::command]
pub fn get_ai_settings(state: State<'_, SharedState>) -> Result<AiSettings, MdvError> {
    let settings = {
        let inner = state.inner.lock().expect("runtime state poisoned");
        inner.config.preferences.ai.clone()
    };

    Ok(with_ai_key_presence(settings))
}

#[tauri::command]
pub fn save_ai_provider(
    provider: AiProvider,
    state: State<'_, SharedState>,
) -> Result<AiSettings, MdvError> {
    let provider = normalize_ai_provider(provider, 0)
        .ok_or_else(|| MdvError::new("InvalidAiProvider", "AI provider settings are invalid."))?;

    let mut preferences = {
        let inner = state.inner.lock().expect("runtime state poisoned");
        inner.config.preferences.clone()
    };

    let mut updated = false;
    for existing in preferences.ai.providers.iter_mut() {
        if existing.id == provider.id {
            *existing = provider.clone();
            updated = true;
            break;
        }
    }

    if !updated {
        preferences.ai.providers.push(provider.clone());
        preferences.ai.active_provider_id = provider.id;
    }

    preferences = normalize_reader_preferences(preferences);
    save_preferences(&preferences)?;

    let settings = preferences.ai.clone();
    let mut inner = state.inner.lock().expect("runtime state poisoned");
    inner.config.preferences = preferences;

    Ok(with_ai_key_presence(settings))
}

#[tauri::command]
pub fn delete_ai_provider(
    provider_id: String,
    state: State<'_, SharedState>,
) -> Result<AiSettings, MdvError> {
    let mut preferences = {
        let inner = state.inner.lock().expect("runtime state poisoned");
        inner.config.preferences.clone()
    };

    preferences
        .ai
        .providers
        .retain(|provider| provider.id != provider_id);

    if !preferences
        .ai
        .providers
        .iter()
        .any(|provider| provider.id == preferences.ai.active_provider_id)
    {
        preferences.ai.active_provider_id = preferences
            .ai
            .providers
            .first()
            .map(|provider| provider.id.clone())
            .unwrap_or_default();
    }

    let _ = delete_ai_api_key_from_keychain(&provider_id);
    preferences = normalize_reader_preferences(preferences);
    save_preferences(&preferences)?;

    let settings = preferences.ai.clone();
    let mut inner = state.inner.lock().expect("runtime state poisoned");
    inner.config.preferences = preferences;

    Ok(with_ai_key_presence(settings))
}

#[tauri::command]
pub fn set_ai_api_key(
    provider_id: String,
    api_key: String,
    state: State<'_, SharedState>,
) -> Result<AiSettings, MdvError> {
    let settings = {
        let inner = state.inner.lock().expect("runtime state poisoned");
        inner.config.preferences.ai.clone()
    };

    if !settings
        .providers
        .iter()
        .any(|provider| provider.id == provider_id)
    {
        return Err(MdvError::new(
            "AiProviderNotFound",
            "Could not find this AI provider.",
        ));
    }

    if api_key.trim().is_empty() {
        delete_ai_api_key_from_keychain(&provider_id)?;
    } else {
        save_ai_api_key_to_keychain(&provider_id, api_key.trim())?;
    }

    Ok(with_ai_key_presence(settings))
}

#[tauri::command]
pub async fn test_ai_provider(
    provider_id: String,
    state: State<'_, SharedState>,
) -> Result<(), MdvError> {
    let provider = get_ai_provider(&state, &provider_id)?;
    let api_key = load_ai_api_key_from_keychain(&provider.id)?;
    validate_ai_provider_config(&provider)?;
    test_ai_provider_request(&provider, &api_key).await
}

#[tauri::command]
pub fn start_ai_chat(
    app: AppHandle,
    state: State<'_, SharedState>,
    request: AiChatRequest,
) -> Result<String, MdvError> {
    let provider = get_ai_provider(&state, &request.provider_id)?;
    let api_key = load_ai_api_key_from_keychain(&provider.id)?;
    validate_ai_provider_config(&provider)?;

    if request.prompt.trim().is_empty() {
        return Err(MdvError::new(
            "InvalidAiPrompt",
            "Ask a question before starting AI chat.",
        ));
    }

    let run_id = uuid::Uuid::new_v4().to_string();
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state
        .ai_runs
        .lock()
        .expect("AI run state poisoned")
        .insert(run_id.clone(), cancel_flag.clone());

    let spawned_run_id = run_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = stream_ai_chat(
            app.clone(),
            provider,
            api_key,
            request,
            spawned_run_id.clone(),
            cancel_flag,
        )
        .await;

        if let Err(error) = result {
            let _ = app.emit(
                "mdv:ai-error",
                AiErrorPayload {
                    run_id: spawned_run_id.clone(),
                    message: error.message,
                    details: error.details,
                },
            );
        }

        let state = app.state::<SharedState>();
        state
            .ai_runs
            .lock()
            .expect("AI run state poisoned")
            .remove(&spawned_run_id);
    });

    Ok(run_id)
}

#[tauri::command]
pub fn cancel_ai_chat(run_id: String, state: State<'_, SharedState>) -> bool {
    let Some(cancel_flag) = state
        .ai_runs
        .lock()
        .expect("AI run state poisoned")
        .get(&run_id)
        .cloned()
    else {
        return false;
    };

    cancel_flag.store(true, Ordering::Relaxed);
    true
}

fn with_ai_key_presence(mut settings: AiSettings) -> AiSettings {
    for provider in settings.providers.iter_mut() {
        provider.has_api_key = has_ai_api_key(&provider.id);
    }

    settings
}

fn get_ai_provider(
    state: &State<'_, SharedState>,
    provider_id: &str,
) -> Result<AiProvider, MdvError> {
    let settings = {
        let inner = state.inner.lock().expect("runtime state poisoned");
        inner.config.preferences.ai.clone()
    };

    settings
        .providers
        .into_iter()
        .find(|provider| provider.id == provider_id)
        .ok_or_else(|| MdvError::new("AiProviderNotFound", "Could not find this AI provider."))
}

fn ai_keychain_entry(provider_id: &str) -> Result<keyring::Entry, MdvError> {
    keyring::Entry::new("mdv", &format!("ai:{provider_id}")).map_err(|error| {
        MdvError::new("AiKeychainError", "Could not access the OS keychain.")
            .with_details(error.to_string())
    })
}

fn save_ai_api_key_to_keychain(provider_id: &str, api_key: &str) -> Result<(), MdvError> {
    ai_keychain_entry(provider_id)?
        .set_password(api_key)
        .map_err(|error| {
            MdvError::new("AiKeychainError", "Could not save this API key.")
                .with_details(error.to_string())
        })
}

fn load_ai_api_key_from_keychain(provider_id: &str) -> Result<String, MdvError> {
    let api_key = ai_keychain_entry(provider_id)?
        .get_password()
        .map_err(|error| {
            MdvError::new(
                "AiApiKeyMissing",
                "Add an API key for this AI provider first.",
            )
            .with_details(error.to_string())
        })?;

    if api_key.trim().is_empty() {
        return Err(MdvError::new(
            "AiApiKeyMissing",
            "Add an API key for this AI provider first.",
        ));
    }

    Ok(api_key)
}

fn delete_ai_api_key_from_keychain(provider_id: &str) -> Result<(), MdvError> {
    let entry = ai_keychain_entry(provider_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(error) => {
            let message = error.to_string();
            if message.to_lowercase().contains("no entry")
                || message.to_lowercase().contains("not found")
            {
                return Ok(());
            }

            Err(
                MdvError::new("AiKeychainError", "Could not delete this API key.")
                    .with_details(message),
            )
        }
    }
}

fn has_ai_api_key(provider_id: &str) -> bool {
    load_ai_api_key_from_keychain(provider_id)
        .map(|api_key| !api_key.trim().is_empty())
        .unwrap_or(false)
}

fn validate_ai_provider_config(provider: &AiProvider) -> Result<(), MdvError> {
    let parsed = Url::parse(&provider.base_url).map_err(|error| {
        MdvError::new("InvalidAiProvider", "AI provider base URL is invalid.")
            .with_details(error.to_string())
    })?;

    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(MdvError::new(
            "InvalidAiProvider",
            "AI provider base URL must use http or https.",
        ));
    }

    if provider.model.trim().is_empty() {
        return Err(MdvError::new(
            "InvalidAiProvider",
            "AI provider model cannot be empty.",
        ));
    }

    Ok(())
}

fn ai_endpoint_url(provider: &AiProvider) -> String {
    let base_url = provider.base_url.trim_end_matches('/');

    if provider.kind == "claude" {
        if base_url.ends_with("/messages") {
            return base_url.to_string();
        }

        return format!("{base_url}/messages");
    }

    if base_url.ends_with("/chat/completions") {
        return base_url.to_string();
    }

    format!("{base_url}/chat/completions")
}

fn apply_openai_reasoning(provider: &AiProvider, body: &mut serde_json::Value) {
    let reasoning = provider.reasoning.trim();

    if reasoning.is_empty() {
        return;
    }

    body["reasoning_effort"] = serde_json::Value::String(reasoning.to_string());
}

fn claude_reasoning_budget(provider: &AiProvider) -> Option<u64> {
    let reasoning = provider.reasoning.trim();

    if reasoning.is_empty() {
        return None;
    }

    reasoning.parse::<u64>().ok().map(|value| value.max(1024))
}

fn claude_max_tokens_for_reasoning(provider: &AiProvider, fallback: u64) -> u64 {
    claude_reasoning_budget(provider)
        .map(|budget| fallback.max(budget + 1024))
        .unwrap_or(fallback)
}

fn apply_claude_reasoning(provider: &AiProvider, body: &mut serde_json::Value, max_tokens: u64) {
    let Some(budget) = claude_reasoning_budget(provider) else {
        return;
    };

    if budget >= max_tokens {
        return;
    }

    body["thinking"] = serde_json::json!({
        "type": "enabled",
        "budget_tokens": budget,
    });
}

async fn test_ai_provider_request(provider: &AiProvider, api_key: &str) -> Result<(), MdvError> {
    let client = reqwest::Client::new();
    let endpoint = ai_endpoint_url(provider);
    let request = if provider.kind == "claude" {
        let mut body = serde_json::json!({
            "model": provider.model,
            "max_tokens": 16,
            "messages": [
                { "role": "user", "content": "Reply with ok." }
            ]
        });
        apply_claude_reasoning(provider, &mut body, 16);

        client
            .post(endpoint)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
    } else {
        let mut body = serde_json::json!({
            "model": provider.model,
            "messages": [
                { "role": "user", "content": "Reply with ok." }
            ]
        });
        apply_openai_reasoning(provider, &mut body);

        client.post(endpoint).bearer_auth(api_key).json(&body)
    };

    let response = request
        .send()
        .await
        .map_err(|error| ai_transport_error("Could not reach this AI provider.", error))?;
    ensure_ai_success(response, "AI provider test failed.").await?;
    Ok(())
}

async fn stream_ai_chat(
    app: AppHandle,
    provider: AiProvider,
    api_key: String,
    request: AiChatRequest,
    run_id: String,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), MdvError> {
    let client = reqwest::Client::new();
    let endpoint = ai_endpoint_url(&provider);
    let system_prompt = "You are mdv's read-only Markdown assistant. Answer only in clean GitHub-flavored Markdown. Use headings, bullet lists, tables, and fenced code blocks when they improve clarity. Answer from the supplied context when possible. Do not claim to edit files or operate the app.";
    let user_content = build_ai_user_content(&request);
    let http_request = if provider.kind == "claude" {
        let max_tokens = claude_max_tokens_for_reasoning(&provider, 2048);
        let mut body = serde_json::json!({
            "model": provider.model,
            "max_tokens": max_tokens,
            "system": system_prompt,
            "messages": [
                { "role": "user", "content": user_content }
            ],
            "stream": true
        });
        apply_claude_reasoning(&provider, &mut body, max_tokens);

        client
            .post(endpoint)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
    } else {
        let mut body = serde_json::json!({
            "model": provider.model,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_content }
            ],
            "stream": true
        });
        apply_openai_reasoning(&provider, &mut body);

        client.post(endpoint).bearer_auth(api_key).json(&body)
    };

    let response = http_request
        .send()
        .await
        .map_err(|error| ai_transport_error("Could not reach this AI provider.", error))?;
    let response = ensure_ai_success(response, "AI chat request failed.").await?;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        let chunk = chunk
            .map_err(|error| ai_transport_error("AI provider stream was interrupted.", error))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk).replace("\r\n", "\n"));

        while let Some(index) = buffer.find("\n\n") {
            let event = buffer[..index].to_string();
            buffer.drain(..index + 2);

            for data in sse_data_lines(&event) {
                if data.trim() == "[DONE]" {
                    let _ = app.emit(
                        "mdv:ai-complete",
                        AiCompletePayload {
                            run_id: run_id.clone(),
                            usage: None,
                        },
                    );
                    return Ok(());
                }

                let delta = if provider.kind == "claude" {
                    parse_claude_stream_delta(&data)
                } else {
                    parse_openai_stream_delta(&data)
                };

                if let Some(delta) = delta {
                    let _ = app.emit(
                        "mdv:ai-stream",
                        AiStreamPayload {
                            run_id: run_id.clone(),
                            delta,
                        },
                    );
                }
            }
        }
    }

    let _ = app.emit(
        "mdv:ai-complete",
        AiCompletePayload {
            run_id,
            usage: None,
        },
    );
    Ok(())
}

async fn ensure_ai_success(
    response: reqwest::Response,
    message: &str,
) -> Result<reqwest::Response, MdvError> {
    let status = response.status();

    if status.is_success() {
        return Ok(response);
    }

    let details = response
        .text()
        .await
        .unwrap_or_else(|error| error.to_string());
    Err(MdvError::new("AiProviderError", message)
        .with_details(format!("HTTP {status}: {}", truncate_for_error(&details))))
}

fn ai_transport_error(message: &str, error: reqwest::Error) -> MdvError {
    MdvError::new("AiNetworkError", message).with_details(error.to_string())
}

fn truncate_for_error(value: &str) -> String {
    const LIMIT: usize = 800;

    if value.len() <= LIMIT {
        return value.to_string();
    }

    format!("{}...", value.chars().take(LIMIT).collect::<String>())
}

fn build_ai_user_content(request: &AiChatRequest) -> String {
    let mut content = String::new();

    if let Some(conversation_id) = request.conversation_id.as_deref() {
        if !conversation_id.trim().is_empty() {
            content.push_str("<conversation>\n");
            content.push_str(conversation_id.trim());
            content.push_str("\n</conversation>\n\n");
        }
    }

    if !request.context_items.is_empty() {
        content.push_str("<context>\n");

        for item in request.context_items.iter().take(8) {
            let label = item.label.trim();
            let kind = item.kind.trim();
            content.push_str(&format!(
                "<item kind=\"{}\" label=\"{}\">\n{}\n</item>\n",
                escape_xml_attr(kind),
                escape_xml_attr(label),
                truncate_context_text(&item.text),
            ));
        }

        content.push_str("</context>\n\n");
    }

    content.push_str("<question>\n");
    content.push_str(request.prompt.trim());
    content.push_str("\n</question>");
    content
}

fn truncate_context_text(value: &str) -> String {
    const LIMIT: usize = 40 * 1024;

    if value.len() <= LIMIT {
        return value.to_string();
    }

    let head = value.chars().take(LIMIT / 2).collect::<String>();
    let tail = value
        .chars()
        .rev()
        .take(LIMIT / 4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();

    format!("{head}\n\n[truncated: context item exceeded 40KB]\n\n{tail}")
}

fn escape_xml_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn sse_data_lines(event: &str) -> Vec<String> {
    event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.trim_start().to_string())
        .collect()
}

fn parse_openai_stream_delta(data: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(data).ok()?;
    value
        .get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()
        .map(ToString::to_string)
}

fn parse_claude_stream_delta(data: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(data).ok()?;

    if value.get("type")?.as_str()? != "content_block_delta" {
        return None;
    }

    value
        .get("delta")?
        .get("text")?
        .as_str()
        .map(ToString::to_string)
}

fn parse_cli_args() -> RuntimeConfig {
    let mut config = RuntimeConfig {
        preferences: load_preferences(),
        ..RuntimeConfig::default()
    };

    let mut args = std::env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--" => {}
            "--no-watch" => config.watch = false,
            "--allow-html" => config.allow_html = true,
            "--theme" => {
                if let Some(value) = args.next() {
                    config.preferences.theme = normalize_theme(&value);
                }
            }
            _ if arg.starts_with("--theme=") => {
                let value = arg.trim_start_matches("--theme=");
                config.preferences.theme = normalize_theme(value);
            }
            _ if arg.starts_with('-') => {}
            _ => {
                if config.input_path == "." {
                    config.input_path = arg;
                }
            }
        }
    }

    config
}

fn load_preferences() -> ReaderPreferences {
    let Some(path) = preferences_path() else {
        return ReaderPreferences::default();
    };

    let Ok(content) = fs::read_to_string(path) else {
        return ReaderPreferences::default();
    };

    serde_json::from_str(&content)
        .map(normalize_reader_preferences)
        .unwrap_or_default()
}

fn save_preferences(preferences: &ReaderPreferences) -> Result<(), MdvError> {
    let path = preferences_path().ok_or_else(|| {
        MdvError::new(
            "PreferencesError",
            "Could not resolve the preferences directory.",
        )
    })?;
    let parent = path.parent().ok_or_else(|| {
        MdvError::new(
            "PreferencesError",
            "Could not resolve the preferences directory.",
        )
    })?;

    fs::create_dir_all(parent).map_err(|error| {
        MdvError::new(
            "PreferencesError",
            "Could not create preferences directory.",
        )
        .with_path(parent.display().to_string())
        .with_details(error.to_string())
    })?;

    let content = serde_json::to_string_pretty(preferences).map_err(|error| {
        MdvError::new("PreferencesError", "Could not serialize preferences.")
            .with_details(error.to_string())
    })?;

    fs::write(&path, content).map_err(|error| {
        MdvError::new("PreferencesError", "Could not save preferences.")
            .with_path(path.display().to_string())
            .with_details(error.to_string())
    })
}

fn preferences_path() -> Option<PathBuf> {
    platform_preferences_path()
}

#[cfg(target_os = "windows")]
fn platform_preferences_path() -> Option<PathBuf> {
    if let Some(app_data) = std::env::var_os("APPDATA") {
        return Some(PathBuf::from(app_data).join("mdv").join("preferences.json"));
    }

    std::env::var_os("USERPROFILE").map(|home| {
        PathBuf::from(home)
            .join("AppData")
            .join("Roaming")
            .join("mdv")
            .join("preferences.json")
    })
}

#[cfg(target_os = "macos")]
fn platform_preferences_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("mdv")
            .join("preferences.json")
    })
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn platform_preferences_path() -> Option<PathBuf> {
    if let Some(config_home) = std::env::var_os("XDG_CONFIG_HOME") {
        return Some(
            PathBuf::from(config_home)
                .join("mdv")
                .join("preferences.json"),
        );
    }

    std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join(".config")
            .join("mdv")
            .join("preferences.json")
    })
}

fn normalize_theme(value: &str) -> String {
    match value {
        "light" | "dark" | "system" => value.to_string(),
        _ => "system".to_string(),
    }
}

fn normalize_font_preset(value: &str) -> String {
    match value {
        "sans" | "serif" | "mono" => value.to_string(),
        _ => "sans".to_string(),
    }
}

fn normalize_reader_preferences(mut preferences: ReaderPreferences) -> ReaderPreferences {
    preferences.theme = normalize_theme(&preferences.theme);
    preferences.font_preset = normalize_font_preset(&preferences.font_preset);
    preferences.font_size = preferences.font_size.clamp(14, 22);
    preferences.line_height = if preferences.line_height.is_finite() {
        preferences.line_height.clamp(1.45, 1.95)
    } else {
        default_line_height()
    };
    preferences.content_width = preferences.content_width.clamp(680, 960);
    preferences.bookmarks.retain(|path, bookmarks| {
        for bookmark in bookmarks.iter_mut() {
            bookmark.label = if bookmark.label.trim().is_empty() {
                "Bookmark".to_string()
            } else {
                bookmark.label.trim().to_string()
            };

            if bookmark.target.is_none() {
                let scroll_y = bookmark.scroll_y.unwrap_or(0);
                bookmark.target = match bookmark.heading_id.as_deref().filter(|id| !id.is_empty()) {
                    Some(heading_id) => Some(ReaderBookmarkTarget::Heading {
                        heading_id: heading_id.to_string(),
                        scroll_y_fallback: scroll_y,
                    }),
                    None => Some(ReaderBookmarkTarget::Offset { scroll_y }),
                };
            }

            bookmark.scroll_y = None;
            bookmark.heading_id = None;
        }

        bookmarks.retain(|bookmark| {
            !bookmark.id.is_empty()
                && !bookmark.label.is_empty()
                && bookmark.target.as_ref().is_some_and(|target| match target {
                    ReaderBookmarkTarget::Heading { heading_id, .. } => !heading_id.is_empty(),
                    ReaderBookmarkTarget::Offset { .. } => true,
                })
        });
        bookmarks.truncate(40);
        !path.is_empty() && !bookmarks.is_empty()
    });
    preferences.ai = normalize_ai_settings(preferences.ai);
    preferences
}

fn normalize_ai_settings(mut settings: AiSettings) -> AiSettings {
    settings.providers = settings
        .providers
        .into_iter()
        .enumerate()
        .filter_map(|(index, provider)| normalize_ai_provider(provider, index))
        .take(8)
        .collect();

    if !settings
        .providers
        .iter()
        .any(|provider| provider.id == settings.active_provider_id)
    {
        settings.active_provider_id = settings
            .providers
            .first()
            .map(|provider| provider.id.clone())
            .unwrap_or_default();
    }

    settings
}

fn normalize_ai_provider(mut provider: AiProvider, index: usize) -> Option<AiProvider> {
    if is_generated_default_ai_provider(&provider) {
        return None;
    }

    provider.kind = normalize_ai_provider_kind(&provider.kind);
    provider.id = if provider.id.trim().is_empty() {
        format!("{}-{index}", provider.kind)
    } else {
        provider.id.trim().to_string()
    };
    provider.name = if provider.name.trim().is_empty() {
        provider.id.clone()
    } else {
        provider.name.trim().to_string()
    };
    provider.base_url = if provider.base_url.trim().is_empty() {
        String::new()
    } else {
        provider.base_url.trim().trim_end_matches('/').to_string()
    };
    provider.model = if provider.model.trim().is_empty() {
        String::new()
    } else {
        provider.model.trim().to_string()
    };
    provider.reasoning = provider.reasoning.trim().to_string();
    provider.has_api_key = false;

    if provider.id.is_empty() || provider.name.is_empty() {
        return None;
    }

    Some(provider)
}

fn is_generated_default_ai_provider(provider: &AiProvider) -> bool {
    (provider.id == "openai-default"
        && provider.base_url == "https://api.openai.com/v1"
        && provider.model == "gpt-5.4-mini")
        || (provider.id == "claude-default"
            && provider.base_url == "https://api.anthropic.com/v1"
            && provider.model == "claude-sonnet-4-6")
}

fn normalize_ai_provider_kind(value: &str) -> String {
    match value {
        "claude" => "claude".to_string(),
        _ => default_ai_provider_kind(),
    }
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_font_preset() -> String {
    "sans".to_string()
}

fn default_font_size() -> u16 {
    16
}

fn default_line_height() -> f32 {
    1.7
}

fn default_content_width() -> u16 {
    780
}

fn default_outline_visible() -> bool {
    true
}

fn default_ai_provider_id() -> String {
    String::new()
}

fn default_ai_provider_kind() -> String {
    "openaiCompatible".to_string()
}

fn default_ai_providers() -> Vec<AiProvider> {
    Vec::new()
}

fn resolve_document_path(input_path: &str, cwd: &Path) -> Result<PathBuf, MdvError> {
    let raw_path = PathBuf::from(input_path);
    let candidate = if raw_path.is_absolute() {
        raw_path
    } else {
        cwd.join(raw_path)
    };

    let metadata = fs::metadata(&candidate).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            MdvError::new("FileNotFound", format!("Could not find file: {input_path}"))
                .with_path(input_path)
                .with_cwd(cwd)
        } else {
            read_error(&candidate, error)
        }
    })?;

    if metadata.is_dir() {
        return resolve_markdown_in_directory(&candidate, input_path, cwd);
    }

    if !is_markdown_path(&candidate) {
        return Err(MdvError::new(
            "InvalidMarkdownFile",
            "Only .md and .markdown files are supported.",
        )
        .with_path(candidate.display().to_string()));
    }

    candidate
        .canonicalize()
        .map_err(|error| read_error(&candidate, error))
}

fn resolve_markdown_in_directory(
    directory: &Path,
    input_path: &str,
    cwd: &Path,
) -> Result<PathBuf, MdvError> {
    for preferred in ["README.md", "readme.md", "index.md"] {
        let candidate = directory.join(preferred);
        if candidate.is_file() {
            return candidate
                .canonicalize()
                .map_err(|error| read_error(&candidate, error));
        }
    }

    let mut markdown_files = fs::read_dir(directory)
        .map_err(|error| read_error(directory, error))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_markdown_path(path))
        .collect::<Vec<_>>();

    markdown_files.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    markdown_files
        .into_iter()
        .next()
        .map(|path| {
            path.canonicalize()
                .map_err(|error| read_error(&path, error))
        })
        .transpose()?
        .ok_or_else(|| {
            MdvError::new(
                "NoMarkdownFiles",
                "No Markdown files found in this directory.",
            )
            .with_path(input_path)
            .with_cwd(cwd)
        })
}

fn open_document_from_input(
    app: &AppHandle,
    state: &SharedState,
    input_path: &str,
) -> Result<DocumentPayload, MdvError> {
    let (cwd, watch) = {
        let inner = state.inner.lock().expect("runtime state poisoned");
        (inner.config.cwd.clone(), inner.config.watch)
    };
    let resolved = resolve_document_path(input_path, &cwd)?;
    let watcher = if watch {
        watcher::start(app.clone(), resolved.clone()).ok()
    } else {
        None
    };
    let document = read_document_at(&resolved, watcher.is_some())?;

    let mut inner = state.inner.lock().expect("runtime state poisoned");
    inner.config.input_path = input_path.to_string();
    inner.document_path = Some(resolved);
    inner.initial_error = None;
    inner.watcher = watcher;

    Ok(document)
}

fn read_document_at(path: &Path, watching: bool) -> Result<DocumentPayload, MdvError> {
    let content = fs::read_to_string(path).map_err(|error| read_error(path, error))?;
    let metadata = metadata_for_path(path)?;

    Ok(DocumentPayload {
        path: metadata.path,
        file_name: metadata.file_name,
        directory: metadata.directory,
        content,
        watching,
    })
}

fn metadata_for_path(path: &Path) -> Result<FileMetadata, MdvError> {
    let canonical = path
        .canonicalize()
        .map_err(|error| read_error(path, error))?;
    let metadata = fs::metadata(&canonical).map_err(|error| read_error(&canonical, error))?;
    let modified_millis = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis());
    let file_name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document.md")
        .to_string();
    let directory = canonical
        .parent()
        .map(|value| value.display().to_string())
        .unwrap_or_default();

    Ok(FileMetadata {
        path: canonical.display().to_string(),
        file_name,
        directory,
        size_bytes: metadata.len(),
        modified_millis,
    })
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn is_browser_safe_src(src: &str) -> bool {
    src.starts_with('#')
        || src.starts_with("data:")
        || src.starts_with("blob:")
        || src.starts_with("http://")
        || src.starts_with("https://")
}

fn local_asset_path(src: &str) -> Result<PathBuf, MdvError> {
    let without_suffix = src.split(['?', '#']).next().unwrap_or(src).trim();

    if without_suffix.starts_with("file://") {
        let url = Url::parse(without_suffix).map_err(|error| {
            MdvError::new("InvalidAssetUrl", "Invalid file URL.").with_details(error.to_string())
        })?;
        return url.to_file_path().map_err(|_| {
            MdvError::new("InvalidAssetUrl", "Could not convert file URL to a path.")
        });
    }

    Ok(PathBuf::from(without_suffix))
}

fn read_error(path: &Path, error: io::Error) -> MdvError {
    match error.kind() {
        io::ErrorKind::NotFound => MdvError::new("FileNotFound", "Could not find file.")
            .with_path(path.display().to_string())
            .with_details(error.to_string()),
        io::ErrorKind::PermissionDenied => MdvError::new(
            "PermissionDenied",
            "Permission denied while reading this file.",
        )
        .with_path(path.display().to_string())
        .with_details(error.to_string()),
        _ => MdvError::new("FileReadError", "Could not read this file.")
            .with_path(path.display().to_string())
            .with_details(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_openai_stream_delta() {
        let data = r#"{"choices":[{"delta":{"content":"hello"}}]}"#;

        assert_eq!(parse_openai_stream_delta(data), Some("hello".to_string()));
    }

    #[test]
    fn parses_claude_stream_delta() {
        let data = r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}"#;

        assert_eq!(parse_claude_stream_delta(data), Some("hello".to_string()));
    }

    #[test]
    fn extracts_sse_data_lines() {
        let event = "event: message\ndata: {\"a\":1}\ndata: [DONE]\n";

        assert_eq!(
            sse_data_lines(event),
            vec!["{\"a\":1}".to_string(), "[DONE]".to_string()]
        );
    }

    #[test]
    fn migrates_old_bookmark_shape() {
        let mut preferences = ReaderPreferences::default();
        preferences.bookmarks.insert(
            "/tmp/readme.md".to_string(),
            vec![ReaderBookmark {
                id: "1".to_string(),
                label: "Intro".to_string(),
                scroll_y: Some(42),
                heading_id: Some("intro".to_string()),
                created_at: 1,
                target: None,
            }],
        );

        let normalized = normalize_reader_preferences(preferences);
        let bookmark = normalized
            .bookmarks
            .get("/tmp/readme.md")
            .and_then(|items| items.first())
            .expect("bookmark should migrate");

        assert!(matches!(
            bookmark.target,
            Some(ReaderBookmarkTarget::Heading {
                ref heading_id,
                scroll_y_fallback: 42,
            }) if heading_id == "intro"
        ));
        assert_eq!(bookmark.scroll_y, None);
        assert_eq!(bookmark.heading_id, None);
    }

    #[test]
    fn builds_provider_endpoint_urls() {
        let openai = AiProvider {
            id: "openai-test".to_string(),
            name: "OpenAI-compatible".to_string(),
            kind: "openaiCompatible".to_string(),
            base_url: "https://example.com/v1/".to_string(),
            model: "model".to_string(),
            reasoning: String::new(),
            has_api_key: false,
        };
        let claude = AiProvider {
            id: "claude-test".to_string(),
            name: "Claude-compatible".to_string(),
            kind: "claude".to_string(),
            base_url: "https://api.anthropic.com/v1".to_string(),
            model: "model".to_string(),
            reasoning: String::new(),
            has_api_key: false,
        };

        assert_eq!(
            ai_endpoint_url(&openai),
            "https://example.com/v1/chat/completions"
        );
        assert_eq!(
            ai_endpoint_url(&claude),
            "https://api.anthropic.com/v1/messages"
        );
    }
}
