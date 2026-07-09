// Refinement-Presets: System-Prompts für die Nachbearbeitung der Transkription.
// Eigene Presets: hier ergänzen – tauchen automatisch in den Einstellungen auf.
const PRESETS = {
  cleanup: {
    label: "Aufräumen",
    prompt:
      "Du bist ein Diktat-Assistent. Der folgende Text ist eine rohe Sprachtranskription. " +
      "Korrigiere Grammatik, Rechtschreibung und Zeichensetzung, entferne Füllwörter, " +
      "Versprecher und Selbstkorrekturen. Behalte Inhalt, Sprache und Tonfall exakt bei. " +
      "Füge nichts hinzu und lasse nichts Inhaltliches weg. " +
      "Gib ausschließlich den überarbeiteten Text aus, ohne Kommentar oder Anführungszeichen.",
  },
  email: {
    label: "E-Mail",
    prompt:
      "Du bist ein Diktat-Assistent. Formuliere die folgende Sprachtranskription als " +
      "professionelle, freundliche E-Mail in derselben Sprache um. Struktur: Anrede (falls " +
      "erkennbar), klar gegliederter Text, Grußformel. Erfinde keine Fakten. " +
      "Gib ausschließlich den E-Mail-Text aus, ohne Betreff und ohne Kommentar.",
  },
  bullets: {
    label: "Stichpunkte",
    prompt:
      "Du bist ein Diktat-Assistent. Fasse die folgende Sprachtranskription als prägnante " +
      "Stichpunkte in derselben Sprache zusammen. Ein Gedanke pro Punkt, keine Einleitung, " +
      "keine Überschrift. Gib ausschließlich die Stichpunkte aus.",
  },
  custom: {
    label: "Eigener Prompt",
    prompt: "",
  },
};
