use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use docx_rs::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingDocResult {
    pub md_path: String,
    pub docx_path: String,
    pub filename: String,
    pub title: String,
}

/// Konvertiert ein Markdown-Meeting-Protokoll in ein echtes Word-Dokument (.docx)
pub fn create_docx_from_markdown(markdown: &str, title: &str) -> Result<Vec<u8>, String> {
    let mut docx = Docx::new();

    // Titel-Kopfzeile
    let header_para = Paragraph::new()
        .add_run(Run::new().add_text(title).bold().size(36))
        .align(AlignmentType::Center);
    docx = docx.add_paragraph(header_para);
    docx = docx.add_paragraph(Paragraph::new()); // Abstand

    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("# ") {
            let text = trimmed.trim_start_matches("# ").trim();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_text(text).bold().size(32))
                    .align(AlignmentType::Left),
            );
        } else if trimmed.starts_with("## ") {
            let text = trimmed.trim_start_matches("## ").trim();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_text(text).bold().size(26))
                    .align(AlignmentType::Left),
            );
        } else if trimmed.starts_with("### ") {
            let text = trimmed.trim_start_matches("### ").trim();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_text(text).bold().size(22))
                    .align(AlignmentType::Left),
            );
        } else if trimmed.starts_with("- [ ] ") || trimmed.starts_with("- [x] ") {
            let checked = trimmed.starts_with("- [x] ");
            let text = &trimmed[6..];
            let mark = if checked { "☑ " } else { "☐ " };
            docx = docx.add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_text(mark).bold().size(20))
                    .add_run(Run::new().add_text(text.trim()).size(20)),
            );
        } else if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            let text = trimmed[2..].trim();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_text("• ").bold().size(20))
                    .add_run(Run::new().add_text(text).size(20)),
            );
        } else if !trimmed.is_empty() {
            docx = docx.add_paragraph(
                Paragraph::new().add_run(Run::new().add_text(trimmed).size(20)),
            );
        } else {
            docx = docx.add_paragraph(Paragraph::new());
        }
    }

    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    docx.build()
        .pack(&mut cursor)
        .map_err(|e| format!("Fehler beim Erstellen der Word-Datei: {e}"))?;

    Ok(buf)
}

/// Exportiert Markdown und .docx in den Zielordner
pub fn export_meeting_documents(
    markdown_content: &str,
    custom_output_dir: &str,
    _template_path: &str,
) -> Result<MeetingDocResult, String> {
    let now = chrono::Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H%M%S").to_string();
    let filename_base = format!("Meeting_{date_str}_{time_str}");
    let doc_title = format!("Meeting-Protokoll – {date_str}");

    // Zielverzeichnis ermitteln
    let target_dir: PathBuf = if !custom_output_dir.trim().is_empty() {
        PathBuf::from(custom_output_dir.trim())
    } else {
        dirs::document_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("VoicePill")
            .join("Meetings")
            .join(&date_str)
    };

    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Ordner konnte nicht erstellt werden ({target_dir:?}): {e}"))?;

    let md_file_path = target_dir.join(format!("{filename_base}.md"));
    let docx_file_path = target_dir.join(format!("{filename_base}.docx"));

    // 1. Markdown (.md) schreiben
    fs::write(&md_file_path, markdown_content)
        .map_err(|e| format!("Markdown-Datei konnte nicht geschrieben werden: {e}"))?;

    // 2. Word (.docx) generieren
    let docx_bytes = create_docx_from_markdown(markdown_content, &doc_title)?;
    fs::write(&docx_file_path, docx_bytes)
        .map_err(|e| format!("Word-Datei konnte nicht geschrieben werden: {e}"))?;

    Ok(MeetingDocResult {
        md_path: md_file_path.to_string_lossy().to_string(),
        docx_path: docx_file_path.to_string_lossy().to_string(),
        filename: filename_base,
        title: doc_title,
    })
}
