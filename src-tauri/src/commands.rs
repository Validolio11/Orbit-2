//! Thin native IPC boundary. Blocking OS work runs off the WebView/UI thread.
use crate::{
    model::{Kind, Settings},
    platform::os,
    state::{AppEvent, AppState, Snapshot, UpdateView, lock},
    wheel::Trigger,
};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

type Shared<'a> = State<'a, Arc<AppState>>;

#[tauri::command]
pub fn get_state(state: Shared<'_>) -> Snapshot {
    state.snapshot()
}

#[tauri::command]
pub async fn save_settings(
    state: Shared<'_>,
    settings: Settings,
    base_revision: Option<u64>,
) -> Result<Settings, String> {
    let state = state.inner().clone();
    blocking(move || state.save_if(settings, base_revision)).await
}

#[derive(Serialize)]
pub struct CatalogEntry {
    name: String,
    target: String,
    args: String,
}
#[derive(Serialize)]
pub struct CatalogView {
    entries: Vec<CatalogEntry>,
    loading: bool,
    error: Option<String>,
}
#[tauri::command]
pub fn catalog_search(state: Shared<'_>, query: String, limit: Option<usize>) -> CatalogView {
    let result = state.catalog.search(&query, limit.unwrap_or(30).min(100));
    let loading = state.catalog.is_loading() || result.is_none();
    let (entries, error) = result.unwrap_or_default();
    CatalogView {
        entries: entries
            .into_iter()
            .map(|e| CatalogEntry {
                name: e.name,
                target: e.target,
                args: e.args,
            })
            .collect(),
        loading,
        error,
    }
}
#[tauri::command]
pub fn refresh_catalog(state: Shared<'_>) {
    state.catalog.refresh();
}

#[tauri::command]
pub async fn item_icon(
    state: Shared<'_>,
    target: String,
    physical_px: u32,
) -> Result<Option<String>, String> {
    let state = state.inner().clone();
    blocking(move || state.icons.get(&target, physical_px)).await
}
#[tauri::command]
pub async fn launch_action(state: Shared<'_>, id: String) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || state.launch_action(&id)).await
}
#[tauri::command]
pub async fn open_wheel_preview(state: Shared<'_>) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(60));
        state.open_wheel(Trigger::Preview, None, 0)
    })
    .await
}
#[tauri::command]
pub fn close_wheel(state: Shared<'_>) -> Result<(), String> {
    state.close_wheel()
}
#[tauri::command]
pub fn wheel_painted(state: Shared<'_>, session: u64) -> Result<(), String> {
    state.wheel_painted(session)
}
#[tauri::command]
pub fn wheel_close(state: Shared<'_>, session: u64) -> Result<(), String> {
    state.wheel_close(session)
}
#[tauri::command]
pub fn wheel_navigate(
    state: Shared<'_>,
    session: u64,
    stack: Vec<String>,
    selected: Option<usize>,
) -> Result<(), String> {
    state.wheel_navigate(session, stack, selected)
}
#[tauri::command]
pub async fn wheel_switch_menu(
    state: Shared<'_>,
    session: u64,
    direction: i32,
) -> Result<Snapshot, String> {
    let state = state.inner().clone();
    blocking(move || state.wheel_switch_menu(session, direction)).await
}
#[tauri::command]
pub async fn wheel_launch(state: Shared<'_>, session: u64, id: String) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || state.wheel_launch(session, id)).await
}
#[tauri::command]
pub async fn wheel_add_foreground(
    state: Shared<'_>,
    session: u64,
    group_path: Vec<String>,
) -> Result<String, String> {
    let state = state.inner().clone();
    blocking(move || state.wheel_add_foreground(session, group_path)).await
}
#[tauri::command]
pub async fn wheel_open_add_dialog(
    state: Shared<'_>,
    session: u64,
    group_path: Vec<String>,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || state.wheel_open_add_dialog(session, group_path)).await
}
#[tauri::command]
pub async fn add_foreground(state: Shared<'_>) -> Result<String, String> {
    let state = state.inner().clone();
    blocking(move || state.add_foreground()).await
}
#[tauri::command]
pub fn open_add_dialog(state: Shared<'_>, group_path: Vec<String>) {
    state.open_add_dialog(group_path);
}

#[tauri::command]
pub async fn pick_file(
    app: tauri::AppHandle,
    kind: Option<Kind>,
) -> Result<Option<String>, String> {
    blocking(move || {
        let mut dialog = app.dialog().file().set_title("Вибрати файл");
        dialog = match kind {
            Some(Kind::App) => dialog.add_filter("Застосунки", &["exe", "lnk"]),
            Some(Kind::Script) => dialog.add_filter("Скрипти", &["ps1", "py", "js", "cjs"]),
            _ => dialog,
        };
        dialog
            .blocking_pick_file()
            .map(|p| {
                p.into_path()
                    .map(|p| p.display().to_string())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
}
#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    blocking(move || {
        app.dialog()
            .file()
            .set_title("Вибрати папку")
            .blocking_pick_folder()
            .map(|p| {
                p.into_path()
                    .map(|p| p.display().to_string())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
}

#[tauri::command]
pub async fn export_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: Shared<'_>,
) -> Result<bool, String> {
    let state = state.inner().clone();
    blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Експортувати налаштування Orbit")
            .set_file_name("orbit-settings.json")
            .add_filter("Orbit JSON", &["json"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        crate::storage::export(&path, &state.store.get()).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn import_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: Shared<'_>,
) -> Result<Option<Settings>, String> {
    let state = state.inner().clone();
    blocking(move || {
        let confirmed = app
            .dialog()
            .message("Поточні меню та налаштування буде замінено даними з обраного файлу. Імпорт самостійно не запускає жодних дій.")
            .title("Імпортувати налаштування?")
            .parent(&window)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Вибрати JSON-файл".into(),
                "Скасувати".into(),
            ))
            .blocking_show();
        if !confirmed {
            return Ok(None);
        }
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Імпортувати налаштування Orbit")
            .add_filter("Orbit JSON", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let settings = crate::storage::import(&path)?;
        state.save(settings).map(Some)
    })
    .await
}

#[tauri::command]
pub fn check_update(state: Shared<'_>) -> UpdateView {
    state.updater.check();
    state.update_view()
}
#[tauri::command]
pub fn download_update(state: Shared<'_>) -> UpdateView {
    state.updater.download();
    state.update_view()
}
#[tauri::command]
pub async fn install_update(state: Shared<'_>) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || {
        state.updater.install()?;
        state.quit();
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn set_admin(state: Shared<'_>, enabled: bool) -> Result<bool, String> {
    let state = state.inner().clone();
    blocking(move || {
        let result = os::admin_set(enabled);
        let status = os::admin_status();
        state.set_runtime(|r| r.admin = status);
        let result = result?;
        if result {
            if status.enabled != enabled {
                return Err(format!(
                    "Windows не {} завдання запуску Orbit.",
                    if enabled {
                        "створив"
                    } else {
                        "видалив"
                    }
                ));
            }
            if enabled != status.elevated {
                state.send(AppEvent::Toast {
                    message: "Перезапустіть Orbit, щоб застосувати права адміністратора.".into(),
                    error: false,
                });
            }
        }
        Ok(result)
    })
    .await
}
#[tauri::command]
pub fn take_events(state: Shared<'_>) -> Vec<crate::state::AppEvent> {
    std::mem::take(&mut lock(&state.events))
}

#[derive(Serialize)]
pub struct FolderView {
    group: &'static str,
    name: String,
    path: String,
    icon: &'static str,
}
#[tauri::command]
pub async fn list_folders() -> Result<Vec<FolderView>, String> {
    blocking(|| {
        Ok(crate::launcher::list_folders()
            .into_iter()
            .map(|f| FolderView {
                group: f.group,
                name: f.name,
                path: f.path,
                icon: f.icon,
            })
            .collect())
    })
    .await
}
#[derive(Serialize)]
pub struct ScriptView {
    name: String,
    path: String,
    extension: String,
    folder: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptsView {
    scripts: Vec<ScriptView>,
    python_available: bool,
}
#[tauri::command]
pub async fn list_scripts(state: Shared<'_>) -> Result<ScriptsView, String> {
    let settings = state.store.get();
    blocking(move || {
        let (scripts, python_available) = crate::launcher::list_scripts(&settings);
        Ok(ScriptsView {
            scripts: scripts
                .into_iter()
                .map(|s| ScriptView {
                    name: s.name,
                    path: s.path,
                    extension: s.extension,
                    folder: s.folder,
                })
                .collect(),
            python_available,
        })
    })
    .await
}
#[tauri::command]
pub fn window_command(window: tauri::WebviewWindow, action: String) -> Result<(), String> {
    match action.as_str() {
        "minimize" => window.minimize(),
        "toggle_maximize" => window.is_maximized().and_then(|max| {
            if max {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }),
        "hide" => window.hide(),
        "drag" => window.start_dragging(),
        _ => return Err("Невідома команда вікна.".into()),
    }
    .map_err(|e| e.to_string())
}
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}
