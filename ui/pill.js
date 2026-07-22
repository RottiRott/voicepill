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

  const actionsEl = document.getElementById("meetingConfirmActions");
  if (actionsEl) {
    actionsEl.style.display = next === "confirm_meeting" ? "flex" : "none";
  }

  // Wenn nicht aufgenommen wird oder nachgefragt wird, Fenster klick-durchlässig schalten, damit darunter liegende Apps nicht blockiert werden
  const ignore = (next !== "recording" && next !== "confirm_meeting");
  invoke("set_pill_click_through", { ignore }).catch(() => {});
}

function askMeetingConfirmation() {
  return new Promise((resolve) => {
    setState("confirm_meeting", "Meeting-Protokoll (Word/MD)?");
    
    const btnJa = document.getElementById("btnConfirmMeetingJa");
    const btnNein = document.getElementById("btnConfirmMeetingNein");

    const cleanUp = () => {
      btnJa.removeEventListener("click", onJa);
      btnNein.removeEventListener("click", onNein);
    };

    const onJa = (e) => {
      e.stopPropagation();
      cleanUp();
      resolve(true);
    };

    const onNein = (e) => {
      e.stopPropagation();
      cleanUp();
      resolve(false);
    };

    btnJa.addEventListener("click", onJa);
    btnNein.addEventListener("click", onNein);
  });
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
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerEl.textContent = "";
}

function showError(msg) {
  stopTimer();
  setState("error", String(msg));
  setTimeout(idle, 4000);
}

function buildRefinePrompt(settings, activeApp = "") {
  let p = PRESETS[settings.refine_preset] ? PRESETS[settings.refine_preset].prompt : PRESETS.cleanup.prompt;
  if (settings.refine_preset === "custom" && settings.custom_prompt) {
    p = settings.custom_prompt;
  }
  if (activeApp && activeApp !== "Unbekannt") {
    p += `\n\nHINWEIS: Der erstellte Text wird direkt in die Anwendung '${activeApp}' eingefügt. Passe Tonfall, Länge und Struktur optimal an diese Anwendung an.`;
  }
  return p;
}

async function startLiveTranscription() {
  const s = await invoke("load_settings");
  liveText = "";
  if (s.stt_provider !== "gemini") return;
  const isLive = s.stt_model.includes("live") || s.stt_model.includes("exp");
  if (!isLive) return;

  try {
    const token = await invoke("get_token", { key: "gemini" });
    if (!token) return;

    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${token}`;
    liveSocket = new WebSocket(wsUrl);

    liveSocket.onopen = () => {
      liveSocket.send(JSON.stringify({
        setup: {
          model: `models/${s.stt_model}`,
          generationConfig: { responseModalities: ["TEXT"] }
        }
      }));
    };

    liveSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const parts = msg.serverContent?.modelTurn?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.text) {
              liveText += part.text;
              label.textContent = liveText.slice(-30);
            }
          }
        }
      } catch (e) {}
    };

    audioChunkUnlisten = await listen("audio-chunk", (event) => {
      if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
        liveSocket.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: "audio/pcm;rate=16000",
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
      let doMeeting = true;
      if (s.meeting_ask_confirmation !== false) {
        doMeeting = await askMeetingConfirmation();
      }

      if (doMeeting) {
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
          templatePath: s.meeting_word_template || "",
          logoPath: s.custom_logo_path || ""
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
