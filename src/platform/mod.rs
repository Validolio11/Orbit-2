//! Operating-system services. Orbit targets Windows; the fallback keeps the editor runnable
//! elsewhere for development and screenshots.

#[cfg(not(windows))]
pub mod fallback;
#[cfg(windows)]
pub mod win;

#[cfg(not(windows))]
pub use fallback as os;
#[cfg(windows)]
pub use win as os;

/// A screen rectangle in physical pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Commands chosen in the tray menu.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum TrayCommand {
    Open,
    ShowWheel,
    Add,
    SelectMenu(String),
    ToggleEnabled,
    Quit,
}

/// What the input thread reports to the app.
#[derive(Clone, Debug)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum InputEvent {
    /// The trigger button went down (physical pixels) while another program with this process id was in front.
    TriggerDown {
        x: i32,
        y: i32,
        foreground_pid: u32,
    },
    TriggerUp,
    /// A left, right or middle click anywhere on the screen.
    Click {
        x: i32,
        y: i32,
    },
    /// Ctrl + Space, with the program that was in front.
    Hotkey {
        foreground_pid: u32,
    },
    Escape,
    Tray(TrayCommand),
    /// Another Orbit was started: show the window, or quit for `--quit`.
    SecondInstance {
        quit: bool,
    },
    HookFailed(String),
}

/// What happens to a running Orbit when it is started again.
#[cfg_attr(not(windows), allow(dead_code))]
pub enum Instance {
    First,
    Forwarded,
}

/// Administrator start (Task Scheduler) state for the controls page.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AdminStatus {
    pub available: bool,
    pub enabled: bool,
    pub elevated: bool,
}

/// A program icon in premultiplied RGBA.
pub struct IconImage {
    pub width: usize,
    pub height: usize,
    pub rgba: Vec<u8>,
}

pub fn python_launcher() -> Option<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if cfg!(windows) {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        candidates.push(std::path::Path::new(&windir).join("py.exe"));
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(
                std::path::Path::new(&local)
                    .join("Programs")
                    .join("Python")
                    .join("Launcher")
                    .join("py.exe"),
            );
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push(dir.join(if cfg!(windows) { "py.exe" } else { "python3" }));
        }
    }
    candidates
        .into_iter()
        .find(|c| c.is_absolute() && c.is_file())
}

pub fn own_exe() -> String {
    std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_default()
}
