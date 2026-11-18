//! Installed programs: Start menu shortcuts, App Paths and Store apps, found by
//! `scripts/discover-apps.ps1` in the background and searched on every keystroke.

use crate::model::validate_packaged_target;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq)]
pub struct AppEntry {
    pub name: String,
    pub target: String,
    pub args: String,
    resolved: String,
    terms: Vec<String>,
    source: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    name: String,
    target: String,
    #[serde(default)]
    args: String,
    source: String,
    #[serde(default)]
    resolved_target: Option<String>,
    #[serde(default)]
    resolved_args: Option<String>,
    #[serde(default)]
    aliases: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cache {
    version: u32,
    saved_at: u64,
    apps: Vec<Row>,
}

pub fn normalize(text: &str) -> String {
    text.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_local_app(target: &str) -> bool {
    let b = target.as_bytes();
    target.len() <= 4096
        && !target.contains(['\0', '\r', '\n'])
        && b.len() > 3
        && b[0].is_ascii_alphabetic()
        && b[1] == b':'
        && (b[2] == b'\\' || b[2] == b'/')
        && [".exe", ".lnk"]
            .iter()
            .any(|e| target.to_ascii_lowercase().ends_with(e))
}
fn key(target: &str) -> String {
    target.replace('/', "\\").to_lowercase()
}
/// Start-menu uninstall shortcuts are noise in a launcher.
fn is_uninstaller(name: &str, targets: &[&str]) -> bool {
    let first = name
        .trim()
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_lowercase();
    if [
        "uninstall",
        "видалити",
        "удалить",
        "деінсталювати",
        "деинсталлировать",
    ]
    .contains(&first.as_str())
    {
        return true;
    }
    targets.iter().any(|t| {
        let file = crate::model::base_name(t).to_lowercase();
        file.ends_with(".exe")
            && (file.starts_with("uninstall")
                || (file.starts_with("unins")
                    && file[5..file.len() - 4].chars().all(|c| c.is_ascii_digit())))
    })
}
fn priority(source: &str) -> u8 {
    match source {
        "start-menu" => 0,
        "app-paths" => 1,
        _ => 2,
    }
}

fn normalize_rows(rows: Vec<Row>) -> Vec<AppEntry> {
    let mut unique: HashMap<String, AppEntry> = HashMap::new();
    for row in rows.into_iter().take(5000) {
        if !["start-menu", "app-paths", "windows-app"].contains(&row.source.as_str()) {
            continue;
        }
        let name: String = row
            .name
            .replace(['\0', '\r', '\n'], " ")
            .trim()
            .chars()
            .take(100)
            .collect();
        let target = row.target.trim().to_string();
        let args = if row.args.len() <= 4096 && !row.args.contains('\0') {
            row.args.clone()
        } else {
            String::new()
        };
        if name.is_empty()
            || is_uninstaller(
                &name,
                &[&row.target, row.resolved_target.as_deref().unwrap_or("")],
            )
        {
            continue;
        }
        if target.to_lowercase().starts_with("app-id:") {
            if validate_packaged_target(&target, &args).is_err() {
                continue;
            }
        } else if !is_local_app(&target) {
            continue;
        }
        let resolved = row
            .resolved_target
            .filter(|t| is_local_app(t))
            .unwrap_or_else(|| target.clone());
        let resolved_args = if resolved != target {
            row.resolved_args.unwrap_or_default()
        } else {
            args.clone()
        };
        let id = format!("{}\0{}", key(&resolved), resolved_args.trim());
        let mut terms: BTreeSet<String> = row
            .aliases
            .iter()
            .filter(|a| a.len() <= 100)
            .take(20)
            .map(|a| normalize(a))
            .collect();
        terms.insert(normalize(&name));
        let entry = AppEntry {
            name,
            target,
            args,
            resolved,
            terms: terms.into_iter().collect(),
            source: row.source,
        };
        match unique.get_mut(&id) {
            None => {
                unique.insert(id, entry);
            }
            Some(previous) => {
                let mut all: BTreeSet<String> = previous.terms.iter().cloned().collect();
                all.extend(entry.terms.iter().cloned());
                if priority(&entry.source) < priority(&previous.source) {
                    *previous = entry;
                }
                previous.terms = all.into_iter().collect();
            }
        }
    }
    let mut list: Vec<AppEntry> = unique.into_values().collect();
    list.sort_by(|a, b| normalize(&a.name).cmp(&normalize(&b.name)));
    list
}

/// Matches by any name or alias; names that start with the query come first.
pub fn search(entries: &[AppEntry], query: &str, limit: usize) -> Vec<AppEntry> {
    let q = normalize(query);
    let mut matches: Vec<&AppEntry> = if q.is_empty() {
        entries.iter().collect()
    } else {
        entries
            .iter()
            .filter(|e| e.terms.iter().any(|t| t.contains(&q)))
            .collect()
    };
    if !q.is_empty() {
        matches.sort_by_key(|e| !normalize(&e.name).starts_with(&q));
    }
    matches.into_iter().take(limit).cloned().collect()
}

#[derive(Default)]
struct State {
    entries: Option<Arc<Vec<AppEntry>>>,
    error: Option<String>,
    loading: bool,
    generation: u64,
}

/// The program index, shared by the editor and the wheel's "+" slot.
#[derive(Clone)]
pub struct Catalog {
    state: Arc<Mutex<State>>,
    cache: PathBuf,
    notify: Arc<dyn Fn() + Send + Sync>,
}

const DISCOVERY_ERROR: &str =
    "Не вдалося прочитати список застосунків. Натисніть «Оновити» або виберіть файл вручну.";

impl Catalog {
    pub fn new(cache: PathBuf, notify: Arc<dyn Fn() + Send + Sync>) -> Self {
        Catalog {
            state: Default::default(),
            cache,
            notify,
        }
    }
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Starts from the cache (less than a day old) and refreshes it in the background.
    pub fn warm(&self) {
        if self.lock().entries.is_some() || self.lock().loading {
            return;
        }
        if let Some(apps) = std::fs::read(&self.cache)
            .ok()
            .filter(|d| d.len() <= 1024 * 1024)
            .and_then(|d| serde_json::from_slice::<Cache>(&d).ok())
        {
            let now = now();
            if apps.version == 1
                && apps.saved_at <= now + 300_000
                && now - apps.saved_at.min(now) < 86_400_000
            {
                self.lock().entries = Some(Arc::new(normalize_rows(apps.apps)));
            }
        }
        self.refresh();
    }

    pub fn refresh(&self) {
        let generation = {
            let mut s = self.lock();
            if s.loading {
                return;
            }
            s.loading = true;
            s.generation += 1;
            s.generation
        };
        let catalog = self.clone();
        std::thread::spawn(move || {
            let result = crate::platform::os::discover_apps().and_then(|text| {
                serde_json::from_str::<Vec<Row>>(text.trim()).map_err(|e| e.to_string())
            });
            let mut state = catalog.lock();
            if state.generation == generation {
                match result {
                    Ok(rows) => {
                        let entries = normalize_rows(rows);
                        let cache = Cache {
                            version: 1,
                            saved_at: now(),
                            apps: entries
                                .iter()
                                .map(|e| Row {
                                    name: e.name.clone(),
                                    target: e.target.clone(),
                                    args: e.args.clone(),
                                    source: e.source.clone(),
                                    resolved_target: Some(e.resolved.clone()),
                                    resolved_args: None,
                                    aliases: e.terms.clone(),
                                })
                                .collect(),
                        };
                        if let Ok(text) = serde_json::to_string(&cache) {
                            if text.len() < 1024 * 1024 {
                                let _ = std::fs::write(&catalog.cache, text);
                            }
                        }
                        state.entries = Some(Arc::new(entries));
                        state.error = None;
                    }
                    Err(_) => {
                        if state.entries.is_none() {
                            state.entries = Some(Arc::new(Vec::new()));
                        }
                        state.error = Some(DISCOVERY_ERROR.into());
                    }
                }
            }
            state.loading = false;
            drop(state);
            (catalog.notify)();
        });
    }

    /// None while the first index is still being built.
    pub fn search(&self, query: &str, limit: usize) -> Option<(Vec<AppEntry>, Option<String>)> {
        let state = self.lock();
        let entries = state.entries.clone()?;
        let error = state.error.clone();
        drop(state);
        Some((search(&entries, query, limit), error))
    }

    /// The catalog entry for a running executable, so the action keeps the shortcut's name and arguments.
    pub fn find_executable(&self, exe: &str) -> Option<AppEntry> {
        let entries = self.lock().entries.clone()?;
        let k = key(exe);
        let matches: Vec<&AppEntry> = entries.iter().filter(|e| key(&e.resolved) == k).collect();
        matches
            .iter()
            .find(|e| e.args.trim().is_empty())
            .or(matches.first())
            .map(|e| (*e).clone())
    }

    pub fn find_named(&self, names: &[&str]) -> Vec<AppEntry> {
        let Some(entries) = self.lock().entries.clone() else {
            return vec![];
        };
        names
            .iter()
            .filter_map(|n| {
                entries
                    .iter()
                    .find(|e| normalize(&e.name) == normalize(n))
                    .cloned()
            })
            .collect()
    }
    pub fn is_loading(&self) -> bool {
        self.lock().loading
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(name: &str, target: &str, source: &str) -> Row {
        Row {
            name: name.into(),
            target: target.into(),
            args: String::new(),
            source: source.into(),
            resolved_target: None,
            resolved_args: None,
            aliases: vec![],
        }
    }
    #[test]
    fn normalizes_dedupes_and_searches() {
        let rows = vec![
            row(
                "Adobe Illustrator 2026",
                r"C:\Adobe\Illustrator.exe",
                "app-paths",
            ),
            row("Illustrator", r"C:\Adobe\Illustrator.exe", "start-menu"),
            row("Uninstall Zoom", r"C:\Zoom\uninstall.exe", "start-menu"),
            row("Видалити Telegram", r"C:\T\unins000.exe", "start-menu"),
            row(
                "Photos",
                "app-id:Microsoft.Windows.Photos_8wekyb3d8bbwe!App",
                "windows-app",
            ),
            row("Bad", "relative.exe", "start-menu"),
        ];
        let entries = normalize_rows(rows);
        assert_eq!(
            entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            ["Illustrator", "Photos"]
        );
        assert_eq!(
            search(&entries, "adobe", 10)[0].name,
            "Illustrator",
            "aliases from duplicates stay searchable"
        );
        assert_eq!(search(&entries, "pho", 10)[0].name, "Photos");
        assert!(search(&entries, "zzz", 10).is_empty());
    }
}
