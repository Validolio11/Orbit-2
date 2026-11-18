use crate::{
    commands, install, model,
    platform::{InputEvent, Instance, TrayCommand, os},
    state::{AppEvent, AppState, lock},
    storage, updater,
    wheel::Trigger,
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// A headless path: validate the shared defaults and the assets actually embedded in this crate.
pub fn self_test() -> Result<(), String> {
    model::default_settings("C:\\Docs", vec![]).checked()?;
    image::load_from_memory(include_bytes!("../../assets/orbit-256.png"))
        .map_err(|e| e.to_string())?;
    let icons: serde_json::Value =
        serde_json::from_str(include_str!("../../assets/icons/map.json"))
            .map_err(|e| e.to_string())?;
    if icons.get("orbit").is_none() {
        return Err("Не знайдено значок Orbit.".into());
    }
    if !include_str!("../dist/index.html").contains("type=\"module\"")
        || !include_str!("../ui/wheel.html").contains("wheel.js")
    {
        return Err("Не знайдено сторінки Orbit.".into());
    }
    Ok(())
}

pub fn run() -> Result<(), String> {
    // WebView2 has no top hairline to hide; cropping rows would draw one at the cut.
    os::set_top_crop(0);
    let args: Vec<String> = std::env::args().skip(1).collect();
    let has = |flag: &str| args.iter().any(|a| a == flag);
    if has("--self-test") {
        return self_test();
    }
    if cfg!(windows) && install::launched_as_setup(&args) {
        return install::install(
            has("/silent") || has("--silent"),
            !has("/nolaunch") && !has("--nolaunch"),
        );
    }
    if has("--uninstall") {
        install::uninstall();
        return Ok(());
    }
    let data = storage::data_dir();
    let mut mode = if has("--quit") {
        "--quit"
    } else if has("--hidden") {
        "--hidden"
    } else {
        "--show"
    }
    .to_string();
    if has("--elevated-task") {
        if let Ok(saved) = std::fs::read_to_string(data.join("admin-start-mode")) {
            mode = saved.trim().to_string();
        }
        let _ = std::fs::remove_file(data.join("admin-start-mode"));
    } else if os::admin_hand_over(&mode, &data) {
        return Ok(());
    }
    // The reused Win32 service already implements single instance and the native tray.
    if let Instance::Forwarded = os::single_instance(mode == "--quit") {
        return Ok(());
    }
    if mode == "--quit" {
        return Ok(());
    }
    if has("--updated") {
        install::refresh_uninstall_entry();
    }
    updater::cleanup(&data.join("updates"));
    let documents = dirs::document_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let (settings, loaded) = storage::load(&data.join("settings.json"), || {
        model::default_settings(&documents, adobe_actions())
    });
    let first_run = matches!(loaded, storage::Loaded::Fresh);
    let notices = match loaded {
        storage::Loaded::FromBackup(file) => vec![AppEvent::Notice {
            title: "Налаштування Orbit відновлено з резервної копії.".into(),
            body: format!(
                "Основний файл був пошкоджений, тож останні зміни перед цим могли не зберегтися. Пошкоджений файл збережено як:\n{}",
                file.display()
            ),
        }],
        storage::Loaded::Reset(file) => vec![AppEvent::Notice {
            title: "Не вдалося прочитати налаштування Orbit.".into(),
            body: format!(
                "Меню скинуто до початкових. Попередній файл збережено як:\n{}",
                file.display()
            ),
        }],
        _ => vec![],
    };
    let store = storage::Store::new(settings, data.join("settings.json"));
    if first_run {
        store.save(store.get())?;
    }
    let state = AppState::new(store, data, notices);
    let setup_state = state.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::save_settings,
            commands::catalog_search,
            commands::refresh_catalog,
            commands::item_icon,
            commands::launch_action,
            commands::open_wheel_preview,
            commands::close_wheel,
            commands::wheel_painted,
            commands::wheel_close,
            commands::wheel_navigate,
            commands::wheel_switch_menu,
            commands::wheel_launch,
            commands::wheel_add_foreground,
            commands::wheel_open_add_dialog,
            commands::add_foreground,
            commands::open_add_dialog,
            commands::pick_file,
            commands::pick_folder,
            commands::export_settings,
            commands::import_settings,
            commands::check_update,
            commands::download_update,
            commands::install_update,
            commands::set_admin,
            commands::take_events,
            commands::list_folders,
            commands::list_scripts,
            commands::window_command,
        ])
        .setup(move |app| {
            let _ = setup_state.app.set(app.handle().clone());
            let icon =
                tauri::image::Image::from_bytes(include_bytes!("../../assets/orbit-256.png"))?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Orbit")
                .inner_size(1260.0, 860.0)
                .min_inner_size(1100.0, 760.0)
                .decorations(false)
                .visible(mode != "--hidden")
                .icon(icon.clone())?
                .build()?;
            // Load the transparent overlay at startup without ever presenting its blank surface.
            let wheel =
                WebviewWindowBuilder::new(app, "wheel", WebviewUrl::App("wheel.html".into()))
                    .title("Orbit — колесо")
                    .inner_size(600.0, 600.0)
                    .resizable(false)
                    .visible(false)
                    .transparent(true)
                    .decorations(false)
                    .shadow(false)
                    .skip_taskbar(true)
                    .always_on_top(true)
                    .focused(false)
                    .focusable(false)
                    .background_color(tauri::window::Color(0, 0, 0, 0))
                    .icon(icon)?
                    .build()?;
            crate::wheel::prepare_window(&wheel)?;
            start_services(setup_state.clone(), first_run);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let state = window.state::<Arc<AppState>>();
                if window.label() == "wheel" {
                    let _ = state.close_wheel();
                } else {
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .map_err(|e| e.to_string())?
        .run(|_, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                os::stop_input();
            }
        });
    Ok(())
}

fn start_services(state: Arc<AppState>, first_run: bool) {
    let settings = state.store.get();
    // Set optimistic initial status before the service can report failures.
    state.set_runtime(|r| {
        r.hook_ready = cfg!(windows) && settings.enabled;
        r.shortcut = cfg!(windows);
    });
    state.sync_tray();
    let input_state = state.clone();
    os::start_input(
        if settings.enabled {
            settings.trigger_button
        } else {
            0
        },
        Box::new(move |event| handle_input(&input_state, event)),
    );
    let admin_state = state.clone();
    std::thread::spawn(move || {
        let status = os::admin_status();
        admin_state.set_runtime(|r| r.admin = status);
    });
    os::set_login_item(settings.launch_at_login && install::is_installed_copy());
    state.catalog.warm();
    if first_run {
        seed_first_run(state);
    }
}
fn handle_input(state: &Arc<AppState>, event: InputEvent) {
    let result = match event {
        InputEvent::TriggerDown {
            x,
            y,
            foreground_pid,
        } => {
            if state.store.read(|s| s.enabled) {
                state.open_wheel(Trigger::Mouse, Some((x, y)), foreground_pid)
            } else {
                Ok(())
            }
        }
        InputEvent::TriggerUp => state.wheel_release(),
        InputEvent::Click { x, y } => {
            state.outside_click(x, y);
            Ok(())
        }
        InputEvent::Hotkey { foreground_pid } => {
            let visible = lock(&state.wheel).visible;
            if visible {
                state.close_wheel()
            } else {
                state.open_wheel(Trigger::Keyboard, None, foreground_pid)
            }
        }
        InputEvent::Escape => state.close_wheel(),
        InputEvent::Tray(TrayCommand::Open) => {
            state.show_main();
            Ok(())
        }
        InputEvent::Tray(TrayCommand::ShowWheel) => state.open_wheel(Trigger::Preview, None, 0),
        InputEvent::Tray(TrayCommand::Add) => {
            state.open_add_dialog(vec![]);
            Ok(())
        }
        InputEvent::Tray(TrayCommand::SelectMenu(id)) => {
            let mut next = state.store.get();
            next.active_menu_id = id;
            state.save(next).map(|_| ())
        }
        InputEvent::Tray(TrayCommand::ToggleEnabled) => {
            let mut next = state.store.get();
            next.enabled = !next.enabled;
            state.save(next).map(|_| ())
        }
        InputEvent::Tray(TrayCommand::Quit) | InputEvent::SecondInstance { quit: true } => {
            state.quit();
            Ok(())
        }
        InputEvent::SecondInstance { quit: false } => {
            state.show_main();
            Ok(())
        }
        InputEvent::HookFailed(error) => {
            state.set_runtime(|r| {
                if error.is_empty() {
                    r.shortcut = false;
                } else {
                    r.hook_ready = false;
                    r.hook_error = Some(error);
                }
            });
            Ok(())
        }
    };
    if let Err(message) = result {
        state.send(AppEvent::Toast {
            message,
            error: true,
        });
    }
}

fn seed_first_run(state: Arc<AppState>) {
    const APPS: [&str; 16] = [
        "Google Chrome",
        "Microsoft Edge",
        "Firefox",
        "Telegram",
        "Visual Studio Code",
        "Figma",
        "Spotify",
        "Discord",
        "Notion",
        "Slack",
        "Microsoft Word",
        "Microsoft Excel",
        "Zoom",
        "Steam",
        "Blender",
        "OBS Studio",
    ];
    let revision = state.store.revision();
    std::thread::spawn(move || {
        for _ in 0..60 {
            if !state.catalog.is_loading() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        let found = state.catalog.find_named(&APPS);
        if found.is_empty() || state.store.revision() != revision {
            return;
        }
        let mut next = state.store.get();
        let items = &mut next.menus[0].items;
        for entry in found.iter().take(11usize.saturating_sub(items.len())).rev() {
            let mut action =
                model::Action::new(model::Kind::App, entry.name.clone(), entry.target.clone());
            action.args = entry.args.clone();
            action.icon = "app".into();
            items.insert(0, action);
        }
        if let Err(message) = state.save(next) {
            state.send(AppEvent::Toast {
                message,
                error: true,
            });
        }
    });
}

/// The egui main module also owns UI entry points, so this small startup helper is adapted here.
fn adobe_actions() -> Vec<model::Action> {
    let find = |product: &str, exe: &str| -> Option<String> {
        for root in ["ProgramFiles", "ProgramFiles(x86)"]
            .iter()
            .filter_map(|key| std::env::var(key).ok())
        {
            let mut dirs: Vec<PathBuf> = std::fs::read_dir(Path::new(&root).join("Adobe"))
                .ok()?
                .flatten()
                .filter(|e| e.file_name().to_string_lossy().starts_with(product))
                .map(|e| e.path())
                .collect();
            dirs.sort();
            dirs.reverse();
            for dir in dirs {
                for candidate in [
                    dir.join(exe),
                    dir.join("Support Files").join(exe),
                    dir.join("Support Files")
                        .join("Contents")
                        .join("Windows")
                        .join(exe),
                ] {
                    if candidate.is_file() {
                        return Some(candidate.display().to_string());
                    }
                }
            }
        }
        None
    };
    [
        (
            "illustrator",
            "Illustrator",
            "Adobe Illustrator",
            "Illustrator.exe",
        ),
        (
            "after-effects",
            "After Effects",
            "Adobe After Effects",
            "AfterFX.exe",
        ),
        ("photoshop", "Photoshop", "Adobe Photoshop", "Photoshop.exe"),
    ]
    .into_iter()
    .filter_map(|(id, name, product, exe)| {
        find(product, exe).map(|target| model::Action {
            id: id.into(),
            name: name.into(),
            kind: model::Kind::App,
            target,
            args: String::new(),
            icon: id.into(),
            children: vec![],
        })
    })
    .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn bundled_assets_and_defaults_pass_headless_self_test() {
        super::self_test().unwrap();
    }
}
