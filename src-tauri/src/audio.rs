use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

pub struct RecordingSession {
    samples: Arc<Mutex<Vec<f32>>>,
    stop: Arc<AtomicBool>,
    handle: std::thread::JoinHandle<()>,
    sample_rate: u32,
    channels: u16,
}

impl RecordingSession {
    pub fn start(app: tauri::AppHandle) -> Result<Self, String> {
        let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel::<Result<(u32, u16), String>>();

        let samples_thread = samples.clone();
        let stop_thread = stop.clone();

        let handle = std::thread::spawn(move || {
            let result = (|| -> Result<(u32, u16, cpal::Stream), String> {
                let host = cpal::default_host();
                let device = host
                    .default_input_device()
                    .ok_or("Kein Mikrofon gefunden")?;
                let config = device
                    .default_input_config()
                    .map_err(|e| format!("Mikrofon-Konfiguration fehlgeschlagen: {e}"))?;
                let sample_rate = config.sample_rate().0;
                let channels = config.channels();
                let err_fn = |e| eprintln!("Audio-Stream-Fehler: {e}");

                let stream = match config.sample_format() {
                    cpal::SampleFormat::F32 => {
                        let buf = samples_thread.clone();
                        device.build_input_stream(
                            &config.into(),
                            move |data: &[f32], _| {
                                buf.lock().unwrap().extend_from_slice(data);
                            },
                            err_fn,
                            None,
                        )
                    }
                    cpal::SampleFormat::I16 => {
                        let buf = samples_thread.clone();
                        device.build_input_stream(
                            &config.into(),
                            move |data: &[i16], _| {
                                let mut g = buf.lock().unwrap();
                                g.extend(data.iter().map(|&v| v as f32 / 32768.0));
                            },
                            err_fn,
                            None,
                        )
                    }
                    cpal::SampleFormat::U16 => {
                        let buf = samples_thread.clone();
                        device.build_input_stream(
                            &config.into(),
                            move |data: &[u16], _| {
                                let mut g = buf.lock().unwrap();
                                g.extend(data.iter().map(|&v| (v as f32 - 32768.0) / 32768.0));
                            },
                            err_fn,
                            None,
                        )
                    }
                    other => return Err(format!("Sample-Format {other:?} wird nicht unterstützt")),
                }
                .map_err(|e| format!("Audio-Stream konnte nicht erstellt werden: {e}"))?;

                stream
                    .play()
                    .map_err(|e| format!("Aufnahme konnte nicht gestartet werden: {e}"))?;
                Ok((sample_rate, channels, stream))
            })();

            match result {
                Ok((sr, ch, stream)) => {
                    let _ = tx.send(Ok((sr, ch)));
                    let mut last_index = 0;
                    let to_sr = 16000;
                    let factor = sr as f32 / to_sr as f32;

                    while !stop_thread.load(Ordering::Relaxed) {
                        std::thread::sleep(Duration::from_millis(100));

                        let current_chunk = {
                            let g = samples_thread.lock().unwrap();
                            if g.len() > last_index {
                                let chunk = g[last_index..].to_vec();
                                last_index = g.len();
                                Some(chunk)
                            } else {
                                None
                            }
                        };

                        if let Some(chunk) = current_chunk {
                            let mono: Vec<f32> = if ch > 1 {
                                chunk
                                    .chunks(ch as usize)
                                    .map(|c| c.iter().sum::<f32>() / c.len() as f32)
                                    .collect()
                            } else {
                                chunk
                            };

                            let mut resampled = Vec::new();
                            let mut src_index = 0.0f32;
                            while (src_index as usize) < mono.len() {
                                let sample = mono[src_index as usize];
                                resampled.push((sample.clamp(-1.0, 1.0) * 32767.0) as i16);
                                src_index += factor;
                            }

                            let mut bytes = Vec::with_capacity(resampled.len() * 2);
                            for s in resampled {
                                bytes.extend_from_slice(&s.to_le_bytes());
                            }

                            use base64::Engine;
                            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                            let _ = app.emit("audio-chunk", b64);
                        }
                    }
                    drop(stream);
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                }
            }
        });

        let (sample_rate, channels) = rx
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "Zeitüberschreitung beim Mikrofon-Start".to_string())??;

        Ok(Self {
            samples,
            stop,
            handle,
            sample_rate,
            channels,
        })
    }

    /// Beendet die Aufnahme und liefert (WAV-Bytes, Dauer in Sekunden).
    pub fn finish(self) -> Result<(Vec<u8>, f32), String> {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.handle.join();

        let samples = self.samples.lock().unwrap();
        // Auf Mono heruntermischen
        let mono: Vec<f32> = if self.channels > 1 {
            samples
                .chunks(self.channels as usize)
                .map(|c| c.iter().sum::<f32>() / c.len() as f32)
                .collect()
        } else {
            samples.clone()
        };
        drop(samples);

        let duration = mono.len() as f32 / self.sample_rate as f32;
        if duration < 0.3 {
            return Err("Aufnahme zu kurz".into());
        }

        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: self.sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut writer =
                hound::WavWriter::new(&mut cursor, spec).map_err(|e| e.to_string())?;
            for s in &mono {
                writer
                    .write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16)
                    .map_err(|e| e.to_string())?;
            }
            writer.finalize().map_err(|e| e.to_string())?;
        }
        Ok((cursor.into_inner(), duration))
    }

    pub fn cancel(self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.handle.join();
    }
}
