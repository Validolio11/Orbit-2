//! Application state and IPC views, independent of egui and its viewport lifecycle.
use crate::{
    catalog::Catalog,
    icons::IconCache,
    model::Settings,
    platform::{self, os},
    storage::Store,
    updater::{Phase, Updater},
};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager};

pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AppEvent {
    ShowMain,
    Navigate { group_path: Vec<String>, add: bool },
    Toast { message: String, error: bool },
    ActionError { id: String, error: String },
    Notice { title: String, body: String },
}

#[derive(Clone, Debug, Default)]
pub struct Runtime {
    pub hook_ready: bool,
    pub hook_error: Option<String>,
    pub shortcut: bool,
    pub admin: platform::AdminStatus,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeView {
    hook_ready: bool,
    hook_error: Option<String>,
    shortcut: bool,
    admin: AdminView,
}
#[derive(Clone, Serialize)]
pub struct AdminView {
    available: bool,
    enabled: bool,
    elevated: bool,
}
impl From<platform::AdminStatus> for AdminView {
    fn from(value: platform::AdminStatus) -> Self {
        Self {
            available: value.available,
            enabled: value.enabled,
            elevated: value.elevated,
        }
    }
}
impl From<Runtime> for RuntimeView {
    fn from(value: Runtime) -> Self {
        Self {
            hook_ready: value.hook_ready,
            hook_error: value.hook_error,
            shortcut: value.shortcut,
            admin: value.admin.into(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateView {
    pub phase: &'static str,
    pub progress: Option<f32>,
    pub error: Option<String>,
    pub current_version: &'static str,
    pub available_version: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub settings: Settings,
    pub revision: u64,
    pub runtime: RuntimeView,
    pub wheel: crate::wheel::WheelView,
    pub update: UpdateView,
    pub catalog_loading: bool,
    pub notices: Vec<AppEvent>,
}

pub struct AppState {
    pub store: Store,
    pub catalog: Catalog,
    pub icons: IconCache,
    pub updater: Updater,
    pub wheel: Mutex<crate::wheel::WheelState>,
    pub runtime: Mutex<Runtime>,
    pub events: Mutex<Vec<AppEvent>>,
    pub notices: Vec<AppEvent>,
    pub app: Arc<OnceLock<AppHandle>>,
}

impl AppState {
    pub fn new(store: Store, data: PathBuf, notices: Vec<AppEvent>) -> Arc<Self> {
        let app = Arc::new(OnceLock::<AppHandle>::new());
        let notify = |event: &'static str| -> Arc<dyn Fn() + Send + Sync> {
            let app = app.clone();
            Arc::new(move || {
                if let Some(app) = app.get() {
                    let _ = app.emit(event, ());
                }
            })
        };
        Arc::new(Self {
            store,
            catalog: Catalog::new(data.join("app-catalog.json"), notify("catalog:changed")),
            updater: Updater::new(data.join("updates"), notify("update:changed")),
            icons: IconCache::default(),
            wheel: Mutex::new(Default::default()),
            runtime: Mutex::new(Default::default()),
            events: Mutex::new(Vec::new()),
            notices,
            app,
        })
    }
    pub fn snapshot(&self) -> Snapshot {
        let (settings, revision) = self.store.snapshot();
        Snapshot {
            settings,
            revision,
            runtime: lock(&self.runtime).clone().into(),
            wheel: lock(&self.wheel).view(),
            update: self.update_view(),
            catalog_loading: self.catalog.is_loading(),
            notices: self.notices.clone(),
        }
    }
    pub fn update_view(&self) -> UpdateView {
        let (phase, progress, error) = match self.updater.phase() {
            Phase::Idle => ("idle", None, None),
            Phase::Checking => ("checking", None, None),
            Phase::Available => ("available", None, None),
            Phase::UpToDate => ("upToDate", None, None),
            Phase::Downloading(n) => ("downloading", Some(n), None),
            Phase::Ready => ("ready", None, None),
            Phase::Installing => ("installing", None, None),
            Phase::Error(error) => ("error", None, Some(error)),
        };
        UpdateView {
            phase,
            progress,
            error,
            current_version: crate::updater::CURRENT,
            available_version: self.updater.version(),
        }
    }
    pub fn emit<T: Serialize + Clone>(&self, event: &str, payload: T) {
        if let Some(app) = self.app.get() {
            let _ = app.emit(event, payload);
        }
    }
    pub fn changed(&self) {
        self.emit("state:changed", self.snapshot());
    }
    pub fn send(&self, event: AppEvent) {
        // Retain a bounded queue for events emitted before the editor has subscribed.
        let mut events = lock(&self.events);
        if events.len() == 100 {
            events.remove(0);
        }
        events.push(event.clone());
        drop(events);
        self.emit("app:event", event);
    }
    pub fn set_runtime(&self, change: impl FnOnce(&mut Runtime)) {
        change(&mut lock(&self.runtime));
        self.changed();
    }
    pub fn save(&self, next: Settings) -> Result<Settings, String> {
        self.save_if(next, None)
    }
    pub fn save_if(&self, next: Settings, base_revision: Option<u64>) -> Result<Settings, String> {
        let previous = self.store.get();
        let saved = match base_revision {
            Some(revision) => self.store.save_if_revision(next, revision)?,
            None => self.store.save(next)?,
        };
        os::set_trigger_button(if saved.enabled {
            saved.trigger_button
        } else {
            0
        });
        if !saved.enabled {
            if let Err(message) = self.close_wheel() {
                // The settings have already been persisted; finish synchronizing the
                // hook/tray and report the window error separately.
                self.send(AppEvent::Toast {
                    message,
                    error: true,
                });
            }
        }
        if previous.launch_at_login != saved.launch_at_login {
            os::set_login_item(saved.launch_at_login && crate::install::is_installed_copy());
        }
        {
            let mut runtime = lock(&self.runtime);
            runtime.hook_ready = cfg!(windows) && saved.enabled && runtime.hook_error.is_none();
        }
        self.sync_tray();
        self.changed();
        Ok(saved)
    }
    pub fn sync_tray(&self) {
        let settings = self.store.get();
        os::set_tray(os::TrayModel {
            menus: settings
                .menus
                .iter()
                .map(|m| (m.id.clone(), m.name.clone()))
                .collect(),
            active: settings.active_menu_id,
            enabled: settings.enabled,
        });
    }
    pub fn show_main(&self) {
        if let Some(main) = self.app.get().and_then(|a| a.get_webview_window("main")) {
            let _ = main.unminimize();
            let _ = main.show();
            let _ = main.set_focus();
        }
        self.send(AppEvent::ShowMain);
    }
    pub fn open_add_dialog(&self, group_path: Vec<String>) {
        let _ = self.close_wheel();
        self.show_main();
        self.send(AppEvent::Navigate {
            group_path,
            add: true,
        });
    }
    pub fn quit(&self) {
        let _ = self.close_wheel();
        os::stop_input();
        if let Some(app) = self.app.get() {
            app.exit(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_preserves_settings_and_exposes_serializable_runtime() {
        let dir =
            std::env::temp_dir().join(format!("orbit-tauri-state-{}", crate::model::new_id()));
        let settings = crate::model::default_settings("C:\\Docs", vec![]);
        let state = AppState::new(
            Store::new(settings.clone(), dir.join("settings.json")),
            dir,
            vec![],
        );
        let view = serde_json::to_value(state.snapshot()).unwrap();
        assert_eq!(view["settings"], serde_json::to_value(settings).unwrap());
        assert_eq!(view["runtime"]["admin"]["enabled"], false);
        assert_eq!(view["wheel"]["visible"], false);
        assert_eq!(view["update"]["phase"], "idle");
    }
}
