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

async function toggle() {
  if (state === "idle" || state === "done" || state === "error") {
    try {
      await invoke("start_recording");
      setState("recording", "Aufnahme");
      startTimer();
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

      let text = await invoke("transcribe", {
        provider: s.stt_provider,
        model: s.stt_model,
        language: s.language,
      });

      const prompt = buildRefinePrompt(s);
      if (s.refine_enabled && prompt) {
        setState("refining", "Verfeinere…");
        text = await invoke("refine", {
          provider: s.refine_provider,
          model: s.refine_model,
          systemPrompt: prompt,
          text,
        });
      }

      await invoke("paste_text", { text, autoPaste: s.auto_paste });
      setState("done", s.auto_paste ? "Eingefügt" : "In Zwischenablage");
      setTimeout(idle, 1800);
    } catch (e) {
      showError(e);
    }
  }
  // Während processing/refining: Toggle ignorieren
}

// Klick auf die Pille während der Aufnahme bricht ab
pill.addEventListener("click", async () => {
  if (state === "recording") {
    await invoke("cancel_recording").catch(() => {});
    stopTimer();
    setState("done", "Abgebrochen");
    setTimeout(idle, 1200);
  }
});

listen("hotkey-toggle", toggle);
idle();
