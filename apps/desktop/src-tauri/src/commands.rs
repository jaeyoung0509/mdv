use crate::watcher;
use notify::RecommendedWatcher;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc, Mutex},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};

mod ai;
mod assets;
mod document;
mod preferences;

pub use ai::{
    cancel_ai_chat, delete_ai_provider, get_ai_settings, save_ai_provider, start_ai_chat,
    test_ai_provider,
};
pub use assets::{import_document_asset, open_external_url, resolve_image_src};
pub use document::{
    get_file_metadata, get_initial_state, list_directory_documents, open_document,
    pick_markdown_file, read_markdown, reload_document, resolve_input_path, save_document,
    watch_file,
};
pub use preferences::{save_reader_preferences, save_theme_preference};

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
    modified_millis: Option<u128>,
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryDocument {
    path: String,
    file_name: String,
    directory: String,
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

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiNoteThread {
    #[serde(default)]
    id: String,
    #[serde(default)]
    anchor: AiNoteAnchor,
    #[serde(default)]
    title: String,
    #[serde(default)]
    messages: Vec<AiNoteMessage>,
    #[serde(default)]
    resolved: bool,
    #[serde(default)]
    created_at: u64,
    #[serde(default)]
    updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiNoteAnchor {
    Heading {
        heading_id: String,
        label: String,
        scroll_y_fallback: u32,
    },
    LineRange {
        from_line: u32,
        to_line: u32,
        label: String,
    },
    Offset {
        scroll_y: u32,
        label: String,
    },
}

impl Default for AiNoteAnchor {
    fn default() -> Self {
        Self::Offset {
            scroll_y: 0,
            label: "Document".to_string(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiNoteMessage {
    #[serde(default)]
    id: String,
    #[serde(default)]
    role: String,
    #[serde(default)]
    content: String,
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
    #[serde(default, skip_serializing_if = "String::is_empty")]
    api_key: String,
    #[serde(default)]
    has_api_key: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    provider_id: String,
    #[serde(default)]
    mode: Option<String>,
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
    ai_notes: HashMap<String, Vec<AiNoteThread>>,
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
            ai_notes: HashMap::new(),
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

    let mut preferences = serde_json::from_str(&content)
        .map(normalize_reader_preferences)
        .unwrap_or_default();

    if ai::migrate_ai_keys_to_keychain(&mut preferences) {
        let _ = save_preferences(&preferences);
    }

    preferences
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
    preferences.ai_notes.retain(|path, notes| {
        for note in notes.iter_mut() {
            note.title = if note.title.trim().is_empty() {
                "AI note".to_string()
            } else {
                note.title.trim().to_string()
            };
            note.messages.retain(|message| {
                let role = message.role.as_str();
                !message.id.is_empty()
                    && (role == "user" || role == "assistant")
                    && !message.content.trim().is_empty()
            });
            note.messages.truncate(24);
        }

        notes.retain(|note| !note.id.is_empty() && !note.messages.is_empty());
        notes.truncate(80);
        !path.is_empty() && !notes.is_empty()
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
    provider.api_key = provider.api_key.trim().to_string();
    provider.has_api_key = !provider.api_key.is_empty();

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
        modified_millis: metadata.modified_millis,
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

fn directory_document_for_path(path: &Path) -> Result<DirectoryDocument, MdvError> {
    let metadata = metadata_for_path(path)?;

    Ok(DirectoryDocument {
        path: metadata.path,
        file_name: metadata.file_name,
        directory: metadata.directory,
    })
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
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
}
