use std::io::Cursor;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use sha2::{Digest, Sha256};

use crate::dnsx::Dnsx;
use crate::safe_http::{fetch_url, FetchOptions};

const MAX_BYTES: usize = 15 * 1024 * 1024;
const MAX_FILES: usize = 3500;
const KEEP_DAYS: u64 = 30;
const JPEG_QUALITY: u8 = 84;

#[derive(Clone)]
pub struct ImageSizer {
    dns: Dnsx,
    dir: PathBuf,
    low_memory: bool,
}

impl ImageSizer {
    pub fn new(dns: Dnsx, cache_root: PathBuf, low_memory: bool) -> Self {
        let dir = cache_root.join("sized-images");
        let _ = std::fs::create_dir_all(&dir);
        let prune_dir = dir.clone();
        std::thread::Builder::new()
            .name("opentv-img-prune".to_string())
            .spawn(move || {
                std::thread::sleep(Duration::from_secs(20));
                prune_cache(&prune_dir);
            })
            .ok();
        Self {
            dns,
            dir,
            low_memory,
        }
    }

    fn cache_key(w: u32, url: &str) -> String {
        let mut h = Sha256::new();
        h.update(w.to_string().as_bytes());
        h.update(b"|");
        h.update(url.as_bytes());
        let sum = h.finalize();
        let mut hex = String::with_capacity(40);
        for b in &sum[..20] {
            use std::fmt::Write;
            let _ = write!(&mut hex, "{b:02x}");
        }
        hex
    }

    pub async fn serve(&self, width: u32, src_url: &str) -> Response {
        let trimmed = src_url.trim();
        let valid_proto = trimmed.starts_with("http://") || trimmed.starts_with("https://");
        if !valid_proto || !(16..=3840).contains(&width) {
            return (StatusCode::BAD_REQUEST, "Bad request").into_response();
        }

        let file = self.dir.join(format!("{}.jpg", Self::cache_key(width, trimmed)));
        if let Ok(cached) = tokio::fs::read(&file).await {
            if !cached.is_empty() {
                return jpeg_response(cached);
            }
        }

        let mut opts = FetchOptions::new(&self.dns, false, Duration::from_secs(15));
        opts.user_agent = Some("Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenTV/2.0".to_string());
        let resp = match fetch_url(trimmed, opts).await {
            Ok(r) => r,
            Err(_) => return (StatusCode::BAD_GATEWAY, "Bad gateway").into_response(),
        };

        if !resp.status().is_success() {
            let status = StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(StatusCode::NOT_FOUND);
            return (status, "Not found").into_response();
        }

        let orig_ct = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();

        if let Some(cl) = resp.content_length() {
            if cl as usize > MAX_BYTES {
                return (StatusCode::PAYLOAD_TOO_LARGE, "Too large").into_response();
            }
        }

        let raw = match resp.bytes().await {
            Ok(b) if !b.is_empty() && b.len() <= MAX_BYTES => b.to_vec(),
            Ok(b) if b.len() > MAX_BYTES => {
                return (StatusCode::PAYLOAD_TOO_LARGE, "Too large").into_response();
            }
            _ => return (StatusCode::BAD_GATEWAY, "Empty image").into_response(),
        };

        let low_mem = self.low_memory;
        let raw_clone = raw.clone();
        let resized = tokio::task::spawn_blocking(move || resize_to_jpeg(&raw_clone, width, low_mem))
            .await
            .ok()
            .flatten();

        if let Some(jpeg) = resized {
            let file_clone = file.clone();
            let jpeg_clone = jpeg.clone();
            tokio::spawn(async move {
                let tmp = file_clone.with_extension("jpg.tmp");
                if tokio::fs::write(&tmp, &jpeg_clone).await.is_ok() {
                    let _ = tokio::fs::rename(&tmp, &file_clone).await;
                }
            });
            return jpeg_response(jpeg);
        }

        // Format undecodable by image crate (e.g. AVIF/SVG): return untouched.
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, orig_ct)
            .header(header::CACHE_CONTROL, "public, max-age=86400")
            .body(Body::from(raw))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Error").into_response())
    }
}

fn jpeg_response(bytes: Vec<u8>) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Error").into_response())
}

fn resize_to_jpeg(raw: &[u8], target_width: u32, low_memory: bool) -> Option<Vec<u8>> {
    let img = image::load_from_memory(raw).ok()?;
    let w = img.width();
    let h = img.height();
    if w == 0 || h == 0 {
        return None;
    }

    let final_img = if w > target_width {
        let new_h = ((h as f64) * (target_width as f64) / (w as f64))
            .round()
            .max(1.0) as u32;
        let filter = if low_memory {
            FilterType::Triangle
        } else {
            FilterType::CatmullRom
        };
        img.resize_exact(target_width, new_h, filter)
    } else {
        img
    };

    let rgb = final_img.to_rgb8();
    let mut out = Cursor::new(Vec::with_capacity((rgb.width() * rgb.height() / 6) as usize));
    let mut enc = JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    enc.encode(
        rgb.as_raw(),
        rgb.width(),
        rgb.height(),
        image::ExtendedColorType::Rgb8,
    )
    .ok()?;
    Some(out.into_inner())
}

fn prune_cache(dir: &PathBuf) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(KEEP_DAYS * 86400))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    let mut files: Vec<(PathBuf, SystemTime)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if mtime < cutoff {
            let _ = std::fs::remove_file(&path);
        } else {
            files.push((path, mtime));
        }
    }

    if files.len() > MAX_FILES {
        files.sort_by_key(|(_, t)| *t);
        let drop_count = files.len() - MAX_FILES;
        for (p, _) in files.into_iter().take(drop_count) {
            let _ = std::fs::remove_file(p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    #[test]
    fn resizes_png_to_exact_target_width_jpeg() {
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_pixel(320, 180, Rgb([20, 140, 220]));
        let mut png_bytes = Cursor::new(Vec::new());
        img.write_to(&mut png_bytes, image::ImageFormat::Png).unwrap();

        let jpeg = resize_to_jpeg(&png_bytes.into_inner(), 64, false).expect("jpeg");
        let decoded = image::load_from_memory(&jpeg).expect("decode jpeg");
        assert_eq!(decoded.width(), 64);
        assert_eq!(decoded.height(), 36);
    }
}
