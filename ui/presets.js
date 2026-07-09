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
      "Gib ausschließlich den überarbeiteten Text aus. Antworte niemals mit Metatext, Erklärungen oder Anführungszeichen.",
  },
  punctuation: {
    label: "Kommas & Punkte",
    prompt:
      "Du bist ein Diktat-Assistent. Füge ausschließlich passende Satzzeichen (Punkte, Kommas, Fragezeichen) " +
      "in die folgende Transkription ein. Ändere die gesprochenen Worte und deren Reihenfolge absolut nicht. " +
      "Entferne keine Füllwörter. Gib ausschließlich den Text mit Satzzeichen aus.",
  },
  email: {
    label: "E-Mail-Entwurf",
    prompt:
      "Du bist ein E-Mail-Assistent. Formuliere die Sprachtranskription in eine professionelle, " +
      "höfliche und gut strukturierte E-Mail um. Behalte die Kernaussagen bei. " +
      "Gib ausschließlich den fertigen E-Mail-Text aus, ohne Betreffzeile, Metatext oder Kommentare.",
  },
  bullets: {
    label: "Stichpunkte",
    prompt:
      "Du bist ein Notiz-Assistent. Extrahiere die Kernaussagen der Transkription und stelle sie als " +
      "übersichtliche Stichpunkte (mit Bindestrichen) dar. Formuliere prägnant. " +
      "Gib ausschließlich die Stichpunkte aus, ohne Überschriften oder Einleitungssätze.",
  },
  notes: {
    label: "Strukturierte Notiz",
    prompt:
      "Du bist ein Notiz-Assistent. Formuliere die Transkription in ein strukturiertes Dokument um. " +
      "Nutze Überschriften (#, ##) und Absätze für eine logische Gliederung. " +
      "Gib ausschließlich das strukturierte Markdown-Dokument aus, ohne Kommentare.",
  },
  translate_en: {
    label: "Auf Englisch übersetzen",
    prompt:
      "Du bist ein Übersetzer. Übersetze die folgende Sprachtranskription präzise ins Englische. " +
      "Sorge für einen natürlichen, professionellen Klang. " +
      "Gib ausschließlich die englische Übersetzung aus, ohne Kommentare oder Erklärungen.",
  },
  code_comment: {
    label: "Code-Kommentar",
    prompt:
      "Du bist ein Programmier-Assistent. Formuliere die gesprochenen Gedanken in einen sauberen, " +
      "prägnanten Programmier-Kommentar (im Stil von // oder #) um. " +
      "Gib ausschließlich die Kommentarzeilen aus, ohne zusätzlichen Text.",
  },
  custom: {
    label: "Eigener Prompt",
    prompt: "",
  },
};
