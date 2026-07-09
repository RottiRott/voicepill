const { invoke } = window.__TAURI__.core;

const $ = (id) => document.getElementById(id);

const STT_MODEL_DEFAULTS = {
  groq: "whisper-large-v3-turbo",
  openai: "gpt-4o-mini-transcribe",
  deepgram: "nova-2",
  mistral: "voxtral-mini-latest",
  gemini: "gemini-3.1-flash-live-preview",
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
  gemini: ["gemini-3.1-flash-live-preview", "gemini-2.5-flash", "gemini-3.5-flash", "gemini-3-flash"],
};

const LLM_MODEL_SUGGESTIONS = {
  anthropic: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest", "claude-haiku-4-5"],
  openai: ["gpt-4o-mini", "gpt-4o", "o1-mini", "o3-mini"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
  gemini: ["gemini-2.5-flash", "gemini-3.1-pro", "gemini-3.5-flash"],
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
  const provider = kind === "stt" ? $("sttProvider").value : $("refineProvider").value;
  const selectEl = kind === "stt" ? $("sttModelSelect") : $("refineModelSelect");
  const customInputEl = kind === "stt" ? $("sttModelCustom") : $("refineModelCustom");
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

async function load() {
  const s = await invoke("load_settings");
  $("sttProvider").value = s.stt_provider;
  populateModelDropdown("stt", s.stt_model);
  $("language").value = s.language;
  $("hotkey").value = s.hotkey;
  $("hotkeyHint").textContent = s.hotkey;
  $("autoPaste").checked = !!s.auto_paste;
  $("refineEnabled").checked = !!s.refine_enabled;
  $("refineProvider").value = s.refine_provider;
  populateModelDropdown("refine", s.refine_model);
  $("refinePreset").value = s.refine_preset;
  $("customPrompt").value = s.custom_prompt || "";
  syncRefineVisibility();
  await refreshTokenState("stt");
  await refreshTokenState("refine");
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

$("sttModelSelect").addEventListener("change", () => {
  $("sttModelCustom").hidden = $("sttModelSelect").value !== "custom";
  if ($("sttModelSelect").value !== "custom") $("sttModelCustom").value = "";
});
$("refineModelSelect").addEventListener("change", () => {
  $("refineModelCustom").hidden = $("refineModelSelect").value !== "custom";
  if ($("refineModelSelect").value !== "custom") $("refineModelCustom").value = "";
});

$("refineEnabled").addEventListener("change", syncRefineVisibility);
$("refinePreset").addEventListener("change", syncRefineVisibility);

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
      const selectVal = $(kind === "stt" ? "sttModelSelect" : "refineModelSelect").value;
      if (selectVal === "custom") {
        return $(kind === "stt" ? "sttModelCustom" : "refineModelCustom").value.trim();
      }
      return selectVal;
    };

    const settings = {
      stt_provider: $("sttProvider").value,
      stt_model: getModelValue("stt"),
      language: $("language").value,
      hotkey: $("hotkey").value.trim(),
      auto_paste: $("autoPaste").checked,
      refine_enabled: $("refineEnabled").checked,
      refine_provider: $("refineProvider").value,
      refine_model: getModelValue("refine"),
      refine_preset: $("refinePreset").value,
      custom_prompt: $("customPrompt").value,
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
