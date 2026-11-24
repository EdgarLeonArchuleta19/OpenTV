use std::path::Path;

#[derive(Clone, Copy, Debug)]
pub struct DiskSpace {
    pub free: i64,
    pub total: i64,
}

#[cfg(target_os = "windows")]
pub fn disk_space(path: &Path) -> DiskSpace {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }

    let _ = std::fs::create_dir_all(path);
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut avail: u64 = 0;
    let mut total: u64 = 0;
    let mut free: u64 = 0;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut avail as *mut u64,
            &mut total as *mut u64,
            &mut free as *mut u64,
        )
    };
    if ok != 0 {
        DiskSpace {
            free: avail as i64,
            total: total as i64,
        }
    } else {
        DiskSpace {
            free: -1,
            total: -1,
        }
    }
}

#[cfg(unix)]
pub fn disk_space(path: &Path) -> DiskSpace {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let _ = std::fs::create_dir_all(path);
    let c_path = match CString::new(path.as_os_str().as_bytes()) {
        Ok(p) => p,
        Err(_) => {
            return DiskSpace {
                free: -1,
                total: -1,
            }
        }
    };
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };
    if rc == 0 {
        let frsize = if stat.f_frsize > 0 {
            stat.f_frsize as u64
        } else {
            stat.f_bsize as u64
        };
        DiskSpace {
            free: (stat.f_bavail as u64).saturating_mul(frsize) as i64,
            total: (stat.f_blocks as u64).saturating_mul(frsize) as i64,
        }
    } else {
        DiskSpace {
            free: -1,
            total: -1,
        }
    }
}
