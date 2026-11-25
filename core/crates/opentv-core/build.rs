use std::env;
use std::fs;
use std::path::PathBuf;

/// Must match the stream decoded by `embedded_json` in `src/subdl.rs`.
fn xorshift(state: &mut u64) -> u8 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x;
    (x >> 24) as u8
}

/// Embeds the git-ignored `config/subdl.json` (`{ "apiKey": "…" }`) in obfuscated form, the
/// same way `apps/desktop/src-tauri/build.rs` embeds the TMDB key. Living in the core crate,
/// it reaches the PC app, the standalone service and the Android `.so` alike.
/// A missing file writes an empty blob: SubDL is simply disabled and the build succeeds.
fn embed_subdl() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let config_dir = manifest_dir.join("../../../config");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=OPENTV_SUBDL_CONFIG");
    let src = env::var_os("OPENTV_SUBDL_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| config_dir.join("subdl.json"));
    if src.is_file() {
        println!("cargo:rerun-if-changed={}", src.display());
    } else if config_dir.is_dir() {
        // Re-run when the file is added later (a missing path would re-run every build).
        println!("cargo:rerun-if-changed={}", config_dir.display());
    }

    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("subdl.bin");
    let plain = fs::read(&src)
        .ok()
        .filter(|b| {
            let s = String::from_utf8_lossy(b);
            let t = s.trim();
            t.starts_with('{') && t.ends_with('}') && t.contains("apiKey")
        })
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
    let mut st = (seed ^ 0x7375_6264_6c6b_6579).max(1);
    for b in plain {
        blob.push(b ^ xorshift(&mut st));
    }
    let _ = fs::write(&out, blob);
}

fn main() {
    embed_subdl();
}
