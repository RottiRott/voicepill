const { invoke } = window.__TAURI__.core;

const $ = (id) => document.getElementById(id);

const STT_MODEL_DEFAULTS = {
  groq: "whisper-large-v3-turbo",
  openai: "gpt-4o-mini-transcribe",
  deepgram: "nova-2",
  mistral: "voxtral-mini-latest",
  gemini: "gemini-2.0-flash-exp",
};

const LLM_MODEL_DEFAULTS = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  gemini: "gemini-2.5-flash",
  minimax: "MiniMax-M3",
};

const STT_MODEL_SUGGESTIONS = {
  groq: ["whisper-large-v3-turbo", "whisper-large-v3"],
  openai: ["whisper-1"],
  deepgram: ["nova-2", "nova-2-ea", "enhanced"],
  mistral: ["voxtral-mini-latest"],
  gemini: ["gemini-2.0-flash-exp", "gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-3.1-flash-live-preview", "gemini-3.5-flash", "gemini-3-flash"],
};

const LLM_MODEL_SUGGESTIONS = {
  anthropic: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest", "claude-haiku-4-5"],
  openai: ["gpt-4o-mini", "gpt-4o", "o1-mini", "o3-mini"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
  gemini: ["gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-3.1-pro", "gemini-3.5-flash"],
  minimax: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1"],
};

// Preset-Dropdown aus presets.js befüllen
for (const [key, p] of Object.entries(PRESETS)) {
  const opt = document.createElement("option");
  opt.value = key;
  opt.textContent = p.label;
  $("refinePreset").appendChild(opt);
}

async function refreshTokenState(kind) {
  const key = kind === "stt" ? $("sttProvider").value : `llm:${$("refineProvider").value}`;
  const exists = await invoke("has_token", { key });
  $(kind === "stt" ? "sttTokenState" : "refineTokenState").textContent = exists ? "gespeichert ✓" : "";
}

function syncRefineVisibility() {
  $("refineBody").classList.toggle("disabled", !$("refineEnabled").checked);
  $("customPromptRow").hidden = $("refinePreset").value !== "custom";
}

function populateModelDropdown(kind, savedModelValue) {
  const provider = kind === "stt" ? $("sttProvider").value : (kind === "meeting" ? $("meetingProvider").value : $("refineProvider").value);
  const selectEl = kind === "stt" ? $("sttModelSelect") : (kind === "meeting" ? $("meetingModelSelect") : $("refineModelSelect"));
  const customInputEl = kind === "stt" ? $("sttModelCustom") : (kind === "meeting" ? $("meetingModelCustom") : $("refineModelCustom"));
  const suggestions = kind === "stt" ? STT_MODEL_SUGGESTIONS : LLM_MODEL_SUGGESTIONS;

  selectEl.innerHTML = "";
  const models = suggestions[provider] || [];
  
  let hasMatchingSuggestion = false;
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    selectEl.appendChild(opt);
    if (m === savedModelValue) {
      hasMatchingSuggestion = true;
    }
  }

  // Eigene Modell-Option
  const optCustom = document.createElement("option");
  optCustom.value = "custom";
  optCustom.textContent = "Eigener Modellname…";
  selectEl.appendChild(optCustom);

  // Wert setzen
  if (savedModelValue) {
    if (hasMatchingSuggestion) {
      selectEl.value = savedModelValue;
      customInputEl.hidden = true;
      customInputEl.value = "";
    } else {
      selectEl.value = "custom";
      customInputEl.hidden = false;
      customInputEl.value = savedModelValue;
    }
  } else {
    const defaultVal = kind === "stt" ? STT_MODEL_DEFAULTS[provider] : LLM_MODEL_DEFAULTS[provider];
    selectEl.value = defaultVal || models[0] || "custom";
    if (selectEl.value === "custom") {
      customInputEl.hidden = false;
    } else {
      customInputEl.hidden = true;
      customInputEl.value = "";
    }
  }
}

async function renderHistory() {
  const container = $("historyList");
  try {
    const list = await invoke("load_history");
    if (!list || list.length === 0) {
      container.innerHTML = `<div style="font-size: 12px; color: var(--ink-soft); text-align: center; padding: 12px;">Noch keine Diktate vorhanden.</div>`;
      return;
    }
    container.innerHTML = "";
    for (const item of list) {
      const card = document.createElement("div");
      card.style.cssText = "background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 10px; font-size: 12.5px;";
      
      const meta = document.createElement("div");
      meta.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 11px; color: var(--ink-soft);";
      const presetBadge = item.preset === "meeting_protocol" ? `<span style="background: #e6f4ea; color: #137333; padding: 1px 6px; border-radius: 4px; font-weight: 600; margin-left: 4px;">Meeting-Protokoll</span>` : "";
      meta.innerHTML = `<span><b>${item.timestamp}</b> • App: <span style="color: var(--leaf); font-weight: 600;">${item.app_name || "Unbekannt"}</span>${presetBadge}</span><button class="copy-btn" style="padding: 2px 8px; font-size: 11px; border: 1px solid var(--line); border-radius: 4px; background: #fff; cursor: pointer;">Kopieren</button>`;
      
      const textEl = document.createElement("div");
      textEl.style.cssText = "white-space: pre-wrap; word-break: break-word;";
      textEl.textContent = item.refined_text || item.raw_text;
      
      card.appendChild(meta);
      card.appendChild(textEl);
      
      card.querySelector(".copy-btn").addEventListener("click", async () => {
        await invoke("paste_text", { text: item.refined_text || item.raw_text, autoPaste: false });
        showStatus("In Zwischenablage kopiert ✓");
      });
      
      container.appendChild(card);
    }
  } catch (e) {
    container.innerHTML = `<div style="font-size: 12px; color: #b3261e; padding: 12px;">Fehler beim Laden des Verlaufs.</div>`;
  }
}

async function load() {
  const s = await invoke("load_settings");
  $("sttProvider").value = s.stt_provider;
  populateModelDropdown("stt", s.stt_model);
  $("sttCustomEndpoint").value = s.stt_custom_endpoint || "";
  $("language").value = s.language;
  $("hotkey").value = s.hotkey;
  $("hotkeyMode").value = s.hotkey_mode || "toggle";
  $("hotkeyHint").textContent = s.hotkey;
  $("autoPaste").checked = !!s.auto_paste;
  $("soundEffects").checked = s.sound_effects !== false;
  $("appAwareness").checked = s.app_awareness !== false;
  $("customVocabulary").value = s.custom_vocabulary || "";
  $("refineEnabled").checked = !!s.refine_enabled;
  $("refineProvider").value = s.refine_provider;
  populateModelDropdown("refine", s.refine_model);
  $("refineCustomEndpoint").value = s.refine_custom_endpoint || "";
  $("refinePreset").value = s.refine_preset;
  $("customPrompt").value = s.custom_prompt || "";

  // Meeting Mode Settings
  $("meetingModeEnabled").checked = s.meeting_mode_enabled !== false;
  $("meetingThresholdMin").value = s.meeting_threshold_min || 5;
  $("meetingAskConfirmation").checked = s.meeting_ask_confirmation !== false;
  $("meetingProvider").value = s.meeting_provider || "gemini";
  populateModelDropdown("meeting", s.meeting_model || "gemini-3.1-pro");
  $("meetingOutputDir").value = s.meeting_output_dir || "";
  $("meetingWordTemplate").value = s.meeting_word_template || "";
  $("customLogoPath").value = s.custom_logo_path || "";

  syncRefineVisibility();
  await refreshTokenState("stt");
  await refreshTokenState("refine");
  await renderHistory();
}

function showStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("err", isError);
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3500);
}

// Provider-Wechsel: Dropdown neu befüllen & Token-Status aktualisieren
$("sttProvider").addEventListener("change", () => {
  populateModelDropdown("stt");
  refreshTokenState("stt");
});
$("refineProvider").addEventListener("change", () => {
  populateModelDropdown("refine");
  refreshTokenState("refine");
});
$("meetingProvider").addEventListener("change", () => {
  populateModelDropdown("meeting");
});

$("sttModelSelect").addEventListener("change", () => {
  $("sttModelCustom").hidden = $("sttModelSelect").value !== "custom";
  if ($("sttModelSelect").value !== "custom") $("sttModelCustom").value = "";
});
$("refineModelSelect").addEventListener("change", () => {
  $("refineModelCustom").hidden = $("refineModelSelect").value !== "custom";
  if ($("refineModelSelect").value !== "custom") $("refineModelCustom").value = "";
});
$("meetingModelSelect").addEventListener("change", () => {
  $("meetingModelCustom").hidden = $("meetingModelSelect").value !== "custom";
  if ($("meetingModelSelect").value !== "custom") $("meetingModelCustom").value = "";
});

$("browseOutputDirBtn").addEventListener("click", async () => {
  const folder = await invoke("select_folder");
  if (folder) $("meetingOutputDir").value = folder;
});

$("browseWordTemplateBtn").addEventListener("click", async () => {
  const file = await invoke("select_file", { extension: "docx" });
  if (file) $("meetingWordTemplate").value = file;
});

$("browseLogoBtn").addEventListener("click", async () => {
  const file = await invoke("select_file", { extension: "" });
  if (file) $("customLogoPath").value = file;
});

$("refineEnabled").addEventListener("change", syncRefineVisibility);
$("refinePreset").addEventListener("change", syncRefineVisibility);

$("clearHistoryBtn").addEventListener("click", async () => {
  await invoke("clear_history").catch(() => {});
  await renderHistory();
  showStatus("Verlauf geleert ✓");
});

$("saveBtn").addEventListener("click", async () => {
  try {
    // Tokens nur schreiben, wenn etwas eingegeben wurde
    const sttToken = $("sttToken").value.trim();
    if (sttToken) {
      await invoke("set_token", { key: $("sttProvider").value, token: sttToken });
      $("sttToken").value = "";
    }
    const refineToken = $("refineToken").value.trim();
    if (refineToken) {
      await invoke("set_token", { key: `llm:${$("refineProvider").value}`, token: refineToken });
      $("refineToken").value = "";
    }

    const getModelValue = (kind) => {
      const selectId = kind === "stt" ? "sttModelSelect" : (kind === "meeting" ? "meetingModelSelect" : "refineModelSelect");
      const customId = kind === "stt" ? "sttModelCustom" : (kind === "meeting" ? "meetingModelCustom" : "refineModelCustom");
      const selectVal = $(selectId).value;
      if (selectVal === "custom") {
        return $(customId).value.trim();
      }
      return selectVal;
    };

    const settings = {
      stt_provider: $("sttProvider").value,
      stt_model: getModelValue("stt"),
      language: $("language").value,
      hotkey: $("hotkey").value.trim(),
      hotkey_mode: $("hotkeyMode").value,
      auto_paste: $("autoPaste").checked,
      sound_effects: $("soundEffects").checked,
      app_awareness: $("appAwareness").checked,
      custom_vocabulary: $("customVocabulary").value,
      stt_custom_endpoint: $("sttCustomEndpoint").value.trim(),
      refine_custom_endpoint: $("refineCustomEndpoint").value.trim(),
      refine_enabled: $("refineEnabled").checked,
      refine_provider: $("refineProvider").value,
      refine_model: getModelValue("refine"),
      refine_preset: $("refinePreset").value,
      custom_prompt: $("customPrompt").value,
      meeting_mode_enabled: $("meetingModeEnabled").checked,
      meeting_threshold_min: parseInt($("meetingThresholdMin").value, 10) || 5,
      meeting_ask_confirmation: $("meetingAskConfirmation").checked,
      meeting_provider: $("meetingProvider").value,
      meeting_model: getModelValue("meeting"),
      meeting_output_dir: $("meetingOutputDir").value.trim(),
      meeting_word_template: $("meetingWordTemplate").value.trim(),
      custom_logo_path: $("customLogoPath").value.trim(),
    };
    await invoke("save_settings", { settings });
    await invoke("update_hotkey", { hotkey: settings.hotkey });
    $("hotkeyHint").textContent = settings.hotkey;
    await refreshTokenState("stt");
    await refreshTokenState("refine");
    showStatus("Gespeichert ✓");
  } catch (e) {
    showStatus(String(e), true);
  }
});

load();
