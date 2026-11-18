//! Orbit's configuration (the same `settings.json` the Electron version wrote), its validation,
//! and the pure operations the editor and the wheel perform on it.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_ITEMS: usize = 12;
pub const MAX_MENUS: usize = 20;
/// Groups can be nested four levels deep.
pub const MAX_GROUP_DEPTH: usize = 4;
pub const DEFAULT_WHEEL_SIZE: u32 = 520;
pub const MIN_WHEEL_SIZE: u32 = 312;
pub const MAX_WHEEL_SIZE: u32 = 780;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
    System,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Activation {
    Release,
    Hover,
    Click,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GroupOpen {
    Hover,
    Click,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    App,
    Folder,
    Script,
    System,
    Group,
}

/// Windows commands in the order the action dialog shows them: (id, name, icon).
pub const SYSTEM_ACTIONS: [(&str, &str, &str); 25] = [
    ("explorer", "Провідник", "folder"),
    ("task-manager", "Диспетчер завдань", "tasks"),
    ("settings", "Параметри Windows", "settings"),
    ("control-panel", "Панель керування", "sliders"),
    ("recycle-bin", "Кошик", "trash"),
    ("search", "Пошук Windows", "search"),
    ("run", "Виконати", "run"),
    ("task-view", "Усі вікна", "windows"),
    ("desktop", "Показати робочий стіл", "desktop"),
    ("lock", "Заблокувати комп’ютер", "lock"),
    ("screenshot", "Знімок екрана", "screenshot"),
    ("clipboard", "Буфер обміну", "clipboard"),
    ("emoji", "Емодзі", "emoji"),
    ("dictation", "Голосове введення", "mic"),
    ("notifications", "Сповіщення", "bell"),
    ("mute", "Вимкнути / увімкнути звук", "volumeMute"),
    ("volume-down", "Зменшити гучність", "volumeDown"),
    ("volume-up", "Збільшити гучність", "volumeUp"),
    ("sound-settings", "Налаштування звуку", "volume"),
    ("bluetooth", "Bluetooth", "bluetooth"),
    ("media-prev", "Попередній трек", "trackPrev"),
    ("media-play", "Відтворення / пауза", "playPause"),
    ("media-next", "Наступний трек", "trackNext"),
    ("calculator", "Калькулятор", "calculator"),
    ("notepad", "Блокнот", "notepad"),
];
pub fn system_name(id: &str) -> Option<&'static str> {
    SYSTEM_ACTIONS.iter().find(|a| a.0 == id).map(|a| a.1)
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Action {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub args: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub children: Vec<Action>,
}

impl Action {
    pub fn new(kind: Kind, name: impl Into<String>, target: impl Into<String>) -> Self {
        Action {
            id: new_id(),
            name: name.into(),
            kind,
            target: target.into(),
            args: String::new(),
            icon: String::new(),
            children: Vec::new(),
        }
    }
    pub fn is_group(&self) -> bool {
        self.kind == Kind::Group
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Menu {
    pub id: String,
    pub name: String,
    #[serde(default = "orbit_icon")]
    pub icon: String,
    pub items: Vec<Action>,
}
fn orbit_icon() -> String {
    "orbit".into()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub theme: Theme,
    pub trigger_button: u8,
    pub activation_mode: Activation,
    pub group_open_mode: GroupOpen,
    pub hover_delay: u32,
    pub enabled: bool,
    pub reduced_motion: bool,
    pub close_on_outside_click: bool,
    pub launch_at_login: bool,
    pub wheel_add_slot: bool,
    pub intro_pending: bool,
    pub wheel_size: u32,
    pub menus: Vec<Menu>,
    pub active_menu_id: String,
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ---------- Validation ----------

fn text(
    value: Option<&Value>,
    name: &str,
    maximum: usize,
    required: bool,
) -> Result<String, String> {
    match value {
        None | Some(Value::Null) if !required => Ok(String::new()),
        Some(Value::String(s)) if s.chars().count() <= maximum && !s.contains('\0') => {
            Ok(s.clone())
        }
        _ => Err(format!("Неправильне значення: {name}.")),
    }
}

/// Store apps are launched through their catalog id: `app-id:<family>!<app>`.
pub fn validate_packaged_target(target: &str, args: &str) -> Result<String, String> {
    let error = || "Неправильний ідентифікатор застосунку Windows.".to_string();
    let id = target.strip_prefix("app-id:").ok_or_else(error)?;
    let part = |p: &str| {
        !p.is_empty()
            && p.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
            && p.chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
    };
    let mut parts = id.split('!');
    let (Some(a), Some(b), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err(error());
    };
    if id.len() > 128 || !part(a) || !part(b) {
        return Err(error());
    }
    if !args.trim().is_empty() {
        return Err("Застосунки Windows з каталогу не підтримують додаткові аргументи.".into());
    }
    Ok(id.to_string())
}

fn validate_action(
    value: &Value,
    depth: usize,
    ids: &mut std::collections::HashSet<String>,
) -> Result<Action, String> {
    let object = value.as_object().ok_or("Неправильна дія.")?;
    if depth > MAX_GROUP_DEPTH {
        return Err("Групи можуть мати не більше чотирьох вкладених рівнів.".into());
    }
    let id = text(object.get("id"), "ідентифікатор дії", 100, true)?;
    if id.is_empty() || !ids.insert(id.clone()) {
        return Err("Ідентифікатори дій мають бути унікальними й непорожніми.".into());
    }
    let kind: Kind = serde_json::from_value(object.get("kind").cloned().unwrap_or(Value::Null))
        .map_err(|_| "Непідтримуваний тип дії.")?;
    let name = text(object.get("name"), "назва дії", 100, true)?
        .trim()
        .to_string();
    if name.is_empty() {
        return Err("Дії потрібна назва.".into());
    }
    let target = text(object.get("target"), "шлях", 4096, false)?;
    let args = text(object.get("args"), "аргументи", 4096, false)?;
    let icon = text(object.get("icon"), "значок", 100, false)?;
    if target.to_ascii_lowercase().starts_with("app-id:") {
        if kind != Kind::App {
            return Err(
                "Ідентифікатор застосунку Windows можна використовувати лише для застосунків."
                    .into(),
            );
        }
        validate_packaged_target(&target, &args)?;
    }
    if kind == Kind::System && system_name(&target).is_none() {
        return Err("Непідтримувана дія Windows.".into());
    }
    let mut children = Vec::new();
    if kind == Kind::Group {
        let list = object
            .get("children")
            .and_then(Value::as_array)
            .ok_or("Група може містити до 12 дій.")?;
        if list.len() > MAX_ITEMS {
            return Err("Група може містити до 12 дій.".into());
        }
        for child in list {
            children.push(validate_action(child, depth + 1, ids)?);
        }
    }
    Ok(Action {
        id,
        name,
        kind,
        target,
        args,
        icon,
        children,
    })
}

/// Checks a configuration from disk, an import or the editor, filling in defaults for optional fields.
pub fn validate(value: &Value) -> Result<Settings, String> {
    let object = value
        .as_object()
        .ok_or("Неправильна або завелика конфігурація.")?;
    if value.to_string().len() > 1024 * 1024 {
        return Err("Неправильна або завелика конфігурація.".into());
    }
    if object.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("Непідтримувана версія конфігурації.".into());
    }
    let enumeration =
        |key: &str, error: &str| object.get(key).cloned().ok_or_else(|| error.to_string());
    let theme: Theme = serde_json::from_value(enumeration("theme", "Неправильна тема.")?)
        .map_err(|_| "Неправильна тема.")?;
    let trigger_button = match object.get("triggerButton").and_then(Value::as_u64) {
        Some(4) => 4,
        Some(5) => 5,
        _ => return Err("Виберіть кнопку миші 4 або 5.".into()),
    };
    let activation_mode: Activation = serde_json::from_value(enumeration(
        "activationMode",
        "Неправильний спосіб запуску.",
    )?)
    .map_err(|_| "Неправильний спосіб запуску.")?;
    let group_open_mode = match object.get("groupOpenMode") {
        None => GroupOpen::Hover,
        Some(v) => {
            serde_json::from_value(v.clone()).map_err(|_| "Неправильний спосіб відкриття груп.")?
        }
    };
    let hover_delay = object
        .get("hoverDelay")
        .and_then(Value::as_u64)
        .filter(|d| (150..=2000).contains(d))
        .ok_or("Затримка наведення має бути від 150 до 2000 мс.")? as u32;
    let flag = |key: &str, default: Option<bool>| -> Result<bool, String> {
        match (object.get(key), default) {
            (Some(Value::Bool(b)), _) => Ok(*b),
            (None, Some(d)) => Ok(d),
            _ => Err("Неправильні значення налаштувань.".into()),
        }
    };
    let wheel_size = match object.get("wheelSize") {
        None => DEFAULT_WHEEL_SIZE,
        Some(v) => {
            v.as_u64()
                .filter(|s| (MIN_WHEEL_SIZE as u64..=MAX_WHEEL_SIZE as u64).contains(s))
                .ok_or("Розмір колеса має бути цілим числом від 312 до 780.")? as u32
        }
    };
    let list = object
        .get("menus")
        .and_then(Value::as_array)
        .filter(|m| !m.is_empty() && m.len() <= MAX_MENUS)
        .ok_or("Створіть від 1 до 20 меню.")?;
    let mut ids = std::collections::HashSet::new();
    let mut menus = Vec::new();
    for menu in list {
        let m = menu.as_object().ok_or("Неправильне меню.")?;
        let id = text(m.get("id"), "ідентифікатор меню", 100, true)?;
        if id.is_empty() || !ids.insert(id.clone()) {
            return Err("Ідентифікатори меню мають бути унікальними.".into());
        }
        let items = m
            .get("items")
            .and_then(Value::as_array)
            .filter(|i| i.len() <= MAX_ITEMS)
            .ok_or("Кожне колесо може мати до 12 дій.")?;
        let name = text(m.get("name"), "назва меню", 100, true)?
            .trim()
            .to_string();
        if name.is_empty() {
            return Err("Меню потрібна назва.".into());
        }
        let icon = match m.get("icon") {
            None => "orbit".into(),
            v => text(v, "значок меню", 100, true)?,
        };
        let items = items
            .iter()
            .map(|item| validate_action(item, 0, &mut ids))
            .collect::<Result<Vec<_>, _>>()?;
        menus.push(Menu {
            id,
            name,
            icon,
            items,
        });
    }
    let active_menu_id = text(object.get("activeMenuId"), "активне меню", 100, true)?;
    if !menus.iter().any(|m| m.id == active_menu_id) {
        return Err("Активного меню не існує.".into());
    }
    Ok(Settings {
        version: 1,
        theme,
        trigger_button,
        activation_mode,
        group_open_mode,
        hover_delay,
        enabled: flag("enabled", None)?,
        reduced_motion: flag("reducedMotion", None)?,
        close_on_outside_click: flag("closeOnOutsideClick", Some(true))?,
        launch_at_login: flag("launchAtLogin", Some(true))?,
        wheel_add_slot: flag("wheelAddSlot", Some(true))?,
        intro_pending: flag("introPending", Some(false))?,
        wheel_size,
        menus,
        active_menu_id,
    })
}

impl Settings {
    /// Re-validates after an edit; the editor never saves anything the loader would reject.
    pub fn checked(self) -> Result<Settings, String> {
        validate(&serde_json::to_value(&self).map_err(|e| e.to_string())?)
    }

    pub fn active_menu_index(&self) -> usize {
        self.menus
            .iter()
            .position(|m| m.id == self.active_menu_id)
            .unwrap_or(0)
    }
    pub fn current_menu(&self) -> &Menu {
        &self.menus[self.active_menu_index()]
    }

    /// Drops group ids that no longer exist, so the path always points at a real group.
    pub fn trim_group_path(&self, path: &[String]) -> Vec<String> {
        let mut items = &self.current_menu().items;
        let mut next = Vec::new();
        for id in path {
            match items.iter().find(|i| &i.id == id && i.is_group()) {
                Some(g) => {
                    next.push(id.clone());
                    items = &g.children;
                }
                None => break,
            }
        }
        next
    }
    /// Items of the group a (trimmed) path points at, with that level's title.
    pub fn level(&self, path: &[String]) -> (&Vec<Action>, &str) {
        let menu = self.current_menu();
        let (mut items, mut name) = (&menu.items, menu.name.as_str());
        for id in path {
            match items.iter().find(|i| &i.id == id && i.is_group()) {
                Some(g) => {
                    items = &g.children;
                    name = &g.name;
                }
                None => break,
            }
        }
        (items, name)
    }
    pub fn level_mut(&mut self, path: &[String]) -> &mut Vec<Action> {
        let index = self.active_menu_index();
        let mut items = &mut self.menus[index].items;
        for id in path {
            let Some(position) = items.iter().position(|i| &i.id == id && i.is_group()) else {
                break;
            };
            items = &mut items[position].children;
        }
        items
    }

    pub fn find(&self, id: &str) -> Option<Location> {
        fn walk(
            items: &[Action],
            id: &str,
            indices: &mut Vec<usize>,
            groups: &mut Vec<String>,
        ) -> bool {
            for (i, item) in items.iter().enumerate() {
                indices.push(i);
                if item.id == id {
                    return true;
                }
                if item.is_group() {
                    groups.push(item.id.clone());
                    if walk(&item.children, id, indices, groups) {
                        return true;
                    }
                    groups.pop();
                }
                indices.pop();
            }
            false
        }
        for (menu, m) in self.menus.iter().enumerate() {
            let (mut indices, mut groups) = (Vec::new(), Vec::new());
            if walk(&m.items, id, &mut indices, &mut groups) {
                return Some(Location {
                    menu,
                    indices,
                    groups,
                });
            }
        }
        None
    }
    pub fn get(&self, location: &Location) -> &Action {
        let mut item = &self.menus[location.menu].items[location.indices[0]];
        for &i in &location.indices[1..] {
            item = &item.children[i];
        }
        item
    }
    pub fn action(&self, id: &str) -> Option<&Action> {
        self.find(id).map(|l| self.get(&l))
    }
}

/// Where an action sits: its menu, the index at every level, and the ids of the groups above it.
#[derive(Clone, Debug, PartialEq)]
pub struct Location {
    pub menu: usize,
    pub indices: Vec<usize>,
    pub groups: Vec<String>,
}
impl Location {}

// ---------- Moving actions (drag and drop, outward buttons) ----------

// ---------- Launch helpers ----------

/// Splits an argument string the way Windows programs read their command line.
pub fn parse_arguments(value: &str) -> Result<Vec<String>, String> {
    let chars: Vec<char> = value.chars().collect();
    let (mut args, mut current, mut quoted, mut started) =
        (Vec::new(), String::new(), false, false);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\\' {
            let mut slashes = 1;
            while chars.get(i + 1) == Some(&'\\') {
                slashes += 1;
                i += 1;
            }
            if chars.get(i + 1) == Some(&'"') {
                current.push_str(&"\\".repeat(slashes / 2));
                if slashes % 2 == 1 {
                    current.push('"');
                } else {
                    quoted = !quoted;
                }
                i += 1;
            } else {
                current.push_str(&"\\".repeat(slashes));
            }
            started = true;
        } else if c == '"' {
            if quoted && chars.get(i + 1) == Some(&'"') {
                current.push('"');
                i += 1;
            } else {
                quoted = !quoted;
            }
            started = true;
        } else if c.is_whitespace() && !quoted {
            if started {
                args.push(std::mem::take(&mut current));
                started = false;
            }
        } else {
            current.push(c);
            started = true;
        }
        i += 1;
    }
    if quoted {
        return Err("Закрийте лапки в аргументах.".into());
    }
    if started {
        args.push(current);
    }
    Ok(args)
}

pub fn base_name(path: &str) -> String {
    let trimmed = path.trim_end_matches(['\\', '/']);
    trimmed
        .rsplit(['\\', '/'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}
pub fn extension(path: &str) -> String {
    let base = base_name(path);
    base.rfind('.')
        .filter(|&i| i > 0)
        .map(|i| base[i..].to_ascii_lowercase())
        .unwrap_or_default()
}
/// A file's wheel name is its name without the extension.
pub fn file_stem(target: &str) -> String {
    let base = base_name(target);
    match base.rfind('.') {
        Some(i) if i > 0 => base[..i].to_string(),
        _ => base,
    }
}

pub const SCRIPT_EXTENSIONS: [&str; 4] = [".ps1", ".py", ".js", ".cjs"];

const SHELL_PROCESSES: [&str; 10] = [
    "explorer.exe",
    "applicationframehost.exe",
    "searchhost.exe",
    "searchapp.exe",
    "shellexperiencehost.exe",
    "startmenuexperiencehost.exe",
    "textinputhost.exe",
    "lockapp.exe",
    "systemsettings.exe",
    "orbit.exe",
];
/// The Windows shell and Orbit itself are never offered as "add the program you are in".
pub fn foreground_candidate(exe: &str, own_exe: &str) -> bool {
    let bytes = exe.as_bytes();
    let drive =
        bytes.len() > 7 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\';
    if !drive || !exe.to_ascii_lowercase().ends_with(".exe") || exe.len() > 1024 {
        return false;
    }
    if exe.eq_ignore_ascii_case(own_exe) {
        return false;
    }
    !SHELL_PROCESSES.contains(&base_name(exe).to_ascii_lowercase().as_str())
}

// ---------- Defaults ----------

pub fn default_settings(documents: &str, adobe: Vec<Action>) -> Settings {
    let action = |id: &str, name: &str, kind: Kind, target: &str, icon: &str| Action {
        id: id.into(),
        name: name.into(),
        kind,
        target: target.into(),
        args: String::new(),
        icon: icon.into(),
        children: Vec::new(),
    };
    let mut items = Vec::new();
    if !adobe.is_empty() {
        let mut group = action("adobe", "Adobe", Kind::Group, "", "adobe");
        group.children = adobe;
        items.push(group);
    }
    items.extend([
        action("documents", "Документи", Kind::Folder, documents, "folder"),
        action(
            "browser",
            "Вебпошук",
            Kind::App,
            "https://www.google.com",
            "globe",
        ),
        action("explorer", "Провідник", Kind::System, "explorer", "files"),
        action(
            "screenshot",
            "Знімок екрана",
            Kind::System,
            "screenshot",
            "screenshot",
        ),
        action(
            "task-manager",
            "Диспетчер завдань",
            Kind::System,
            "task-manager",
            "activity",
        ),
        action("mute", "Вимкнути звук", Kind::System, "mute", "volume"),
        action(
            "settings",
            "Параметри Windows",
            Kind::System,
            "settings",
            "settings",
        ),
    ]);
    Settings {
        version: 1,
        theme: Theme::Dark,
        trigger_button: 4,
        activation_mode: Activation::Hover,
        group_open_mode: GroupOpen::Hover,
        hover_delay: 350,
        enabled: true,
        reduced_motion: false,
        close_on_outside_click: true,
        launch_at_login: true,
        wheel_add_slot: true,
        intro_pending: true,
        wheel_size: DEFAULT_WHEEL_SIZE,
        active_menu_id: "main".into(),
        menus: vec![Menu {
            id: "main".into(),
            name: "Головне меню".into(),
            icon: "orbit".into(),
            items,
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn action(id: &str) -> Action {
        Action {
            id: id.into(),
            name: id.into(),
            kind: Kind::App,
            target: format!("C:\\Apps\\{id}.exe"),
            args: "--profile=work".into(),
            icon: "app".into(),
            children: vec![],
        }
    }
    fn group(id: &str, children: Vec<Action>) -> Action {
        Action {
            id: id.into(),
            name: id.into(),
            kind: Kind::Group,
            target: String::new(),
            args: String::new(),
            icon: "group".into(),
            children,
        }
    }
    fn settings(items: Vec<Action>) -> Settings {
        let mut s = default_settings("C:\\Docs", vec![]);
        s.menus[0].items = items;
        s.checked().unwrap()
    }

    #[test]
    fn reads_the_electron_settings_format() {
        let value = json!({"version":1,"theme":"dark","enabled":true,"reducedMotion":false,"triggerButton":4,"activationMode":"hover","hoverDelay":350,
            "activeMenuId":"main","menus":[{"id":"main","name":"Main","items":[{"id":"a","name":" A ","kind":"app","target":"C:\\a.exe"}]}]});
        let s = validate(&value).unwrap();
        assert_eq!(s.menus[0].items[0].name, "A");
        assert!(
            s.close_on_outside_click && s.launch_at_login && s.wheel_add_slot && !s.intro_pending
        );
        assert_eq!(s.wheel_size, 520);
        assert_eq!(s.group_open_mode, GroupOpen::Hover);
        let round = serde_json::to_value(&s).unwrap();
        assert_eq!(round["triggerButton"], 4);
        assert_eq!(validate(&round).unwrap(), s);
    }

    #[test]
    fn rejects_invalid_configurations() {
        let base = serde_json::to_value(default_settings("C:\\Docs", vec![])).unwrap();
        for (key, value) in [
            ("triggerButton", json!(3)),
            ("theme", json!("blue")),
            ("hoverDelay", json!(100)),
            ("wheelSize", json!(900)),
            ("activeMenuId", json!("missing")),
            ("menus", json!([])),
        ] {
            let mut v = base.clone();
            v[key] = value;
            assert!(validate(&v).is_err(), "{key}");
        }
        let mut v = base.clone();
        v["menus"][0]["items"][1]["id"] = v["menus"][0]["items"][0]["id"].clone();
        assert!(validate(&v).is_err());
        let mut v = base.clone();
        v["menus"][0]["items"][2]["target"] = json!("format-disk");
        assert!(validate(&v).is_err());
        let mut deep = json!({"id":"g0","name":"g","kind":"group","children":[]});
        for i in 1..6 {
            deep = json!({"id":format!("g{i}"),"name":"g","kind":"group","children":[deep]});
        }
        let mut v = base;
        v["menus"][0]["items"] = json!([deep]);
        assert!(validate(&v).is_err());
    }

    #[test]
    fn packaged_targets_are_strict() {
        assert_eq!(
            validate_packaged_target("app-id:Microsoft.Photos_8wekyb!App", "").unwrap(),
            "Microsoft.Photos_8wekyb!App"
        );
        assert!(validate_packaged_target("app-id:bad id!App", "").is_err());
        assert!(validate_packaged_target("app-id:A!B", "--x").is_err());
        assert!(validate_packaged_target("app-id:A!B!C", "").is_err());
    }

    #[test]
    fn group_paths_and_locations() {
        let s = settings(vec![group("g", vec![group("h", vec![action("c")])])]);
        assert_eq!(
            s.trim_group_path(&["g".into(), "missing".into()]),
            vec!["g".to_string()]
        );
        assert_eq!(s.level(&["g".into(), "h".into()]).1, "h");
        let l = s.find("c").unwrap();
        assert_eq!(l.groups, ["g", "h"]);
        assert_eq!(s.get(&l).id, "c");
    }

    #[test]
    fn windows_argument_parsing() {
        assert_eq!(
            parse_arguments(r#""C:\Project files\scene.aep" --profile=work"#).unwrap(),
            [r"C:\Project files\scene.aep", "--profile=work"]
        );
        assert_eq!(parse_arguments(r#"a\\"b c" d"#).unwrap(), [r"a\b c", "d"]);
        assert_eq!(parse_arguments(r#"say \"hi\""#).unwrap(), ["say", "\"hi\""]);
        assert_eq!(parse_arguments(r#""""#).unwrap(), [""]);
        assert!(parse_arguments(r#""open"#).is_err());
    }

    #[test]
    fn foreground_candidates() {
        assert!(foreground_candidate(
            r"C:\Apps\Figma.exe",
            r"C:\Orbit\Orbit.exe"
        ));
        assert!(!foreground_candidate(r"C:\Windows\explorer.exe", ""));
        assert!(!foreground_candidate(
            r"C:\Orbit\Orbit.exe",
            r"c:\orbit\orbit.exe"
        ));
        assert!(!foreground_candidate("relative.exe", ""));
    }

    #[test]
    fn file_stems() {
        assert_eq!(file_stem(r"C:\a\Render scene.ps1"), "Render scene");
    }
}
