use futures_util::StreamExt;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;

use super::{
    normalize_ai_provider, normalize_reader_preferences, save_preferences, AiChatRequest,
    AiProvider, AiSettings, MdvError, SharedState,
};

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
    let mut provider = normalize_ai_provider(provider, 0)
        .ok_or_else(|| MdvError::new("InvalidAiProvider", "AI provider settings are invalid."))?;

    let mut preferences = {
        let inner = state.inner.lock().expect("runtime state poisoned");
        inner.config.preferences.clone()
    };

    let mut updated = false;
    for existing in preferences.ai.providers.iter_mut() {
        if existing.id == provider.id {
            if provider.api_key.is_empty() {
                provider.api_key = existing.api_key.clone();
                provider.has_api_key = !provider.api_key.trim().is_empty();
            }
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

    preferences = normalize_reader_preferences(preferences);
    save_preferences(&preferences)?;

    let settings = preferences.ai.clone();
    let mut inner = state.inner.lock().expect("runtime state poisoned");
    inner.config.preferences = preferences;

    Ok(with_ai_key_presence(settings))
}

#[tauri::command]
pub async fn test_ai_provider(
    provider_id: String,
    state: State<'_, SharedState>,
) -> Result<(), MdvError> {
    let provider = get_ai_provider(&state, &provider_id)?;
    let api_key = load_ai_api_key_from_provider(&provider)?;
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
    let api_key = load_ai_api_key_from_provider(&provider)?;
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
        provider.has_api_key = !provider.api_key.trim().is_empty();
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

fn load_ai_api_key_from_provider(provider: &AiProvider) -> Result<String, MdvError> {
    let api_key = provider.api_key.trim().to_string();
    if api_key.trim().is_empty() {
        return Err(MdvError::new(
            "AiApiKeyMissing",
            "Add an API key for this AI provider first.",
        ));
    }

    Ok(api_key)
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
    fn builds_provider_endpoint_urls() {
        let openai = AiProvider {
            id: "openai-test".to_string(),
            name: "OpenAI-compatible".to_string(),
            kind: "openaiCompatible".to_string(),
            base_url: "https://example.com/v1/".to_string(),
            model: "model".to_string(),
            reasoning: String::new(),
            api_key: String::new(),
            has_api_key: false,
        };
        let claude = AiProvider {
            id: "claude-test".to_string(),
            name: "Claude-compatible".to_string(),
            kind: "claude".to_string(),
            base_url: "https://api.anthropic.com/v1".to_string(),
            model: "model".to_string(),
            reasoning: String::new(),
            api_key: String::new(),
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
