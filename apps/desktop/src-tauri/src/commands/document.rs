use crate::watcher;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, State};

use super::{
    directory_document_for_path, metadata_for_path, open_document_from_input, read_document_at,
    read_error, resolve_document_path, DirectoryDocument, DocumentPayload, FileMetadata,
    InitialState, MdvError, SharedState,
};

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
pub fn save_document(
    state: State<'_, SharedState>,
    content: String,
    expected_modified_millis: Option<u128>,
    force: bool,
) -> Result<DocumentPayload, MdvError> {
    let (path, watching) = {
        let inner = state.inner.lock().expect("runtime state poisoned");
        (
            inner.document_path.clone().ok_or_else(|| {
                MdvError::new("NoDocument", "No Markdown file is currently open.")
            })?,
            inner.watcher.is_some(),
        )
    };

    if !force {
        let current_metadata = metadata_for_path(&path)?;

        if current_metadata.modified_millis != expected_modified_millis {
            return Err(MdvError::new(
                "DocumentConflict",
                "This file changed on disk after you started editing.",
            )
            .with_path(current_metadata.path));
        }
    }

    fs::write(&path, content).map_err(|error| {
        MdvError::new("FileWriteError", "Could not save this Markdown file.")
            .with_path(path.display().to_string())
            .with_details(error.to_string())
    })?;

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
pub fn list_directory_documents(directory: String) -> Result<Vec<DirectoryDocument>, MdvError> {
    let directory_path = PathBuf::from(&directory);
    let canonical_directory = directory_path
        .canonicalize()
        .map_err(|error| read_error(&directory_path, error))?;
    let metadata = fs::metadata(&canonical_directory)
        .map_err(|error| read_error(&canonical_directory, error))?;

    if !metadata.is_dir() {
        return Err(MdvError::new(
            "InvalidDirectory",
            "Document switcher can only browse directories.",
        )
        .with_path(canonical_directory.display().to_string()));
    }

    let mut documents = fs::read_dir(&canonical_directory)
        .map_err(|error| read_error(&canonical_directory, error))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && super::is_markdown_path(path))
        .filter_map(|path| directory_document_for_path(&path).ok())
        .collect::<Vec<_>>();

    documents.sort_by(|a, b| {
        a.file_name
            .to_lowercase()
            .cmp(&b.file_name.to_lowercase())
            .then_with(|| a.file_name.cmp(&b.file_name))
    });

    Ok(documents)
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
