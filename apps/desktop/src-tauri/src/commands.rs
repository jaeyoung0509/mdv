use crate::watcher;
use base64::{engine::general_purpose::STANDARD, Engine};
use notify::RecommendedWatcher;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager, State};
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

#[derive(Default)]
pub struct SharedState {
    inner: Mutex<RuntimeState>,
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
    #[serde(default)]
    scroll_y: u32,
    #[serde(default)]
    heading_id: Option<String>,
    #[serde(default)]
    created_at: u64,
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
        bookmarks.retain(|bookmark| !bookmark.id.is_empty() && !bookmark.label.is_empty());
        bookmarks.truncate(40);
        !path.is_empty() && !bookmarks.is_empty()
    });
    preferences
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
