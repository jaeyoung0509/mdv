use tauri::State;

use super::{
    normalize_reader_preferences, normalize_theme, save_preferences, MdvError, ReaderPreferences,
    SharedState,
};

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
