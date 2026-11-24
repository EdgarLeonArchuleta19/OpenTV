use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opentv_core::netguard;
use opentv_core::ServiceState;
use serde_json::{json, Value};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;
use url::Url;

static CAP_SEQ: AtomicU64 = AtomicU64::new(1);

/// Offscreen WebView2 capture for JS plugins (`kino.browser.capture / load`).
///
/// Security model:
/// - The capture window has NO Tauri capabilities (cannot call `invoke`).
/// - Initial target URL and every navigation hop are checked against `opentv_core::netguard`.
/// - Captured payloads travel out over `on_document_title_changed` in 16 KB chunks,
///   so zero IPC permissions are ever granted to untrusted pages.
pub async fn run_browser_capture(
    app: AppHandle,
    core: ServiceState,
    opts: Value,
) -> Value {
    // Only a fixed set of fields is accepted. In particular, plugin-supplied
    // `script`/`injectJs` is ignored: untrusted code must never run in the
    // capture WebView, even if an old runtime still sends the field.
    if !opts.is_object() {
        return json!({ "ok": false, "error": "Opciones no válidas" });
    }
    let raw_url = opts["url"].as_str().unwrap_or("").trim().to_string();
    let Ok(target) = Url::parse(&raw_url) else {
        return json!({ "ok": false, "error": "URL no válida" });
    };
    if target.scheme() != "http" && target.scheme() != "https" {
        return json!({ "ok": false, "error": "Protocolo no permitido" });
    }
    let allow_lan = opts["allowLan"].as_bool().unwrap_or(false)
        || opts["allowLan"].as_str() == Some("true");

    let host = target.host_str().unwrap_or("");
    if let Err(reason) = netguard::check(&core.dns, host, allow_lan).await {
        return json!({ "ok": false, "error": reason });
    }

    let timeout_ms = opts["timeoutMs"]
        .as_u64()
        .unwrap_or(15_000)
        .clamp(2_000, 25_000);
    let return_html = opts["returnHtml"].as_bool().unwrap_or(false);
    let wait_ms = opts["waitMs"].as_u64().unwrap_or(350).min(5_000);
    // Arbitrary regular expressions from a plugin can freeze the capture WebView
    // (ReDoS). Only well-known, linear patterns are accepted; anything else
    // falls back to the default media-extension detector.
    let match_source = safe_match_source(opts["matchSource"].as_str().unwrap_or(""));
    let match_flags = match opts["matchFlags"].as_str().unwrap_or("") {
        "gi" | "ig" | "g" => "gi",
        _ => "i",
    };
    let custom_ua = opts["headers"]
        .as_object()
        .and_then(|h| {
            h.iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("user-agent"))
                .and_then(|(_, v)| v.as_str())
                .filter(|s| !s.is_empty() && s.len() <= 512 && !s.contains(['\r', '\n', '\0']))
                .map(str::to_string)
        })
        .unwrap_or_else(|| {
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36".to_string()
        });

    let init_js = build_capture_init_script(match_source, match_flags, return_html, wait_ms);

    let label = format!("otv-cap-{}", CAP_SEQ.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = oneshot::channel::<Value>();
    let tx_slot = Arc::new(Mutex::new(Some(tx)));
    let chunks_buf = Arc::new(Mutex::new((0usize, BTreeMap::<usize, String>::new())));

    let dns_nav = core.dns.clone();
    let rt_handle = tokio::runtime::Handle::current();

    let tx_title = tx_slot.clone();
    let chunks_title = chunks_buf.clone();

    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(target))
        .visible(false)
        .incognito(true)
        .inner_size(1280.0, 720.0)
        .skip_taskbar(true)
        .user_agent(&custom_ua)
        .initialization_script(&init_js)
        .on_navigation(move |nav_url| {
            let scheme = nav_url.scheme();
            if scheme == "about" || scheme == "data" || scheme == "blob" {
                return true;
            }
            if scheme != "http" && scheme != "https" {
                return false;
            }
            let h = nav_url.host_str().unwrap_or("").to_string();
            let dns = dns_nav.clone();
            // Run NetGuard synchronously on the tokio runtime without blocking executor threads.
            tokio::task::block_in_place(|| {
                rt_handle.block_on(async move { netguard::check(&dns, &h, allow_lan).await.is_ok() })
            })
        })
        .on_document_title_changed(move |_win, title| {
            // Protocol: "__OTV_C__:<idx>/<total>:<slice>"
            let Some(rest) = title.strip_prefix("__OTV_C__:") else {
                return;
            };
            let Some((meta, payload)) = rest.split_once(':') else {
                return;
            };
            let Some((idx_s, tot_s)) = meta.split_once('/') else {
                return;
            };
            let (Ok(idx), Ok(tot)) = (idx_s.parse::<usize>(), tot_s.parse::<usize>()) else {
                return;
            };
            if tot == 0 || tot > 128 || idx >= tot || payload.len() > 16_384 {
                return;
            }
            let assembled = {
                let Ok(mut guard) = chunks_title.lock() else {
                    return;
                };
                if guard.0 != tot {
                    guard.0 = tot;
                    guard.1.clear();
                }
                guard.1.insert(idx, payload.to_string());
                if guard.1.len() == tot {
                    let mut full = String::new();
                    for i in 0..tot {
                        if let Some(part) = guard.1.get(&i) {
                            full.push_str(part);
                        }
                    }
                    guard.1.clear();
                    (full.len() <= 256_000).then_some(full)
                } else {
                    None
                }
            };
            if let Some(json_str) = assembled {
                if let Ok(Value::Object(mut obj)) = serde_json::from_str::<Value>(&json_str) {
                    // A page can set `document.title` itself: only accept the
                    // exact shape our init script emits, and strip cookies.
                    obj.remove("cookies");
                    let ok = obj.get("ok").and_then(Value::as_bool).unwrap_or(false);
                    let url = obj.get("url").and_then(Value::as_str).unwrap_or("");
                    let url_ok = url.starts_with("http://") || url.starts_with("https://");
                    let html_ok = return_html && obj.contains_key("html");
                    if ok && url_ok && (html_ok || obj.contains_key("headers")) {
                        if let Some(headers) = obj.get_mut("headers").and_then(Value::as_object_mut) {
                            headers.retain(|k, v| {
                                k.len() <= 64
                                    && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                                    && v.as_str().map(|s| s.len() <= 2048).unwrap_or(false)
                            });
                        }
                        if let Ok(mut sender) = tx_title.lock() {
                            if let Some(ch) = sender.take() {
                                let _ = ch.send(Value::Object(obj));
                            }
                        }
                    }
                }
            }
        });

    #[cfg(target_os = "windows")]
    {
        builder = builder.additional_browser_args("--mute-audio");
    }

    let cap_win = match builder.build() {
        Ok(w) => w,
        Err(e) => return json!({ "ok": false, "error": format!("No se pudo abrir captura: {e}") }),
    };

    let result = match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
        Ok(Ok(val)) => val,
        _ => json!({ "ok": false, "error": "Tiempo agotado esperando el vídeo" }),
    };

    let _ = cap_win.destroy();
    result
}

/// Only linear, well-known patterns are allowed from an untrusted plugin.
fn safe_match_source(raw: &str) -> &'static str {
    const DEFAULT: &str = r"\.(m3u8|mp4|mpd)(\?|$)";
    match raw.trim() {
        "" | DEFAULT => DEFAULT,
        r"\.m3u8" | r"\.m3u8(\?|$)" => r"\.m3u8(\?|$)",
        r"\.mp4" | r"\.mp4(\?|$)" => r"\.mp4(\?|$)",
        r"\.(mp4|m4v|mkv|webm)(\?|$)" => r"\.(mp4|m4v|mkv|webm)(\?|$)",
        r"\.(m3u8|mp4|mpd|mkv|webm|ts)(\?|$)" => r"\.(m3u8|mp4|mpd|mkv|webm|ts)(\?|$)",
        _ => DEFAULT,
    }
}

fn build_capture_init_script(
    match_source: &str,
    match_flags: &str,
    return_html: bool,
    wait_ms: u64,
) -> String {
    let ms_json = serde_json::to_string(match_source).unwrap_or_else(|_| "\"\"".into());
    let mf_json = serde_json::to_string(match_flags).unwrap_or_else(|_| "\"i\"".into());
    format!(
        r#"(function(){{
  if (window.__otvCapInstalled) return;
  window.__otvCapInstalled = true;
  var sent = false;
  var returnHtml = {return_html};
  var waitMs = {wait_ms};
  var re;
  try {{ re = new RegExp({ms_json}, {mf_json}); }} catch (e) {{ re = /\.(m3u8|mp4|mpd)(\?|$)/i; }}

  function emit(obj) {{
    if (sent) return;
    sent = true;
    try {{
      var raw = JSON.stringify(obj);
      var chunkSize = 12000;
      var total = Math.max(1, Math.ceil(raw.length / chunkSize));
      var i = 0;
      function next() {{
        if (i >= total) return;
        document.title = '__OTV_C__:' + i + '/' + total + ':' + raw.slice(i * chunkSize, (i + 1) * chunkSize);
        i++;
        if (i < total) setTimeout(next, 12);
      }}
      next();
    }} catch (e) {{}}
  }}

  function checkUrl(u, hdrs) {{
    if (sent || returnHtml || !u) return;
    var s = String(u);
    if (!/^https?:\/\//i.test(s)) {{
      try {{ s = new URL(s, location.href).href; }} catch (e) {{ return; }}
    }}
    if (re.test(s)) {{
      var outH = Object.assign({{ Referer: location.href, 'User-Agent': navigator.userAgent }}, hdrs || {{}});
      emit({{ ok: true, url: s, headers: outH, media: [{{ url: s, headers: outH }}] }});
    }}
  }}

  if (!returnHtml) {{
    try {{
      var origFetch = window.fetch;
      window.fetch = function(input, init) {{
        try {{
          var u = typeof input === 'string' ? input : (input && input.url);
          checkUrl(u, init && init.headers);
        }} catch (e) {{}}
        return origFetch.apply(this, arguments);
      }};
    }} catch (e) {{}}

    try {{
      var origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(m, u) {{
        try {{ checkUrl(u); }} catch (e) {{}}
        return origOpen.apply(this, arguments);
      }};
    }} catch (e) {{}}

    try {{
      var po = new PerformanceObserver(function(list) {{
        list.getEntries().forEach(function(e) {{ checkUrl(e && e.name); }});
      }});
      po.observe({{ type: 'resource', buffered: true }});
    }} catch (e) {{}}

    setInterval(function() {{
      if (sent) return;
      try {{
        var vids = document.querySelectorAll('video, source');
        for (var i = 0; i < vids.length; i++) {{
          checkUrl(vids[i].currentSrc || vids[i].src || vids[i].getAttribute('src'));
        }}
      }} catch (e) {{}}
    }}, 400);
  }}

  window.addEventListener('load', function() {{
    if (returnHtml) {{
      setTimeout(function() {{
        var html = document.documentElement ? document.documentElement.outerHTML : '';
        emit({{ ok: true, url: location.href, html: html, headers: {{}}, media: [] }});
      }}, waitMs);
    }}
  }});
}})();"#,
        return_html = if return_html { "true" } else { "false" },
        wait_ms = wait_ms,
        ms_json = ms_json,
        mf_json = mf_json,
    )
}
