use crate::commands::MdvError;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileUpdatePayload {
    path: String,
}

pub fn start(app: AppHandle, path: PathBuf) -> Result<RecommendedWatcher, MdvError> {
    let watched_path = path.clone();
    let event_path = path.display().to_string();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        if let Ok(event) = result {
            if !event
                .paths
                .iter()
                .any(|candidate| candidate == &watched_path)
            {
                return;
            }

            let _ = app.emit(
                "mdv:file-updated",
                FileUpdatePayload {
                    path: event_path.clone(),
                },
            );
        }
    })
    .map_err(|error| {
        MdvError::new("WatchError", "Could not watch this file.").with_details(error.to_string())
    })?;

    watcher
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|error| {
            MdvError::new("WatchError", "Could not watch this file.")
                .with_details(error.to_string())
        })?;

    Ok(watcher)
}
