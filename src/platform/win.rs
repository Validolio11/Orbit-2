// Win32 calls are unsafe throughout; the unsafe fns here are thin wrappers around them.
#![allow(unsafe_op_in_unsafe_fn)]

//! Windows services: the low-level mouse hook, Ctrl + Space, the tray icon, program launching,
//! Shell icons, the sign-in entry and "start as administrator".
//!
//! One background thread owns a hidden window. The mouse hook, the hotkeys and the tray icon all
//! deliver their messages to it, so nothing here ever waits on the UI thread.

use super::{AdminStatus, IconImage, InputEvent, Instance, Rect, TrayCommand};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicU8, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::Com::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Registry::*;
use windows::Win32::System::Shutdown::LockWorkStation;
use windows::Win32::System::Threading::*;
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::Shell::*;
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::core::{HSTRING, Interface, PCWSTR, PWSTR, w};

const SERVICE_CLASS: PCWSTR = w!("OrbitService");
const WM_TRAY: u32 = WM_APP + 1;
const WM_SET_ESCAPE: u32 = WM_APP + 2;
const WM_TRIGGER: u32 = WM_APP + 3;
const WM_REFRESH_TRAY: u32 = WM_APP + 4;
const WM_SECOND_INSTANCE: u32 = WM_APP + 5;
const WM_STOP: u32 = WM_APP + 6;
const HOTKEY_WHEEL: i32 = 1;
const HOTKEY_ESCAPE: i32 = 2;
const TRAY_ID: u32 = 1;

type Sink = Box<dyn Fn(InputEvent) + Send + Sync>;
static SINK: OnceLock<Sink> = OnceLock::new();
static SERVICE: AtomicIsize = AtomicIsize::new(0);
static PREVIOUS_FOREGROUND: AtomicIsize = AtomicIsize::new(0);
static WRAPPED: AtomicIsize = AtomicIsize::new(0);
/// How many rows at the top of the wheel window are cut off (the egui window paints a hairline there).
static TOP_CROP: AtomicI32 = AtomicI32::new(8);

pub fn set_top_crop(rows: i32) {
    TOP_CROP.store(rows.max(0), Ordering::Relaxed);
}
static HOOK: AtomicIsize = AtomicIsize::new(0);
/// 4 or 5 while the trigger is active, 0 when Orbit is paused.
static BUTTON: AtomicU8 = AtomicU8::new(0);
static TRIGGER_PID: AtomicU32 = AtomicU32::new(0);
static TRIGGER_DOWN: AtomicBool = AtomicBool::new(false);
static TASKBAR_CREATED: AtomicU32 = AtomicU32::new(0);

/// What the tray menu lists: the menus (id, name), the active one, and whether Orbit is on.
#[derive(Clone, Default)]
pub struct TrayModel {
    pub menus: Vec<(String, String)>,
    pub active: String,
    pub enabled: bool,
}
static TRAY: Mutex<Option<TrayModel>> = Mutex::new(None);

fn emit(event: InputEvent) {
    if let Some(sink) = SINK.get() {
        sink(event);
    }
}
fn service() -> Option<HWND> {
    let h = SERVICE.load(Ordering::Acquire);
    (h != 0).then_some(HWND(h as *mut c_void))
}
fn post(message: u32, wparam: usize, lparam: isize) {
    if let Some(hwnd) = service() {
        unsafe {
            let _ = PostMessageW(Some(hwnd), message, WPARAM(wparam), LPARAM(lparam));
        }
    }
}
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

// ---------- Single instance ----------

/// The first Orbit keeps running; a second start hands over to it (show the window, or `--quit`).
pub fn single_instance(quit: bool) -> Instance {
    unsafe {
        let mutex = CreateMutexW(None, true, w!("Local\\OrbitSingleInstance"));
        if mutex.is_ok() && GetLastError() != ERROR_ALREADY_EXISTS {
            return Instance::First;
        }
        if let Ok(hwnd) = FindWindowW(SERVICE_CLASS, PCWSTR::null()) {
            let _ = AllowSetForegroundWindow(ASFW_ANY);
            let _ = PostMessageW(
                Some(hwnd),
                WM_SECOND_INSTANCE,
                WPARAM(quit as usize),
                LPARAM(0),
            );
        }
        Instance::Forwarded
    }
}

// ---------- Input thread ----------

pub fn start_input(button: u8, sink: Sink) {
    let _ = SINK.set(sink);
    BUTTON.store(button, Ordering::Release);
    std::thread::Builder::new()
        .name("orbit-input".into())
        .spawn(|| unsafe { run_service() })
        .ok();
}
pub fn set_trigger_button(button: u8) {
    BUTTON.store(button, Ordering::Release);
}
pub fn set_escape(active: bool) {
    post(WM_SET_ESCAPE, active as usize, 0);
}
pub fn set_tray(model: TrayModel) {
    *TRAY.lock().unwrap_or_else(|e| e.into_inner()) = Some(model);
    post(WM_REFRESH_TRAY, 0, 0);
}
pub fn stop_input() {
    post(WM_STOP, 0, 0);
}

unsafe fn run_service() {
    let instance = GetModuleHandleW(PCWSTR::null())
        .map(|m| HINSTANCE(m.0))
        .unwrap_or_default();
    let class = WNDCLASSW {
        lpfnWndProc: Some(service_proc),
        hInstance: instance,
        lpszClassName: SERVICE_CLASS,
        ..Default::default()
    };
    RegisterClassW(&class);
    let Ok(hwnd) = CreateWindowExW(
        WINDOW_EX_STYLE(0),
        SERVICE_CLASS,
        w!("Orbit service"),
        WS_OVERLAPPED,
        0,
        0,
        0,
        0,
        None,
        None,
        Some(instance),
        None,
    ) else {
        emit(InputEvent::HookFailed(
            "Не вдалося запустити службу Orbit.".into(),
        ));
        return;
    };
    SERVICE.store(hwnd.0 as isize, Ordering::Release);
    TASKBAR_CREATED.store(
        RegisterWindowMessageW(w!("TaskbarCreated")),
        Ordering::Release,
    );
    match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), Some(instance), 0) {
        Ok(hook) => HOOK.store(hook.0 as isize, Ordering::Release),
        Err(error) => emit(InputEvent::HookFailed(format!(
            "Не вдалося встановити перехоплення миші: {error}"
        ))),
    }
    if RegisterHotKey(
        Some(hwnd),
        HOTKEY_WHEEL,
        MOD_CONTROL | MOD_NOREPEAT,
        VK_SPACE.0 as u32,
    )
    .is_err()
    {
        emit(InputEvent::HookFailed(String::new()));
    }
    add_tray(hwnd);
    let mut message = MSG::default();
    while GetMessageW(&mut message, None, 0, 0).as_bool() {
        let _ = TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    let hook = HOOK.swap(0, Ordering::AcqRel);
    if hook != 0 {
        let _ = UnhookWindowsHookEx(HHOOK(hook as *mut c_void));
    }
    remove_tray(hwnd);
    let _ = DestroyWindow(hwnd);
}

/// Mirrors the old Orbit.Input helper: the trigger side button is consumed, every other click passes through.
unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let hook = HHOOK(HOOK.load(Ordering::Acquire) as *mut c_void);
    if code >= 0 {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        let packed = |x: i32, y: i32| {
            (
                (x as i16 as u16 as isize) | ((y as i16 as u16 as isize) << 16),
                0usize,
            )
        };
        match wparam.0 as u32 {
            WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN => {
                let (lp, _) = packed(info.pt.x, info.pt.y);
                post(WM_TRIGGER, 3, lp);
            }
            message @ (WM_XBUTTONDOWN | WM_XBUTTONUP) => {
                let button = ((info.mouseData >> 16) & 0xffff) as u8 + 3;
                let selected = BUTTON.load(Ordering::Acquire);
                if selected != 0 && button == selected {
                    let (lp, _) = packed(info.pt.x, info.pt.y);
                    if message == WM_XBUTTONDOWN {
                        // The program in front is read here, before the wheel can take focus.
                        TRIGGER_PID.store(foreground_pid(), Ordering::Release);
                        TRIGGER_DOWN.store(true, Ordering::Release);
                        post(WM_TRIGGER, 1, lp);
                    } else if TRIGGER_DOWN.swap(false, Ordering::AcqRel) {
                        post(WM_TRIGGER, 2, lp);
                    }
                    return LRESULT(1);
                }
            }
            _ => {}
        }
    }
    CallNextHookEx(Some(hook), code, wparam, lparam)
}

unsafe extern "system" fn service_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let point = || {
        (
            (lparam.0 & 0xffff) as u16 as i16 as i32,
            ((lparam.0 >> 16) & 0xffff) as u16 as i16 as i32,
        )
    };
    match message {
        WM_TRIGGER => {
            let (x, y) = point();
            match wparam.0 {
                1 => emit(InputEvent::TriggerDown {
                    x,
                    y,
                    foreground_pid: TRIGGER_PID.load(Ordering::Acquire),
                }),
                2 => emit(InputEvent::TriggerUp),
                _ => emit(InputEvent::Click { x, y }),
            }
        }
        WM_HOTKEY if wparam.0 as i32 == HOTKEY_WHEEL => emit(InputEvent::Hotkey {
            foreground_pid: foreground_pid(),
        }),
        WM_HOTKEY if wparam.0 as i32 == HOTKEY_ESCAPE => emit(InputEvent::Escape),
        WM_SET_ESCAPE => {
            if wparam.0 != 0 {
                let _ = RegisterHotKey(Some(hwnd), HOTKEY_ESCAPE, MOD_NOREPEAT, VK_ESCAPE.0 as u32);
            } else {
                let _ = UnregisterHotKey(Some(hwnd), HOTKEY_ESCAPE);
            }
        }
        WM_TRAY => match (lparam.0 & 0xffff) as u32 {
            WM_LBUTTONUP => emit(InputEvent::Tray(TrayCommand::Open)),
            WM_RBUTTONUP | WM_CONTEXTMENU => show_tray_menu(hwnd),
            _ => {}
        },
        WM_REFRESH_TRAY => update_tray_tip(hwnd, NIM_MODIFY),
        WM_SECOND_INSTANCE => emit(InputEvent::SecondInstance {
            quit: wparam.0 != 0,
        }),
        WM_STOP => PostQuitMessage(0),
        m if m != 0 && m == TASKBAR_CREATED.load(Ordering::Acquire) => add_tray(hwnd),
        _ => return DefWindowProcW(hwnd, message, wparam, lparam),
    }
    LRESULT(0)
}

// ---------- Tray ----------

static ICON_PNG: &[u8] = include_bytes!("../../assets/orbit-32.png");

unsafe fn tray_data(hwnd: HWND) -> NOTIFYICONDATAW {
    let mut data = NOTIFYICONDATAW {
        cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
        hWnd: hwnd,
        uID: TRAY_ID,
        ..Default::default()
    };
    data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    data.uCallbackMessage = WM_TRAY;
    data.hIcon = CreateIconFromResourceEx(ICON_PNG, true, 0x00030000, 0, 0, LR_DEFAULTCOLOR)
        .unwrap_or_default();
    let enabled = TRAY
        .lock()
        .ok()
        .and_then(|t| t.as_ref().map(|m| m.enabled))
        .unwrap_or(true);
    let tip = wide(&format!(
        "Orbit · {}",
        if enabled {
            "Увімкнено"
        } else {
            "Призупинено"
        }
    ));
    for (slot, c) in data.szTip.iter_mut().zip(tip.iter().take(127)) {
        *slot = *c;
    }
    data
}
unsafe fn update_tray_tip(hwnd: HWND, action: NOTIFY_ICON_MESSAGE) {
    let data = tray_data(hwnd);
    let _ = Shell_NotifyIconW(action, &data);
}
unsafe fn add_tray(hwnd: HWND) {
    update_tray_tip(hwnd, NIM_ADD);
}
unsafe fn remove_tray(hwnd: HWND) {
    let data = tray_data(hwnd);
    let _ = Shell_NotifyIconW(NIM_DELETE, &data);
}

unsafe fn show_tray_menu(hwnd: HWND) {
    let model = TRAY.lock().ok().and_then(|t| t.clone()).unwrap_or_default();
    let Ok(menu) = CreatePopupMenu() else { return };
    let item = |menu: HMENU, id: usize, text: &str, flags: MENU_ITEM_FLAGS| {
        let label = wide(text);
        let _ = AppendMenuW(menu, flags, id, PCWSTR(label.as_ptr()));
    };
    item(menu, 1, "Відкрити Orbit", MF_STRING);
    item(menu, 2, "Показати колесо", MF_STRING);
    item(menu, 3, "Додати дію…", MF_STRING);
    if model.menus.len() > 1 {
        if let Ok(sub) = CreatePopupMenu() {
            for (i, (id, name)) in model.menus.iter().enumerate() {
                item(
                    sub,
                    100 + i,
                    name,
                    if *id == model.active {
                        MF_STRING | MF_CHECKED
                    } else {
                        MF_STRING
                    },
                );
            }
            let label = wide("Меню на колесі");
            let _ = AppendMenuW(menu, MF_POPUP, sub.0 as usize, PCWSTR(label.as_ptr()));
        }
    }
    item(
        menu,
        4,
        "Увімкнено",
        if model.enabled {
            MF_STRING | MF_CHECKED
        } else {
            MF_STRING
        },
    );
    item(menu, 0, "", MF_SEPARATOR);
    item(menu, 5, "Вийти з Orbit", MF_STRING);
    let mut cursor = POINT::default();
    let _ = GetCursorPos(&mut cursor);
    // The menu closes when focus leaves it only if its owner is the foreground window.
    let _ = SetForegroundWindow(hwnd);
    let chosen = TrackPopupMenu(
        menu,
        TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON,
        cursor.x,
        cursor.y,
        None,
        hwnd,
        None,
    )
    .0 as usize;
    let _ = DestroyMenu(menu);
    let command = match chosen {
        1 => TrayCommand::Open,
        2 => TrayCommand::ShowWheel,
        3 => TrayCommand::Add,
        4 => TrayCommand::ToggleEnabled,
        5 => TrayCommand::Quit,
        n if n >= 100 => match model.menus.get(n - 100) {
            Some((id, _)) => TrayCommand::SelectMenu(id.clone()),
            None => return,
        },
        _ => return,
    };
    emit(InputEvent::Tray(command));
}

// ---------- Windows and screens ----------

pub fn foreground_pid() -> u32 {
    unsafe {
        let mut pid = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid));
        pid
    }
}

pub fn process_path(pid: u32) -> String {
    if pid == 0 {
        return String::new();
    }
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buffer = vec![0u16; 32768];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        )
        .is_ok();
        let _ = CloseHandle(process);
        if ok {
            String::from_utf16_lossy(&buffer[..size as usize])
        } else {
            String::new()
        }
    }
}

pub fn cursor() -> (i32, i32) {
    unsafe {
        let mut p = POINT::default();
        let _ = GetCursorPos(&mut p);
        (p.x, p.y)
    }
}

/// The work area (physical pixels) of the screen under a point, and that screen's scale factor.
pub fn work_area(x: i32, y: i32) -> (Rect, f32) {
    unsafe {
        let monitor = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let _ = GetMonitorInfoW(monitor, &mut info);
        let (mut dx, mut dy) = (96u32, 96u32);
        let _ = GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
        let r = info.rcWork;
        (
            Rect {
                x: r.left,
                y: r.top,
                width: r.right - r.left,
                height: r.bottom - r.top,
            },
            dx.max(96) as f32 / 96.0,
        )
    }
}

#[link(name = "dwmapi")]
unsafe extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: *mut c_void,
        attribute: u32,
        value: *const c_void,
        size: u32,
    ) -> i32;
}

/// Windows 11 gives every top-level window a hairline border, rounded corners and a shadow.
/// The wheel window is a transparent square, so all three are switched off for it.
fn strip_frame(hwnd: HWND) {
    const NCRENDERING_POLICY: u32 = 2;
    const WINDOW_CORNER_PREFERENCE: u32 = 33;
    const BORDER_COLOR: u32 = 34;
    for (attribute, value) in [
        (NCRENDERING_POLICY, 1u32),       // DWMNCRP_DISABLED
        (WINDOW_CORNER_PREFERENCE, 1u32), // DWMWCP_DONOTROUND
        (BORDER_COLOR, 0xFFFF_FFFEu32),   // DWMWA_COLOR_NONE
    ] {
        unsafe {
            DwmSetWindowAttribute(hwnd.0, attribute, &value as *const u32 as *const c_void, 4);
        }
    }
}

/// The window's frame and region are set once, while it is still off screen. Changing them on every show
/// makes the system repaint the window, which flashes.
/// The wheel window must be a plain popup. Left with the caption and resize border of an ordinary window,
/// the system paints a white title bar and frame for the first few frames of every show.
fn ensure_borderless(hwnd: HWND) {
    const FRAME: u32 = WS_CAPTION.0
        | WS_THICKFRAME.0
        | WS_SYSMENU.0
        | WS_MINIMIZEBOX.0
        | WS_MAXIMIZEBOX.0
        | WS_BORDER.0
        | WS_DLGFRAME.0;
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        if style & FRAME == 0 {
            return;
        }
        SetWindowLongPtrW(hwnd, GWL_STYLE, ((style & !FRAME) | WS_POPUP.0) as isize);
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
}

fn prepare_wheel_window(handle: isize) {
    ensure_borderless(HWND(handle as *mut c_void));
    if WRAPPED.swap(handle, Ordering::Relaxed) == handle {
        return;
    }
    unsafe {
        let hwnd = HWND(handle as *mut c_void);
        strip_frame(hwnd);
        // Windows still paints a one-pixel line along the top edge of this borderless window. The wheel
        // never uses its outermost rows, so the window region leaves the top few out.
        let crop = TOP_CROP.load(Ordering::Relaxed);
        if crop > 0 {
            let region = CreateRectRgn(0, crop, 32000, 32000);
            if SetWindowRgn(hwnd, Some(region), false) == 0 {
                let _ = DeleteObject(region.into());
            }
        }
    }
}

/// Shows a window at a position without waiting for the thread that owns it.
pub fn place_window(handle: isize, rect: Rect, activate: bool) {
    unsafe {
        let hwnd = HWND(handle as *mut c_void);
        prepare_wheel_window(handle);
        if activate {
            let front = GetForegroundWindow();
            if front != hwnd {
                PREVIOUS_FOREGROUND.store(front.0 as isize, Ordering::Relaxed);
            }
        }
        let mut flags = SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS;
        if !activate {
            flags |= SWP_NOACTIVATE;
        }
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            flags,
        );
        if activate {
            let _ = SetForegroundWindow(hwnd);
        }
    }
}
/// Takes the wheel window off the screen without hiding it. A window that is hidden and shown again
/// flashes a blank white rectangle before its first frame; a parked one keeps its transparent surface.
pub fn hide_window(handle: isize) {
    prepare_wheel_window(handle);
    unsafe {
        let hwnd = HWND(handle as *mut c_void);
        if GetForegroundWindow() == hwnd {
            let previous = PREVIOUS_FOREGROUND.load(Ordering::Relaxed);
            if previous != 0 {
                let _ = SetForegroundWindow(HWND(previous as *mut c_void));
            }
        }
        let _ = SetWindowPos(
            hwnd,
            None,
            -32000,
            -32000,
            0,
            0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS,
        );
    }
}
// ---------- Launching ----------

pub fn shell_open(target: &str) -> Result<(), String> {
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            &HSTRING::from(target),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!("Windows не зміг відкрити «{target}»."))
    }
}

pub fn spawn(
    program: &std::path::Path,
    args: &[String],
    cwd: Option<&std::path::Path>,
    hidden: bool,
) -> Result<(), String> {
    let mut command = std::process::Command::new(program);
    command.args(args);
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(if hidden { 0x0800_0000 } else { 0 });
    }
    let _ = hidden;
    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Windows commands that are keyboard shortcuts, sent after the wheel has released focus.
pub fn system_keys(action: &str) -> Result<(), String> {
    if action == "lock" {
        return unsafe { LockWorkStation() }.map_err(|e| e.to_string());
    }
    let keys: &[u16] = match action {
        "screenshot" => &[0x5B, 0x10, 0x53],
        "desktop" => &[0x5B, 0x44],
        "mute" => &[0xAD],
        "volume-up" => &[0xAF],
        "volume-down" => &[0xAE],
        "media-play" => &[0xB3],
        "media-next" => &[0xB0],
        "media-prev" => &[0xB1],
        "search" => &[0x5B, 0x53],
        "run" => &[0x5B, 0x52],
        "task-view" => &[0x5B, 0x09],
        "clipboard" => &[0x5B, 0x56],
        "emoji" => &[0x5B, 0xBE],
        "dictation" => &[0x5B, 0x48],
        "notifications" => &[0x5B, 0x4E],
        _ => return Err("Непідтримувана дія Windows.".into()),
    };
    let key = |vk: u16, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    KEYBD_EVENT_FLAGS(0)
                },
                ..Default::default()
            },
        },
    };
    let inputs: Vec<INPUT> = keys
        .iter()
        .map(|&k| key(k, false))
        .chain(keys.iter().rev().map(|&k| key(k, true)))
        .collect();
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("Windows не виконав дію.".into())
    }
}

// ---------- Icons ----------

/// The Shell's own icon (up to 256 px, never upscaled) for a program, shortcut or `shell:AppsFolder\…` item.
pub fn app_icon(path: &str) -> Option<IconImage> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(&HSTRING::from(path), None::<&IBindCtx>).ok()?;
        let bitmap = factory
            .GetImage(
                SIZE { cx: 256, cy: 256 },
                SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
            )
            .ok()?;
        let mut info = BITMAP::default();
        let ok = GetObjectW(
            bitmap.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut info as *mut BITMAP as *mut c_void),
        ) != 0;
        let (width, height) = (info.bmWidth, info.bmHeight);
        let mut result = None;
        if ok && (1..=512).contains(&width) && (1..=512).contains(&height) {
            let mut header = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut pixels = vec![0u8; (width * height * 4) as usize];
            let dc = GetDC(None);
            let lines = GetDIBits(
                dc,
                bitmap,
                0,
                height as u32,
                Some(pixels.as_mut_ptr() as *mut c_void),
                &mut header,
                DIB_RGB_COLORS,
            );
            ReleaseDC(None, dc);
            if lines == height {
                // BGRA with premultiplied alpha → RGBA.
                for px in pixels.chunks_exact_mut(4) {
                    px.swap(0, 2);
                }
                result = Some(IconImage {
                    width: width as usize,
                    height: height as usize,
                    rgba: pixels,
                });
            }
        }
        let _ = DeleteObject(bitmap.into());
        result
    }
}

// ---------- Sign-in and administrator start ----------

const RUN_KEY: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
pub fn set_login_item(enabled: bool) {
    unsafe {
        if enabled {
            let value = wide(&format!("\"{}\" --hidden", super::own_exe()));
            let _ = RegSetKeyValueW(
                HKEY_CURRENT_USER,
                RUN_KEY,
                w!("Orbit"),
                REG_SZ.0,
                Some(value.as_ptr() as *const c_void),
                (value.len() * 2) as u32,
            );
        } else {
            let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN_KEY, w!("Orbit"));
        }
    }
}

pub fn set_registry_string(key: &str, name: &str, value: &str) {
    let data = wide(value);
    unsafe {
        let _ = RegSetKeyValueW(
            HKEY_CURRENT_USER,
            &HSTRING::from(key),
            &HSTRING::from(name),
            REG_SZ.0,
            Some(data.as_ptr() as *const c_void),
            (data.len() * 2) as u32,
        );
    }
}
pub fn delete_registry_tree(key: &str) {
    unsafe {
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(key));
    }
}

const ADMIN_TASK: &str = "Orbit (administrator)";

fn elevated() -> bool {
    unsafe { IsUserAnAdmin().as_bool() }
}
fn schtasks(args: &[&str]) -> std::process::Output {
    let mut command = std::process::Command::new("schtasks.exe");
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.output().unwrap_or_else(|_| std::process::Output {
        status: Default::default(),
        stdout: vec![],
        stderr: vec![],
    })
}
fn task_matches() -> bool {
    let output = schtasks(&["/Query", "/TN", ADMIN_TASK, "/XML"]);
    output.status.success()
        && String::from_utf8_lossy(&output.stdout)
            .to_lowercase()
            .contains(&super::own_exe().to_lowercase())
}

/// Available only for an installed copy, since the task points at this executable.
pub fn admin_status() -> AdminStatus {
    let installed = crate::install::is_installed_copy();
    AdminStatus {
        available: installed,
        enabled: installed && task_matches(),
        elevated: elevated(),
    }
}

/// Creates or removes the task through one UAC prompt. Ok(false) when the prompt was declined.
pub fn admin_set(enabled: bool) -> Result<bool, String> {
    let exe = super::own_exe();
    let args = if enabled {
        format!(
            "/Create /F /TN \"{ADMIN_TASK}\" /SC ONLOGON /RL HIGHEST /TR \"\\\"{exe}\\\" --elevated-task\""
        )
    } else {
        format!("/Delete /F /TN \"{ADMIN_TASK}\"")
    };
    unsafe {
        let file = HSTRING::from("schtasks.exe");
        let params = HSTRING::from(args);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            lpVerb: w!("runas"),
            lpFile: PCWSTR(file.as_ptr()),
            lpParameters: PCWSTR(params.as_ptr()),
            nShow: SW_HIDE.0,
            ..Default::default()
        };
        if ShellExecuteExW(&mut info).is_err() {
            return if GetLastError() == ERROR_CANCELLED {
                Ok(false)
            } else {
                Err("Windows не зміг змінити завдання запуску.".into())
            };
        }
        WaitForSingleObject(info.hProcess, 60_000);
        let _ = CloseHandle(info.hProcess);
    }
    Ok(true)
}

/// Every normal start hands over to the elevated task when it exists; the mode survives in a small file.
pub fn admin_hand_over(mode: &str, data_dir: &std::path::Path) -> bool {
    if elevated() || !crate::install::is_installed_copy() || !task_matches() {
        return false;
    }
    let _ = std::fs::create_dir_all(data_dir);
    let _ = std::fs::write(data_dir.join("admin-start-mode"), mode);
    schtasks(&["/Run", "/TN", ADMIN_TASK]).status.success()
}

// ---------- PowerShell helpers (folders, installed apps) ----------

/// Runs a PowerShell script hidden, with a time limit, and returns its UTF-8 output.
pub fn powershell(script: &str, timeout: std::time::Duration) -> Result<String, String> {
    use std::io::Read;
    let encoded: String = {
        let bytes: Vec<u8> = script
            .encode_utf16()
            .flat_map(|u| u.to_le_bytes())
            .collect();
        base64(&bytes)
    };
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
    let exe = std::path::Path::new(&windir)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    let mut command = std::process::Command::new(exe);
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &encoded,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let mut stdout = child.stdout.take().ok_or("no output")?;
    let reader = std::thread::spawn(move || {
        let mut out = Vec::new();
        let _ = stdout.by_ref().take(8 * 1024 * 1024).read_to_end(&mut out);
        out
    });
    let started = std::time::Instant::now();
    loop {
        if let Ok(Some(_)) = child.try_wait() {
            break;
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            return Err("PowerShell timed out.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
    let out = reader.join().unwrap_or_default();
    Ok(String::from_utf8_lossy(&out)
        .trim_start_matches('\u{feff}')
        .to_string())
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16
            | (*chunk.get(1).unwrap_or(&0) as u32) << 8
            | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[(n >> (18 - i * 6) & 63) as usize] as char)
            } else {
                out.push('=')
            }
        }
    }
    out
}

/// Explorer's Quick Access folders and the drives with their Explorer labels.
pub fn shell_folders() -> (Vec<(String, String)>, Vec<(String, String)>) {
    let script = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false;$shell=New-Object -ComObject Shell.Application;\
        @{quick=@($shell.Namespace('shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}').Items()|Where-Object {$_.IsFolder -and $_.Path -match '^[A-Za-z]:\\\\'}|Select-Object -First 24|ForEach-Object {@{name=$_.Name;path=$_.Path}});\
        drives=@($shell.Namespace('shell:MyComputerFolder').Items()|Where-Object {$_.Path -match '^[A-Za-z]:\\\\$'}|ForEach-Object {@{name=$_.Name;path=$_.Path}})}|ConvertTo-Json -Compress -Depth 4";
    let rows = |value: &serde_json::Value| -> Vec<(String, String)> {
        let list = match value {
            serde_json::Value::Array(a) => a.clone(),
            serde_json::Value::Object(_) => vec![value.clone()],
            _ => vec![],
        };
        list.iter()
            .filter_map(|r| {
                Some((
                    r["name"].as_str()?.to_string(),
                    r["path"].as_str()?.to_string(),
                ))
            })
            .collect()
    };
    match powershell(script, std::time::Duration::from_secs(5))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t.trim()).ok())
    {
        Some(v) => (rows(&v["quick"]), rows(&v["drives"])),
        None => (vec![], vec![]),
    }
}

pub fn discover_apps() -> Result<String, String> {
    powershell(
        include_str!("../../assets/discover-apps.ps1"),
        std::time::Duration::from_secs(12),
    )
}

// ---------- Shortcuts (installer) ----------

pub fn create_shortcut(
    link: &std::path::Path,
    target: &std::path::Path,
    args: &str,
    description: &str,
) -> Result<(), String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let shell: IShellLinkW = CoCreateInstance(
            &ShellLink,
            None::<&windows::core::IUnknown>,
            CLSCTX_INPROC_SERVER,
        )
        .map_err(|e| e.to_string())?;
        shell
            .SetPath(&HSTRING::from(target.as_os_str()))
            .map_err(|e| e.to_string())?;
        shell
            .SetArguments(&HSTRING::from(args))
            .map_err(|e| e.to_string())?;
        shell
            .SetDescription(&HSTRING::from(description))
            .map_err(|e| e.to_string())?;
        if let Some(dir) = target.parent() {
            let _ = shell.SetWorkingDirectory(&HSTRING::from(dir.as_os_str()));
        }
        let file: IPersistFile = shell.cast().map_err(|e| e.to_string())?;
        file.Save(&HSTRING::from(link.as_os_str()), true)
            .map_err(|e| e.to_string())
    }
}
