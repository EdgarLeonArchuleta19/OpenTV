use serde_json::{json, Value};

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    pub fn system_volume(command: &str, value: Option<Value>) -> Value {
        unsafe {
            let hr_init = CoInitializeEx(None, COINIT_MULTITHREADED);
            let should_uninit = hr_init.is_ok();
            let res = run_volume_com(command, value);
            if should_uninit {
                CoUninitialize();
            }
            match res {
                Ok((vol, muted)) => json!({ "volume": vol, "muted": muted }),
                Err(msg) => json!({ "error": msg }),
            }
        }
    }

    unsafe fn run_volume_com(command: &str, value: Option<Value>) -> Result<(f32, bool), String> {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Audio COM enumerator: {e}"))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| format!("Sin dispositivo de audio: {e}"))?;
        let endpoint: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Audio endpoint: {e}"))?;

        match command {
            "set" => {
                if let Some(v) = value.and_then(|x| x.as_f64()) {
                    let clamped = (v as f32).clamp(0.0, 1.0);
                    endpoint
                        .SetMasterVolumeLevelScalar(clamped, std::ptr::null())
                        .map_err(|e| format!("SetVolume: {e}"))?;
                }
            }
            "mute" => {
                if let Some(m) = value.and_then(|x| x.as_bool()) {
                    endpoint
                        .SetMute(BOOL::from(m), std::ptr::null())
                        .map_err(|e| format!("SetMute: {e}"))?;
                }
            }
            _ => {}
        }

        let vol = endpoint
            .GetMasterVolumeLevelScalar()
            .map_err(|e| format!("GetVolume: {e}"))?;
        let muted = endpoint
            .GetMute()
            .map_err(|e| format!("GetMute: {e}"))?
            .as_bool();
        Ok((vol, muted))
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use super::*;
    pub fn system_volume(_command: &str, _value: Option<Value>) -> Value {
        json!({ "error": "Solo disponible en Windows" })
    }
}

pub fn system_volume(command: &str, value: Option<Value>) -> Value {
    imp::system_volume(command, value)
}
