// Die Pille orchestriert den kompletten Ablauf:
// Hotkey → Aufnahme → Transkription → (optional) Verfeinerung → Einfügen.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const pill = document.getElementById("pill");
const label = document.getElementById("label");
const timerEl = document.getElementById("timer");

let state = "idle"; // idle | recording | processing | refining | done | error
let timerInterval = null;
let recordStart = 0;

let liveSocket = null;
let liveText = "";
let audioChunkUnlisten = null;

function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (type === "start") {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === "stop") {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    }
  } catch (e) {
    console.error("Audio feedback error", e);
  }
}

function setState(next, text) {
  state = next;
  pill.className = next === "idle" ? "" : `active ${next}`;
  if (next === "error") pill.classList.add("error", "active");
  label.textContent = text;

  // Wenn nicht aufgenommen wird, Fenster klick-durchlässig schalten, damit darunter liegende Apps nicht blockiert werden
  const ignore = next !== "recording";
  invoke("set_pill_click_through", { ignore }).catch(() => {});
}

function idle() {
  stopTimer();
  setState("idle", "Bereit");
}

function startTimer() {
  recordStart = Date.now();
  timerEl.textContent = "0:00";
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - recordStart) / 1000);
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 250);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function showError(err) {
  stopTimer();
  const msg = String(err).slice(0, 60);
  setState("error", msg);
  setTimeout(idle, 4000);
}

function buildRefinePrompt(settings, activeApp) {
  const preset = settings.refine_preset || "cleanup";
  let basePrompt = preset === "custom" ? (settings.custom_prompt || "").trim() : (PRESETS[preset] || PRESETS.cleanup).prompt;
  
  if (settings.app_awareness && activeApp && activeApp !== "Unbekannt" && activeApp !== "VoicePill") {
    basePrompt += `\n\nHinweis zum Kontext: Der Benutzer schreibt diese Nachricht aktuell in der Anwendung "${activeApp}". Passe Formatierung und Tonfall gegebenenfalls optimal an diese Anwendung an.`;
  }
  
  if (settings.custom_vocabulary && settings.custom_vocabulary.trim()) {
    basePrompt += `\n\nAchte besonders auf die korrekte Schreibweise folgender Fachbegriffe/Eigennamen: ${settings.custom_vocabulary.trim()}`;
  }
  
  return basePrompt;
}

async function startLiveTranscription() {
  try {
    const s = await invoke("load_settings");
    if (s.stt_provider !== "gemini") return;
    if (!s.stt_model.includes("live") && !s.stt_model.includes("exp")) return;

    const apiKey = await invoke("get_token", { key: "gemini" }).catch(() => null);
    if (!apiKey && !s.stt_custom_endpoint) {
      throw new Error("Kein API-Token für Gemini hinterlegt. Bitte speichern.");
    }

    const model = s.stt_model || "gemini-2.0-flash-exp";
    const wsUrl = s.stt_custom_endpoint || `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    
    liveSocket = new WebSocket(wsUrl);
    liveText = "";

    liveSocket.onopen = () => {
      liveSocket.send(JSON.stringify({
        setup: {
          model: `models/${model}`,
          generationConfig: {
            responseModalities: ["TEXT"]
          },
          systemInstruction: {
            parts: [
              {
                text: "You are a precise speech-to-text transcriber. Transcribe the user's speech exactly as spoken in its original language. Do not translate. Output ONLY the transcription. Do not reply or comment."
              }
            ]
          }
        }
      }));
    };

    liveSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.serverContent && msg.serverContent.modelTurn && msg.serverContent.modelTurn.parts) {
          const partText = msg.serverContent.modelTurn.parts.map(p => p.text).join("");
          liveText += partText;
          const display = liveText.trim();
          if (display && state === "recording") {
            label.textContent = display;
          }
        }
      } catch (err) {
        console.error("Live transcription parse error", err);
      }
    };

    liveSocket.onerror = (err) => {
      console.error("Live transcription error", err);
    };

    audioChunkUnlisten = await listen("audio-chunk", (event) => {
      if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
        liveSocket.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: "audio/pcm",
                data: event.payload
              }
            ]
          }
        }));
      }
    });

  } catch (err) {
    await invoke("cancel_recording").catch(() => {});
    showError(err);
  }
}

async function cleanUpLive() {
  if (liveSocket) {
    try {
      liveSocket.close();
    } catch(e) {}
    liveSocket = null;
  }
  if (audioChunkUnlisten) {
    try {
      audioChunkUnlisten();
    } catch(e) {}
    audioChunkUnlisten = null;
  }
}

async function startRecordingFlow() {
  const s = await invoke("load_settings");
  if (s.sound_effects) playSound("start");
  try {
    await invoke("start_recording");
    setState("recording", "Aufnahme");
    startTimer();
    await startLiveTranscription();
  } catch (e) {
    showError(e);
  }
}

async function stopRecordingFlow() {
  const s = await invoke("load_settings");
  if (s.sound_effects) playSound("stop");
  stopTimer();
  setState("processing", "Transkribiere…");
  try {
    await invoke("stop_recording");
    const activeApp = s.app_awareness ? await invoke("get_active_app").catch(() => "Unbekannt") : "Unbekannt";
    
    const finalLiveText = liveText.trim();
    await cleanUpLive();

    const durationSec = Math.floor((Date.now() - recordStart) / 1000);
    const thresholdSec = (s.meeting_threshold_min || 5) * 60;
    const isMeetingMode = s.meeting_mode_enabled && durationSec >= thresholdSec;

    let text = "";
    if (s.stt_provider === "gemini" && finalLiveText) {
      text = finalLiveText;
    } else {
      if (s.stt_provider === "gemini" && s.stt_model.includes("live")) {
        throw new Error("Echtzeit-Modell benötigt eine aktive Live-Verbindung.");
      }
      text = await invoke("transcribe", {
        provider: s.stt_provider,
        model: s.stt_model,
        language: s.language,
        customEndpoint: s.stt_custom_endpoint || "",
        promptVocab: s.custom_vocabulary || "",
      });
    }

    const rawText = text;

    if (isMeetingMode) {
      setState("refining", "Meeting-Protokoll…");
      const meetingPrompt = `Du bist ein professioneller Protokollant. Erstelle aus dem folgenden Meeting-Diktat ein sauber strukturiertes Meeting-Protokoll auf Deutsch im Markdown-Format.
Verwende exakt diese Überschriften:
# Meeting-Protokoll
**Datum:** ${new Date().toLocaleDateString('de-DE')}
**Kontext / App:** ${activeApp}

## Executive Summary
Kompakte Zusammenfassung der Kernpunkte.

## Themen & Diskussion
Wichtige Punkte in Stichpunkten.

## Beschlüsse & Ergebnisse
Festgehaltene Beschlüsse.

## To-Do Liste
- [ ] Aufgabe 1 (Verantwortlich)
- [ ] Aufgabe 2 (Verantwortlich)`;

      const mProvider = s.meeting_provider || s.refine_provider || "gemini";
      const mModel = s.meeting_model || s.refine_model || "gemini-3.1-pro";

      text = await invoke("refine", {
        provider: mProvider,
        model: mModel,
        systemPrompt: meetingPrompt,
        text,
        customEndpoint: s.refine_custom_endpoint || "",
      });

      setState("refining", "Erstelle Word & MD…");
      await invoke("export_meeting_docs", {
        markdownContent: text,
        customOutputDir: s.meeting_output_dir || "",
        templatePath: s.meeting_word_template || ""
      }).catch(e => console.error("Meeting Export error:", e));

    } else {
      const prompt = buildRefinePrompt(s, activeApp);
      if (s.refine_enabled && prompt) {
        setState("refining", "Verfeinere…");
        text = await invoke("refine", {
          provider: s.refine_provider,
          model: s.refine_model,
          systemPrompt: prompt,
          text,
          customEndpoint: s.refine_custom_endpoint || "",
        });
      }
    }

    await invoke("paste_text", { text, autoPaste: s.auto_paste });
    
    // In Historie speichern
    await invoke("add_history_entry", {
      entry: {
        id: String(Date.now()),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        raw_text: rawText,
        refined_text: text,
        preset: isMeetingMode ? "meeting_protocol" : (s.refine_preset || "cleanup"),
        app_name: activeApp
      }
    }).catch(() => {});

    setState("done", isMeetingMode ? "Protokoll & Word gespeichert 📄" : (s.auto_paste ? "Eingefügt" : "In Zwischenablage"));
    setTimeout(idle, 2400);
  } catch (e) {
    await cleanUpLive();
    showError(e);
  }
}

async function toggle() {
  const s = await invoke("load_settings");
  if (s.hotkey_mode === "hold") return; // Push-to-Talk ignoriert Toggle

  if (state === "idle" || state === "done" || state === "error") {
    await startRecordingFlow();
    return;
  }

  if (state === "recording") {
    await stopRecordingFlow();
  }
}

// Push-to-Talk Event Listeners
listen("hotkey-down", async () => {
  const s = await invoke("load_settings");
  if (s.hotkey_mode === "hold" && (state === "idle" || state === "done" || state === "error")) {
    await startRecordingFlow();
  }
});

listen("hotkey-up", async () => {
  const s = await invoke("load_settings");
  if (s.hotkey_mode === "hold" && state === "recording") {
    await stopRecordingFlow();
  }
});

// Klick auf die Pille während der Aufnahme bricht ab
pill.addEventListener("click", async () => {
  if (state === "recording") {
    await invoke("cancel_recording").catch(() => {});
    stopTimer();
    await cleanUpLive();
    setState("done", "Abgebrochen");
    setTimeout(idle, 1200);
  }
});

listen("hotkey-toggle", toggle);
idle();
