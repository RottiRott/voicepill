use serde_json::{json, Value};
use base64::Engine;

/// Speech-to-Text über den gewählten Provider.
/// Neue Provider: hier einen Match-Arm ergänzen + Eintrag in ui/settings.js.
pub async fn transcribe(
    provider: &str,
    model: &str,
    language: &str,
    token: &str,
    custom_endpoint: &str,
    wav: Vec<u8>,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    match provider {
        // OpenAI-kompatible Transkriptions-Endpunkte (multipart)
        "openai" | "groq" | "mistral" => {
            let url = if !custom_endpoint.is_empty() {
                custom_endpoint
            } else {
                match provider {
                    "openai" => "https://api.openai.com/v1/audio/transcriptions",
                    "groq" => "https://api.groq.com/openai/v1/audio/transcriptions",
                    _ => "https://api.mistral.ai/v1/audio/transcriptions",
                }
            };
            let part = reqwest::multipart::Part::bytes(wav)
                .file_name("audio.wav")
                .mime_str("audio/wav")
                .map_err(|e| e.to_string())?;
            let mut form = reqwest::multipart::Form::new()
                .part("file", part)
                .text("model", model.to_string());
            if language != "auto" {
                form = form.text("language", language.to_string());
            }
            let resp = client
                .post(url)
                .bearer_auth(token)
                .multipart(form)
                .send()
                .await
                .map_err(|e| format!("Netzwerkfehler ({provider}): {e}"))?;
            let status = resp.status();
            let body: Value = resp
                .json()
                .await
                .map_err(|e| format!("Antwort unlesbar ({provider}): {e}"))?;
            if !status.is_success() {
                return Err(api_error(provider, &body));
            }
            body["text"]
                .as_str()
                .map(|s| s.trim().to_string())
                .ok_or_else(|| format!("Unerwartete Antwort von {provider}: {body}"))
        }

        "deepgram" => {
            let mut url = format!(
                "https://api.deepgram.com/v1/listen?model={model}&smart_format=true"
            );
            if language == "auto" {
                url.push_str("&detect_language=true");
            } else {
                url.push_str(&format!("&language={language}"));
            }
            let resp = client
                .post(&url)
                .header("Authorization", format!("Token {token}"))
                .header("Content-Type", "audio/wav")
                .body(wav)
                .send()
                .await
                .map_err(|e| format!("Netzwerkfehler (deepgram): {e}"))?;
            let status = resp.status();
            let body: Value = resp
                .json()
                .await
                .map_err(|e| format!("Antwort unlesbar (deepgram): {e}"))?;
            if !status.is_success() {
                return Err(api_error("deepgram", &body));
            }
            body["results"]["channels"][0]["alternatives"][0]["transcript"]
                .as_str()
                .map(|s| s.trim().to_string())
                .ok_or_else(|| format!("Unerwartete Antwort von deepgram: {body}"))
        }

        "gemini" => {
            let b64_audio = base64::engine::general_purpose::STANDARD.encode(&wav);
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model, token
            );
            
            let prompt = if language == "auto" {
                "Transcribe this audio exactly as it is spoken. Do not translate. Output ONLY the transcription and nothing else."
            } else {
                // We format a custom prompt for the specific language if provided
                "Transcribe this audio exactly as it is spoken. Do not translate. Output ONLY the transcription and nothing else."
            };

            let body = json!({
                "contents": [{
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {
                            "mime_type": "audio/wav",
                            "data": b64_audio
                        }}
                    ]
                }]
            });
            let resp = client
                .post(&url)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Netzwerkfehler (gemini): {e}"))?;
            let status = resp.status();
            let v: Value = resp
                .json()
                .await
                .map_err(|e| format!("Antwort unlesbar (gemini): {e}"))?;
            if !status.is_success() {
                return Err(api_error("gemini", &v));
            }
            v["candidates"][0]["content"]["parts"][0]["text"]
                .as_str()
                .map(|s| s.trim().to_string())
                .ok_or_else(|| format!("Unerwartete Antwort von gemini: {v}"))
        }

        _ => Err(format!("Unbekannter STT-Provider: {provider}")),
    }
}

/// Verfeinerung der Transkription über ein LLM.
pub async fn refine(
    provider: &str,
    model: &str,
    system_prompt: &str,
    text: &str,
    token: &str,
    custom_endpoint: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    match provider {
        "anthropic" => {
            let body = json!({
                "model": model,
                "max_tokens": 4000,
                "system": system_prompt,
                "messages": [{"role": "user", "content": text}]
            });
            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", token)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Netzwerkfehler (anthropic): {e}"))?;
            let status = resp.status();
            let v: Value = resp
                .json()
                .await
                .map_err(|e| format!("Antwort unlesbar (anthropic): {e}"))?;
            if !status.is_success() {
                return Err(api_error("anthropic", &v));
            }
            v["content"][0]["text"]
                .as_str()
                .map(|s| s.trim().to_string())
                .ok_or_else(|| format!("Unerwartete Antwort von anthropic: {v}"))
        }

        // OpenAI-kompatible Chat-Endpunkte
        "openai" | "groq" | "gemini" | "minimax" => {
            let url = if !custom_endpoint.is_empty() {
                custom_endpoint
            } else {
                match provider {
                    "openai" => "https://api.openai.com/v1/chat/completions",
                    "groq" => "https://api.groq.com/openai/v1/chat/completions",
                    "minimax" => "https://api.minimax.io/v1/chat/completions",
                    _ => "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                }
            };
            let body = json!({
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text}
                ]
            });
            let resp = client
                .post(url)
                .bearer_auth(token)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Netzwerkfehler ({provider}): {e}"))?;
            let status = resp.status();
            let v: Value = resp
                .json()
                .await
                .map_err(|e| format!("Antwort unlesbar ({provider}): {e}"))?;
            if !status.is_success() {
                return Err(api_error(provider, &v));
            }
            let raw_content = v["choices"][0]["message"]["content"]
                .as_str()
                .map(|s| s.trim().to_string())
                .ok_or_else(|| format!("Unerwartete Antwort von {provider}: {v}"))?;
            
            // Falls das Modell den Denkprozess in <think>...</think> mitschickt, filtern wir diesen heraus.
            let clean_content = if raw_content.contains("<think>") && raw_content.contains("</think>") {
                let parts: Vec<&str> = raw_content.split("</think>").collect();
                parts.last().unwrap_or(&raw_content.as_str()).trim().to_string()
            } else {
                raw_content
            };
            Ok(clean_content)
        }

        _ => Err(format!("Unbekannter LLM-Provider: {provider}")),
    }
}

fn api_error(provider: &str, body: &Value) -> String {
    let msg = body["error"]["message"]
        .as_str()
        .or_else(|| body["err_msg"].as_str())
        .or_else(|| body["message"].as_str())
        .unwrap_or("Unbekannter API-Fehler");
    format!("{provider}: {msg}")
}
