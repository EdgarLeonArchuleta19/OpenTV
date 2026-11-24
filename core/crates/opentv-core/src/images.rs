use std::io::Cursor;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{ImageError, ImageFormat, ImageReader, Limits};
use sha2::{Digest, Sha256};

use crate::dnsx::Dnsx;
use crate::safe_http::{fetch_url, FetchOptions};

const MAX_BYTES: usize = 15 * 1024 * 1024;
const MAX_FILES: usize = 3500;
const KEEP_DAYS: u64 = 30;
const JPEG_QUALITY: u8 = 84;

/// Decoder limits against decompression bombs (a tiny PNG/WebP declaring a huge canvas).
const MAX_DIM: u32 = 8192;
const MAX_ALLOC: u64 = 64 * 1024 * 1024;
/// Tighter limits for 1 GB TV devices (`low_memory`).
const MAX_DIM_LOW: u32 = 4096;
const MAX_ALLOC_LOW: u64 = 32 * 1024 * 1024;

/// Why an image could not be turned into a sized JPEG.
#[derive(Debug, PartialEq, Eq)]
enum ResizeError {
    /// Over the decoder limits: refused, never passed through.
    TooLarge,
    /// A raster format this build cannot decode (GIF, AVIF, BMP, ICO...).
    Unsupported,
    Invalid,
}

fn decode_limits(low_memory: bool) -> Limits {
    let mut limits = Limits::default();
    let (dim, alloc) = if low_memory {
        (MAX_DIM_LOW, MAX_ALLOC_LOW)
    } else {
        (MAX_DIM, MAX_ALLOC)
    };
    limits.max_image_width = Some(dim);
    limits.max_image_height = Some(dim);
    limits.max_alloc = Some(alloc);
    limits
}

/// Raster formats that may be relayed untouched when they cannot be resized. The
/// Content-Type is derived from the magic bytes, never from the upstream header, so
/// SVG/HTML/script payloads are never served from the service origin.
fn passthrough_mime(raw: &[u8]) -> Option<&'static str> {
    match image::guess_format(raw).ok()? {
        ImageFormat::Gif => Some("image/gif"),
        ImageFormat::Avif => Some("image/avif"),
        ImageFormat::Bmp => Some("image/bmp"),
        ImageFormat::Ico => Some("image/x-icon"),
        _ => None,
    }
}

fn error_response(status: StatusCode, msg: &'static str) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(msg))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

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
            return error_response(StatusCode::BAD_REQUEST, "Solicitud de imagen no válida");
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
            Err(_) => return error_response(StatusCode::BAD_GATEWAY, "No se pudo descargar la imagen"),
        };

        if !resp.status().is_success() {
            return error_response(StatusCode::NOT_FOUND, "Imagen no encontrada");
        }

        if let Some(cl) = resp.content_length() {
            if cl as usize > MAX_BYTES {
                return error_response(StatusCode::PAYLOAD_TOO_LARGE, "Imagen demasiado grande");
            }
        }

        let raw = match resp.bytes().await {
            Ok(b) if !b.is_empty() && b.len() <= MAX_BYTES => b.to_vec(),
            Ok(b) if b.len() > MAX_BYTES => {
                return error_response(StatusCode::PAYLOAD_TOO_LARGE, "Imagen demasiado grande");
            }
            _ => return error_response(StatusCode::BAD_GATEWAY, "Imagen vacía"),
        };

        let low_mem = self.low_memory;
        let raw_clone = raw.clone();
        let resized = tokio::task::spawn_blocking(move || resize_to_jpeg(&raw_clone, width, low_mem))
            .await
            .unwrap_or(Err(ResizeError::Invalid));

        if let Ok(jpeg) = resized {
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

        match resized {
            Err(ResizeError::TooLarge) => {
                error_response(StatusCode::UNPROCESSABLE_ENTITY, "Imagen demasiado grande")
            }
            // Raster format this build cannot resize (e.g. GIF/AVIF): relay it with the
            // type sniffed from its magic bytes. Anything else (SVG, HTML...) is refused.
            _ => match passthrough_mime(&raw) {
                Some(mime) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, mime)
                    .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                    .header(header::CACHE_CONTROL, "public, max-age=86400")
                    .body(Body::from(raw))
                    .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
                None => error_response(
                    StatusCode::UNSUPPORTED_MEDIA_TYPE,
                    "Formato de imagen no compatible",
                ),
            },
        }
    }
}

fn jpeg_response(bytes: Vec<u8>) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Error").into_response())
}

fn decode_limited(raw: &[u8], low_memory: bool) -> Result<image::DynamicImage, ResizeError> {
    let mut reader = ImageReader::new(Cursor::new(raw))
        .with_guessed_format()
        .map_err(|_| ResizeError::Invalid)?;
    if reader.format().is_none() {
        return Err(ResizeError::Unsupported);
    }
    reader.limits(decode_limits(low_memory));
    reader.decode().map_err(|e| match e {
        ImageError::Limits(_) => ResizeError::TooLarge,
        ImageError::Unsupported(_) => ResizeError::Unsupported,
        _ => ResizeError::Invalid,
    })
}

fn resize_to_jpeg(raw: &[u8], target_width: u32, low_memory: bool) -> Result<Vec<u8>, ResizeError> {
    let img = decode_limited(raw, low_memory)?;
    let w = img.width();
    let h = img.height();
    if w == 0 || h == 0 {
        return Err(ResizeError::Invalid);
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
    .map_err(|_| ResizeError::Invalid)?;
    Ok(out.into_inner())
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

    /// A valid PNG header that declares a huge canvas: the decoder must refuse it from
    /// the header alone instead of allocating width * height * 4 bytes.
    fn png_declaring(width: u32, height: u32) -> Vec<u8> {
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_pixel(1, 1, Rgb([0, 0, 0]));
        let mut png = Cursor::new(Vec::new());
        img.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let mut bytes = png.into_inner();
        // IHDR data starts at byte 16 (8 signature + 4 length + 4 type).
        bytes[16..20].copy_from_slice(&width.to_be_bytes());
        bytes[20..24].copy_from_slice(&height.to_be_bytes());
        // Fix the IHDR CRC (over type + data, bytes 12..29).
        let crc = crc32(&bytes[12..29]);
        bytes[29..33].copy_from_slice(&crc.to_be_bytes());
        bytes
    }

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xffff_ffffu32;
        for &b in data {
            crc ^= b as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
            }
        }
        !crc
    }

    #[test]
    fn refuses_decompression_bombs_by_dimensions_and_allocation() {
        let bomb = png_declaring(60_000, 60_000);
        assert_eq!(resize_to_jpeg(&bomb, 300, false), Err(ResizeError::TooLarge));
        // Within the dimension cap but over the 64 MB allocation budget (8000*8000*3).
        let wide = png_declaring(8000, 8000);
        assert_eq!(resize_to_jpeg(&wide, 300, false), Err(ResizeError::TooLarge));
        // Low-memory devices cap dimensions at 4096.
        let tv = png_declaring(5000, 100);
        assert_eq!(resize_to_jpeg(&tv, 300, true), Err(ResizeError::TooLarge));
    }

    #[test]
    fn never_relays_svg_or_html_and_sniffs_passthrough_type() {
        assert_eq!(passthrough_mime(b"<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"), None);
        assert_eq!(passthrough_mime(b"<!doctype html><script>alert(1)</script>"), None);
        assert_eq!(passthrough_mime(b"GIF89a\x01\x00\x01\x00"), Some("image/gif"));
        assert_eq!(
            resize_to_jpeg(b"<svg xmlns='http://www.w3.org/2000/svg'/>", 100, false).is_err(),
            true
        );
    }
}
