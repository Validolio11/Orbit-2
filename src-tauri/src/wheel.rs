//! Prewarmed native wheel lifecycle and session-guarded interaction boundary.
use crate::{
    model::{self, Action, Kind, MAX_ITEMS, Settings},
    platform::{self, Rect, os},
    state::{AppEvent, AppState, lock},
};
use serde::Serialize;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Trigger {
    Mouse,
    Keyboard,
    Preview,
}

#[derive(Clone, Debug, Serialize)]
pub struct Foreground {
    pub name: String,
    pub target: String,
    pub args: String,
}

pub struct WheelState {
    pub visible: bool,
    /// An open session is logically visible before its hidden webview is presented.
    pub shown: bool,
    pub session: u64,
    pub trigger: Trigger,
    pub stack: Vec<String>,
    pub selected: Option<usize>,
    pub selected_at: Option<Instant>,
    pub foreground: Option<Foreground>,
    pub busy: bool,
    pub released: bool,
    pub release_point: Option<[i32; 2]>,
    pub size: f32,
    pub bounds: Rect,
    pub scale: f32,
}
impl Default for WheelState {
    fn default() -> Self {
        Self {
            visible: false,
            shown: false,
            session: 0,
            trigger: Trigger::Preview,
            stack: vec![],
            selected: None,
            selected_at: None,
            foreground: None,
            busy: false,
            released: false,
            release_point: None,
            size: 520.0,
            bounds: Rect::default(),
            scale: 1.0,
        }
    }
}
#[derive(Clone, Serialize)]
pub struct BoundsView {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WheelView {
    pub visible: bool,
    pub session: u64,
    pub trigger: Trigger,
    pub stack: Vec<String>,
    pub selected: Option<usize>,
    pub foreground: Option<Foreground>,
    pub busy: bool,
    pub released: bool,
    pub release_point: Option<[i32; 2]>,
    pub size: f32,
    pub bounds: BoundsView,
    pub scale: f32,
}
#[derive(Clone, Serialize)]
pub struct OpenEvent {
    session: u64,
    settings: Settings,
    wheel: WheelView,
}
#[derive(Clone, Serialize)]
pub struct CloseEvent {
    pub session: u64,
}
#[derive(Clone, Serialize)]
pub struct ReleaseEvent {
    pub session: u64,
    pub x: i32,
    pub y: i32,
}

/// All coordinates are physical pixels; the resulting wheel size is in logical pixels.
pub fn placement(requested: u32, x: i32, y: i32, area: Rect, scale: f32) -> (Rect, f32) {
    let wheel = requested as f32;
    let side = (600f32.max(wheel + 80.0) * scale).round() as i32;
    let (width, height) = (side.min(area.width), side.min(area.height));
    let bounds = Rect {
        x: (x - width / 2).min(area.x + area.width - width).max(area.x),
        y: (y - height / 2)
            .min(area.y + area.height - height)
            .max(area.y),
        width,
        height,
    };
    let size = wheel
        .min(width as f32 / scale - 30.0)
        .min(height as f32 / scale - 60.0)
        .max(0.0);
    (bounds, size)
}
impl WheelState {
    pub fn view(&self) -> WheelView {
        WheelView {
            visible: self.visible,
            session: self.session,
            trigger: self.trigger,
            stack: self.stack.clone(),
            selected: self.selected,
            foreground: self.foreground.clone(),
            busy: self.busy,
            released: self.released,
            release_point: self.release_point,
            size: self.size,
            bounds: BoundsView {
                x: self.bounds.x,
                y: self.bounds.y,
                width: self.bounds.width,
                height: self.bounds.height,
            },
            scale: self.scale,
        }
    }
    fn open(&mut self, trigger: Trigger, bounds: Rect, size: f32, scale: f32) {
        let session = self.session + 1;
        *self = Self {
            visible: true,
            session,
            trigger,
            bounds,
            size,
            scale,
            ..Self::default()
        };
    }
    fn close(&mut self) -> bool {
        if !self.visible {
            return false;
        }
        self.visible = false;
        self.shown = false;
        self.session += 1;
        self.selected = None;
        self.selected_at = None;
        true
    }
    fn active(&self, session: u64) -> bool {
        self.visible && self.session == session
    }
    fn present(&mut self, session: u64) -> bool {
        if !self.active(session) || self.shown {
            return false;
        }
        self.shown = true;
        true
    }
    fn outside(&self, x: i32, y: i32) -> bool {
        let cx = self.bounds.x as f32 + self.bounds.width as f32 / 2.0;
        let cy = self.bounds.y as f32 + self.bounds.height as f32 / 2.0;
        (x as f32 - cx).hypot(y as f32 - cy) > 207.0 / 480.0 * self.size * self.scale
    }
}
impl AppState {
    pub fn wheel_release(&self) -> Result<(), String> {
        // The consumed side button need not deliver a WebView pointer event.
        // Capture native physical screen coordinates on the input thread itself.
        let (x, y) = os::cursor();
        let session = {
            let wheel = lock(&self.wheel);
            if !wheel.visible {
                return Ok(());
            }
            wheel.session
        };
        self.wheel_session(session, move |state| {
            {
                let mut wheel = lock(&state.wheel);
                wheel.released = true;
                wheel.release_point = Some([x, y]);
            }
            state.emit("wheel:release", ReleaseEvent { session, x, y });
            state.changed();
            Ok(())
        })
    }
    /// All wheel IPC mutations are validated on the lifecycle thread. Checking before
    /// dispatch would let a queued callback from an old page close a newer session.
    pub fn wheel_session<R: Send + 'static>(
        &self,
        session: u64,
        operation: impl FnOnce(&AppState) -> Result<R, String> + Send + 'static,
    ) -> Result<R, String> {
        let guarded = move |state: &AppState| {
            if !lock(&state.wheel).active(session) {
                return Err("Сеанс колеса вже завершено.".into());
            }
            operation(state)
        };
        if let Some(app) = self.app.get() {
            let state = app.state::<Arc<AppState>>().inner().clone();
            run_lifecycle(app, move || guarded(&state))
        } else {
            guarded(self)
        }
    }
    pub fn wheel_navigate(
        &self,
        session: u64,
        stack: Vec<String>,
        selected: Option<usize>,
    ) -> Result<(), String> {
        self.wheel_session(session, move |state| {
            let settings = state.store.get();
            validate_stack(&settings, &stack)?;
            let count = settings.level(&stack).0.len();
            let add = settings.wheel_add_slot && count > 0 && count < MAX_ITEMS;
            let mut wheel = lock(&state.wheel);
            wheel.stack = stack;
            wheel.selected = selected.filter(|i| *i < count + usize::from(add));
            Ok(())
        })
    }
    pub fn wheel_switch_menu(
        &self,
        session: u64,
        direction: i32,
    ) -> Result<crate::state::Snapshot, String> {
        self.wheel_session(session, move |state| {
            let mut settings = state.store.get();
            if settings.menus.len() > 1 && direction != 0 {
                let count = settings.menus.len() as i64;
                let index = (settings.active_menu_index() as i64 + i64::from(direction.signum()))
                    .rem_euclid(count) as usize;
                settings.active_menu_id = settings.menus[index].id.clone();
                {
                    let mut wheel = lock(&state.wheel);
                    wheel.stack.clear();
                    wheel.selected = None;
                    wheel.selected_at = None;
                }
                state.save(settings)?;
            }
            Ok(state.snapshot())
        })
    }
    pub fn wheel_add_foreground(&self, session: u64, stack: Vec<String>) -> Result<String, String> {
        self.wheel_session(session, move |state| {
            validate_stack(&state.store.get(), &stack)?;
            lock(&state.wheel).stack = stack;
            state.add_foreground()
        })
    }
    pub fn wheel_open_add_dialog(&self, session: u64, stack: Vec<String>) -> Result<(), String> {
        self.wheel_session(session, move |state| {
            validate_stack(&state.store.get(), &stack)?;
            state.close_wheel_now()?;
            state.show_main();
            state.send(AppEvent::Navigate {
                group_path: stack,
                add: true,
            });
            Ok(())
        })
    }
    pub fn wheel_launch(&self, session: u64, id: String) -> Result<(), String> {
        let action = self.wheel_session(session, move |state| {
            let action = state
                .store
                .get()
                .action(&id)
                .cloned()
                .ok_or("Дію не знайдено.")?;
            if action.kind == Kind::Group {
                return Err("Група не є командою запуску.".into());
            }
            state.close_wheel_now()?;
            Ok(action)
        })?;
        crate::launcher::execute(&action).inspect_err(|error| {
            self.show_main();
            self.send(AppEvent::ActionError {
                id: action.id.clone(),
                error: error.clone(),
            });
        })
    }
    pub fn wheel_close(&self, session: u64) -> Result<(), String> {
        self.wheel_session(session, |state| state.close_wheel_now())
    }
    pub fn wheel_painted(&self, session: u64) -> Result<(), String> {
        if let Some(app) = self.app.get() {
            let state = app.state::<Arc<AppState>>().inner().clone();
            return run_lifecycle(app, move || state.show_painted_now(session));
        }
        self.show_painted_now(session)
    }
    fn show_painted_now(&self, session: u64) -> Result<(), String> {
        let (bounds, trigger) = {
            let mut wheel = lock(&self.wheel);
            if !wheel.present(session) {
                return Ok(());
            }
            (wheel.bounds, wheel.trigger)
        };
        if let Some(window) = self.app.get().and_then(|a| a.get_webview_window("wheel")) {
            let result = (|| -> tauri::Result<()> {
                prepare_window(&window)?;
                #[cfg(windows)]
                {
                    // place_window also strips the frame and preserves/restores the foreground.
                    // It sets SWP_SHOWWINDOW, so it must only run after the painted handshake.
                    let hwnd = window.hwnd()?;
                    os::place_window(hwnd.0 as isize, bounds, trigger != Trigger::Mouse);
                }
                window.show()?;
                window.set_always_on_top(true)?;
                if trigger != Trigger::Mouse {
                    window.set_focus()?;
                }
                window.emit("wheel:shown", CloseEvent { session })?;
                Ok(())
            })();
            if let Err(error) = result {
                let _ = self.close_wheel_now();
                return Err(error.to_string());
            }
        }
        Ok(())
    }
    pub fn open_wheel(
        self: &Arc<Self>,
        trigger: Trigger,
        point: Option<(i32, i32)>,
        foreground_pid: u32,
    ) -> Result<(), String> {
        if let Some(app) = self.app.get() {
            let state = self.clone();
            return run_lifecycle(app, move || {
                state.open_wheel_now(trigger, point, foreground_pid)
            });
        }
        self.open_wheel_now(trigger, point, foreground_pid)
    }
    fn open_wheel_now(
        self: &Arc<Self>,
        trigger: Trigger,
        point: Option<(i32, i32)>,
        foreground_pid: u32,
    ) -> Result<(), String> {
        let settings = self.store.get();
        if trigger != Trigger::Preview && settings.intro_pending {
            let state = self.clone();
            std::thread::spawn(move || {
                let _ = state.store.update(|s| s.intro_pending = false);
                state.changed();
            });
        }
        let (x, y) = point.unwrap_or_else(os::cursor);
        let (area, scale) = os::work_area(x, y);
        let (bounds, size) = placement(settings.wheel_size, x, y, area, scale);
        let view = {
            let mut wheel = lock(&self.wheel);
            wheel.open(trigger, bounds, size, scale);
            wheel.view()
        };
        // Reopening never exposes the previous session while this one is painting.
        if let Some(window) = self.app.get().and_then(|a| a.get_webview_window("wheel")) {
            let result = (|| -> tauri::Result<()> {
                window.hide()?;
                prepare_window(&window)?;
                window.set_size(PhysicalSize::new(bounds.width as u32, bounds.height as u32))?;
                window.set_position(PhysicalPosition::new(bounds.x, bounds.y))?;
                window.set_focusable(trigger != Trigger::Mouse)?;
                window.emit(
                    "wheel:open",
                    OpenEvent {
                        session: view.session,
                        settings,
                        wheel: view.clone(),
                    },
                )?;
                Ok(())
            })();
            if let Err(error) = result {
                let _ = self.close_wheel_now();
                return Err(error.to_string());
            }
            let state = self.clone();
            let session = view.session;
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(120));
                if let Err(message) = state.wheel_painted(session) {
                    state.send(AppEvent::Toast {
                        message,
                        error: true,
                    });
                }
            });
        }
        os::set_escape(true);
        self.changed();
        if foreground_pid != 0 && foreground_pid != std::process::id() {
            self.resolve_foreground(foreground_pid, view.session);
        }
        Ok(())
    }
    fn resolve_foreground(self: &Arc<Self>, pid: u32, session: u64) {
        let state = self.clone();
        std::thread::spawn(move || {
            let path = os::process_path(pid);
            if !model::foreground_candidate(&path, &platform::own_exe()) {
                return;
            }
            let found = state.catalog.find_executable(&path);
            if found.is_none() && path.to_lowercase().contains("\\windowsapps\\") {
                return;
            }
            let foreground = found
                .map(|e| Foreground {
                    name: e.name,
                    target: e.target,
                    args: e.args,
                })
                .unwrap_or_else(|| {
                    let stem = model::file_stem(&path);
                    let mut chars = stem.chars();
                    let name = chars
                        .next()
                        .map(|c| c.to_uppercase().collect::<String>() + chars.as_str())
                        .unwrap_or_default();
                    Foreground {
                        name,
                        target: path,
                        args: String::new(),
                    }
                });
            let mut wheel = lock(&state.wheel);
            if wheel.visible && wheel.session == session {
                wheel.foreground = Some(foreground);
                drop(wheel);
                state.changed();
            }
        });
    }
    pub fn close_wheel(&self) -> Result<(), String> {
        if let Some(app) = self.app.get() {
            let state = app.state::<Arc<AppState>>().inner().clone();
            return run_lifecycle(app, move || state.close_wheel_now());
        }
        self.close_wheel_now()
    }
    fn close_wheel_now(&self) -> Result<(), String> {
        let changed = lock(&self.wheel).close();
        if !changed {
            return Ok(());
        }
        let result =
            if let Some(window) = self.app.get().and_then(|a| a.get_webview_window("wheel")) {
                #[cfg(windows)]
                if let Ok(hwnd) = window.hwnd() {
                    os::hide_window(hwnd.0 as isize);
                }
                // Win32 hide_window parks; Tauri hide actually clears native visibility.
                window.hide().map_err(|e| e.to_string())
            } else {
                Ok(())
            };
        os::set_escape(false);
        self.emit(
            "wheel:close",
            CloseEvent {
                session: lock(&self.wheel).session,
            },
        );
        self.changed();
        result
    }
    pub fn outside_click(&self, x: i32, y: i32) {
        let session = {
            let wheel = lock(&self.wheel);
            if !wheel.visible {
                return;
            }
            wheel.session
        };
        // The input thread may be waiting behind a new preview/open. Validate the
        // captured session and physical hit together on the lifecycle thread.
        let _ = self.wheel_session(session, move |state| {
            let outside = lock(&state.wheel).outside(x, y);
            if outside && state.store.read(|s| s.close_on_outside_click) {
                state.close_wheel_now()?;
            }
            Ok(())
        });
    }
    pub fn add_foreground(&self) -> Result<String, String> {
        let (foreground, stack) = {
            let w = lock(&self.wheel);
            (w.foreground.clone(), w.stack.clone())
        };
        let foreground = foreground.ok_or("Не вдалося визначити програму.")?;
        let mut action = Action::new(Kind::App, foreground.name, foreground.target);
        action.args = foreground.args;
        action.icon = "app".into();
        let id = action.id.clone();
        let mut next = self.store.get();
        let level = next.level_mut(&stack);
        if level.len() >= MAX_ITEMS {
            return Err("У цьому колесі вже 12 дій.".into());
        }
        level.push(action);
        self.save(next)?;
        Ok(id)
    }
    pub fn launch_action(&self, id: &str) -> Result<(), String> {
        let action = self
            .store
            .get()
            .action(id)
            .cloned()
            .ok_or("Дію не знайдено.")?;
        self.close_wheel()?;
        crate::launcher::execute(&action).inspect_err(|error| {
            self.show_main();
            self.send(AppEvent::ActionError {
                id: action.id.clone(),
                error: error.clone(),
            });
        })
    }
}

/// Run each entire open/close operation on the owning thread. A close cannot overtake
/// a half-finished open and leave a stale session visible. Tauri executes this inline
/// when already on its UI thread; no state lock is held while waiting for dispatch.
fn run_lifecycle<R: Send + 'static>(
    app: &tauri::AppHandle,
    operation: impl FnOnce() -> Result<R, String> + Send + 'static,
) -> Result<R, String> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.send(operation());
    })
    .map_err(|e| e.to_string())?;
    receiver.recv().map_err(|e| e.to_string())?
}

fn validate_stack(settings: &Settings, stack: &[String]) -> Result<(), String> {
    if settings.trim_group_path(stack) != stack {
        return Err("Групу не знайдено.".into());
    }
    Ok(())
}

/// Tauri decorations are disabled at construction. Explicitly clear native frame
/// bits while still hidden as WebView2/Windows may otherwise retain a resize frame.
/// The legacy prepare helper is private and its public place/hide helpers show the
/// HWND, so the small no-show style adaptation belongs to this new crate.
pub fn prepare_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::*;
        let hwnd = window.hwnd()?;
        frame_guard::install(hwnd)?;
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
            let borderless = frame_guard::borderless_style(style);
            if style != borderless {
                SetWindowLongPtrW(hwnd, GWL_STYLE, borderless as isize);
                SetWindowPos(
                    hwnd,
                    None,
                    0,
                    0,
                    0,
                    0,
                    SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                )
                .map_err(|error| tauri::Error::Io(std::io::Error::other(error.to_string())))?;
            }
        }
    }
    #[cfg(not(windows))]
    let _ = window;
    Ok(())
}

/// Tao rebuilds GWL_STYLE from its own flags on show/hide/focusable changes and
/// includes WS_CAPTION even with decorations disabled. Filter those changes before
/// Windows can paint them, keeping the prewarmed wheel a popup throughout its life.
#[cfg(windows)]
mod frame_guard {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::WindowsAndMessaging::*,
    };

    static WINDOW: AtomicIsize = AtomicIsize::new(0);
    static PREVIOUS: AtomicIsize = AtomicIsize::new(0);

    pub fn borderless_style(style: u32) -> u32 {
        let frame = WS_CAPTION.0
            | WS_THICKFRAME.0
            | WS_SYSMENU.0
            | WS_MINIMIZEBOX.0
            | WS_MAXIMIZEBOX.0
            | WS_BORDER.0
            | WS_DLGFRAME.0;
        (style & !frame) | WS_POPUP.0
    }

    /// Called only by the wheel's owning UI thread; no HWND is ever shown here.
    pub fn install(hwnd: HWND) -> tauri::Result<()> {
        let handle = hwnd.0 as isize;
        let installed = WINDOW.load(Ordering::Acquire);
        if installed == handle {
            return Ok(());
        }
        if installed != 0 {
            return Err(tauri::Error::Io(std::io::Error::other(
                "Wheel frame guard already installed",
            )));
        }
        let previous =
            unsafe { SetWindowLongPtrW(hwnd, GWLP_WNDPROC, window_proc as *const () as isize) };
        if previous == 0 {
            return Err(tauri::Error::Io(std::io::Error::last_os_error()));
        }
        PREVIOUS.store(previous, Ordering::Release);
        WINDOW.store(handle, Ordering::Release);
        Ok(())
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        let previous = PREVIOUS.load(Ordering::Acquire);
        let original: WNDPROC = if previous == 0 {
            None
        } else {
            // SetWindowLongPtrW returned this same ABI-compatible WNDPROC address.
            Some(unsafe {
                std::mem::transmute::<
                    isize,
                    unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT,
                >(previous)
            })
        };
        // A rapid reopen can leave one frame with the old caption style; with no non-client
        // area at all there is nothing for Windows to paint as a title bar.
        match message {
            WM_NCCALCSIZE | WM_NCPAINT => return LRESULT(0),
            WM_NCACTIVATE => return LRESULT(1),
            _ => {}
        }
        if message == WM_NCDESTROY && previous != 0 {
            unsafe {
                SetWindowLongPtrW(hwnd, GWLP_WNDPROC, previous);
            }
        }
        let result = unsafe {
            if original.is_some() {
                CallWindowProcW(original, hwnd, message, wparam, lparam)
            } else {
                DefWindowProcW(hwnd, message, wparam, lparam)
            }
        };
        if message == WM_STYLECHANGING && wparam.0 as isize == GWL_STYLE.0 as isize && lparam.0 != 0
        {
            let styles = unsafe { &mut *(lparam.0 as *mut STYLESTRUCT) };
            styles.styleNew = borderless_style(styles.styleNew);
        }
        if message == WM_NCDESTROY {
            WINDOW.store(0, Ordering::Release);
            PREVIOUS.store(0, Ordering::Release);
        }
        result
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn removes_all_native_frame_bits_and_preserves_visibility_flags() {
            let retained = WS_VISIBLE.0 | WS_DISABLED.0 | WS_CLIPCHILDREN.0 | WS_CLIPSIBLINGS.0;
            assert_eq!(
                borderless_style(WS_OVERLAPPEDWINDOW.0 | retained),
                retained | WS_POPUP.0
            );
            assert_eq!(
                borderless_style(retained | WS_POPUP.0),
                retained | WS_POPUP.0
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn outside_click_uses_physical_ring_and_respects_setting() {
        let dir = std::env::temp_dir().join(format!("orbit-outside-{}", model::new_id()));
        let mut settings = model::default_settings("C:\\Docs", vec![]);
        settings.close_on_outside_click = true;
        let state = AppState::new(
            crate::storage::Store::new(settings, dir.join("settings.json")),
            dir,
            vec![],
        );
        let bounds = Rect {
            x: -900,
            y: 100,
            width: 900,
            height: 900,
        };
        lock(&state.wheel).open(Trigger::Mouse, bounds, 520.0, 1.5);
        state.outside_click(-450, 550);
        assert!(
            lock(&state.wheel).visible,
            "physical window center is inside"
        );
        state.outside_click(-450 + 300, 550);
        assert!(
            lock(&state.wheel).visible,
            "300 px remains inside a 336 px physical radius"
        );
        state.outside_click(-450 + 340, 550);
        assert!(
            !lock(&state.wheel).visible,
            "physical pixels must be scaled once"
        );
        // A separate in-memory Store avoids persistence just to vary this preference.
        let dir = std::env::temp_dir().join(format!("orbit-outside-off-{}", model::new_id()));
        let mut settings = model::default_settings("C:\\Docs", vec![]);
        settings.close_on_outside_click = false;
        let state = AppState::new(
            crate::storage::Store::new(settings, dir.join("settings.json")),
            dir,
            vec![],
        );
        lock(&state.wheel).open(Trigger::Mouse, bounds, 520.0, 1.5);
        state.outside_click(1000, 1000);
        assert!(lock(&state.wheel).visible);
    }
    #[test]
    fn only_current_unshown_session_can_be_presented() {
        let mut wheel = WheelState::default();
        wheel.open(Trigger::Mouse, Rect::default(), 520.0, 1.0);
        let first = wheel.session;
        assert!(wheel.visible);
        assert!(
            !wheel.shown,
            "opening must remain hidden until paint or timeout"
        );
        assert!(!wheel.present(first + 1));
        assert!(wheel.present(first), "paint or timeout may win the race");
        assert!(
            !wheel.present(first),
            "the other callback must not show twice"
        );
        wheel.close();
        assert!(
            !wheel.present(first),
            "late paint cannot resurrect a closed wheel"
        );
        wheel.open(Trigger::Keyboard, Rect::default(), 520.0, 1.0);
        assert!(!wheel.shown);
        assert!(
            !wheel.present(first),
            "old timeout cannot show a new session"
        );
        assert!(wheel.present(wheel.session));
    }
    #[test]
    fn session_guard_rejects_stale_commands_before_their_side_effects() {
        let dir = std::env::temp_dir().join(format!("orbit-wheel-{}", model::new_id()));
        let state = AppState::new(
            crate::storage::Store::new(
                model::default_settings("C:\\Docs", vec![]),
                dir.join("settings.json"),
            ),
            dir,
            vec![],
        );
        lock(&state.wheel).open(Trigger::Preview, Rect::default(), 520.0, 1.0);
        let old = lock(&state.wheel).session;
        state.wheel_close(old).unwrap();
        lock(&state.wheel).open(Trigger::Preview, Rect::default(), 520.0, 1.0);
        assert!(
            state
                .wheel_session(old, |_| -> Result<(), String> {
                    panic!("stale command ran");
                })
                .is_err()
        );
        assert!(lock(&state.wheel).visible);
        assert!(state.wheel_close(old).is_err());
        assert!(lock(&state.wheel).visible);
        state.wheel_painted(old).unwrap();
        assert!(!lock(&state.wheel).shown);
        let current = lock(&state.wheel).session;
        state.wheel_navigate(current, vec![], Some(999)).unwrap();
        assert_eq!(lock(&state.wheel).selected, None);
        assert!(
            state
                .wheel_navigate(current, vec!["missing".into()], None)
                .is_err()
        );
        assert!(lock(&state.wheel).stack.is_empty());
    }
    #[test]
    fn placement_matches_legacy_physical_bounds_at_fractional_scale() {
        let area = Rect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let (bounds, size) = placement(780, -5, 1035, area, 1.5);
        assert_eq!(
            bounds,
            Rect {
                x: -1290,
                y: 0,
                width: 1290,
                height: 1040
            }
        );
        assert!((size - (1040.0 / 1.5 - 60.0)).abs() < 0.001);
        let (bounds, size) = placement(
            520,
            960,
            540,
            Rect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
            1.0,
        );
        assert_eq!(
            bounds,
            Rect {
                x: 660,
                y: 240,
                width: 600,
                height: 600
            }
        );
        assert_eq!(size, 520.0);
    }
    #[test]
    fn reopen_resets_interaction_and_close_invalidates_session() {
        let mut w = WheelState::default();
        w.open(
            Trigger::Mouse,
            Rect {
                width: 600,
                height: 600,
                ..Default::default()
            },
            520.0,
            1.0,
        );
        w.stack.push("group".into());
        w.selected = Some(1);
        w.released = true;
        w.busy = true;
        assert!(!w.outside(300, 300));
        assert!(w.outside(599, 599));
        let session = w.session;
        assert!(w.close());
        assert!(w.session > session);
        assert!(!w.close());
        w.open(Trigger::Preview, Rect::default(), 520.0, 1.0);
        assert!(w.stack.is_empty());
        assert_eq!(w.selected, None);
        assert!(!w.released);
        assert!(!w.busy);
    }
}
