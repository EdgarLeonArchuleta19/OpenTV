use std::io::{self, Read, Write};
use std::path::PathBuf;

use opentv_core::config::{default_allowed_origins, generate_session_token, ServiceConfig};
use opentv_core::start_server_with_state;

#[tokio::main]
async fn main() {
    let mut cfg = ServiceConfig {
        port: 0,
        platform: "desktop".to_string(),
        low_memory: false,
        // Standalone harness (contract tests / legacy launchers): keeps the broad origin list.
        allowed_origins: default_allowed_origins(),
        ..Default::default()
    };

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--port" => {
                if let Some(v) = args.next() {
                    if let Ok(p) = v.parse::<u16>() {
                        cfg.port = p;
                    }
                }
            }
            "--token" => {
                cfg.auth_token = args.next().filter(|s| !s.is_empty());
            }
            "--tmdb-config" => {
                cfg.tmdb_config_path = args.next().map(PathBuf::from);
            }
            "--cache-dir" => {
                cfg.cache_dir = args.next().filter(|s| !s.is_empty()).map(PathBuf::from);
            }
            "--downloads-dir" => {
                cfg.downloads_dir = args.next().filter(|s| !s.is_empty()).map(PathBuf::from);
            }
            "--version" => {
                cfg.app_version = args.next().filter(|s| !s.is_empty());
            }
            "--mpv-dll" => {
                cfg.mpv_dll_path = args.next().filter(|s| !s.is_empty()).map(PathBuf::from);
            }
            _ => {}
        }
    }

    // Never run the loopback service without a session token. Launchers pass
    // one explicitly; fall back to the environment or a fresh random secret.
    if cfg.auth_token.as_ref().map(|t| t.is_empty()).unwrap_or(true) {
        cfg.auth_token = Some(
            std::env::var("OPENTV_TOKEN")
                .ok()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(generate_session_token),
        );
    }

    let (addr, state, shutdown_tx) = match start_server_with_state(cfg).await {
        Ok(res) => res,
        Err(err) => {
            eprintln!("[opentv-service] fatal: {err}");
            std::process::exit(1);
        }
    };

    // Electron reads this single line to discover the dynamic loopback port and libmpv availability.
    println!(
        "OPENTV_READY port={} mpv={}",
        addr.port(),
        if state.mpv.available() { 1 } else { 0 }
    );
    let _ = io::stdout().flush();

    // Exit automatically if Electron closes stdin (prevents orphan processes) OR on Ctrl+C.
    let stdin_closed = tokio::task::spawn_blocking(|| {
        let mut buf = [0u8; 64];
        loop {
            match io::stdin().read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = stdin_closed => {}
    }

    state.torrents.stop().await;
    let _ = shutdown_tx.send(());
}
