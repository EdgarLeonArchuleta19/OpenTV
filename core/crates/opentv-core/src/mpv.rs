use std::path::PathBuf;

use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream::Stream;
use serde_json::Value;

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use serde_json::json;
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int, c_void};
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::{Duration, Instant};

    use libloading::Library;
    use tokio::sync::broadcast;

    const MPV_EVENT_NONE: c_int = 0;
    const MPV_EVENT_SHUTDOWN: c_int = 1;
    const MPV_EVENT_END_FILE: c_int = 7;
    const MPV_EVENT_FILE_LOADED: c_int = 8;
    const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
    const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

    const MPV_FORMAT_NONE: c_int = 0;

    #[repr(C)]
    struct MpvEvent {
        event_id: c_int,
        error: c_int,
        reply_userdata: u64,
        data: *mut c_void,
    }

    #[repr(C)]
    struct MpvEventEndFile {
        reason: c_int,
        error: c_int,
    }

    const MPV_END_FILE_REASON_EOF: c_int = 0;
    const MPV_END_FILE_REASON_STOP: c_int = 2;
    const MPV_END_FILE_REASON_ERROR: c_int = 4;

    type FnCreate = unsafe extern "C" fn() -> *mut c_void;
    type FnInit = unsafe extern "C" fn(*mut c_void) -> c_int;
    type FnSetOpt = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int;
    type FnSetProp = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int;
    type FnGetProp = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_char;
    type FnCommand = unsafe extern "C" fn(*mut c_void, *const *const c_char) -> c_int;
    type FnWaitEvent = unsafe extern "C" fn(*mut c_void, f64) -> *const MpvEvent;
    type FnFree = unsafe extern "C" fn(*mut c_void);
    type FnDestroy = unsafe extern "C" fn(*mut c_void);
    type FnObserve = unsafe extern "C" fn(*mut c_void, u64, *const c_char, c_int) -> c_int;

    struct MpvApi {
        _lib: Library,
        create: FnCreate,
        initialize: FnInit,
        set_option_string: FnSetOpt,
        set_property_string: FnSetProp,
        get_property_string: FnGetProp,
        command: FnCommand,
        wait_event: FnWaitEvent,
        free: FnFree,
        terminate_destroy: FnDestroy,
        observe_property: FnObserve,
    }

    impl MpvApi {
        unsafe fn load(path: &Path) -> Result<Self, String> {
            let lib = Library::new(path).map_err(|e| format!("No se pudo cargar libmpv: {e}"))?;
            let create = *lib
                .get::<FnCreate>(b"mpv_create\0")
                .map_err(|e| e.to_string())?;
            let initialize = *lib
                .get::<FnInit>(b"mpv_initialize\0")
                .map_err(|e| e.to_string())?;
            let set_option_string = *lib
                .get::<FnSetOpt>(b"mpv_set_option_string\0")
                .map_err(|e| e.to_string())?;
            let set_property_string = *lib
                .get::<FnSetProp>(b"mpv_set_property_string\0")
                .map_err(|e| e.to_string())?;
            let get_property_string = *lib
                .get::<FnGetProp>(b"mpv_get_property_string\0")
                .map_err(|e| e.to_string())?;
            let command = *lib
                .get::<FnCommand>(b"mpv_command\0")
                .map_err(|e| e.to_string())?;
            let wait_event = *lib
                .get::<FnWaitEvent>(b"mpv_wait_event\0")
                .map_err(|e| e.to_string())?;
            let free = *lib
                .get::<FnFree>(b"mpv_free\0")
                .map_err(|e| e.to_string())?;
            let terminate_destroy = *lib
                .get::<FnDestroy>(b"mpv_terminate_destroy\0")
                .map_err(|e| e.to_string())?;
            let observe_property = *lib
                .get::<FnObserve>(b"mpv_observe_property\0")
                .map_err(|e| e.to_string())?;
            Ok(Self {
                _lib: lib,
                create,
                initialize,
                set_option_string,
                set_property_string,
                get_property_string,
                command,
                wait_event,
                free,
                terminate_destroy,
                observe_property,
            })
        }

        fn set_opt(&self, ctx: *mut c_void, name: &str, val: &str) {
            if let (Ok(k), Ok(v)) = (CString::new(name), CString::new(val)) {
                unsafe {
                    (self.set_option_string)(ctx, k.as_ptr(), v.as_ptr());
                }
            }
        }

        fn set_prop(&self, ctx: *mut c_void, name: &str, val: &str) {
            if let (Ok(k), Ok(v)) = (CString::new(name), CString::new(val)) {
                unsafe {
                    (self.set_property_string)(ctx, k.as_ptr(), v.as_ptr());
                }
            }
        }

        fn get_prop(&self, ctx: *mut c_void, name: &str) -> Option<String> {
            let k = CString::new(name).ok()?;
            let ptr = unsafe { (self.get_property_string)(ctx, k.as_ptr()) };
            if ptr.is_null() {
                return None;
            }
            let s = unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() };
            unsafe {
                (self.free)(ptr as *mut c_void);
            }
            Some(s)
        }

        fn cmd(&self, ctx: *mut c_void, args: &[&str]) -> c_int {
            let cstrings: Vec<CString> = args
                .iter()
                .filter_map(|a| CString::new(*a).ok())
                .collect();
            let mut ptrs: Vec<*const c_char> = cstrings.iter().map(|c| c.as_ptr()).collect();
            ptrs.push(std::ptr::null());
            unsafe { (self.command)(ctx, ptrs.as_ptr()) }
        }

        fn observe(&self, ctx: *mut c_void, id: u64, name: &str) {
            if let Ok(k) = CString::new(name) {
                unsafe {
                    (self.observe_property)(ctx, id, k.as_ptr(), MPV_FORMAT_NONE);
                }
            }
        }
    }

    enum MpvCmd {
        Attach {
            wid: i64,
        },
        Load {
            url: String,
            start: f64,
            autoplay: bool,
            live: bool,
            gen: u64,
        },
        Play,
        Pause,
        Seek {
            t: f64,
            s: u64,
        },
        SetVolume {
            v: f64,
            m: bool,
        },
        SetRate {
            r: f64,
        },
        SelectAudio {
            index: usize,
        },
        SelectText {
            index: i64,
        },
        SelectQuality {
            height: i64,
        },
        Stop,
    }

    #[derive(Clone)]
    pub struct MpvController {
        dll_path: Option<PathBuf>,
        ready: Arc<AtomicBool>,
        tx: Arc<Mutex<Option<mpsc::Sender<MpvCmd>>>>,
        events: broadcast::Sender<Value>,
    }

    fn locate_dll(override_path: Option<PathBuf>) -> Option<PathBuf> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(p) = override_path {
            candidates.push(p);
        }
        // Only the app's own folders (DLL planting): next to the executable and its
        // bundled `resources/bin`; debug builds also accept the repository dev layout.
        // Never the current directory or PATH.
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                for name in ["mpv-2.dll", "libmpv-2.dll"] {
                    candidates.push(dir.join(name));
                    candidates.push(dir.join("resources").join("bin").join(name));
                }
                #[cfg(debug_assertions)]
                for anc in dir.ancestors().take(7) {
                    for name in ["mpv-2.dll", "libmpv-2.dll"] {
                        candidates.push(
                            anc.join("apps")
                                .join("desktop")
                                .join("src-tauri")
                                .join("resources")
                                .join("bin")
                                .join(name),
                        );
                    }
                }
            }
        }
        candidates
            .into_iter()
            .find(|p| p.is_absolute() && p.is_file())
    }

    impl MpvController {
        pub fn new(override_path: Option<PathBuf>) -> Self {
            let dll_path = locate_dll(override_path);
            let available = dll_path.is_some();
            let (events, _) = broadcast::channel(128);
            Self {
                dll_path,
                ready: Arc::new(AtomicBool::new(available)),
                tx: Arc::new(Mutex::new(None)),
                events,
            }
        }

        pub fn available(&self) -> bool {
            self.ready.load(Ordering::Relaxed)
        }

        pub fn dll_path_str(&self) -> String {
            self.dll_path
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default()
        }

        pub fn subscribe(&self) -> broadcast::Receiver<Value> {
            self.events.subscribe()
        }

        fn ensure_worker(&self) -> Result<mpsc::Sender<MpvCmd>, String> {
            let mut guard = self.tx.lock().map_err(|_| "lock poisoned".to_string())?;
            if let Some(ref s) = *guard {
                return Ok(s.clone());
            }
            let Some(ref path) = self.dll_path else {
                return Err("libmpv (mpv-2.dll) no encontrado".to_string());
            };
            let path = path.clone();
            let events = self.events.clone();
            let ready_flag = self.ready.clone();
            let (cmd_tx, cmd_rx) = mpsc::channel::<MpvCmd>();

            std::thread::Builder::new()
                .name("opentv-mpv".to_string())
                .spawn(move || {
                    run_mpv_thread(path, cmd_rx, events, ready_flag);
                })
                .map_err(|e| e.to_string())?;

            *guard = Some(cmd_tx.clone());
            Ok(cmd_tx)
        }

        pub fn handle(&self, method: &str, p: &Value) -> Result<Value, String> {
            let cmd = match method {
                "mpvAttach" => {
                    let wid = p["wid"].as_i64().unwrap_or(0);
                    MpvCmd::Attach { wid }
                }
                "mpvLoad" => MpvCmd::Load {
                    url: p["url"].as_str().unwrap_or("").to_string(),
                    start: p["start"].as_f64().unwrap_or(0.0),
                    autoplay: p["autoplay"].as_bool().unwrap_or(false),
                    live: p["live"].as_bool().unwrap_or(false),
                    gen: p["g"].as_u64().unwrap_or(0),
                },
                "mpvPlay" => MpvCmd::Play,
                "mpvPause" => MpvCmd::Pause,
                "mpvSeek" => MpvCmd::Seek {
                    t: p["t"].as_f64().unwrap_or(0.0),
                    s: p["s"].as_u64().unwrap_or(0),
                },
                "mpvSetVolume" => MpvCmd::SetVolume {
                    v: p["v"].as_f64().unwrap_or(1.0),
                    m: p["m"].as_bool().unwrap_or(false),
                },
                "mpvSetRate" => MpvCmd::SetRate {
                    r: p["r"].as_f64().unwrap_or(1.0),
                },
                "mpvSelectAudio" => MpvCmd::SelectAudio {
                    index: p["i"].as_u64().unwrap_or(0) as usize,
                },
                "mpvSelectText" => MpvCmd::SelectText {
                    index: p["i"].as_i64().unwrap_or(-1),
                },
                "mpvSelectQuality" => MpvCmd::SelectQuality {
                    height: p["h"].as_i64().unwrap_or(0),
                },
                "mpvStop" => MpvCmd::Stop,
                _ => return Err("Comando mpv desconocido".to_string()),
            };

            let tx = self.ensure_worker()?;
            tx.send(cmd)
                .map_err(|_| "El motor libmpv no está respondiendo".to_string())?;
            Ok(json!({ "ok": true }))
        }
    }

    fn run_mpv_thread(
        dll_path: PathBuf,
        rx: mpsc::Receiver<MpvCmd>,
        events: broadcast::Sender<Value>,
        ready_flag: Arc<AtomicBool>,
    ) {
        let api = match unsafe { MpvApi::load(&dll_path) } {
            Ok(a) => a,
            Err(e) => {
                eprintln!("[mpv] {e}");
                ready_flag.store(false, Ordering::Relaxed);
                return;
            }
        };

        let mut ctx: *mut c_void = std::ptr::null_mut();
        let mut current_wid: i64 = 0;
        let mut current_gen: u64 = 0;
        let mut seek_seq: u64 = 0;
        let mut is_live = false;
        let mut active = false;
        let mut last_cue = String::new();
        let mut audio_ids: Vec<i64> = Vec::new();
        let mut text_ids: Vec<i64> = Vec::new();
        let mut last_time_emit = Instant::now();

        let init_ctx = |wid: i64| -> *mut c_void {
            let c = unsafe { (api.create)() };
            if c.is_null() {
                return std::ptr::null_mut();
            }
            if wid != 0 {
                api.set_opt(c, "wid", &wid.to_string());
            }
            api.set_opt(c, "vo", "gpu");
            api.set_opt(c, "gpu-api", "d3d11");
            api.set_opt(c, "hwdec", "auto-safe");
            api.set_opt(c, "tls-verify", "yes");
            api.set_opt(
                c,
                "user-agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
            );
            api.set_opt(c, "keep-open", "yes");
            api.set_opt(c, "idle", "yes");
            api.set_opt(c, "ytdl", "no");
            api.set_opt(c, "sub-auto", "no");
            api.set_opt(c, "sub-visibility", "no"); // App draws subtitles cleanly in its own DOM overlay.
            api.set_opt(c, "osd-level", "0");
            api.set_opt(c, "cache", "yes");
            api.set_opt(c, "demuxer-max-bytes", "64MiB");
            api.set_opt(c, "demuxer-max-back-bytes", "16MiB");
            api.set_opt(c, "network-timeout", "20");
            let rc = unsafe { (api.initialize)(c) };
            if rc < 0 {
                eprintln!("[mpv] mpv_initialize failed rc={rc}");
                unsafe { (api.terminate_destroy)(c) };
                return std::ptr::null_mut();
            }
            api.observe(c, 1, "pause");
            api.observe(c, 2, "paused-for-cache");
            api.observe(c, 3, "eof-reached");
            api.observe(c, 4, "track-list");
            api.observe(c, 5, "sub-text");
            api.observe(c, 6, "video-params/w");
            api.observe(c, 7, "video-params/h");
            c
        };

        loop {
            // Drain pending commands.
            loop {
                match rx.try_recv() {
                    Ok(cmd) => match cmd {
                        MpvCmd::Attach { wid } => {
                            if wid != 0 && wid != current_wid {
                                current_wid = wid;
                                if !ctx.is_null() {
                                    unsafe { (api.terminate_destroy)(ctx) };
                                }
                                ctx = init_ctx(current_wid);
                            }
                        }
                        MpvCmd::Load {
                            url,
                            start,
                            autoplay,
                            live,
                            gen,
                        } => {
                            if ctx.is_null() {
                                ctx = init_ctx(current_wid);
                            }
                            if ctx.is_null() {
                                let _ = events.send(json!({
                                    "t": "error", "g": gen, "code": 4,
                                    "name": "mpv", "msg": "No se pudo iniciar libmpv"
                                }));
                                continue;
                            }
                            current_gen = gen;
                            seek_seq = 0;
                            is_live = live;
                            active = true;
                            last_cue.clear();
                            api.set_prop(ctx, "pause", if autoplay { "no" } else { "yes" });
                            if start > 0.5 {
                                api.set_prop(ctx, "start", &format!("{start:.2}"));
                            } else {
                                api.set_prop(ctx, "start", "none");
                            }
                            api.cmd(ctx, &["loadfile", &url, "replace"]);
                            let _ = events.send(json!({
                                "t": "state", "g": current_gen, "st": 2, "pl": false
                            }));
                        }
                        MpvCmd::Play => {
                            if !ctx.is_null() {
                                api.set_prop(ctx, "pause", "no");
                            }
                        }
                        MpvCmd::Pause => {
                            if !ctx.is_null() {
                                api.set_prop(ctx, "pause", "yes");
                            }
                        }
                        MpvCmd::Seek { t, s } => {
                            seek_seq = s;
                            if !ctx.is_null() {
                                api.cmd(ctx, &["seek", &format!("{t:.3}"), "absolute"]);
                            }
                        }
                        MpvCmd::SetVolume { v, m } => {
                            if !ctx.is_null() {
                                let pct = (v.clamp(0.0, 1.0) * 100.0).round();
                                api.set_prop(ctx, "volume", &format!("{pct:.0}"));
                                api.set_prop(ctx, "mute", if m { "yes" } else { "no" });
                            }
                        }
                        MpvCmd::SetRate { r } => {
                            if !ctx.is_null() {
                                let clamped = r.clamp(0.25, 4.0);
                                api.set_prop(ctx, "speed", &format!("{clamped:.2}"));
                            }
                        }
                        MpvCmd::SelectAudio { index } => {
                            if !ctx.is_null() {
                                if let Some(&aid) = audio_ids.get(index) {
                                    api.set_prop(ctx, "aid", &aid.to_string());
                                }
                            }
                        }
                        MpvCmd::SelectText { index } => {
                            if !ctx.is_null() {
                                if index < 0 {
                                    api.set_prop(ctx, "sid", "no");
                                } else if let Some(&sid) = text_ids.get(index as usize) {
                                    api.set_prop(ctx, "sid", &sid.to_string());
                                }
                            }
                        }
                        MpvCmd::SelectQuality { height } => {
                            if !ctx.is_null() {
                                if height <= 0 {
                                    api.set_prop(ctx, "vid", "auto");
                                } else if let Some(raw) = api.get_prop(ctx, "track-list") {
                                    if let Ok(list) = serde_json::from_str::<Vec<Value>>(&raw) {
                                        let mut best_id: Option<i64> = None;
                                        let mut best_h: i64 = 0;
                                        for tr in list {
                                            if tr["type"].as_str() == Some("video") {
                                                let h = tr["demux-h"].as_i64().unwrap_or(0);
                                                let id = tr["id"].as_i64().unwrap_or(0);
                                                if h > 0 && h <= height && h > best_h {
                                                    best_h = h;
                                                    best_id = Some(id);
                                                }
                                            }
                                        }
                                        if let Some(vid) = best_id {
                                            api.set_prop(ctx, "vid", &vid.to_string());
                                        }
                                    }
                                }
                            }
                        }
                        MpvCmd::Stop => {
                            active = false;
                            if !ctx.is_null() {
                                api.cmd(ctx, &["stop"]);
                            }
                        }
                    },
                    Err(mpsc::TryRecvError::Empty) => break,
                    Err(mpsc::TryRecvError::Disconnected) => {
                        if !ctx.is_null() {
                            unsafe { (api.terminate_destroy)(ctx) };
                        }
                        return;
                    }
                }
            }

            if ctx.is_null() {
                std::thread::sleep(Duration::from_millis(50));
                continue;
            }

            let ev_ptr = unsafe { (api.wait_event)(ctx, 0.05) };
            if !ev_ptr.is_null() {
                let ev = unsafe { &*ev_ptr };
                match ev.event_id {
                    MPV_EVENT_SHUTDOWN => break,
                    MPV_EVENT_FILE_LOADED if active => {
                        emit_tracks(&api, ctx, current_gen, &mut audio_ids, &mut text_ids, &events);
                        emit_size(&api, ctx, current_gen, &events);
                        let paused = api.get_prop(ctx, "pause").as_deref() == Some("yes");
                        let _ = events.send(json!({
                            "t": "state", "g": current_gen, "st": 3, "pl": !paused
                        }));
                    }
                    MPV_EVENT_PLAYBACK_RESTART if active => {
                        let paused = api.get_prop(ctx, "pause").as_deref() == Some("yes");
                        let _ = events.send(json!({
                            "t": "seeked", "g": current_gen, "s": seek_seq
                        }));
                        let _ = events.send(json!({
                            "t": "state", "g": current_gen, "st": 3, "pl": !paused
                        }));
                    }
                    MPV_EVENT_END_FILE if active => {
                        let (reason, ef_err) = if !ev.data.is_null() {
                            let ef = unsafe { &*(ev.data as *const MpvEventEndFile) };
                            (ef.reason, ef.error)
                        } else {
                            (MPV_END_FILE_REASON_EOF, 0)
                        };
                        if reason == MPV_END_FILE_REASON_STOP {
                            // Replaced by a new loadfile or explicit stop: ignore.
                        } else if reason == MPV_END_FILE_REASON_ERROR || ef_err < 0 {
                            let _ = events.send(json!({
                                "t": "error", "g": current_gen, "code": 4,
                                "name": "mpv", "msg": format!("Error de reproducción ({ef_err})")
                            }));
                        } else if reason == MPV_END_FILE_REASON_EOF {
                            let _ = events.send(json!({
                                "t": "state", "g": current_gen, "st": 4, "pl": false
                            }));
                        }
                    }
                    MPV_EVENT_PROPERTY_CHANGE if active => match ev.reply_userdata {
                        1 | 2 | 3 => {
                            let paused = api.get_prop(ctx, "pause").as_deref() == Some("yes");
                            let buff =
                                api.get_prop(ctx, "paused-for-cache").as_deref() == Some("yes");
                            let eof = api.get_prop(ctx, "eof-reached").as_deref() == Some("yes");
                            let st = if eof {
                                4
                            } else if buff {
                                2
                            } else {
                                3
                            };
                            let _ = events.send(json!({
                                "t": "state", "g": current_gen, "st": st, "pl": !paused && st == 3
                            }));
                        }
                        4 => {
                            emit_tracks(
                                &api,
                                ctx,
                                current_gen,
                                &mut audio_ids,
                                &mut text_ids,
                                &events,
                            );
                        }
                        5 => {
                            let cue = api.get_prop(ctx, "sub-text").unwrap_or_default();
                            if cue != last_cue {
                                last_cue = cue.clone();
                                let _ = events.send(json!({
                                    "t": "cues", "g": current_gen, "text": cue
                                }));
                            }
                        }
                        6 | 7 => {
                            emit_size(&api, ctx, current_gen, &events);
                        }
                        _ => {}
                    },
                    MPV_EVENT_NONE | _ => {}
                }
            }

            if active && last_time_emit.elapsed() >= Duration::from_millis(250) {
                last_time_emit = Instant::now();
                let pos = api
                    .get_prop(ctx, "time-pos")
                    .and_then(|s| s.parse::<f64>().ok())
                    .unwrap_or(0.0);
                let dur = api
                    .get_prop(ctx, "duration")
                    .and_then(|s| s.parse::<f64>().ok())
                    .unwrap_or(0.0);
                let buf = api
                    .get_prop(ctx, "demuxer-cache-time")
                    .and_then(|s| s.parse::<f64>().ok())
                    .unwrap_or(pos);
                let _ = events.send(json!({
                    "t": "time",
                    "g": current_gen,
                    "p": pos,
                    "d": dur,
                    "b": buf,
                    "o": 0.0,
                    "dyn": is_live && dur <= 0.0,
                    "s": seek_seq
                }));
            }
        }

        if !ctx.is_null() {
            unsafe { (api.terminate_destroy)(ctx) };
        }
    }

    fn emit_size(
        api: &MpvApi,
        ctx: *mut c_void,
        gen: u64,
        events: &broadcast::Sender<Value>,
    ) {
        let w = api
            .get_prop(ctx, "video-params/w")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        let h = api
            .get_prop(ctx, "video-params/h")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        if w > 0 && h > 0 {
            let _ = events.send(json!({ "t": "size", "g": gen, "w": w, "h": h }));
        }
    }

    fn emit_tracks(
        api: &MpvApi,
        ctx: *mut c_void,
        gen: u64,
        audio_ids: &mut Vec<i64>,
        text_ids: &mut Vec<i64>,
        events: &broadcast::Sender<Value>,
    ) {
        let Some(raw) = api.get_prop(ctx, "track-list") else {
            return;
        };
        let Ok(list) = serde_json::from_str::<Vec<Value>>(&raw) else {
            return;
        };

        let mut audio = Vec::new();
        let mut video = Vec::new();
        let mut text = Vec::new();
        audio_ids.clear();
        text_ids.clear();

        for tr in list {
            let kind = tr["type"].as_str().unwrap_or("");
            let id = tr["id"].as_i64().unwrap_or(0);
            let sel = tr["selected"].as_bool().unwrap_or(false);
            let lang = tr["lang"].as_str().unwrap_or("").to_string();
            let title = tr["title"].as_str().unwrap_or("").to_string();
            match kind {
                "audio" => {
                    audio_ids.push(id);
                    audio.push(json!({
                        "lang": lang,
                        "label": title,
                        "sel": sel
                    }));
                }
                "video" => {
                    let h = tr["demux-h"].as_i64().unwrap_or(0);
                    video.push(json!({ "h": h, "sel": sel }));
                }
                "sub" => {
                    let idx = text_ids.len();
                    text_ids.push(id);
                    text.push(json!({
                        "index": idx,
                        "lang": lang,
                        "label": title,
                        "mime": tr["codec"].as_str().unwrap_or("sub"),
                        "forced": tr["forced"].as_bool().unwrap_or(false),
                        "selected": sel
                    }));
                }
                _ => {}
            }
        }

        let _ = events.send(json!({
            "t": "tracks",
            "g": gen,
            "audio": audio,
            "video": video
        }));
        let _ = events.send(json!({
            "t": "text",
            "g": gen,
            "tracks": text
        }));
    }

    pub fn sse_stream(
        ctrl: &MpvController,
    ) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
        let rx = ctrl.subscribe();
        let stream = futures_util::stream::unfold(rx, |mut rx| async move {
            loop {
                match rx.recv().await {
                    Ok(val) => {
                        let ev = Event::default().data(val.to_string());
                        return Some((Ok(ev), rx));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        });
        Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use super::*;
    use std::time::Duration;

    #[derive(Clone)]
    pub struct MpvController;

    impl MpvController {
        pub fn new(_override_path: Option<PathBuf>) -> Self {
            Self
        }

        pub fn available(&self) -> bool {
            false
        }

        pub fn dll_path_str(&self) -> String {
            String::new()
        }

        pub fn handle(&self, _method: &str, _p: &Value) -> Result<Value, String> {
            Err("libmpv solo se usa en escritorio".to_string())
        }
    }

    pub fn sse_stream(
        _ctrl: &MpvController,
    ) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
        Sse::new(futures_util::stream::empty())
            .keep_alive(KeepAlive::new().interval(Duration::from_secs(30)))
    }
}

pub use imp::{sse_stream, MpvController};
