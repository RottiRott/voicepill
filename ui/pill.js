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

function setState(next, text) {
  state = next;
  pill.className = next === "idle" ? "" : `active ${next}`;
  if (next === "error") pill.classList.add("error", "active");
  label.textContent = text;
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

function buildRefinePrompt(settings) {
  const preset = settings.refine_preset || "cleanup";
  if (preset === "custom") return (settings.custom_prompt || "").trim();
  return (PRESETS[preset] || PRESETS.cleanup).prompt;
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

async function toggle() {
  if (state === "idle" || state === "done" || state === "error") {
    try {
      await invoke("start_recording");
      setState("recording", "Aufnahme");
      startTimer();
      await startLiveTranscription();
    } catch (e) {
      showError(e);
    }
    return;
  }

  if (state === "recording") {
    stopTimer();
    setState("processing", "Transkribiere…");
    try {
      await invoke("stop_recording");
      const s = await invoke("load_settings");
      
      const finalLiveText = liveText.trim();
      await cleanUpLive();

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
        });
      }

      const prompt = buildRefinePrompt(s);
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

      await invoke("paste_text", { text, autoPaste: s.auto_paste });
      setState("done", s.auto_paste ? "Eingefügt" : "In Zwischenablage");
      setTimeout(idle, 1800);
    } catch (e) {
      await cleanUpLive();
      showError(e);
    }
  }
}

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
