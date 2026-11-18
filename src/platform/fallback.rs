//! Development stand-ins for systems other than Windows: no global input, files open with xdg-open.

use super::{AdminStatus, IconImage, InputEvent, Instance, Rect};

#[allow(dead_code)]
#[derive(Clone, Default)]
pub struct TrayModel {
    pub menus: Vec<(String, String)>,
    pub active: String,
    pub enabled: bool,
}

pub fn single_instance(_quit: bool) -> Instance {
    Instance::First
}
pub fn start_input(_button: u8, sink: Box<dyn Fn(InputEvent) + Send + Sync>) {
    sink(InputEvent::HookFailed(
        "Перехоплення миші доступне лише у Windows.".into(),
    ));
}
pub fn set_trigger_button(_button: u8) {}
pub fn set_escape(_active: bool) {}
pub fn set_tray(_model: TrayModel) {}
pub fn stop_input() {}
pub fn process_path(_pid: u32) -> String {
    String::new()
}
pub fn cursor() -> (i32, i32) {
    (640, 400)
}
pub fn work_area(_x: i32, _y: i32) -> (Rect, f32) {
    (
        Rect {
            x: 0,
            y: 0,
            width: 1600,
            height: 1000,
        },
        1.0,
    )
}
pub fn find_own_window(_title: &str) -> Option<isize> {
    None
}
pub fn place_window(_handle: isize, _rect: Rect, _activate: bool) {}
pub fn hide_window(_handle: isize) {}
pub fn set_top_crop(_rows: i32) {}
pub fn show_window(_handle: isize) {}
pub fn shell_open(target: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
pub fn spawn(
    program: &std::path::Path,
    args: &[String],
    cwd: Option<&std::path::Path>,
    _hidden: bool,
) -> Result<(), String> {
    let mut command = std::process::Command::new(program);
    command.args(args);
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}
pub fn system_keys(_action: &str) -> Result<(), String> {
    Err("Команди Windows доступні лише у Windows.".into())
}
pub fn app_icon(_path: &str) -> Option<IconImage> {
    None
}
pub fn set_login_item(_enabled: bool) {}
pub fn admin_status() -> AdminStatus {
    AdminStatus::default()
}
pub fn admin_set(_enabled: bool) -> Result<bool, String> {
    Err("Доступно лише у Windows.".into())
}
pub fn admin_hand_over(_mode: &str, _data_dir: &std::path::Path) -> bool {
    false
}
pub fn shell_folders() -> (Vec<(String, String)>, Vec<(String, String)>) {
    (vec![], vec![])
}
pub fn discover_apps() -> Result<String, String> {
    // ORBIT_FAKE_APPS lets the editor's program picker be exercised without Windows.
    std::env::var("ORBIT_FAKE_APPS")
        .map_err(|_| "Каталог програм доступний лише у Windows.".to_string())
}
pub fn set_registry_string(_key: &str, _name: &str, _value: &str) {}
pub fn delete_registry_tree(_key: &str) {}
pub fn create_shortcut(
    _link: &std::path::Path,
    _target: &std::path::Path,
    _args: &str,
    _description: &str,
) -> Result<(), String> {
    Err("Ярлики створюються лише у Windows.".into())
}
