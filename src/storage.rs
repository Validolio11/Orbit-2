//! Settings on disk: `%APPDATA%\Orbit\settings.json`, written so that a power cut cannot lose the menus.

use crate::model::{self, Settings};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

pub fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("ORBIT_DATA_DIR") {
        return PathBuf::from(dir);
    }
    dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Orbit")
}

/// The new text is flushed before it replaces the file, and the previous good file is kept as `.bak`.
pub fn write_durable(file: &Path, text: &str) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let temp = file.with_extension("json.tmp");
    {
        let mut handle = fs::File::create(&temp)?;
        handle.write_all(text.as_bytes())?;
        handle.sync_all()?;
    }
    if file.exists() {
        fs::copy(file, file.with_extension("json.bak"))?;
    }
    fs::rename(&temp, file)
}

fn parse(text: &str) -> Result<Settings, String> {
    let value: serde_json::Value =
        serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())?;
    model::validate(&value)
}

/// How loading went, so the first window can tell the user about a recovery.
pub enum Loaded {
    Fresh,
    Main,
    FromBackup(PathBuf),
    Reset(PathBuf),
}

pub fn load(file: &Path, defaults: impl FnOnce() -> Settings) -> (Settings, Loaded) {
    let main = fs::read_to_string(file);
    if let Ok(text) = &main {
        if let Ok(settings) = parse(text) {
            return (settings, Loaded::Main);
        }
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let aside = PathBuf::from(format!("{}.bad-{stamp}", file.display()));
    if let Ok(settings) = fs::read_to_string(file.with_extension("json.bak"))
        .map_err(|e| e.to_string())
        .and_then(|t| parse(&t))
    {
        // The damaged main file is moved aside so the next save cannot copy it over the good backup.
        let _ = fs::rename(file, &aside);
        return (settings, Loaded::FromBackup(aside));
    }
    match main {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (defaults(), Loaded::Fresh),
        _ => {
            let _ = fs::rename(file, &aside);
            (defaults(), Loaded::Reset(aside))
        }
    }
}

/// The one copy of the settings, shared by the editor, the wheel and the input thread.
#[derive(Clone)]
pub struct Store {
    inner: Arc<Mutex<Inner>>,
    file: Arc<PathBuf>,
}
struct Inner {
    settings: Settings,
    revision: u64,
}

impl Store {
    pub fn new(settings: Settings, file: PathBuf) -> Self {
        Store {
            inner: Arc::new(Mutex::new(Inner {
                settings,
                revision: 1,
            })),
            file: Arc::new(file),
        }
    }
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn get(&self) -> Settings {
        self.lock().settings.clone()
    }
    pub fn revision(&self) -> u64 {
        self.lock().revision
    }
    pub fn snapshot(&self) -> (Settings, u64) {
        let inner = self.lock();
        (inner.settings.clone(), inner.revision)
    }
    pub fn read<R>(&self, f: impl FnOnce(&Settings) -> R) -> R {
        f(&self.lock().settings)
    }
    /// Validates and persists a whole configuration; nothing changes when either step fails.
    pub fn save(&self, next: Settings) -> Result<Settings, String> {
        self.save_locked(&mut self.lock(), next)
    }
    /// Like `save`, but refuses when the settings changed since the caller read `expected`.
    #[allow(dead_code)] // used by the Tauri app
    pub fn save_if_revision(&self, next: Settings, expected: u64) -> Result<Settings, String> {
        let mut inner = self.lock();
        if inner.revision != expected {
            return Err(REVISION_MOVED.into());
        }
        self.save_locked(&mut inner, next)
    }
    fn save_locked(&self, inner: &mut Inner, next: Settings) -> Result<Settings, String> {
        let next = next.checked()?;
        let text = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
        write_durable(&self.file, &text)
            .map_err(|e| format!("Не вдалося зберегти налаштування: {e}"))?;
        inner.settings = next.clone();
        inner.revision += 1;
        Ok(next)
    }
    /// Applies a change to the settings that are current, holding the lock for the whole write.
    pub fn update(&self, change: impl FnOnce(&mut Settings)) -> Result<Settings, String> {
        let mut inner = self.lock();
        let mut next = inner.settings.clone();
        change(&mut next);
        self.save_locked(&mut inner, next)
    }
}

/// The editor matches this text to re-apply its edit on fresh settings.
#[allow(dead_code)] // used by the Tauri app
pub const REVISION_MOVED: &str =
    "Налаштування змінилися в іншому місці. Оновіть їх і повторіть зміну.";

/// Writes beside the target first, so a failed export never leaves a truncated file where an older export was.
pub fn export(file: &Path, settings: &Settings) -> std::io::Result<()> {
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let mut temp = file.as_os_str().to_owned();
    temp.push(".orbit-tmp");
    let temp = PathBuf::from(temp);
    let written = fs::File::create(&temp).and_then(|mut handle| {
        handle.write_all(text.as_bytes())?;
        handle.sync_all()
    });
    match written.and_then(|()| fs::rename(&temp, file)) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temp);
            Err(error)
        }
    }
}
pub fn import(file: &Path) -> Result<Settings, String> {
    let size = fs::metadata(file).map_err(|e| e.to_string())?.len();
    if size > 1024 * 1024 {
        return Err("Файл налаштувань завеликий.".into());
    }
    parse(&fs::read_to_string(file).map_err(|e| e.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn durable_save_keeps_a_backup_and_recovers_from_it() {
        let dir = std::env::temp_dir().join(format!("orbit-test-{}", model::new_id()));
        let file = dir.join("settings.json");
        let defaults = || model::default_settings("C:\\Docs", vec![]);
        let (first, loaded) = load(&file, defaults);
        assert!(matches!(loaded, Loaded::Fresh));
        let store = Store::new(first.clone(), file.clone());
        store.update(|s| s.hover_delay = 500).unwrap();
        store.update(|s| s.hover_delay = 750).unwrap();
        assert!(store.update(|s| s.hover_delay = 5).is_err());
        assert_eq!(store.get().hover_delay, 750);
        fs::write(&file, "{broken").unwrap();
        let (recovered, loaded) = load(&file, defaults);
        assert!(matches!(loaded, Loaded::FromBackup(_)));
        assert_eq!(recovered.hover_delay, 500);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_updates_are_not_lost() {
        let dir = std::env::temp_dir().join(format!("orbit-test-{}", model::new_id()));
        let store = Store::new(
            model::default_settings(r"C:\Docs", vec![]),
            dir.join("settings.json"),
        );
        let (a, b) = (store.clone(), store.clone());
        let ta = std::thread::spawn(move || {
            for i in 0..30 {
                a.update(|s| s.hover_delay = 200 + i).unwrap();
            }
        });
        let tb = std::thread::spawn(move || {
            for i in 0..30 {
                b.update(|s| s.wheel_size = 400 + i).unwrap();
            }
        });
        ta.join().unwrap();
        tb.join().unwrap();
        let s = store.get();
        assert_eq!((s.hover_delay, s.wheel_size), (229, 429));
        assert_eq!(store.revision(), 61);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn export_round_trips_through_import_and_replaces_an_older_export() {
        let dir = std::env::temp_dir().join(format!("orbit-test-{}", model::new_id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("orbit-settings.json");
        fs::write(&file, "older export").unwrap();
        let mut settings = model::default_settings(r"C:\Docs", vec![]);
        settings.hover_delay = 640;
        export(&file, &settings).unwrap();
        let back = import(&file).unwrap();
        assert_eq!(
            serde_json::to_value(&back).unwrap(),
            serde_json::to_value(&settings).unwrap()
        );
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(
            leftovers,
            vec![std::ffi::OsString::from("orbit-settings.json")]
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn import_rejects_files_that_are_not_orbit_settings() {
        let dir = std::env::temp_dir().join(format!("orbit-test-{}", model::new_id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("other.json");
        for text in ["", "[]", "{\"version\": 2}", "not json"] {
            fs::write(&file, text).unwrap();
            assert!(import(&file).is_err(), "{text:?} should be rejected");
        }
        fs::write(&file, vec![b' '; 1024 * 1024 + 1]).unwrap();
        assert_eq!(import(&file).unwrap_err(), "Файл налаштувань завеликий.");
        assert!(import(&dir.join("missing.json")).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn stale_revision_is_rejected() {
        let dir = std::env::temp_dir().join(format!("orbit-test-{}", model::new_id()));
        let store = Store::new(
            model::default_settings(r"C:\Docs", vec![]),
            dir.join("settings.json"),
        );
        let (stale, rev) = store.snapshot();
        store.update(|s| s.hover_delay = 600).unwrap();
        let mut next = stale.clone();
        next.hover_delay = 700;
        assert_eq!(
            store.save_if_revision(next.clone(), rev),
            Err(REVISION_MOVED.into())
        );
        assert_eq!(store.get().hover_delay, 600);
        store.save_if_revision(next, store.revision()).unwrap();
        assert_eq!(store.get().hover_delay, 700);
        let _ = fs::remove_dir_all(dir);
    }
}
