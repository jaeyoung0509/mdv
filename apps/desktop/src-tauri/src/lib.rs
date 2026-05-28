mod commands;
mod watcher;

use commands::{
    cancel_ai_chat, delete_ai_provider, get_ai_settings, get_file_metadata, get_initial_state,
    import_document_asset, initialize_state, list_directory_documents, open_document,
    open_external_url, pick_markdown_file, read_markdown, reload_document, resolve_image_src,
    resolve_input_path, save_ai_provider, save_document, save_reader_preferences,
    save_theme_preference, start_ai_chat, test_ai_provider, watch_file, SharedState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SharedState::default())
        .invoke_handler(tauri::generate_handler![
            get_initial_state,
            reload_document,
            save_document,
            import_document_asset,
            resolve_image_src,
            open_external_url,
            read_markdown,
            resolve_input_path,
            open_document,
            pick_markdown_file,
            list_directory_documents,
            get_file_metadata,
            watch_file,
            save_reader_preferences,
            save_theme_preference,
            get_ai_settings,
            save_ai_provider,
            delete_ai_provider,
            test_ai_provider,
            start_ai_chat,
            cancel_ai_chat
        ])
        .setup(|app| {
            initialize_state(&app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running mdv");
}
