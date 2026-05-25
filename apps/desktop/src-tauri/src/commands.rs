use crate::watcher;
use base64::{engine::general_purpose::STANDARD, Engine};
use notify::RecommendedWatcher;
use serde::Serialize;
use std::{
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
    theme: String,
    watch: bool,
    allow_html: bool,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            input_path: ".".to_string(),
            cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            theme: "system".to_string(),
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
    theme: String,
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
        theme: config.theme,
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
    inner.document_path = Some(resolved);
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

fn parse_cli_args() -> RuntimeConfig {
    let mut config = RuntimeConfig::default();
    let mut args = std::env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--" => {}
            "--no-watch" => config.watch = false,
            "--allow-html" => config.allow_html = true,
            "--theme" => {
                if let Some(value) = args.next() {
                    config.theme = normalize_theme(&value);
                }
            }
            _ if arg.starts_with("--theme=") => {
                let value = arg.trim_start_matches("--theme=");
                config.theme = normalize_theme(value);
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

fn normalize_theme(value: &str) -> String {
    match value {
        "light" | "dark" | "system" => value.to_string(),
        _ => "system".to_string(),
    }
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
