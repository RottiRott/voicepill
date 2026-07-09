# VoicePill

Systemweite Spracheingabe für macOS und Windows – im Stil von Wispr Flow. Hotkey drücken, sprechen, erneut drücken: Die Aufnahme wird per Cloud-STT transkribiert, optional durch ein LLM verfeinert und automatisch an der Cursorposition eingefügt. Eine kleine Pille oben mittig am Bildschirm zeigt den Status.

## Features

- **Globaler Hotkey** (Standard: `Ctrl/Cmd + Shift + Space`), funktioniert in jeder App
- **Status-Pille** oben mittig: Aufnahme (mit Timer und Waveform), Transkription, Verfeinerung, Eingefügt
- **Mehrere STT-Anbieter** per API-Token: Groq (Whisper), OpenAI, Deepgram, Mistral (Voxtral) – Tokens landen im System-Schlüsselbund (macOS Keychain / Windows Credential Manager), nie in einer Datei
- **LLM-Verfeinerung** (optional): Anthropic, OpenAI oder Groq mit Presets (Aufräumen, E-Mail, Stichpunkte) oder eigenem System-Prompt
- **Auto-Paste**: Text wird direkt eingefügt (simuliertes Cmd/Strg+V) oder wahlweise nur in die Zwischenablage gelegt
- Klick auf die Pille während der Aufnahme bricht ab
- Tray-Icon mit Zugriff auf die Einstellungen; Schließen des Fensters beendet die App nicht

## Installation (Endnutzer)

Fertige Installer gibt es unter **Releases**: `.dmg` für macOS (Apple Silicon), `.msi`/`.exe` für Windows. Doppelklick, fertig.

**macOS, erste Öffnung:** Die App ist nicht signiert. Rechtsklick → „Öffnen" oder im Terminal:

```bash
xattr -cr /Applications/VoicePill.app
```

Berechtigungen, die macOS abfragt:
- **Mikrofon** (für die Aufnahme)
- **Bedienungshilfen** (Systemeinstellungen → Datenschutz → Bedienungshilfen) – nötig für Auto-Paste. Ohne diese Berechtigung bleibt der Text trotzdem in der Zwischenablage.

**Windows:** SmartScreen-Warnung mit „Weitere Informationen → Trotzdem ausführen" bestätigen (unsignierter Installer).

## Releases bauen (GitHub Actions)

1. Repo auf GitHub pushen
2. Tag setzen:
   ```bash
   git tag v0.1.0 && git push --tags
   ```
3. Der Workflow `.github/workflows/release.yml` baut auf macOS- und Windows-Runnern und legt einen **Release-Draft** mit den Installern an → prüfen und veröffentlichen.

Für Intel-Macs zusätzlich eine Matrix-Zeile mit `platform: macos-13` ergänzen.

## Lokal entwickeln

Voraussetzungen: [Rust](https://rustup.rs) und Node.js ≥ 18.

```bash
npm install
npx tauri icon app-icon.png   # einmalig: Icons generieren
npx tauri dev                 # Entwicklung
npx tauri build               # Installer für das eigene OS
```

Das Frontend ist bewusst reines HTML/CSS/JS ohne Bundler (`ui/`), Änderungen dort brauchen keinen Build-Schritt.

## Bedienung

1. App starten → Einstellungsfenster öffnet sich
2. STT-Anbieter wählen, API-Token einfügen, speichern
3. Cursor in ein beliebiges Textfeld setzen
4. Hotkey drücken → Pille zeigt „Aufnahme" → sprechen → Hotkey erneut drücken
5. Text wird transkribiert (ggf. verfeinert) und eingefügt

## Architektur

```
ui/            Frontend (statisch, kein Bundler)
  index.html   Einstellungen (Provider, Tokens, Hotkey, Refinement)
  pill.html    Status-Pille (transparentes Always-on-top-Fenster)
  pill.js      State-Machine + Pipeline: Aufnahme → STT → LLM → Paste
  presets.js   Refinement-Prompts (hier eigene Presets ergänzen)
src-tauri/
  src/lib.rs        Tauri-Setup, Commands, Hotkey, Tray, Keyring
  src/audio.rs      Mikrofonaufnahme (cpal) → WAV (hound)
  src/providers.rs  HTTP-Anbindung STT- und LLM-APIs (reqwest)
```

Neue Provider (z. B. Minimax): Match-Arm in `providers.rs` + Option in `ui/settings.js` / `index.html` ergänzen – die Token-Verwaltung über den Schlüsselbund funktioniert automatisch.

## Bekannte Grenzen (MVP)

- Kein Streaming – Transkription startet erst nach Ende der Aufnahme
- Hotkey ist ein Toggle (kein Push-to-Talk)
- macOS-Build in CI ist Apple Silicon; Windows x64
- Unsignierte Builds (Gatekeeper/SmartScreen-Hinweise, siehe oben)
