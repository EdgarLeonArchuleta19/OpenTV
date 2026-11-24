use std::env;
use std::fs;
use std::path::PathBuf;

/// Must match the stream decoded by `embedded_tmdb_json` in `src/main.rs`.
fn xorshift(state: &mut u64) -> u8 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x;
    (x >> 24) as u8
}

/// Embeds `config/tmdb.json` (git-ignored) into the binary in obfuscated form so installed
/// builds have Spanish TMDB metadata like the Android app (which ships an encrypted asset).
/// Writes an empty blob when the file is missing, so builds without a key still work.
fn embed_tmdb() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let config_dir = manifest_dir.join("../../../config");
    let default_src = config_dir.join("tmdb.json");
    println!("cargo:rerun-if-env-changed=OPENTV_TMDB_CONFIG");
    let src = env::var_os("OPENTV_TMDB_CONFIG")
        .map(PathBuf::from)
        .unwrap_or(default_src);
    if src.is_file() {
        println!("cargo:rerun-if-changed={}", src.display());
    } else if config_dir.is_dir() {
        println!("cargo:rerun-if-changed={}", config_dir.display());
    }

    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("tmdb.bin");
    let plain = fs::read(&src)
        .ok()
        .filter(|b| serde_json_like(b))
        .unwrap_or_default();
    if plain.is_empty() {
        let _ = fs::write(&out, []);
        return;
    }
    let seed: u64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E37_79B9_7F4A_7C15)
        | 1;
    let mut blob = Vec::with_capacity(plain.len() + 9);
    blob.push(1u8);
    blob.extend_from_slice(&seed.to_le_bytes());
    let mut st = (seed ^ 0x6F70_656E_7476_746D).max(1);
    for b in plain {
        blob.push(b ^ xorshift(&mut st));
    }
    let _ = fs::write(&out, blob);
}

/// Cheap sanity check (no serde in build-deps): a JSON object with a credential field.
fn serde_json_like(bytes: &[u8]) -> bool {
    let s = String::from_utf8_lossy(bytes);
    let t = s.trim();
    t.starts_with('{') && t.ends_with('}') && (t.contains("readAccessToken") || t.contains("apiKey"))
}

fn main() {
    embed_tmdb();
    tauri_build::build()
}
