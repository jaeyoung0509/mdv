mod commands;
mod watcher;

use commands::{
    get_file_metadata, get_initial_state, initialize_state, open_document, open_external_url,
    pick_markdown_file, read_markdown, reload_document, resolve_image_src, resolve_input_path,
    save_reader_preferences, save_theme_preference, watch_file, SharedState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SharedState::default())
        .invoke_handler(tauri::generate_handler![
            get_initial_state,
            reload_document,
            resolve_image_src,
            open_external_url,
            read_markdown,
            resolve_input_path,
            open_document,
            pick_markdown_file,
            get_file_metadata,
            watch_file,
            save_reader_preferences,
            save_theme_preference
        ])
        .setup(|app| {
            initialize_state(&app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running mdv");
}
