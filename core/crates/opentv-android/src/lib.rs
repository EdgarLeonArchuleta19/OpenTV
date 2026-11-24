use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use jni::objects::{JClass, JString, JValue};
use jni::sys::{jboolean, jint, jlong, jstring};
use jni::{JNIEnv, JavaVM};
use opentv_core::config::ServiceConfig;
use opentv_core::{start_server_with_state, ServiceState};
use serde_json::json;
use tokio::runtime::{Builder, Runtime};
use tokio::sync::oneshot;

struct RunningService {
    rt: Runtime,
    port: u16,
    state: ServiceState,
    shutdown: Option<oneshot::Sender<()>>,
}

static INSTANCE: Mutex<Option<RunningService>> = Mutex::new(None);

fn opt_jstring(env: &mut JNIEnv, s: &JString) -> Option<String> {
    if s.is_null() {
        return None;
    }
    env.get_string(s)
        .ok()
        .map(|js| js.to_string_lossy().into_owned())
        .filter(|v| !v.is_empty())
}

/// Runs a JNI body and turns a Rust panic into `fallback`: the service lives
/// inside the app process, so a panic crossing into Java would close the app.
fn guarded<T>(fallback: T, body: impl FnOnce() -> T) -> T {
    std::panic::catch_unwind(AssertUnwindSafe(body)).unwrap_or(fallback)
}

/// JNI entrypoint for Android (`com.techpoint.opentv.service.RustServiceBridge`).
/// Uses a lightweight 2-thread Tokio runtime tailored for 1 GB Fire TV Sticks.
#[no_mangle]
pub extern "system" fn Java_com_techpoint_opentv_service_RustServiceBridge_startNative(
    env: JNIEnv,
    class: JClass,
    port: jint,
    auth_token: JString,
    cache_dir: JString,
    downloads_dir: JString,
    tmdb_json: JString,
    version_name: JString,
    version_code: jlong,
    abi: JString,
    media_caps_json: JString,
    low_memory: jboolean,
) -> jint {
    guarded(-4, move || {
        start_native(
            env, class, port, auth_token, cache_dir, downloads_dir, tmdb_json, version_name,
            version_code, abi, media_caps_json, low_memory,
        )
    })
}

#[allow(clippy::too_many_arguments)]
fn start_native(
    mut env: JNIEnv,
    _class: JClass,
    port: jint,
    auth_token: JString,
    cache_dir: JString,
    downloads_dir: JString,
    tmdb_json: JString,
    version_name: JString,
    version_code: jlong,
    abi: JString,
    media_caps_json: JString,
    low_memory: jboolean,
) -> jint {
    let mut guard = match INSTANCE.lock() {
        Ok(g) => g,
        Err(_) => return -1,
    };
    if let Some(ref running) = *guard {
        return running.port as jint;
    }

    // Without a token every app on the device and every website in its
    // browser could call the service: refuse to start rather than run open.
    let Some(token) = opt_jstring(&mut env, &auth_token) else {
        return -5;
    };
    let cache_path = opt_jstring(&mut env, &cache_dir).map(PathBuf::from);
    let downloads_path = opt_jstring(&mut env, &downloads_dir).map(PathBuf::from);
    let tmdb_inline = opt_jstring(&mut env, &tmdb_json);
    let app_version = opt_jstring(&mut env, &version_name);
    let abi_str = opt_jstring(&mut env, &abi);
    let media_caps = opt_jstring(&mut env, &media_caps_json)
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());

    let jvm: Option<Arc<JavaVM>> = env.get_java_vm().ok().map(Arc::new);

    let install_apk_hook = jvm.clone().map(|vm| -> opentv_core::app_update::InstallCallback {
        Arc::new(move |apk_path: &str| {
            let Ok(mut env) = vm.attach_current_thread() else {
                return json!({ "returnValue": false, "errorText": "No se pudo abrir el instalador" });
            };
            let Ok(cls) = env.find_class("com/techpoint/opentv/service/RustServiceBridge") else {
                return json!({ "returnValue": false, "errorText": "Puente Android no encontrado" });
            };
            let Ok(jpath) = env.new_string(apk_path) else {
                return json!({ "returnValue": false, "errorText": "Ruta inválida" });
            };
            let res = env.call_static_method(
                cls,
                "installApkFromRust",
                "(Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(&jpath)],
            );
            match res.and_then(|v| v.l()) {
                Ok(obj) if !obj.is_null() => {
                    let js = JString::from(obj);
                    let raw = env
                        .get_string(&js)
                        .ok()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    serde_json::from_str(&raw).unwrap_or_else(|_| json!({ "state": "installing" }))
                }
                _ => json!({ "returnValue": false, "errorText": "No se pudo lanzar el instalador" }),
            }
        })
    });

    let download_start_hook = jvm.map(|vm| -> opentv_core::config::DownloadNotifyCallback {
        Arc::new(move || {
            if let Ok(mut env) = vm.attach_current_thread() {
                if let Ok(cls) = env.find_class("com/techpoint/opentv/service/RustServiceBridge") {
                    let _ = env.call_static_method(cls, "onDownloadStartedFromRust", "()V", &[]);
                }
            }
        })
    });

    let rt = match Builder::new_multi_thread()
        .worker_threads(2)
        .thread_name("opentv-rs")
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(_) => return -2,
    };

    let cfg = ServiceConfig {
        port: if port > 0 && port <= 65535 {
            port as u16
        } else {
            8910
        },
        auth_token: Some(token),
        allowed_origins: opentv_core::config::default_allowed_origins(),
        tmdb_config_path: None,
        tmdb_inline_json: tmdb_inline,
        platform: "android".to_string(),
        downloads_dir: downloads_path,
        cache_dir: cache_path,
        low_memory: low_memory != 0,
        app_version,
        version_code: if version_code > 0 {
            Some(version_code as i64)
        } else {
            None
        },
        abi: abi_str,
        media_caps,
        mpv_dll_path: None,
        install_apk_hook,
        download_start_hook,
    };

    let res = rt.block_on(async move { start_server_with_state(cfg).await });
    match res {
        Ok((addr, state, tx)) => {
            let bound = addr.port();
            *guard = Some(RunningService {
                rt,
                port: bound,
                state,
                shutdown: Some(tx),
            });
            bound as jint
        }
        Err(_) => -3,
    }
}

/// Direct in-process JNI RPC into `opentv_core::rpc::dispatch` (~0.1 ms, zero loopback HTTP overhead).
/// Releases `INSTANCE` mutex before awaiting so concurrent Kotlin coroutines run in parallel.
#[no_mangle]
pub extern "system" fn Java_com_techpoint_opentv_service_RustServiceBridge_callRpcNative(
    mut env: JNIEnv,
    _class: JClass,
    method: JString,
    params_json: JString,
) -> jstring {
    let method_str = opt_jstring(&mut env, &method).unwrap_or_default();
    let params_str = opt_jstring(&mut env, &params_json).unwrap_or_else(|| "{}".to_string());

    let reply = guarded(
        r#"{"returnValue":false,"errorText":"Error interno del servicio"}"#.to_string(),
        move || {
            let (state, handle) = {
                let Ok(guard) = INSTANCE.lock() else {
                    return r#"{"returnValue":false,"errorText":"Servicio bloqueado"}"#.to_string();
                };
                let Some(ref running) = *guard else {
                    return r#"{"returnValue":false,"errorText":"Servicio no iniciado"}"#.to_string();
                };
                (running.state.clone(), running.rt.handle().clone())
            };
            let params: serde_json::Value =
                serde_json::from_str(&params_str).unwrap_or_else(|_| json!({}));
            let out = handle.block_on(async move {
                opentv_core::rpc::dispatch(&state, &method_str, &params).await
            });
            out.to_string()
        },
    );

    env.new_string(reply)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

/// Stops only the active streaming torrent (leaving background downloads running).
#[no_mangle]
pub extern "system" fn Java_com_techpoint_opentv_service_RustServiceBridge_stopTorrentNative(
    _env: JNIEnv,
    _class: JClass,
) {
    guarded((), || {
        let pair = INSTANCE.lock().ok().and_then(|guard| {
            guard
                .as_ref()
                .map(|r| (r.state.torrents.clone(), r.rt.handle().clone()))
        });
        if let Some((torrents, handle)) = pair {
            handle.block_on(async move {
                torrents.stop().await;
            });
        }
    })
}

/// Synchronous NetGuard check called from Android `BrowserCapturePlugin.shouldInterceptRequest`.
/// Returns `null` when allowed, or a Spanish refusal message when blocked.
#[no_mangle]
pub extern "system" fn Java_com_techpoint_opentv_service_RustServiceBridge_netguardRefusalNative(
    mut env: JNIEnv,
    _class: JClass,
    host: JString,
    allow_lan: jboolean,
) -> jstring {
    let Some(host_str) = opt_jstring(&mut env, &host) else {
        return env
            .new_string("Dirección no permitida")
            .map(|s| s.into_raw())
            .unwrap_or(std::ptr::null_mut());
    };
    let lan = allow_lan != 0;

    // A panic while checking counts as a refusal: never let a request through
    // because the check itself failed.
    let refusal: Option<String> = guarded(Some("Dirección no permitida".to_string()), move || {
        netguard_refusal(&host_str, lan)
    });

    match refusal {
        None => std::ptr::null_mut(),
        Some(msg) => env
            .new_string(msg)
            .map(|s| s.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

fn netguard_refusal(host_str: &str, lan: bool) -> Option<String> {
    let host_str = host_str.to_string();
    let pair = match INSTANCE.lock() {
        Ok(guard) => guard
            .as_ref()
            .map(|r| (r.state.dns.clone(), r.rt.handle().clone())),
        Err(_) => return Some("Servicio no disponible".to_string()),
    };
    if let Some((dns, handle)) = pair {
        handle.block_on(async move {
            match opentv_core::netguard::check(&dns, &host_str, lan).await {
                Ok(_) => None,
                Err(e) => Some(e),
            }
        })
    } else {
        // Service not started yet: fall back to literal IP classification.
        match opentv_core::netguard::classify_str(&host_str) {
            Some("loopback") => Some("Un plugin no puede acceder a este aparato".to_string()),
            Some("lan") if !lan => {
                Some("Activa \"Red de tu casa\" en Configurar del plugin".to_string())
            }
            Some("blocked") => Some("Dirección no permitida".to_string()),
            _ => None,
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_techpoint_opentv_service_RustServiceBridge_stopNative(
    _env: JNIEnv,
    _class: JClass,
) {
    guarded((), || {
        if let Ok(mut guard) = INSTANCE.lock() {
            if let Some(mut running) = guard.take() {
                let torrents = running.state.torrents.clone();
                running.rt.block_on(async move {
                    torrents.stop().await;
                });
                if let Some(tx) = running.shutdown.take() {
                    let _ = tx.send(());
                }
                drop(running.rt);
            }
        }
    })
}
