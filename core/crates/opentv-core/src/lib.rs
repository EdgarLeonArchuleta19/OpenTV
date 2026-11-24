pub mod app_update;
pub mod config;
pub mod dnsx;
pub mod downloads;
pub mod epg;
pub mod images;
pub mod local_media;
pub mod m3u;
pub mod mpv;
pub mod netguard;
pub mod plugin_fetch;
pub mod proxy;
pub mod resolve;
pub mod rpc;
pub mod safe_http;
pub mod storage;
pub mod subtitlecat;
pub mod tmdb;
pub mod torrents;
pub mod transcode;
pub mod video_hash;

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::app_update::AppUpdater;
use crate::config::ServiceConfig;
use crate::dnsx::Dnsx;
use crate::downloads::DownloadManager;
use crate::epg::EpgStore;
use crate::images::ImageSizer;
use crate::local_media::LocalMediaStore;
use crate::mpv::MpvController;
use crate::proxy::ProxyStore;
use crate::subtitlecat::SubtitleCat;
use crate::tmdb::TmdbClient;
use crate::torrents::TorrentEngine;
use crate::transcode::MediaCompatEngine;
use crate::video_hash::VideoHasher;

#[derive(Clone)]
pub struct ServiceState {
    pub config: Arc<ServiceConfig>,
    pub http: reqwest::Client,
    pub dns: Dnsx,
    pub epg: EpgStore,
    pub tmdb: TmdbClient,
    pub proxy: ProxyStore,
    pub video_hash: VideoHasher,
    pub subtitlecat: SubtitleCat,
    pub images: ImageSizer,
    pub torrents: TorrentEngine,
    pub downloads: DownloadManager,
    pub local_media: LocalMediaStore,
    pub transcode: MediaCompatEngine,
    pub mpv: MpvController,
    pub app_updater: AppUpdater,
    bound_port: Arc<AtomicU16>,
}

impl ServiceState {
    pub fn new(config: ServiceConfig) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .tcp_nodelay(true)
            .tcp_keepalive(Duration::from_secs(30))
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(if config.low_memory { 6 } else { 16 })
            .http2_adaptive_window(true)
            .build()
            .expect("http client");

        let cache_dir = config.resolved_cache_dir();
        let downloads_dir = config.resolved_downloads_dir();
        let version = config
            .app_version
            .clone()
            .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
        let abi = config.abi.clone().unwrap_or_default();

        let dns = Dnsx::new();
        let epg = EpgStore::new(dns.clone());
        let tmdb = TmdbClient::new(
            http.clone(),
            config.tmdb_config_path.clone(),
            config.tmdb_inline_json.as_deref(),
        );
        let proxy = ProxyStore::new(dns.clone());
        let video_hash = VideoHasher::new(dns.clone());
        let subtitlecat = SubtitleCat::new(http.clone());
        let images = ImageSizer::new(dns.clone(), cache_dir.clone(), config.low_memory);
        let torrents = TorrentEngine::new(http.clone(), cache_dir.clone(), config.low_memory);
        let downloads = DownloadManager::new(dns.clone(), torrents.clone(), downloads_dir);
        let local_media = LocalMediaStore::new();
        let transcode = MediaCompatEngine::new(proxy.clone());
        let mpv = MpvController::new(config.mpv_dll_path.clone());
        let app_updater = AppUpdater::new(
            http.clone(),
            cache_dir,
            version,
            abi,
            config.install_apk_hook.clone(),
        );

        Self {
            config: Arc::new(config),
            http,
            dns,
            epg,
            tmdb,
            proxy,
            video_hash,
            subtitlecat,
            images,
            torrents,
            downloads,
            local_media,
            transcode,
            mpv,
            app_updater,
            bound_port: Arc::new(AtomicU16::new(0)),
        }
    }

    pub fn bound_port(&self) -> u16 {
        self.bound_port.load(Ordering::Relaxed)
    }

    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.bound_port())
    }
}

/// Starts the loopback-only (`127.0.0.1`) OpenTV unified Rust service.
/// Returns the actual bound address, shared state handle, and a shutdown trigger.
pub async fn start_server_with_state(
    config: ServiceConfig,
) -> Result<(SocketAddr, ServiceState, oneshot::Sender<()>), String> {
    let bind_addr = SocketAddr::from(([127, 0, 0, 1], config.port));
    let listener = TcpListener::bind(bind_addr)
        .await
        .map_err(|e| format!("No se pudo abrir 127.0.0.1:{}: {e}", config.port))?;
    let local_addr = listener.local_addr().map_err(|e| e.to_string())?;

    let state = ServiceState::new(config);
    state.bound_port.store(local_addr.port(), Ordering::Relaxed);
    let router = rpc::build_router(state.clone());

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    Ok((local_addr, state, shutdown_tx))
}

/// Convenience wrapper for callers that only need the address and shutdown handle.
pub async fn start_server(
    config: ServiceConfig,
) -> Result<(SocketAddr, oneshot::Sender<()>), String> {
    let (addr, _state, tx) = start_server_with_state(config).await?;
    Ok((addr, tx))
}
