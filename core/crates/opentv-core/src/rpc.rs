use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::{Json, Router};
use serde_json::{json, Map, Value};
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

use crate::m3u;
use crate::mpv;
use crate::plugin_fetch;
use crate::resolve;
use crate::storage;
use crate::ServiceState;

/// Query parameter that may carry the session token (a header would force a
/// CORS preflight on every call from the Android WebView).
pub const TOKEN_PARAM: &str = "__token";

pub fn build_router(state: ServiceState) -> Router {
    let origins: Vec<HeaderValue> = state
        .config
        .allowed_origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/media/abort", any(handle_media_abort))
        .route("/media/{token}/{*rest}", any(handle_media))
        .route("/hls/{token}/{encoded}", any(handle_hls_child))
        .route("/sub/{token}", get(handle_subtitle))
        .route("/t/{token}/{*rest}", any(handle_torrent_stream))
        .route("/d/{id}/{*rest}", any(handle_download_stream))
        .route("/local/{token}/{*rest}", any(handle_local_stream))
        .route("/local-sub/{token}", get(handle_local_sub))
        .route("/compat/{token_mp4}", get(handle_compat_stream))
        .route("/compat-sub/{token}/{sub_vtt}", get(handle_compat_sub))
        .route("/img", get(handle_image))
        .route("/mpv/events", get(handle_mpv_events))
        .route("/{method}", any(handle_rpc))
        .layer(middleware::from_fn_with_state(state.clone(), origin_guard))
        .layer(middleware::from_fn_with_state(state.clone(), host_guard))
        .layer(cors)
        .with_state(state)
}

/// Refuses any request whose `Origin` is not one of the app's own pages, on
/// every route (RPC, media, torrents, downloads, images, mpv events). Without
/// this, a website open in a browser on the same device could drive the
/// service and read its answers.
async fn origin_guard(State(state): State<ServiceState>, req: Request, next: Next) -> Response {
    if let Some(origin) = req.headers().get(header::ORIGIN) {
        let origin = origin.to_str().unwrap_or("");
        if !origin_allowed(&state.config.allowed_origins, origin) {
            return (StatusCode::FORBIDDEN, Json(fail("Origen no permitido"))).into_response();
        }
    }
    next.run(req).await
}

/// Refuses any request whose `Host` is not this service (`127.0.0.1:<port>` or
/// `localhost:<port>`). Blocks DNS-rebinding: a website whose name resolves to
/// 127.0.0.1 still sends its own name as `Host`. ExoPlayer, FFmpeg, Coil, WebView2
/// and reqwest all address the service as `http://127.0.0.1:<port>`.
async fn host_guard(State(state): State<ServiceState>, req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| req.uri().authority().map(|a| a.as_str().to_string()))
        .unwrap_or_default();
    if !host_allowed(&host, state.bound_port()) {
        return (StatusCode::FORBIDDEN, Json(fail("Host no permitido"))).into_response();
    }
    next.run(req).await
}

pub fn host_allowed(host: &str, port: u16) -> bool {
    let host = host.trim().to_ascii_lowercase();
    host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}")
}

pub fn origin_allowed(allowed: &[String], origin: &str) -> bool {
    allowed.iter().any(|a| a == origin)
}

/// Compares without stopping at the first different byte.
fn token_matches(expected: &str, got: &str) -> bool {
    let (a, b) = (expected.as_bytes(), got.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The session token is mandatory on every route that is not protected by an
/// unguessable token embedded in its path. Fails closed when no token is set.
fn token_ok(state: &ServiceState, headers: &HeaderMap, query: &HashMap<String, String>) -> bool {
    token_ok_with(state, headers, query, false)
}

/// `allow_short_alias` accepts `?t=` as well as `__token`: only for `/img`, whose URLs
/// Android's `RustServiceBridge.sizedImageUrl` builds with `&t=<token>`.
fn token_ok_with(
    state: &ServiceState,
    headers: &HeaderMap,
    query: &HashMap<String, String>,
    allow_short_alias: bool,
) -> bool {
    let Some(expected) = state.config.auth_token.as_ref() else {
        return false;
    };
    let got = headers
        .get("x-opentv-token")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| query.get(TOKEN_PARAM).cloned())
        .or_else(|| {
            if allow_short_alias {
                query.get("t").cloned()
            } else {
                None
            }
        })
        .unwrap_or_default();
    token_matches(expected, &got)
}

fn unauthorized() -> Response {
    (StatusCode::UNAUTHORIZED, Json(fail("No autorizado"))).into_response()
}

async fn handle_media_abort(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    if !token_ok(&state, &headers, &q) {
        return unauthorized();
    }
    let except = q.get("exceptToken").map(|s| s.as_str()).filter(|s| !s.is_empty());
    state.proxy.abort_all(except).await;
    StatusCode::NO_CONTENT.into_response()
}

async fn handle_media(
    State(state): State<ServiceState>,
    method: Method,
    Path((token, rest)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let base_url = state.base_url();
    state
        .proxy
        .serve_media(&base_url, &method, &token, &rest, &headers)
        .await
}

async fn handle_hls_child(
    State(state): State<ServiceState>,
    method: Method,
    Path((token, encoded)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let base_url = state.base_url();
    state
        .proxy
        .serve_hls_child(&base_url, &method, &token, &encoded, &headers)
        .await
}

async fn handle_subtitle(
    State(state): State<ServiceState>,
    Path(token): Path<String>,
) -> Response {
    state.proxy.serve_subtitle(&token).await
}

async fn handle_torrent_stream(
    State(state): State<ServiceState>,
    method: Method,
    Path((token, _rest)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    state.torrents.serve_torrent(&method, &token, &headers).await
}

async fn handle_download_stream(
    State(state): State<ServiceState>,
    method: Method,
    Path((id, _rest)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    state.downloads.serve_download(&method, &id, &headers).await
}

async fn handle_local_stream(
    State(state): State<ServiceState>,
    method: Method,
    Path((token, _rest)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    state.local_media.serve_file(&method, &token, &headers).await
}

async fn handle_local_sub(
    State(state): State<ServiceState>,
    Path(token): Path<String>,
) -> Response {
    state.local_media.serve_subtitle(&token).await
}

async fn handle_compat_stream(
    State(state): State<ServiceState>,
    Path(token_mp4): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let token = token_mp4.strip_suffix(".mp4").unwrap_or(&token_mp4);
    let start = q
        .get("start")
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v >= 0.0)
        .unwrap_or(0.0);
    let audio = q
        .get("audio")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    let mode = q.get("mode").map(|s| s.as_str()).unwrap_or("copy");
    state.transcode.serve_compat(token, start, audio, mode).await
}

async fn handle_compat_sub(
    State(state): State<ServiceState>,
    Path((token, sub_vtt)): Path<(String, String)>,
) -> Response {
    let idx = sub_vtt
        .strip_suffix(".vtt")
        .unwrap_or(&sub_vtt)
        .parse::<usize>()
        .unwrap_or(0);
    state.transcode.serve_subtitle(&token, idx).await
}

async fn handle_image(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    if !token_ok_with(&state, &headers, &q, true) {
        return unauthorized();
    }
    let w = q
        .get("w")
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    let u = q.get("u").map(|s| s.as_str()).unwrap_or("");
    // Address rules are deliberately relaxed here (posters may come from a
    // LAN addon), but the session token is mandatory: without it any website
    // on the device could turn this into an open proxy via an <img> tag.
    state.images.serve(w, u).await
}

async fn handle_mpv_events(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    if !token_ok(&state, &headers, &q) {
        return unauthorized();
    }
    mpv::sse_stream(&state.mpv).into_response()
}

/// Supports both:
/// - `GET /<method>?k=v` (compatible with Android & `portal.js` queryString, including JSON-encoded arrays/objects)
/// - `POST /<method>` with JSON body (no 64 KB URL limit, used by Electron `service.cjs`)
async fn handle_rpc(
    State(state): State<ServiceState>,
    Path(method): Path<String>,
    headers: HeaderMap,
    Query(query_params): Query<HashMap<String, String>>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if !token_ok(&state, &headers, &query_params) {
        return unauthorized();
    }
    let mut query_params = query_params;
    query_params.remove(TOKEN_PARAM);

    let params: Value = if !body.is_empty() {
        serde_json::from_slice(&body).unwrap_or_else(|_| Value::Object(Map::new()))
    } else {
        decode_query_params(query_params)
    };

    let out = dispatch(&state, &method, &params).await;
    (StatusCode::OK, Json(out)).into_response()
}

/// libmpv opens whatever URL it is given (any protocol, any host). Only http(s) to a
/// NetGuard-approved host, or this service's own stream routes, may be loaded.
async fn check_player_url(
    state: &ServiceState,
    base_url: &str,
    raw: &str,
    allow_lan: bool,
) -> Result<(), String> {
    let parsed = url::Url::parse(raw.trim()).map_err(|_| "Enlace no válido".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Solo se permiten enlaces http(s)".to_string());
    }
    let host = parsed.host_str().unwrap_or("");
    if crate::netguard::classify_str(host) == Some("loopback") {
        let own = parsed.as_str().starts_with(&format!("{base_url}/"))
            && ["/media/", "/hls/", "/t/", "/d/", "/local/", "/compat/"]
                .iter()
                .any(|p| parsed.path().starts_with(p));
        return if own {
            Ok(())
        } else {
            Err(crate::netguard::refusal_message(crate::netguard::IpKind::Loopback).to_string())
        };
    }
    crate::netguard::check_all(&state.dns, host, allow_lan)
        .await
        .map(|_| ())
}

fn decode_query_params(raw: HashMap<String, String>) -> Value {
    let mut map = Map::new();
    for (k, v) in raw {
        let trimmed = v.trim();
        let parsed = if (trimmed.starts_with('{') && trimmed.ends_with('}'))
            || (trimmed.starts_with('[') && trimmed.ends_with(']'))
        {
            serde_json::from_str::<Value>(trimmed).unwrap_or(Value::String(v))
        } else if trimmed == "true" {
            Value::Bool(true)
        } else if trimmed == "false" {
            Value::Bool(false)
        } else if !trimmed.is_empty()
            && trimmed.len() < 16
            && trimmed
                .bytes()
                .all(|b| b.is_ascii_digit() || b == b'-' || b == b'.')
        {
            if let Ok(n) = trimmed.parse::<i64>() {
                Value::Number(n.into())
            } else if let Ok(f) = trimmed.parse::<f64>() {
                serde_json::Number::from_f64(f)
                    .map(Value::Number)
                    .unwrap_or(Value::String(v))
            } else {
                Value::String(v)
            }
        } else {
            Value::String(v)
        };
        map.insert(k, parsed);
    }
    Value::Object(map)
}

fn ok(mut payload: Value) -> Value {
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("returnValue".to_string(), Value::Bool(true));
        payload
    } else {
        json!({ "returnValue": true })
    }
}

fn fail(msg: &str) -> Value {
    json!({
        "returnValue": false,
        "errorText": msg,
        "errorCode": 1
    })
}

pub async fn dispatch(state: &ServiceState, method: &str, params: &Value) -> Value {
    let base_url = state.base_url();

    match method {
        "ping" => {
            let space = storage::disk_space(state.torrents.cache_dir());
            let version = state
                .config
                .app_version
                .clone()
                .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
            let mut out = json!({
                "returnValue": true,
                "service": "com.techpoint.opentv.service",
                "version": version,
                "serviceVersion": env!("CARGO_PKG_VERSION"),
                "engine": "rust",
                "platform": state.config.platform,
                "proxyPort": state.bound_port(),
                "relayAvailable": state.transcode.available(),
                "torrents": true,
                "downloads": true,
                "nativePlayer": state.mpv.available(),
                "tmdbAvailable": state.tmdb.available(),
                "storage": {
                    "free": space.free,
                    "total": space.total
                }
            });
            if let Some(vc) = state.config.version_code {
                out["versionCode"] = json!(vc);
            }
            if let Some(ref media) = state.config.media_caps {
                out["media"] = media.clone();
            }
            out
        }

        "keepAlive" => json!({
            "returnValue": true,
            "subscribed": false
        }),

        "heartbeat" => {
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            json!({
                "returnValue": true,
                "alive": true,
                "proxyPort": state.bound_port(),
                "timestamp": ts
            })
        }

        "tmdb" => {
            let list_name = params["list"].as_str().unwrap_or("");
            let res = state.tmdb.list(list_name).await;
            if let Some(err) = res["error"].as_str() {
                return json!({
                    "returnValue": false,
                    "errorText": err,
                    "unavailable": res["unavailable"].as_bool().unwrap_or(false)
                });
            }
            ok(res)
        }

        "fetchM3u" => {
            let url = params["url"].as_str().unwrap_or("");
            let allow_lan = params["allowLan"].as_bool().unwrap_or(false);
            match m3u::fetch_m3u(&state.dns, url, allow_lan).await {
                Ok(channels) => ok(json!({ "channels": channels })),
                Err(e) => fail(&e),
            }
        }

        "epg" => {
            let url = params["url"].as_str().unwrap_or("");
            let ids: Vec<String> = params["ids"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let allow_lan = params["allowLan"].as_bool().unwrap_or(false)
                || params["allowLan"].as_str() == Some("true");
            match state.epg.get(url, &ids, allow_lan).await {
                Ok(programmes) => ok(json!({ "programmes": programmes })),
                Err(e) => fail(&e),
            }
        }

        "epgSchedule" => {
            let url = params["url"].as_str().unwrap_or("");
            let id = params["id"].as_str().unwrap_or("");
            let allow_lan = params["allowLan"].as_bool().unwrap_or(false)
                || params["allowLan"].as_str() == Some("true");
            match state.epg.schedule(url, id, allow_lan).await {
                Ok(programmes) => ok(json!({ "programmes": programmes })),
                Err(e) => fail(&e),
            }
        }

        "resolveLive" => {
            let stream_url = params["streamUrl"].as_str().unwrap_or("");
            if stream_url.is_empty() {
                return fail("El canal no tiene enlace");
            }
            ok(json!({
                "url": stream_url,
                "proxyPath": stream_url,
                "isHls": true
            }))
        }

        "resolveExternal" => {
            match resolve::resolve_external(&state.dns, &state.proxy, &base_url, params).await {
                Ok(out) => ok(out),
                Err(e) => fail(&e),
            }
        }

        "videoHash" => {
            let url = params["url"].as_str().unwrap_or("");
            let mut headers = HashMap::new();
            if let Some(obj) = params["headers"].as_object() {
                for (k, v) in obj {
                    if let Some(s) = v.as_str() {
                        headers.insert(k.clone(), s.to_string());
                    }
                }
            }
            let allow_lan = params["allowLan"].as_bool().unwrap_or(false)
                || params["allowLan"].as_str() == Some("true");
            match state.video_hash.hash_url(url, &headers, allow_lan).await {
                Ok(info) => ok(serde_json::to_value(info).unwrap_or_default()),
                Err(e) => fail(&e),
            }
        }

        "proxySubtitles" => {
            let list = params["subtitles"].as_array().cloned().unwrap_or_default();
            let allow_lan = params["allowLan"].as_bool().unwrap_or(false)
                || params["allowLan"].as_str() == Some("true");
            let mut out = Vec::new();
            // The output stays index-aligned with the input (callers map by
            // position), so a refused entry becomes `url: null` instead of
            // being dropped and shifting every following subtitle.
            for item in list.into_iter().take(60) {
                let u = item["url"].as_str().unwrap_or("");
                let lang = item["lang"].as_str().unwrap_or("");
                if !(u.starts_with("http://") || u.starts_with("https://")) {
                    out.push(json!({ "lang": lang, "url": null }));
                    continue;
                }
                // NetGuard refuses loopback/LAN hosts before a token exists.
                let Ok(token) = state.proxy.add_subtitle(u.to_string(), allow_lan).await else {
                    out.push(json!({ "lang": lang, "url": null }));
                    continue;
                };
                out.push(json!({
                    "lang": lang,
                    "format": "srt",
                    "url": format!("{base_url}/sub/{token}")
                }));
            }
            ok(json!({ "subtitles": out }))
        }

        "subtitleCat" => {
            let subs = state.subtitlecat.search(params).await;
            ok(json!({ "subtitles": subs }))
        }

        "resolveShortCode" => {
            let code = params["code"].as_str().unwrap_or("");
            match plugin_fetch::resolve_short_code(&state.dns, code).await {
                Ok(url) => ok(json!({ "url": url })),
                Err(e) => fail(&e),
            }
        }

        "pluginFetch" => {
            let res = plugin_fetch::plugin_fetch(&state.dns, params).await;
            ok(res)
        }

        "netguardCheck" => {
            let host = params["host"].as_str().unwrap_or("");
            let allow_lan = params["allowLan"].as_bool().unwrap_or(false);
            match crate::netguard::check(&state.dns, host, allow_lan).await {
                Ok(ip) => ok(json!({ "allowed": true, "ip": ip.to_string() })),
                Err(reason) => ok(json!({ "allowed": false, "error": reason })),
            }
        }

        "abortMedia" => {
            let except = params["exceptToken"].as_str().filter(|s| !s.is_empty());
            state.proxy.abort_all(except).await;
            state.transcode.stop().await;
            ok(json!({}))
        }

        // Desktop Hybrid FFmpeg Compatibility Engine (remux / GPU HW transcode / multi-audio / embedded subs)
        "mediaProbe" => {
            let url = params["url"].as_str().unwrap_or("");
            let mut headers = HashMap::new();
            if let Some(obj) = params["headers"].as_object() {
                for (k, v) in obj {
                    if let Some(s) = v.as_str() {
                        headers.insert(k.clone(), s.to_string());
                    }
                }
            }
            let allow_lan = params["allowLan"].as_bool().unwrap_or(false);
            match state.transcode.probe(&base_url, url, &headers, allow_lan).await {
                Ok(res) => ok(res),
                Err(e) => fail(&e),
            }
        }
        "compatStart" => {
            let url = params["url"].as_str().unwrap_or("");
            let mut headers = HashMap::new();
            if let Some(obj) = params["headers"].as_object() {
                for (k, v) in obj {
                    if let Some(s) = v.as_str() {
                        headers.insert(k.clone(), s.to_string());
                    }
                }
            }
            let hevc = params["hevc"].as_bool().unwrap_or(false);
            let audio = params["audio"].as_u64().unwrap_or(0) as usize;
            let mode = params["mode"].as_str().unwrap_or("copy");
            let allow_lan = params["allowLan"].as_bool().unwrap_or(false);
            match state
                .transcode
                .start_session(&base_url, url, headers, allow_lan, hevc, audio, mode)
                .await
            {
                Ok(res) => ok(res),
                Err(e) => fail(&e),
            }
        }
        "compatStop" => {
            state.transcode.stop().await;
            ok(json!({}))
        }

        // Unified Rust Torrent Engine (PC + Android/TV)
        "torrentStart" => match state.torrents.start(&base_url, params).await {
            Ok(out) => ok(out),
            Err(e) => fail(&e),
        },
        "torrentProbe" => ok(state.torrents.probe(params).await),
        "torrentStats" => ok(state.torrents.stats().await),
        "torrentStop" => {
            state.torrents.stop().await;
            ok(json!({}))
        }

        // Unified Rust Downloads Manager (Direct + HLS without FFmpeg + Torrents)
        "downloadStart" => match state.downloads.start(params).await {
            Ok(out) => {
                if let Some(ref hook) = state.config.download_start_hook {
                    hook();
                }
                ok(out)
            }
            Err(e) => fail(&e),
        },
        "downloadList" => ok(state.downloads.list().await),
        "downloadSnapshot" => {
            let drain = params["drain"].as_bool().unwrap_or(false);
            ok(state.downloads.snapshot(drain).await)
        }
        "downloadAction" => {
            let id = params["id"].as_str().unwrap_or("");
            let action = params["action"].as_str().unwrap_or("");
            match state.downloads.action(id, action).await {
                Ok(out) => ok(out),
                Err(e) => fail(&e),
            }
        }
        "downloadOpen" => {
            let id = params["id"].as_str().unwrap_or("");
            match state.downloads.open(&base_url, id).await {
                Ok(out) => ok(out),
                Err(e) => fail(&e),
            }
        }

        // Local media files & user-selected folders (PC / USB)
        "localRegister" => {
            let path = params["path"].as_str().unwrap_or("");
            match state.local_media.register(&base_url, path).await {
                Ok(out) => ok(out),
                Err(e) => fail(&e),
            }
        }
        "localScanFolder" => {
            let dir = params["dir"].as_str().unwrap_or("");
            match state.local_media.scan_folder(dir).await {
                Ok(out) => ok(out),
                Err(e) => fail(&e),
            }
        }

        // Android APK Updater (check + download in Rust; install delegates to OS hook)
        "appUpdate" => match state.app_updater.handle(params).await {
            Ok(res) => {
                if res.get("returnValue").is_some() {
                    res
                } else {
                    ok(res)
                }
            }
            Err(e) => fail(&e),
        },

        // Windows libmpv Native Player controls
        "mpvAttach" | "mpvLoad" | "mpvPlay" | "mpvPause" | "mpvSeek" | "mpvSetVolume"
        | "mpvSetRate" | "mpvSelectAudio" | "mpvSelectText" | "mpvSelectQuality" | "mpvStop" => {
            if method == "mpvLoad" {
                let url = params["url"].as_str().unwrap_or("");
                let allow_lan = params["allowLan"].as_bool().unwrap_or(false);
                if let Err(e) = check_player_url(state, &base_url, url, allow_lan).await {
                    return fail(&e);
                }
            }
            match state.mpv.handle(method, params) {
                Ok(out) => ok(out),
                Err(e) => fail(&e),
            }
        }

        _ => fail("Operación no disponible"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_loopback_host_headers_for_this_port_pass() {
        assert!(host_allowed("127.0.0.1:8910", 8910));
        assert!(host_allowed("LOCALHOST:8910", 8910));
        assert!(!host_allowed("127.0.0.1:8911", 8910));
        assert!(!host_allowed("127.0.0.1", 8910));
        assert!(!host_allowed("evil.example:8910", 8910));
        assert!(!host_allowed("rebind.attacker.example", 8910));
        assert!(!host_allowed("", 8910));
    }

    #[test]
    fn platform_origins_are_trimmed() {
        use crate::config::allowed_origins_for;
        assert!(allowed_origins_for("android").is_empty());
        let desktop = allowed_origins_for("desktop");
        assert!(origin_allowed(&desktop, "http://tauri.localhost"));
        assert!(!origin_allowed(&desktop, "http://localhost"));
        assert!(!origin_allowed(&desktop, "capacitor://localhost"));
        assert!(!origin_allowed(&desktop, "null"));
    }
}
