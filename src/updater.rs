//! In-app updates from the latest GitHub release: check, download with a SHA-256 check, then swap
//! the executable. Windows lets a running .exe be renamed, so the old copy steps aside as
//! `Orbit.exe.old` (removed on the next start) and comes back if anything fails.

use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub const REPOSITORY: &str = "Validolio11/Orbit-2";
pub const CURRENT: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug, PartialEq)]
pub enum Phase {
    Idle,
    Checking,
    Available,
    UpToDate,
    Downloading(f32),
    Ready,
    Installing,
    Error(String),
}

#[derive(Clone, Debug)]
struct Release {
    version: String,
    exe_url: String,
    sums_url: String,
}

pub fn asset_name(version: &str) -> String {
    format!("Orbit-{version}-windows-x64.exe")
}

fn parse(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version
        .trim_start_matches('v')
        .split('.')
        .map(|p| p.parse::<u64>().ok());
    let v = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(v)
}
pub fn is_newer(candidate: &str, current: &str) -> bool {
    matches!((parse(candidate), parse(current)), (Some(a), Some(b)) if a > b)
}

#[derive(Clone)]
pub struct Updater {
    state: Arc<Mutex<(Phase, Option<Release>, Option<PathBuf>)>>,
    dir: PathBuf,
    notify: Arc<dyn Fn() + Send + Sync>,
}

impl Updater {
    pub fn new(dir: PathBuf, notify: Arc<dyn Fn() + Send + Sync>) -> Self {
        Updater {
            state: Arc::new(Mutex::new((Phase::Idle, None, None))),
            dir,
            notify,
        }
    }
    fn set(&self, phase: Phase) {
        self.state.lock().unwrap().0 = phase;
        (self.notify)();
    }
    pub fn phase(&self) -> Phase {
        self.state.lock().unwrap().0.clone()
    }
    pub fn version(&self) -> Option<String> {
        self.state
            .lock()
            .unwrap()
            .1
            .as_ref()
            .map(|r| r.version.clone())
    }

    pub fn check(&self) {
        if matches!(
            self.phase(),
            Phase::Checking | Phase::Downloading(_) | Phase::Installing
        ) {
            return;
        }
        self.set(Phase::Checking);
        let this = self.clone();
        std::thread::spawn(move || {
            let result = latest();
            let phase = match result {
                Ok(Some(release)) => {
                    this.state.lock().unwrap().1 = Some(release);
                    Phase::Available
                }
                Ok(None) => Phase::UpToDate,
                Err(e) => Phase::Error(e),
            };
            this.set(phase);
        });
    }

    pub fn download(&self) {
        let Some(release) = self.state.lock().unwrap().1.clone() else {
            return;
        };
        self.set(Phase::Downloading(0.0));
        let this = self.clone();
        std::thread::spawn(move || match this.fetch(&release) {
            Ok(file) => {
                this.state.lock().unwrap().2 = Some(file);
                this.set(Phase::Ready);
            }
            Err(e) => this.set(Phase::Error(e)),
        });
    }

    fn fetch(&self, release: &Release) -> Result<PathBuf, String> {
        let sums = agent()
            .get(&release.sums_url)
            .call()
            .map_err(network)?
            .into_string()
            .map_err(network)?;
        let expected = sums
            .lines()
            .find_map(|line| {
                let mut parts = line.split_whitespace();
                let (hash, name) = (parts.next()?, parts.next()?.trim_start_matches('*'));
                (name == asset_name(&release.version)).then(|| hash.to_lowercase())
            })
            .ok_or("У випуску немає контрольної суми для Orbit.")?;
        let response = agent().get(&release.exe_url).call().map_err(network)?;
        let total: f32 = response
            .header("Content-Length")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.0);
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let file = self.dir.join(format!("Orbit-{}.exe", release.version));
        let partial = file.with_extension("part");
        let downloaded = (|| -> Result<(), String> {
            let mut out = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
            let mut reader = response.into_reader().take(300 * 1024 * 1024);
            let (mut hasher, mut buffer, mut received) =
                (Sha256::new(), vec![0u8; 64 * 1024], 0usize);
            loop {
                let n = reader.read(&mut buffer).map_err(network)?;
                if n == 0 {
                    break;
                }
                hasher.update(&buffer[..n]);
                out.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
                received += n;
                if total > 0.0 {
                    self.set(Phase::Downloading(received as f32 / total * 100.0));
                }
            }
            out.sync_all().map_err(|e| e.to_string())?;
            drop(out);
            let actual: String = hasher
                .finalize()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            if actual != expected {
                return Err(
                    "Завантажений файл пошкоджений (SHA-256 не збігається). Спробуйте ще раз."
                        .into(),
                );
            }
            Ok(())
        })();
        // Whatever failed, no half-written file stays behind.
        if let Err(error) = downloaded {
            let _ = std::fs::remove_file(&partial);
            return Err(error);
        }
        std::fs::rename(&partial, &file).map_err(|e| e.to_string())?;
        Ok(file)
    }

    /// Puts the new executable in place of this one and starts it. The caller then quits.
    pub fn install(&self) -> Result<(), String> {
        let file = self
            .state
            .lock()
            .unwrap()
            .2
            .clone()
            .ok_or("Спочатку завантажте оновлення.")?;
        self.set(Phase::Installing);
        let result = swap(&file);
        if let Err(e) = &result {
            self.set(Phase::Error(e.clone()));
        }
        result
    }
}

fn swap(new: &std::path::Path) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let old = exe.with_extension("exe.old");
    let _ = std::fs::remove_file(&old);
    std::fs::rename(&exe, &old)
        .map_err(|e| format!("Немає доступу на запис до папки Orbit: {e}"))?;
    if let Err(e) = std::fs::copy(new, &exe) {
        let _ = std::fs::rename(&old, &exe);
        return Err(format!(
            "Не вдалося встановити оновлення, попередню версію збережено: {e}"
        ));
    }
    std::process::Command::new(&exe)
        .arg("--updated")
        .spawn()
        .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(new);
    Ok(())
}

/// Removes what a finished update left behind.
pub fn cleanup(dir: &std::path::Path) {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(exe.with_extension("exe.old"));
    }
    let _ = std::fs::remove_dir_all(dir);
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout_read(std::time::Duration::from_secs(30))
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
        .build()
}
fn network(error: impl std::fmt::Display) -> String {
    format!("Не вдалося з'єднатися з GitHub: {error}")
}

fn latest() -> Result<Option<Release>, String> {
    let url = format!("https://api.github.com/repos/{REPOSITORY}/releases/latest");
    let json: serde_json::Value = agent()
        .get(&url)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(network)?
        .into_json()
        .map_err(network)?;
    let tag = json["tag_name"]
        .as_str()
        .ok_or("GitHub повернув неочікувану відповідь.")?;
    let version = tag.trim_start_matches('v').to_string();
    if !is_newer(&version, CURRENT) {
        return Ok(None);
    }
    let assets = json["assets"].as_array().cloned().unwrap_or_default();
    let url_of = |name: &str| {
        assets
            .iter()
            .find(|a| a["name"].as_str() == Some(name))
            .and_then(|a| a["browser_download_url"].as_str())
            .map(String::from)
            .filter(|u| {
                u.starts_with(&format!(
                    "https://github.com/{REPOSITORY}/releases/download/"
                ))
            })
    };
    let exe_url =
        url_of(&asset_name(&version)).ok_or("У новому випуску немає файлу Orbit для Windows.")?;
    let sums_url = url_of("SHA256SUMS.txt").ok_or("У новому випуску немає контрольних сум.")?;
    Ok(Some(Release {
        version,
        exe_url,
        sums_url,
    }))
}

#[cfg(test)]
mod tests {
    #[test]
    fn versions() {
        assert!(super::is_newer("0.2.0", "0.1.16"));
        assert!(super::is_newer("v1.0.0", "0.9.9"));
        assert!(!super::is_newer("0.1.16", "0.1.16"));
        assert!(!super::is_newer("0.2.0-beta", "0.1.0"));
    }
}
