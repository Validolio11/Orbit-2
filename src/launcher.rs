//! Running actions, and the folders and scripts offered as tiles in the add dialog.

use crate::model::{
    self, Action, Kind, SCRIPT_EXTENSIONS, Settings, parse_arguments, validate_packaged_target,
};
use crate::platform::{self, os};
use std::path::{Path, PathBuf};

fn windows_dir() -> PathBuf {
    PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into()))
}

/// Starts an action. Errors are written for the user.
pub fn execute(action: &Action) -> Result<(), String> {
    let target = action.target.trim();
    match action.kind {
        Kind::Group => return Err("Відкрийте групу в колесі.".into()),
        _ if target.is_empty() => {
            return Err(
                "Спочатку виберіть шлях до застосунку або файлу в налаштуваннях дії.".into(),
            );
        }
        Kind::System => return system(target),
        _ => {}
    }
    if action.kind == Kind::App && target.starts_with("app-id:") {
        let id = validate_packaged_target(target, &action.args)?;
        return os::spawn(
            &windows_dir().join("explorer.exe"),
            &[format!("shell:AppsFolder\\{id}")],
            None,
            false,
        );
    }
    if action.kind == Kind::App && (target.starts_with("http://") || target.starts_with("https://"))
    {
        return os::shell_open(target);
    }
    let path = Path::new(target);
    if !(path.is_absolute() || target.as_bytes().get(1) == Some(&b':')) {
        return Err("Виберіть повний шлях до файлу.".into());
    }
    let meta = std::fs::metadata(path)
        .map_err(|_| "Файл або папку не знайдено. Оновіть шлях до дії.".to_string())?;
    let args = parse_arguments(&action.args)?;
    let ext = model::extension(target);
    let cwd = path.parent();
    match action.kind {
        Kind::Folder => {
            if !meta.is_dir() {
                return Err("Вибраний шлях не є папкою.".into());
            }
            os::shell_open(target)
        }
        Kind::Script => {
            if !meta.is_file() {
                return Err("Виберіть файл скрипту.".into());
            }
            let mut all = vec![target.to_string()];
            all.extend(args);
            match ext.as_str() {
                ".ps1" => {
                    let mut ps = vec!["-NoProfile".to_string(), "-File".into()];
                    ps.extend(all);
                    os::spawn(
                        &windows_dir().join("System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
                        &ps,
                        cwd,
                        true,
                    )
                }
                ".py" => os::spawn(
                    &platform::python_launcher().ok_or(
                        "Не знайдено Python Launcher (py.exe). Встановіть Python з python.org.",
                    )?,
                    &all,
                    cwd,
                    false,
                ),
                ".js" | ".cjs" => os::spawn(Path::new("node"), &all, cwd, true).map_err(|_| {
                    "Для .js-скриптів потрібен Node.js (node.exe у PATH).".to_string()
                }),
                _ => Err("Підтримуються скрипти .ps1, .py, .js та .cjs.".into()),
            }
        }
        _ if ext == ".exe" => os::spawn(path, &args, cwd, false),
        _ if ext == ".lnk" => {
            if !args.is_empty() {
                return Err("Додайте аргументи у властивостях ярлика або виберіть .exe.".into());
            }
            os::shell_open(target)
        }
        _ => Err("Для застосунку виберіть файл .exe або .lnk.".into()),
    }
}

fn system(target: &str) -> Result<(), String> {
    let windows = windows_dir();
    match target {
        "explorer" => os::spawn(&windows.join("explorer.exe"), &[], None, false),
        "recycle-bin" => os::spawn(
            &windows.join("explorer.exe"),
            &["shell:RecycleBinFolder".into()],
            None,
            false,
        ),
        "task-manager" => os::spawn(&windows.join("System32\\Taskmgr.exe"), &[], None, false),
        "control-panel" => os::spawn(&windows.join("System32\\control.exe"), &[], None, false),
        "calculator" => os::spawn(&windows.join("System32\\calc.exe"), &[], None, false),
        "notepad" => os::spawn(&windows.join("System32\\notepad.exe"), &[], None, false),
        "settings" => os::shell_open("ms-settings:"),
        "sound-settings" => os::shell_open("ms-settings:sound"),
        "bluetooth" => os::shell_open("ms-settings:bluetooth"),
        // Keyboard shortcuts go to the program in front once the wheel has let go of focus.
        other => {
            std::thread::sleep(std::time::Duration::from_millis(100));
            os::system_keys(other)
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct FolderTile {
    pub group: &'static str,
    pub name: String,
    pub path: String,
    pub icon: &'static str,
}

/// Quick Access first, then standard folders (with their Ukrainian names) and drives.
pub fn list_folders() -> Vec<FolderTile> {
    let (quick, drives) = os::shell_folders();
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let mut add = |group: &'static str, name: &str, path: &str, icon: &'static str| {
        let key = path.trim_end_matches(['\\', '/']).to_lowercase();
        if !path.is_empty() && seen.insert(key) {
            out.push(FolderTile {
                group,
                name: name.chars().take(100).collect(),
                path: path.to_string(),
                icon,
            });
        }
    };
    for (name, path) in &quick {
        add("quick", name, path, "folder");
    }
    let known = [
        (dirs::desktop_dir(), "Робочий стіл", "desktop"),
        (dirs::document_dir(), "Документи", "folder"),
        (dirs::download_dir(), "Завантаження", "import"),
        (dirs::picture_dir(), "Зображення", "image"),
        (dirs::video_dir(), "Відео", "film"),
        (dirs::audio_dir(), "Музика", "music"),
        (dirs::home_dir(), "Особиста папка", "home"),
    ];
    for (dir, name, icon) in known {
        if let Some(d) = dir {
            add("known", name, &d.display().to_string(), icon);
        }
    }
    if let Ok(one) = std::env::var("OneDrive") {
        add("known", "OneDrive", &one, "cloud");
    }
    for (name, path) in &drives {
        add("drive", name, path, "drive");
    }
    if cfg!(windows) && drives.is_empty() {
        for letter in 'C'..='Z' {
            let root = format!("{letter}:\\");
            if Path::new(&root).exists() {
                add("drive", &format!("Диск {letter}:"), &root, "drive");
            }
        }
    }
    out.retain(|f| Path::new(&f.path).exists());
    out
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScriptTile {
    pub name: String,
    pub path: String,
    pub extension: String,
    pub folder: String,
}

/// A shallow, bounded scan of the folders that already hold script actions, then Desktop, Documents and Downloads.
pub fn list_scripts(settings: &Settings) -> (Vec<ScriptTile>, bool) {
    let mut roots: Vec<PathBuf> = Vec::new();
    fn walk_actions(items: &[Action], roots: &mut Vec<PathBuf>) {
        for item in items {
            if item.kind == Kind::Script {
                if let Some(dir) = Path::new(&item.target).parent() {
                    if dir.is_absolute() && !roots.contains(&dir.to_path_buf()) {
                        roots.push(dir.to_path_buf());
                    }
                }
            }
            walk_actions(&item.children, roots);
        }
    }
    for menu in &settings.menus {
        walk_actions(&menu.items, &mut roots);
    }
    for dir in [
        dirs::desktop_dir(),
        dirs::document_dir(),
        dirs::download_dir(),
    ]
    .into_iter()
    .flatten()
    {
        if !roots.contains(&dir) {
            roots.push(dir);
        }
    }
    const SKIPPED: [&str; 10] = [
        "node_modules",
        ".git",
        "appdata",
        "$recycle.bin",
        "windows",
        "program files",
        "program files (x86)",
        "__pycache__",
        ".venv",
        "venv",
    ];
    let mut found: Vec<(ScriptTile, std::time::SystemTime)> = Vec::new();
    let mut visited = 0;
    fn walk(
        dir: &Path,
        depth: usize,
        visited: &mut usize,
        found: &mut Vec<(ScriptTile, std::time::SystemTime)>,
    ) {
        *visited += 1;
        if *visited > 600 || found.len() >= 400 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut subdirs = Vec::new();
        for entry in entries.flatten() {
            let (Ok(kind), name) = (
                entry.file_type(),
                entry.file_name().to_string_lossy().to_string(),
            ) else {
                continue;
            };
            if kind.is_file() {
                let ext = model::extension(&name);
                if SCRIPT_EXTENSIONS.contains(&ext.as_str())
                    && found.len() < 400
                    && !found.iter().any(|(t, _)| {
                        t.path
                            .eq_ignore_ascii_case(&entry.path().display().to_string())
                    })
                {
                    let modified = entry
                        .metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(std::time::UNIX_EPOCH);
                    found.push((
                        ScriptTile {
                            name: model::file_stem(&name),
                            path: entry.path().display().to_string(),
                            extension: ext,
                            folder: model::base_name(&dir.display().to_string()),
                        },
                        modified,
                    ));
                }
            } else if kind.is_dir()
                && depth < 2
                && !name.starts_with('.')
                && !SKIPPED.contains(&name.to_lowercase().as_str())
            {
                subdirs.push(entry.path());
            }
        }
        for sub in subdirs {
            walk(&sub, depth + 1, visited, found);
        }
    }
    for root in roots {
        walk(&root, 0, &mut visited, &mut found);
    }
    found.sort_by(|a, b| b.1.cmp(&a.1));
    (
        found.into_iter().take(60).map(|(t, _)| t).collect(),
        platform::python_launcher().is_some(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn act(kind: Kind, target: &str, args: &str) -> Action {
        Action {
            id: "t".into(),
            name: "t".into(),
            kind,
            target: target.into(),
            args: args.into(),
            icon: String::new(),
            children: vec![],
        }
    }

    /// Every case is rejected before any process would start.
    #[test]
    fn invalid_actions_are_rejected_without_starting_anything() {
        let dir = std::env::temp_dir().join(format!("orbit-launch-{}", model::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = |name: &str| {
            let path = dir.join(name);
            std::fs::write(&path, "x").unwrap();
            path.display().to_string()
        };
        let (lnk, txt, xyz) = (file("a.lnk"), file("a.txt"), file("a.xyz"));
        let cases = [
            (act(Kind::App, "  ", ""), "Спочатку виберіть"),
            (act(Kind::System, "", ""), "Спочатку виберіть"),
            (act(Kind::Group, r"C:\x.exe", ""), "Відкрийте групу"),
            (act(Kind::App, "tool.exe", ""), "повний шлях"),
            (
                act(Kind::App, r"C:\orbit-missing\no.exe", ""),
                "не знайдено",
            ),
            (
                act(Kind::App, &dir.display().to_string(), ""),
                "файл .exe або .lnk",
            ),
            (act(Kind::App, &lnk, "--flag"), "аргументи у властивостях"),
            (act(Kind::App, &txt, ""), "файл .exe або .lnk"),
            (act(Kind::Script, &xyz, ""), "скрипти .ps1"),
        ];
        for (action, expected) in cases {
            let error = execute(&action).expect_err(&format!("{:?} must fail", action.target));
            assert!(error.contains(expected), "{error:?} lacks {expected:?}");
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
