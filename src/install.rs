//! Orbit is one executable. Started as `Orbit-Setup-<version>.exe` (or with `--install`) it installs
//! itself for the current user, without administrator rights, replacing an older Electron-based Orbit.

use crate::platform::os;
use std::path::PathBuf;

const UNINSTALL_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Orbit";

pub fn install_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Programs")
        .join("Orbit")
}
pub fn installed_exe() -> PathBuf {
    install_dir().join("Orbit.exe")
}

pub fn is_installed_copy() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.canonicalize().ok())
        .zip(installed_exe().canonicalize().ok())
        .is_some_and(|(own, installed)| own == installed)
}

/// True when this executable was downloaded as the installer.
pub fn launched_as_setup(args: &[String]) -> bool {
    args.iter().any(|a| a == "--install")
        || std::env::current_exe()
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()))
            .is_some_and(|n| n.starts_with("orbit-setup"))
}

fn start_menu_link() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_default()
        .join("Microsoft\\Windows\\Start Menu\\Programs\\Orbit.lnk")
}
fn desktop_link() -> PathBuf {
    dirs::desktop_dir().unwrap_or_default().join("Orbit.lnk")
}

/// Copies this executable into place, adds the shortcuts and the Apps & features entry, then starts it.
pub fn install(silent: bool, launch: bool) -> Result<(), String> {
    let dir = install_dir();
    let target = installed_exe();
    // A running Orbit (this one or the older Electron version) is asked to quit first.
    if target.exists() {
        let _ = std::process::Command::new(&target).arg("--quit").status();
        std::thread::sleep(std::time::Duration::from_millis(1500));
    }
    // The Electron build left a folder of runtime files next to Orbit.exe; settings live in AppData and stay.
    if dir.join("resources").is_dir() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Не вдалося створити {}: {e}", dir.display()))?;
    let own = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut copied = Err(String::new());
    for _ in 0..10 {
        copied = std::fs::copy(&own, &target)
            .map(|_| ())
            .map_err(|e| e.to_string());
        if copied.is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    copied.map_err(|e| format!("Не вдалося скопіювати Orbit: {e}"))?;
    let _ = os::create_shortcut(
        &start_menu_link(),
        &target,
        "",
        "Orbit — радіальне меню для миші",
    );
    if !silent || !desktop_link().exists() {
        let _ = os::create_shortcut(&desktop_link(), &target, "", "Orbit");
    }
    let exe = target.display().to_string();
    for (name, value) in [
        ("DisplayName", "Orbit"),
        ("DisplayVersion", env!("CARGO_PKG_VERSION")),
        ("Publisher", "Orbit"),
        ("InstallLocation", &dir.display().to_string()),
        ("DisplayIcon", &exe),
        ("UninstallString", &format!("\"{exe}\" --uninstall")),
    ] {
        os::set_registry_string(UNINSTALL_KEY, name, value);
    }
    if launch {
        std::process::Command::new(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Removes the shortcuts, the sign-in entry and the program folder; menus in AppData stay.
pub fn uninstall() {
    os::set_login_item(false);
    let _ = std::fs::remove_file(start_menu_link());
    let _ = std::fs::remove_file(desktop_link());
    os::delete_registry_tree(UNINSTALL_KEY);
    // The running executable cannot delete itself; a hidden shell removes the folder after Orbit exits.
    let dir = install_dir().display().to_string();
    let _ = std::process::Command::new("cmd.exe")
        .args([
            "/C",
            &format!("ping -n 3 127.0.0.1 >NUL & rmdir /S /Q \"{dir}\""),
        ])
        .spawn();
}

/// After an in-app update the Apps & features entry shows the new version.
pub fn refresh_uninstall_entry() {
    if is_installed_copy() {
        os::set_registry_string(UNINSTALL_KEY, "DisplayVersion", env!("CARGO_PKG_VERSION"));
    }
}
