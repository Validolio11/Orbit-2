//! Dialogs: new/rename menu, delete, import, notices, and the add/edit action dialog with its pickers.

use super::item_icon::{IconSource, paint_item_icon};
use super::theme::{Palette, R_FIELD, Weight, caps, font, paint_icon, text};
use super::widgets::{self, Button, icon_button, text_field};
use crate::app::App;
use crate::catalog::AppEntry;
use crate::launcher::{FolderTile, ScriptTile};
use crate::model::{self, Action, Kind, MAX_GROUP_DEPTH, MAX_ITEMS, MAX_MENUS, SYSTEM_ACTIONS};
use egui::{Align2, Color32, Key, Rect, Sense, Stroke, StrokeKind, Ui, Vec2};
use std::sync::{Arc, Mutex};

pub enum Dialog {
    Menu {
        rename: bool,
        name: String,
        error: String,
    },
    Delete {
        menu: bool,
        id: String,
    },
    Import,
    Notice {
        title: String,
        body: String,
    },
    Action(Box<ActionDialog>),
}
impl Dialog {
    pub fn menu(rename: Option<String>) -> Self {
        Dialog::Menu {
            rename: rename.is_some(),
            name: rename.unwrap_or_default(),
            error: String::new(),
        }
    }
}

/// The shared dialog frame. Returns (body result, close requested).
/// A footer button: label, optional icon, style, and whether it sits on the left.
pub struct Btn<'a> {
    pub label: &'a str,
    pub icon: Option<&'a str>,
    pub style: widgets::Kind,
    pub left: bool,
}
pub fn btn(label: &str, style: widgets::Kind) -> Btn<'_> {
    Btn {
        label,
        icon: None,
        style,
        left: false,
    }
}
const CANCEL: Btn<'static> = Btn {
    label: "Скасувати",
    icon: None,
    style: widgets::Kind::Secondary,
    left: false,
};

/// The shared dialog frame. Footer buttons are listed right to left. Returns (body result, clicked button, close requested).
fn modal<R>(
    ctx: &egui::Context,
    p: &Palette,
    id: &str,
    title: &str,
    width: f32,
    buttons: &[Btn],
    body: impl FnOnce(&mut Ui) -> R,
) -> (R, Option<usize>, bool) {
    let mut clicked = None;
    let mut close = false;
    let response = egui::Modal::new(egui::Id::unique(id))
        .backdrop_color(Color32::from_rgba_unmultiplied(9, 10, 10, 190))
        .frame(
            egui::Frame::new()
                .fill(p.panel)
                .stroke(Stroke::new(1.0, p.line))
                .corner_radius(28)
                .shadow(egui::Shadow {
                    offset: [0, 24],
                    blur: 64,
                    spread: 0,
                    color: Color32::from_black_alpha(if p.dark { 190 } else { 60 }),
                }),
        )
        .show(ctx, |ui| {
            ui.set_width(width);
            ui.spacing_mut().item_spacing.y = 0.0;
            ui.horizontal(|ui| {
                ui.set_height(60.0);
                ui.add_space(23.0);
                ui.label(text(title, 18.0, Weight::Semibold, p.text));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.add_space(16.0);
                    if icon_button(ui, "close", 18.0, "Закрити", false, true).clicked() {
                        close = true;
                    }
                });
            });
            let max_height = ui.ctx().content_rect().height() * 0.9 - 140.0;
            let result = egui::ScrollArea::vertical()
                .max_height(max_height)
                .auto_shrink([false, true])
                .show(ui, |ui| {
                    egui::Frame::new()
                        .inner_margin(egui::Margin {
                            left: 23,
                            right: 23,
                            top: 8,
                            bottom: 14,
                        })
                        .show(ui, |ui| {
                            ui.set_width(width - 46.0);
                            ui.spacing_mut().item_spacing.y = 8.0;
                            body(ui)
                        })
                        .inner
                })
                .inner;
            let top = ui.cursor().top();
            let footer_rect = Rect::from_min_size(
                egui::pos2(ui.max_rect().left(), top),
                Vec2::new(width, 62.0),
            );
            ui.allocate_ui_with_layout(
                footer_rect.size(),
                egui::Layout::right_to_left(egui::Align::Center),
                |ui| {
                    ui.add_space(23.0);
                    for (i, b) in buttons.iter().enumerate().filter(|(_, b)| !b.left) {
                        if footer_button(ui, b).clicked() {
                            clicked = Some(i);
                        }
                    }
                    ui.with_layout(egui::Layout::left_to_right(egui::Align::Center), |ui| {
                        ui.add_space(23.0);
                        for (i, b) in buttons.iter().enumerate().filter(|(_, b)| b.left) {
                            if footer_button(ui, b).clicked() {
                                clicked = Some(i);
                            }
                        }
                    });
                },
            );
            result
        });
    let should_close = response.should_close();
    (response.inner, clicked, close || should_close)
}

fn footer_button(ui: &mut Ui, b: &Btn) -> egui::Response {
    let mut button = Button::new(b.label);
    if let Some(icon) = b.icon {
        button = button.icon(icon, 14.0);
    }
    button = match b.style {
        widgets::Kind::Primary => button.primary(),
        widgets::Kind::Danger => button.danger(),
        widgets::Kind::Ghost => button.ghost(),
        widgets::Kind::Accent => button.accent(),
        widgets::Kind::Secondary => button,
    };
    button.show(ui)
}

fn label(ui: &mut Ui, p: &Palette, s: &str) {
    ui.label(caps(s, p.muted));
    ui.add_space(-1.0);
}
fn note(ui: &mut Ui, p: &Palette, s: &str) {
    ui.add(egui::Label::new(text(s, 10.0, Weight::Regular, p.muted)).wrap());
}

impl App {
    pub fn dialogs(&mut self, ctx: &egui::Context) {
        let Some(mut dialog) = self.dialog.take() else {
            return;
        };
        let p = self.palette;
        let keep = match &mut dialog {
            Dialog::Menu {
                rename,
                name,
                error,
            } => {
                let rename = *rename;
                let mut submit = false;
                let mut cancel = false;
                let buttons = [
                    btn(
                        if rename {
                            "Зберегти"
                        } else {
                            "Створити меню"
                        },
                        widgets::Kind::Primary,
                    ),
                    CANCEL,
                ];
                let (_, clicked, close) = modal(
                    ctx,
                    &p,
                    "menu-dialog",
                    if rename {
                        "Перейменувати меню"
                    } else {
                        "Нове меню"
                    },
                    490.0,
                    &buttons,
                    |ui| {
                        label(ui, &p, "Назва меню");
                        let response =
                            text_field(ui, "menu-name", name, "Наприклад, Монтаж", 444.0);
                        if !response.has_focus() && ui.ctx().memory(|m| m.focused().is_none()) {
                            response.request_focus();
                        }
                        if response.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter)) {
                            submit = true;
                        }
                        note(ui, &p, "Окремий набір дій.");
                        if !error.is_empty() {
                            ui.label(text(error.as_str(), 11.0, Weight::Regular, p.error));
                        }
                    },
                );
                if clicked == Some(0) {
                    submit = true;
                }
                if clicked == Some(1) {
                    cancel = true;
                }
                let value: String = name.trim().chars().take(100).collect();
                if submit && !value.is_empty() {
                    let mut next = self.settings.clone();
                    if rename {
                        let i = next.active_menu_index();
                        next.menus[i].name = value;
                        !self.save(next, "Назву збережено")
                    } else if next.menus.len() >= MAX_MENUS {
                        *error = "Можна створити до 20 меню.".into();
                        true
                    } else {
                        let id = model::new_id();
                        next.menus.push(model::Menu {
                            id: id.clone(),
                            name: value,
                            icon: "orbit".into(),
                            items: vec![],
                        });
                        next.active_menu_id = id;
                        self.group_path.clear();
                        !self.save(next, "Меню створено")
                    }
                } else {
                    !(close || cancel)
                }
            }
            Dialog::Delete { menu, id } => {
                let (menu, id) = (*menu, id.clone());
                let item_name = if menu {
                    Some((self.settings.current_menu().name.clone(), true))
                } else {
                    self.settings
                        .action(&id)
                        .map(|a| (a.name.clone(), a.is_group()))
                };
                match item_name {
                    None => false,
                    Some((name, nested)) => {
                        let mut confirm = false;
                        let mut cancel = false;
                        let buttons = [
                            Btn {
                                label: "Видалити",
                                icon: Some("trash"),
                                style: widgets::Kind::Danger,
                                left: false,
                            },
                            CANCEL,
                        ];
                        let (_, clicked, close) = modal(
                            ctx,
                            &p,
                            "delete-dialog",
                            if menu {
                                "Видалити меню?"
                            } else {
                                "Видалити дію?"
                            },
                            490.0,
                            &buttons,
                            |ui| {
                                let mut job = egui::text::LayoutJob::default();
                                let normal = egui::TextFormat {
                                    font_id: font(13.0, Weight::Regular),
                                    color: p.muted,
                                    ..Default::default()
                                };
                                job.append("Видалити ", 0.0, normal.clone());
                                job.append(
                                    &name,
                                    0.0,
                                    egui::TextFormat {
                                        font_id: font(13.0, Weight::Semibold),
                                        color: p.text,
                                        ..Default::default()
                                    },
                                );
                                job.append(
                                    &format!(
                                        "{}? Файли та програми на комп’ютері залишаться на місці.",
                                        if nested {
                                            " разом із вкладеними діями"
                                        } else {
                                            ""
                                        }
                                    ),
                                    0.0,
                                    normal,
                                );
                                ui.add(egui::Label::new(job).wrap());
                            },
                        );
                        if clicked == Some(0) {
                            confirm = true;
                        }
                        if clicked == Some(1) {
                            cancel = true;
                        }
                        if confirm {
                            let mut next = self.settings.clone();
                            if menu {
                                let active = next.active_menu_id.clone();
                                next.menus.retain(|m| m.id != active);
                                next.active_menu_id = next.menus[0].id.clone();
                                self.group_path.clear();
                            } else {
                                next = model::remove(&next, &id);
                            }
                            !self.save(next, "Видалено")
                        } else {
                            !(close || cancel)
                        }
                    }
                }
            }
            Dialog::Import => {
                let mut choose = false;
                let mut cancel = false;
                let buttons = [btn("Вибрати JSON-файл", widgets::Kind::Primary), CANCEL];
                let (_, clicked, close) = modal(
                    ctx,
                    &p,
                    "import-dialog",
                    "Імпортувати налаштування?",
                    490.0,
                    &buttons,
                    |ui| {
                        ui.add(egui::Label::new(text("Поточні меню та налаштування буде замінено даними з обраного файлу. Імпорт самостійно не запускає жодних дій.", 13.0, Weight::Regular, p.muted)).wrap());
                    },
                );
                if clicked == Some(0) {
                    choose = true;
                }
                if clicked == Some(1) {
                    cancel = true;
                }
                if choose {
                    match rfd::FileDialog::new()
                        .set_title("Імпортувати налаштування Orbit")
                        .add_filter("Orbit JSON", &["json"])
                        .pick_file()
                    {
                        None => true,
                        Some(file) => match crate::storage::import(&file) {
                            Ok(next) => {
                                self.group_path.clear();
                                !self.save(next, "Налаштування імпортовано")
                            }
                            Err(e) => {
                                self.toast(e, true);
                                true
                            }
                        },
                    }
                } else {
                    !(close || cancel)
                }
            }
            Dialog::Notice { title, body } => {
                let mut ok = false;
                let (_, clicked, close) = modal(
                    ctx,
                    &p,
                    "notice-dialog",
                    title,
                    490.0,
                    &[btn("Зрозуміло", widgets::Kind::Primary)],
                    |ui| {
                        ui.add(
                            egui::Label::new(text(body.as_str(), 13.0, Weight::Regular, p.muted))
                                .wrap(),
                        );
                    },
                );
                if clicked == Some(0) {
                    ok = true;
                }
                !(ok || close)
            }
            Dialog::Action(action) => action.show(ctx, self),
        };
        if keep && self.dialog.is_none() {
            self.dialog = Some(dialog);
        }
    }
}

// ---------- Add / edit action ----------

const PICKABLE: [Kind; 3] = [Kind::App, Kind::Folder, Kind::Script];
const COLUMNS: usize = 4;
const FOLDER_GROUPS: [(&str, &str); 3] = [
    ("quick", "Швидкий доступ"),
    ("known", "Стандартні папки"),
    ("drive", "Диски"),
];
// Ordered by theme: favourites and people, communication, creative work, media, internet and AI, computer, study and money, everything else.
const GROUP_ICONS: [(&str, &str); 63] = [
    ("group", "Група"),
    ("star", "Обране"),
    ("heart", "Улюблене"),
    ("bookmark", "Закладки"),
    ("briefcase", "Робота"),
    ("users", "Команда"),
    ("user", "Особисте"),
    ("home", "Дім"),
    ("calendar", "Календар"),
    ("clock", "Час"),
    ("mail", "Пошта"),
    ("chat", "Чати"),
    ("phone", "Телефон"),
    ("palette", "Дизайн"),
    ("layers", "Шари"),
    ("cube", "3D"),
    ("image", "Фото"),
    ("camera", "Камера"),
    ("film", "Медіа"),
    ("video", "Відео"),
    ("tv", "ТБ"),
    ("music", "Музика"),
    ("headphones", "Навушники"),
    ("mic", "Мікрофон"),
    ("gamepad", "Ігри"),
    ("trophy", "Досягнення"),
    ("emoji", "Розваги"),
    ("browser", "Інтернет"),
    ("cloud", "Хмара"),
    ("wifi", "Мережа"),
    ("map", "Мапи"),
    ("sparkles", "ШІ"),
    ("bot", "Бот"),
    ("cpu", "Процесор"),
    ("script", "Код"),
    ("database", "Бази даних"),
    ("server", "Сервер"),
    ("system", "Комп’ютер"),
    ("drive", "Диск"),
    ("keyboard", "Клавіатура"),
    ("settings", "Утиліти"),
    ("zap", "Швидкі дії"),
    ("rocket", "Запуск"),
    ("shield", "Захист"),
    ("key", "Ключі"),
    ("lock", "Приватне"),
    ("book", "Книги"),
    ("graduation", "Навчання"),
    ("notepad", "Документи"),
    ("clipboard", "Нотатки"),
    ("chart", "Аналітика"),
    ("wallet", "Фінанси"),
    ("cart", "Покупки"),
    ("calculator", "Розрахунки"),
    ("box", "Архів"),
    ("printer", "Друк"),
    ("folder", "Папки"),
    ("app", "Програми"),
    ("flask", "Наука"),
    ("leaf", "Природа"),
    ("coffee", "Перерва"),
    ("gift", "Подарунки"),
    ("tag", "Мітки"),
];
const GROUP_SUGGESTIONS: [(&str, &str); 6] = [
    ("Робота", "briefcase"),
    ("Дизайн", "palette"),
    ("Ігри", "gamepad"),
    ("Браузери", "browser"),
    ("Медіа", "film"),
    ("Утиліти", "settings"),
];

pub struct ActionDialog {
    existing: Option<Action>,
    draft: Action,
    /// Names Orbit filled in (a picked program, a Windows tile) are dropped when the type changes; typed ones stay.
    name_typed: bool,
    icon_chosen: bool,
    query: String,
    selected_name: String,
    url_mode: bool,
    details_open: bool,
    /// Programs, folders or scripts ticked to be added together, by target.
    picked: Vec<(String, Action)>,
    /// Actions ticked to move into a new group.
    move_ids: Vec<String>,
    error: String,
    group_path: Vec<String>,
    active: Option<usize>,
    results: Option<(String, Vec<AppEntry>, Option<String>)>,
    folders: Arc<Mutex<Option<Vec<FolderTile>>>>,
    scripts: Arc<Mutex<Option<(Vec<ScriptTile>, bool)>>>,
    script_query: String,
    focus: Option<&'static str>,
    focus_tries: u8,
}

enum Choice {
    Submit(Action, bool),
}

impl ActionDialog {
    pub fn new(app: &App, id: Option<String>) -> Self {
        let existing = id.and_then(|id| app.settings.action(&id).cloned());
        let draft = existing.clone().unwrap_or_else(|| Action {
            id: model::new_id(),
            name: String::new(),
            kind: Kind::App,
            target: String::new(),
            args: String::new(),
            icon: String::new(),
            children: vec![],
        });
        let app_name = existing
            .as_ref()
            .filter(|e| e.kind == Kind::App)
            .map(|e| e.name.clone())
            .unwrap_or_default();
        let url_mode = draft.target.starts_with("http://") || draft.target.starts_with("https://");
        let mut dialog = ActionDialog {
            name_typed: existing.is_some(),
            icon_chosen: !draft.icon.is_empty() && draft.icon != "group",
            query: app_name.clone(),
            selected_name: app_name,
            url_mode,
            details_open: !draft.args.is_empty(),
            picked: vec![],
            move_ids: vec![],
            error: String::new(),
            group_path: app.group_path.clone(),
            active: None,
            results: None,
            folders: Default::default(),
            scripts: Default::default(),
            script_query: String::new(),
            focus_tries: 0,
            focus: Some(if url_mode {
                "action-target"
            } else {
                "app-search"
            }),
            existing,
            draft,
        };
        dialog.load_lists(app);
        dialog
    }
    fn adding(&self) -> bool {
        self.existing.is_none()
    }

    fn load_lists(&mut self, app: &App) {
        if !self.adding() {
            return;
        }
        if self.draft.kind == Kind::Folder && self.folders.lock().unwrap().is_none() {
            let slot = self.folders.clone();
            let ctx = app.shared.ctx.get().cloned();
            std::thread::spawn(move || {
                *slot.lock().unwrap() = Some(crate::launcher::list_folders());
                if let Some(c) = ctx {
                    c.request_repaint();
                }
            });
        }
        if self.draft.kind == Kind::Script && self.scripts.lock().unwrap().is_none() {
            let slot = self.scripts.clone();
            let ctx = app.shared.ctx.get().cloned();
            let settings = app.settings.clone();
            std::thread::spawn(move || {
                *slot.lock().unwrap() = Some(crate::launcher::list_scripts(&settings));
                if let Some(c) = ctx {
                    c.request_repaint();
                }
            });
        }
    }

    fn primary_label(&self) -> String {
        if !self.adding() {
            return "Зберегти".into();
        }
        if self.draft.kind == Kind::Group {
            return if self.move_ids.is_empty() {
                "Створити групу".into()
            } else {
                format!("Створити групу ({})", self.move_ids.len())
            };
        }
        if !self.picked.is_empty() && PICKABLE.contains(&self.draft.kind) {
            return format!("Додати вибрані ({})", self.picked.len());
        }
        "Додати дію".into()
    }

    fn toggle_pick(&mut self, action: Action) {
        if let Some(i) = self.picked.iter().position(|(t, _)| *t == action.target) {
            self.picked.remove(i);
        } else {
            self.picked.push((action.target.clone(), action));
        }
    }

    fn set_kind(&mut self, kind: Kind, app: &App) {
        if self
            .existing
            .as_ref()
            .is_some_and(|e| e.kind == Kind::Group)
            && !self.draft.children.is_empty()
            && kind != Kind::Group
        {
            self.error = "Спочатку видаліть або перенесіть дії з групи.".into();
            return;
        }
        self.error.clear();
        if self.draft.kind == kind {
            return;
        }
        self.draft.kind = kind;
        self.draft.target = if kind == Kind::System {
            "explorer".into()
        } else {
            String::new()
        };
        self.draft.icon.clear();
        self.icon_chosen = false;
        if !self.name_typed {
            self.draft.name.clear();
        }
        self.picked.clear();
        self.move_ids.clear();
        self.focus = match kind {
            Kind::App => Some("app-search"),
            Kind::Script => Some("script-search"),
            Kind::Group => Some("action-name"),
            _ => None,
        };
        self.load_lists(app);
    }

    /// Returns false when the dialog should close.
    fn show(&mut self, ctx: &egui::Context, app: &mut App) -> bool {
        let p = app.palette;
        let mut choice: Option<Choice> = None;
        let mut cancel = false;
        let mut delete = false;
        let title = if self.adding() {
            "Додати дію"
        } else {
            "Редагувати дію"
        };
        let primary = self.primary_label();
        let adding = self.adding();
        let mut buttons = vec![btn(&primary, widgets::Kind::Primary), CANCEL];
        if !adding {
            buttons.push(Btn {
                label: "Видалити",
                icon: Some("trash"),
                style: widgets::Kind::Danger,
                left: true,
            });
        }
        let (_, clicked, close) = modal(ctx, &p, "action-dialog", title, 490.0, &buttons, |ui| {
            // Type choices.
            let kinds: Vec<Kind> = Kind::ALL
                .into_iter()
                .filter(|k| {
                    *k != Kind::Group
                        || self
                            .existing
                            .as_ref()
                            .is_some_and(|e| e.kind == Kind::Group)
                        || self.group_path.len() < MAX_GROUP_DEPTH
                })
                .collect();
            let width =
                (ui.available_width() - 6.0 * (kinds.len() as f32 - 1.0)) / kinds.len() as f32;
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 6.0;
                for kind in kinds {
                    let active = self.draft.kind == kind;
                    if tile(
                        ui,
                        &p,
                        Vec2::new(width, 63.0),
                        active,
                        false,
                        |ui, rect, color| {
                            paint_icon(
                                ui,
                                Rect::from_center_size(
                                    rect.center() - Vec2::new(0.0, 8.0),
                                    Vec2::splat(19.0),
                                ),
                                kind.icon(),
                                color,
                            );
                            ui.painter().text(
                                rect.center() + Vec2::new(0.0, 14.0),
                                Align2::CENTER_CENTER,
                                kind.label(),
                                font(9.0, Weight::Regular),
                                color,
                            );
                        },
                    )
                    .clicked()
                    {
                        self.set_kind(kind, app);
                    }
                }
            });
            ui.add_space(12.0);
            match self.draft.kind {
                Kind::App => self.app_fields(ui, &p, app, &mut choice),
                Kind::Folder => self.folder_fields(ui, &p, &mut choice),
                Kind::Script => self.script_fields(ui, &p, &mut choice),
                Kind::Group => self.group_fields(ui, &p, app),
                Kind::System => self.system_fields(ui, &p, &mut choice),
            }
            if !self.error.is_empty() {
                ui.add_space(6.0);
                ui.add(egui::Label::new(text(&self.error, 11.0, Weight::Regular, p.error)).wrap());
            }
            // Focus is asked for over a few frames: the click that opened the dialog may still be releasing.
            if let Some(id) = self.focus {
                let id = egui::Id::unique(id);
                if ui.ctx().memory(|m| m.has_focus(id)) {
                    self.focus = None;
                    self.focus_tries = 0;
                } else if self.focus_tries < 5 {
                    self.focus_tries += 1;
                    ui.ctx().memory_mut(|m| m.request_focus(id));
                    ui.ctx().request_repaint();
                } else {
                    self.focus = None;
                    self.focus_tries = 0;
                }
            }
        });
        match clicked {
            Some(0) => choice = Some(Choice::Submit(self.draft.clone(), false)),
            Some(1) => cancel = true,
            Some(2) => delete = true,
            _ => {}
        }
        if delete {
            app.dialog = Some(Dialog::Delete {
                menu: false,
                id: self.draft.id.clone(),
            });
            return false;
        }
        if cancel || close {
            return false;
        }
        match choice {
            Some(Choice::Submit(draft, single)) => !self.submit(app, draft, single),
            None => true,
        }
    }

    fn name_field(&mut self, ui: &mut Ui, p: &Palette, title: &str, hint: &str) {
        label(ui, p, title);
        let before = self.draft.name.clone();
        text_field(ui, "action-name", &mut self.draft.name, hint, 444.0);
        if self.draft.name != before {
            self.name_typed = true;
        }
        ui.add_space(8.0);
    }

    fn details(
        &mut self,
        ui: &mut Ui,
        p: &Palette,
        summary: &str,
        body: impl FnOnce(&mut Self, &mut Ui),
    ) {
        let (rect, response) =
            ui.allocate_exact_size(Vec2::new(ui.available_width(), 28.0), Sense::click());
        let color = if response.hovered() { p.text } else { p.muted };
        let chevron =
            Rect::from_min_size(rect.left_center() - Vec2::new(0.0, 6.5), Vec2::splat(13.0));
        if self.details_open {
            let painter = ui.painter();
            let c = chevron.center();
            painter.line_segment(
                [c + Vec2::new(-4.0, -2.0), c + Vec2::new(0.0, 2.0)],
                Stroke::new(1.5, color),
            );
            painter.line_segment(
                [c + Vec2::new(0.0, 2.0), c + Vec2::new(4.0, -2.0)],
                Stroke::new(1.5, color),
            );
        } else {
            paint_icon(ui, chevron, "chevron", color);
        }
        ui.painter().text(
            rect.left_center() + Vec2::new(19.0, 0.0),
            Align2::LEFT_CENTER,
            summary,
            font(12.0, Weight::Medium),
            color,
        );
        if response
            .on_hover_cursor(egui::CursorIcon::PointingHand)
            .clicked()
        {
            self.details_open = !self.details_open;
        }
        if self.details_open {
            ui.add_space(8.0);
            body(self, ui);
        }
    }

    fn path_field(
        &mut self,
        ui: &mut Ui,
        p: &Palette,
        title: &str,
        hint: &str,
        browse: Option<&str>,
    ) -> bool {
        label(ui, p, title);
        let mut clicked = false;
        ui.horizontal(|ui| {
            text_field(
                ui,
                "action-target",
                &mut self.draft.target,
                hint,
                if browse.is_some() { 346.0 } else { 444.0 },
            );
            if browse.is_some() && Button::new("Огляд…").show(ui).clicked() {
                clicked = true;
            }
        });
        ui.add_space(8.0);
        clicked
    }

    fn args_field(&mut self, ui: &mut Ui, p: &Palette, disabled: bool, hint_text: &str) {
        ui.horizontal(|ui| {
            ui.label(caps("Аргументи", p.muted));
            ui.label(text("· необов’язково", 11.0, Weight::Regular, p.faint));
        });
        ui.add_enabled_ui(!disabled, |ui| {
            text_field(
                ui,
                "action-args",
                &mut self.draft.args,
                "Наприклад, \"C:\\Projects\\scene.aep\"",
                444.0,
            );
        });
        note(ui, p, hint_text);
        ui.add_space(8.0);
    }

    // ---------- Programs ----------

    fn app_fields(&mut self, ui: &mut Ui, p: &Palette, app: &mut App, choice: &mut Option<Choice>) {
        let adding = self.adding();
        let mut browse = false;
        let mut mode: Option<bool> = None;
        if self.url_mode {
            ui.horizontal(|ui| {
                label(ui, p, "Посилання");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if Button::new("Знайти програму")
                        .icon("search", 13.0)
                        .ghost()
                        .small()
                        .show(ui)
                        .clicked()
                    {
                        mode = Some(false);
                    }
                });
            });
            text_field(
                ui,
                "action-target",
                &mut self.draft.target,
                "https://example.com",
                444.0,
            );
            note(ui, p, "Відкриється у вашому браузері.");
            ui.add_space(8.0);
            self.name_field(ui, p, "Назва в колесі", "Наприклад, Пошта");
        } else {
            ui.horizontal(|ui| {
                label(
                    ui,
                    p,
                    if adding {
                        "Виберіть програму"
                    } else {
                        "Замінити програму"
                    },
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if Button::new("Вказати URL")
                        .icon("external", 13.0)
                        .ghost()
                        .small()
                        .show(ui)
                        .clicked()
                    {
                        mode = Some(true);
                    }
                    if Button::new("Обрати файл…")
                        .icon("folder", 13.0)
                        .ghost()
                        .small()
                        .show(ui)
                        .clicked()
                    {
                        browse = true;
                    }
                });
            });
            self.app_search(ui, p, app, choice);
            if adding {
                note(
                    ui,
                    p,
                    "Клацніть програму, щоб додати її. Позначте галочкою кілька, щоб додати разом (з клавіатури — Ctrl+Enter).",
                );
            }
            ui.add_space(8.0);
            if !self.draft.target.is_empty() && !adding {
                egui::Frame::new()
                    .corner_radius(R_FIELD)
                    .fill(p.bg)
                    .inner_margin(egui::Margin::symmetric(12, 10))
                    .show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.horizontal(|ui| {
                            let (r, _) = ui.allocate_exact_size(Vec2::splat(27.0), Sense::hover());
                            let name = if self.selected_name.is_empty() {
                                self.draft.name.clone()
                            } else {
                                self.selected_name.clone()
                            };
                            paint_item_icon(
                                ui,
                                r,
                                IconSource {
                                    kind: Kind::App,
                                    name: &name,
                                    target: &self.draft.target,
                                    icon: "app",
                                },
                                p.muted,
                                p,
                                &app.shared.icons,
                            );
                            ui.vertical(|ui| {
                                ui.label(text(
                                    if name.is_empty() {
                                        "Обраний застосунок".to_string()
                                    } else {
                                        name.clone()
                                    },
                                    12.0,
                                    Weight::Medium,
                                    p.text,
                                ));
                                ui.label(text(
                                    if self.draft.target.starts_with("app-id:") {
                                        "Застосунок Windows".to_string()
                                    } else {
                                        self.draft.target.clone()
                                    },
                                    10.0,
                                    Weight::Regular,
                                    p.muted,
                                ));
                            });
                        });
                    });
                ui.add_space(8.0);
            }
            if !adding {
                self.name_field(ui, p, "Назва в колесі", "Заповниться після вибору програми");
            }
            let app_id = self.draft.target.starts_with("app-id:");
            self.details(ui, p, "Додатково", |this, ui| {
                if adding { this.name_field(ui, p, "Назва в колесі", "Заповниться після вибору програми"); }
                this.path_field(ui, p, "Програма, ярлик або URL", "C:\\Program Files\\…\\App.exe", None);
                this.args_field(ui, p, app_id, if app_id { "Цей застосунок запускається без додаткових аргументів." } else { "Для .exe можна вказати аргументи. Аргументи ярлика налаштовуються у його властивостях." });
            });
        }
        if let Some(url) = mode {
            self.url_mode = url;
            self.query.clear();
            self.selected_name.clear();
            self.draft.target.clear();
            self.draft.args.clear();
            self.error.clear();
            self.focus = Some(if url { "action-target" } else { "app-search" });
        }
        if browse {
            if let Some(file) = rfd::FileDialog::new()
                .set_title("Виберіть файл")
                .add_filter("Застосунки Windows", &["exe", "lnk"])
                .pick_file()
            {
                let value = file.display().to_string();
                let name = model::file_stem(&value);
                if self.draft.name.is_empty()
                    || self.draft.name == self.selected_name
                    || !self.name_typed
                {
                    self.draft.name = name.clone();
                }
                self.draft.target = value;
                self.selected_name = name.clone();
                self.query = name;
                if adding && !self.details_open {
                    *choice = Some(Choice::Submit(self.draft.clone(), true));
                }
            }
        }
    }

    /// Installed programs as a four-column grid, searched as you type. Arrow keys move by tiles and rows.
    fn app_search(&mut self, ui: &mut Ui, p: &Palette, app: &mut App, choice: &mut Option<Choice>) {
        let before = self.query.clone();
        let mut refresh = false;
        egui::Frame::new()
            .stroke(Stroke::new(1.0, p.line))
            .corner_radius(R_FIELD)
            .fill(p.bg)
            .inner_margin(egui::Margin {
                left: 14,
                right: 6,
                top: 3,
                bottom: 3,
            })
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    super::theme::icon(ui, "search", 16.0, p.muted);
                    let id = egui::Id::unique("app-search");
                    let response = ui.add(
                        egui::TextEdit::singleline(&mut self.query)
                            .id(id)
                            .frame(egui::Frame::NONE)
                            .hint_text(text(
                                "Пошук серед встановлених програм",
                                13.0,
                                Weight::Regular,
                                p.faint,
                            ))
                            .font(font(13.0, Weight::Regular))
                            .text_color(p.text)
                            .desired_width(ui.available_width() - 34.0)
                            .margin(egui::Margin::symmetric(4, 7))
                            .align(egui::Align2::LEFT_CENTER)
                            .min_size(Vec2::new(0.0, 30.0)),
                    );
                    // A one-line field gives up focus on Enter, so that Enter is handled here too.
                    if response.has_focus()
                        || (response.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter)))
                    {
                        // Arrow keys move the highlight in the grid instead of moving focus to another widget.
                        ui.memory_mut(|m| {
                            m.set_focus_lock_filter(
                                id,
                                egui::EventFilter {
                                    vertical_arrows: true,
                                    horizontal_arrows: true,
                                    ..Default::default()
                                },
                            )
                        });
                        self.search_keys(ui, choice);
                    }
                    if icon_button(ui, "refresh", 15.0, "Оновити список", false, true).clicked()
                    {
                        refresh = true;
                        ui.memory_mut(|m| m.request_focus(id));
                    }
                });
            });
        if refresh {
            app.shared.catalog.refresh();
            self.results = None;
        }
        // Typing a new search drops a program chosen earlier, and the name Orbit filled in for it.
        if self.query != before {
            self.active = None;
            if !self.draft.target.is_empty() && self.adding() == false {
                if self.draft.name == self.selected_name {
                    self.draft.name.clear();
                }
                self.draft.target.clear();
            }
        }
        let query = self.query.trim().to_string();
        if self.results.as_ref().is_none_or(|(q, _, _)| *q != query)
            || app.shared.catalog.is_loading()
        {
            match app.shared.catalog.search(&query, 60) {
                Some((results, error)) => self.results = Some((query.clone(), results, error)),
                None => {
                    self.results = None;
                    ui.ctx()
                        .request_repaint_after(std::time::Duration::from_millis(200));
                }
            }
        }
        ui.add_space(8.0);
        let picked: Vec<String> = self.picked.iter().map(|(t, _)| t.clone()).collect();
        let adding = self.adding();
        let mut clicked: Option<(usize, bool)> = None;
        egui::ScrollArea::vertical()
            .id_salt("app-results")
            .max_height(236.0)
            .min_scrolled_height(236.0)
            .auto_shrink([false, false])
            .show(ui, |ui| match &self.results {
                None => status(ui, p, "Шукаємо встановлені програми…"),
                Some((_, results, error)) if results.is_empty() => status(
                    ui,
                    p,
                    if error.is_some() {
                        "Не вдалося отримати список програм. Скористайтеся кнопкою «Обрати файл…»."
                    } else if !query.is_empty() {
                        "Нічого не знайдено. Спробуйте іншу назву або оберіть файл."
                    } else {
                        "Програм не знайдено. Оберіть файл або оновіть список."
                    },
                ),
                Some((_, results, _)) => {
                    let width =
                        (ui.available_width() - 6.0 * (COLUMNS as f32 - 1.0)) / COLUMNS as f32;
                    for (row, chunk) in results.chunks(COLUMNS).enumerate() {
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 6.0;
                            for (col, entry) in chunk.iter().enumerate() {
                                let index = row * COLUMNS + col;
                                let is_picked = picked.contains(&entry.target);
                                let mut check_hit = false;
                                let response = tile(
                                    ui,
                                    p,
                                    Vec2::new(width, 88.0),
                                    is_picked || self.active == Some(index),
                                    self.active == Some(index),
                                    |ui, rect, color| {
                                        paint_item_icon(
                                            ui,
                                            Rect::from_center_size(
                                                rect.center() - Vec2::new(0.0, 12.0),
                                                Vec2::splat(34.0),
                                            ),
                                            IconSource {
                                                kind: Kind::App,
                                                name: &entry.name,
                                                target: &entry.target,
                                                icon: "app",
                                            },
                                            color,
                                            p,
                                            &app.shared.icons,
                                        );
                                        let galley = clip(
                                            ui,
                                            &entry.name,
                                            11.0,
                                            p.text,
                                            rect.width() - 12.0,
                                        );
                                        ui.painter().galley(
                                            egui::pos2(
                                                rect.center().x - galley.size().x / 2.0,
                                                rect.bottom() - 26.0,
                                            ),
                                            galley,
                                            p.text,
                                        );
                                        if adding {
                                            check_hit = check(ui, p, rect, is_picked);
                                        }
                                    },
                                )
                                .on_hover_text(format!(
                                    "{}\n{}",
                                    entry.name,
                                    if entry.target.starts_with("app-id:") {
                                        "Застосунок Windows"
                                    } else {
                                        &entry.target
                                    }
                                ));
                                if response.clicked() {
                                    clicked =
                                        Some((index, check_hit || ui.input(|i| i.modifiers.ctrl)));
                                }
                                if self.active == Some(index) {
                                    response.scroll_to_me(None);
                                }
                            }
                        });
                        ui.add_space(6.0);
                    }
                }
            });
        if let Some((index, tick)) = clicked {
            self.activate_result(index, tick, choice);
        }
    }

    fn search_keys(&mut self, ui: &mut Ui, choice: &mut Option<Choice>) {
        let count = self.results.as_ref().map(|r| r.1.len()).unwrap_or(0);
        let (step, enter, escape, ctrl) = ui.input_mut(|i| {
            let step = [
                (Key::ArrowRight, 1i32),
                (Key::ArrowLeft, -1),
                (Key::ArrowDown, COLUMNS as i32),
                (Key::ArrowUp, -(COLUMNS as i32)),
            ]
            .into_iter()
            .find(|(k, _)| i.key_pressed(*k))
            .map(|(_, s)| s);
            (
                step,
                i.key_pressed(Key::Enter),
                i.key_pressed(Key::Escape),
                i.modifiers.ctrl,
            )
        });
        if let Some(step) = step {
            if count > 0 && (self.active.is_some() || step == COLUMNS as i32) {
                let next = self
                    .active
                    .map(|a| a as i32 + step)
                    .unwrap_or(0)
                    .clamp(0, count as i32 - 1);
                self.active = Some(next as usize);
            }
        }
        if enter && count > 0 && (self.active.is_some() || !self.query.trim().is_empty()) {
            self.activate_result(self.active.unwrap_or(0), ctrl, choice);
            self.focus = Some("app-search");
        }
        // Escape first drops the highlight, then clears the query; only an empty search lets it close the dialog.
        if escape && (self.active.is_some() || !self.query.is_empty()) {
            ui.input_mut(|i| i.consume_key(egui::Modifiers::NONE, Key::Escape));
            if self.active.is_some() {
                self.active = None;
            } else {
                self.query.clear();
            }
        }
    }

    fn activate_result(&mut self, index: usize, tick: bool, choice: &mut Option<Choice>) {
        let Some(entry) = self.results.as_ref().and_then(|r| r.1.get(index)).cloned() else {
            return;
        };
        if self.adding() && (!self.picked.is_empty() || tick) {
            let mut action = Action::new(Kind::App, entry.name.clone(), entry.target.clone());
            action.args = entry.args.clone();
            action.icon = "app".into();
            self.toggle_pick(action);
            return;
        }
        // Picking a program finishes the action unless the advanced fields are open to add arguments.
        if self.draft.name.is_empty() || self.draft.name == self.selected_name {
            self.draft.name = entry.name.clone();
        }
        self.draft.target = entry.target.clone();
        self.draft.args = entry.args.clone();
        self.draft.icon = "app".into();
        self.selected_name = entry.name.clone();
        self.query = entry.name.clone();
        self.error.clear();
        if !self.details_open {
            *choice = Some(Choice::Submit(self.draft.clone(), false));
        } else {
            self.focus = Some("action-name");
        }
    }

    // ---------- Folders ----------

    fn folder_fields(&mut self, ui: &mut Ui, p: &Palette, choice: &mut Option<Choice>) {
        if !self.adding() {
            self.name_field(ui, p, "Назва в колесі", "Візьметься з назви папки");
            if self.path_field(ui, p, "Шлях до папки", "C:\\Проєкти", Some("folder"))
            {
                self.browse_folder(choice);
            }
            note(ui, p, "Відкриється у Провіднику Windows.");
            return;
        }
        ui.horizontal(|ui| {
            label(ui, p, "Виберіть папку");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if Button::new("Обрати папку…")
                    .icon("folder", 13.0)
                    .ghost()
                    .small()
                    .show(ui)
                    .clicked()
                {
                    self.browse_folder(choice);
                }
            });
        });
        let folders = self.folders.lock().unwrap().clone();
        let mut clicked = None;
        egui::ScrollArea::vertical()
            .id_salt("folder-results")
            .max_height(236.0)
            .min_scrolled_height(236.0)
            .auto_shrink([false, false])
            .show(ui, |ui| match &folders {
                None => status(ui, p, "Шукаємо папки…"),
                Some(list) if list.is_empty() => status(
                    ui,
                    p,
                    "Папок не знайдено. Скористайтеся кнопкою «Обрати папку…».",
                ),
                Some(list) => {
                    for (group, title) in FOLDER_GROUPS {
                        let entries: Vec<(usize, &FolderTile)> = list
                            .iter()
                            .enumerate()
                            .filter(|(_, f)| f.group == group)
                            .collect();
                        if entries.is_empty() {
                            continue;
                        }
                        ui.label(text(title.to_uppercase(), 9.0, Weight::Regular, p.faint));
                        ui.add_space(2.0);
                        let width = (ui.available_width() - 18.0) / COLUMNS as f32;
                        for chunk in entries.chunks(COLUMNS) {
                            ui.horizontal(|ui| {
                                ui.spacing_mut().item_spacing.x = 6.0;
                                for (index, folder) in chunk {
                                    let is_picked =
                                        self.picked.iter().any(|(t, _)| *t == folder.path);
                                    let mut check_hit = false;
                                    let response = tile(
                                        ui,
                                        p,
                                        Vec2::new(width, 80.0),
                                        is_picked,
                                        false,
                                        |ui, rect, color| {
                                            paint_icon(
                                                ui,
                                                Rect::from_center_size(
                                                    rect.center() - Vec2::new(0.0, 10.0),
                                                    Vec2::splat(28.0),
                                                ),
                                                folder.icon,
                                                color,
                                            );
                                            let galley = clip(
                                                ui,
                                                &folder.name,
                                                11.0,
                                                p.text,
                                                rect.width() - 12.0,
                                            );
                                            ui.painter().galley(
                                                egui::pos2(
                                                    rect.center().x - galley.size().x / 2.0,
                                                    rect.bottom() - 24.0,
                                                ),
                                                galley,
                                                p.text,
                                            );
                                            check_hit = check(ui, p, rect, is_picked);
                                        },
                                    )
                                    .on_hover_text(&folder.path);
                                    if response.clicked() {
                                        clicked = Some((
                                            *index,
                                            check_hit || ui.input(|i| i.modifiers.ctrl),
                                        ));
                                    }
                                }
                            });
                            ui.add_space(6.0);
                        }
                    }
                }
            });
        note(
            ui,
            p,
            "Клацніть папку, щоб додати її. Позначте кілька галочкою або перетягніть папку з Провідника у вікно Orbit.",
        );
        if let (Some((index, tick)), Some(list)) = (clicked, folders) {
            let folder = &list[index];
            if !self.picked.is_empty() || tick {
                let mut a = Action::new(Kind::Folder, folder.name.clone(), folder.path.clone());
                a.icon = "folder".into();
                self.toggle_pick(a);
            } else {
                self.choose_folder(folder.path.clone(), folder.name.clone(), choice);
            }
        }
        ui.add_space(8.0);
        self.details(ui, p, "Вказати шлях вручну", |this, ui| {
            if this.path_field(ui, p, "Шлях до папки", "C:\\Проєкти", Some("folder"))
            {
                this.browse_folder(choice);
            }
            this.name_field(ui, p, "Назва в колесі", "Візьметься з назви папки");
        });
    }
    fn browse_folder(&mut self, choice: &mut Option<Choice>) {
        if let Some(dir) = rfd::FileDialog::new()
            .set_title("Виберіть папку")
            .pick_folder()
        {
            let value = dir.display().to_string();
            if self.adding() {
                self.choose_folder(value.clone(), model::folder_name(&value), choice);
            } else {
                if !self.name_typed {
                    self.draft.name = model::folder_name(&value);
                }
                self.draft.target = value;
            }
        }
    }
    fn choose_folder(&mut self, target: String, name: String, choice: &mut Option<Choice>) {
        self.draft.target = target;
        if !self.name_typed {
            self.draft.name = name;
        }
        *choice = Some(Choice::Submit(self.draft.clone(), true));
    }

    // ---------- Scripts ----------

    fn script_fields(&mut self, ui: &mut Ui, p: &Palette, choice: &mut Option<Choice>) {
        if !self.adding() {
            self.name_field(ui, p, "Назва в колесі", "Візьметься з назви файлу");
            if self.path_field(
                ui,
                p,
                "Файл скрипту",
                "C:\\Scripts\\render.ps1",
                Some("script"),
            ) {
                self.browse_script(choice);
            }
            self.args_field(
                ui,
                p,
                false,
                "Аргументи з пробілами беріть у подвійні лапки.",
            );
            note(ui, p, "Підтримуються .ps1, .py, .js та .cjs.");
            return;
        }
        ui.horizontal(|ui| {
            label(ui, p, "Виберіть скрипт");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if Button::new("Обрати файл…")
                    .icon("script", 13.0)
                    .ghost()
                    .small()
                    .show(ui)
                    .clicked()
                {
                    self.browse_script(choice);
                }
            });
        });
        let list = self.scripts.lock().unwrap().clone();
        let query = self.script_query.trim().to_lowercase();
        let visible: Vec<ScriptTile> = list
            .as_ref()
            .map(|(s, _)| {
                s.iter()
                    .filter(|t| {
                        query.is_empty()
                            || t.name.to_lowercase().contains(&query)
                            || t.folder.to_lowercase().contains(&query)
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        egui::Frame::new()
            .stroke(Stroke::new(1.0, p.line))
            .corner_radius(R_FIELD)
            .fill(p.bg)
            .inner_margin(egui::Margin {
                left: 14,
                right: 6,
                top: 3,
                bottom: 3,
            })
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    super::theme::icon(ui, "search", 16.0, p.muted);
                    let response = ui.add(
                        egui::TextEdit::singleline(&mut self.script_query)
                            .id(egui::Id::unique("script-search"))
                            .frame(egui::Frame::NONE)
                            .hint_text(text(
                                "Пошук за назвою або папкою",
                                13.0,
                                Weight::Regular,
                                p.faint,
                            ))
                            .font(font(13.0, Weight::Regular))
                            .text_color(p.text)
                            .desired_width(ui.available_width())
                            .margin(egui::Margin::symmetric(4, 7))
                            .align(egui::Align2::LEFT_CENTER)
                            .min_size(Vec2::new(0.0, 30.0)),
                    );
                    if response.has_focus()
                        || (response.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter)))
                    {
                        // Enter adds the first match; Escape clears the filter before it can close the dialog.
                        if ui.input(|i| i.key_pressed(Key::Enter)) {
                            if let Some(first) = visible.first() {
                                self.choose_script(first.path.clone(), choice);
                            }
                        }
                        if !self.script_query.is_empty()
                            && ui.input_mut(|i| i.consume_key(egui::Modifiers::NONE, Key::Escape))
                        {
                            self.script_query.clear();
                        }
                    }
                });
            });
        ui.add_space(8.0);
        let python = list.as_ref().map(|l| l.1).unwrap_or(true);
        let mut clicked = None;
        egui::ScrollArea::vertical().id_salt("script-results").max_height(236.0).min_scrolled_height(236.0).auto_shrink([false, false]).show(ui, |ui| {
            match &list {
                None => status(ui, p, "Шукаємо скрипти…"),
                Some((all, _)) if all.is_empty() => status(ui, p, "Скриптів поки не знайдено. Оберіть файл .ps1, .py, .js або .cjs чи перетягніть його у вікно Orbit."),
                Some(_) if visible.is_empty() => status(ui, p, "Нічого не знайдено. Спробуйте іншу назву або оберіть файл."),
                Some(_) => {
                    let width = (ui.available_width() - 18.0) / COLUMNS as f32;
                    for chunk in visible.chunks(COLUMNS) {
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 6.0;
                            for script in chunk {
                                let is_picked = self.picked.iter().any(|(t, _)| *t == script.path);
                                let missing = script.extension == ".py" && !python;
                                let mut check_hit = false;
                                let response = tile(ui, p, Vec2::new(width, 88.0), is_picked, false, |ui, rect, color| {
                                    let color = if missing { color.gamma_multiply(0.5) } else { color };
                                    paint_icon(ui, Rect::from_center_size(rect.center() - Vec2::new(0.0, 16.0), Vec2::splat(26.0)), "script", color);
                                    let tag = match script.extension.as_str() { ".ps1" => "PS1", ".py" => "PY", _ => "JS" };
                                    ui.painter().text(rect.center() + Vec2::new(14.0, -6.0), Align2::CENTER_CENTER, tag, font(8.0, Weight::Mono), color);
                                    let galley = clip(ui, &script.name, 11.0, p.text, rect.width() - 12.0);
                                    ui.painter().galley(egui::pos2(rect.center().x - galley.size().x / 2.0, rect.bottom() - 33.0), galley, p.text);
                                    let sub = clip(ui, if missing { "Немає Python" } else { &script.folder }, 9.0, p.muted, rect.width() - 12.0);
                                    ui.painter().galley(egui::pos2(rect.center().x - sub.size().x / 2.0, rect.bottom() - 18.0), sub, p.muted);
                                    check_hit = check(ui, p, rect, is_picked);
                                }).on_hover_text(if missing { format!("{}\nПотрібен Python Launcher (py.exe)", script.path) } else { script.path.clone() });
                                if response.clicked() { clicked = Some((script.clone(), check_hit || ui.input(|i| i.modifiers.ctrl))); }
                            }
                        });
                        ui.add_space(6.0);
                    }
                }
            }
        });
        let mut hint = "Клацніть скрипт, щоб додати його, або позначте кілька галочкою. Шукаємо .ps1, .py, .js і .cjs на робочому столі, у Документах, Завантаженнях і папках ваших скриптів.".to_string();
        if !python
            && list
                .as_ref()
                .is_some_and(|l| l.0.iter().any(|s| s.extension == ".py"))
        {
            hint.push_str(" Python Launcher не знайдено, тож .py-скрипти не запустяться, доки ви його не встановите.");
        }
        note(ui, p, &hint);
        if let Some((script, tick)) = clicked {
            if !self.picked.is_empty() || tick {
                self.toggle_pick(Action::new(
                    Kind::Script,
                    script.name.clone(),
                    script.path.clone(),
                ));
            } else {
                self.choose_script(script.path, choice);
            }
        }
        ui.add_space(8.0);
        self.details(
            ui,
            p,
            "Аргументи та шлях вручну",
            |this, ui| {
                if this.path_field(
                    ui,
                    p,
                    "Файл скрипту",
                    "C:\\Scripts\\render.ps1",
                    Some("script"),
                ) {
                    this.browse_script(choice);
                }
                this.name_field(ui, p, "Назва в колесі", "Візьметься з назви файлу");
                this.args_field(
                    ui,
                    p,
                    false,
                    "Аргументи з пробілами беріть у подвійні лапки.",
                );
            },
        );
    }
    fn browse_script(&mut self, choice: &mut Option<Choice>) {
        if let Some(file) = rfd::FileDialog::new()
            .set_title("Виберіть файл")
            .add_filter("Скрипти", &["ps1", "py", "js", "cjs"])
            .pick_file()
        {
            let value = file.display().to_string();
            if self.adding() {
                self.choose_script(value, choice);
            } else {
                if !self.name_typed {
                    self.draft.name = model::file_stem(&value);
                }
                self.draft.target = value;
            }
        }
    }
    /// With the advanced fields open the script only fills the form, so arguments can be added before saving.
    fn choose_script(&mut self, target: String, choice: &mut Option<Choice>) {
        if !self.name_typed {
            self.draft.name = model::file_stem(&target);
        }
        self.draft.target = target;
        if !self.details_open {
            *choice = Some(Choice::Submit(self.draft.clone(), true));
        } else {
            self.focus = Some("action-args");
        }
    }

    // ---------- Groups ----------

    fn group_fields(&mut self, ui: &mut Ui, p: &Palette, app: &App) {
        self.name_field(ui, p, "Назва групи", "Нова група");
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = Vec2::new(6.0, 6.0);
            for (name, glyph) in GROUP_SUGGESTIONS {
                let galley = ui.painter().layout_no_wrap(
                    name.to_string(),
                    font(11.0, Weight::Regular),
                    p.muted,
                );
                let (rect, response) =
                    ui.allocate_exact_size(Vec2::new(galley.size().x + 20.0, 26.0), Sense::click());
                ui.painter().rect_filled(
                    rect,
                    13,
                    if response.hovered() {
                        widgets::mix(p.active, p.text, 0.12)
                    } else {
                        p.active
                    },
                );
                ui.painter()
                    .galley(rect.center() - galley.size() / 2.0, galley, p.text);
                if response
                    .on_hover_cursor(egui::CursorIcon::PointingHand)
                    .clicked()
                {
                    // A suggested name also picks a fitting icon unless the user already chose one.
                    self.draft.name = name.into();
                    self.name_typed = true;
                    if !self.icon_chosen {
                        self.draft.icon = glyph.into();
                    }
                    self.focus = Some("action-name");
                }
            }
        });
        ui.add_space(14.0);
        label(ui, p, "Значок");
        let current = if self.draft.icon.is_empty() {
            "group".to_string()
        } else {
            self.draft.icon.clone()
        };
        let width = (ui.available_width() - 6.0 * 8.0) / 9.0;
        for chunk in GROUP_ICONS.chunks(9) {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 6.0;
                for (glyph, title) in chunk {
                    let active = current == *glyph;
                    let response = tile(
                        ui,
                        p,
                        Vec2::new(width, 34.0),
                        active,
                        false,
                        |ui, rect, color| {
                            paint_icon(
                                ui,
                                Rect::from_center_size(rect.center(), Vec2::splat(18.0)),
                                glyph,
                                color,
                            );
                        },
                    )
                    .on_hover_text(*title);
                    if response.clicked() {
                        self.icon_chosen = true;
                        self.draft.icon = glyph.to_string();
                    }
                }
            });
            ui.add_space(6.0);
        }
        if !self.adding() {
            return;
        }
        ui.add_space(8.0);
        let level = app.settings.level(&self.group_path).0.clone();
        let movable: Vec<Action> = level
            .into_iter()
            .filter(|i| self.group_path.len() + 1 + i.group_height() <= MAX_GROUP_DEPTH)
            .collect();
        if movable.is_empty() {
            note(
                ui,
                p,
                "Після створення група відкриється, щоб ви додали в неї дії.",
            );
            return;
        }
        ui.horizontal(|ui| {
            ui.label(caps("Перенести в групу", p.muted));
            ui.label(text("· необов’язково", 11.0, Weight::Regular, p.faint));
        });
        let width = (ui.available_width() - 18.0) / COLUMNS as f32;
        for chunk in movable.chunks(COLUMNS) {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 6.0;
                for item in chunk {
                    let is_picked = self.move_ids.contains(&item.id);
                    let response = tile(
                        ui,
                        p,
                        Vec2::new(width, 80.0),
                        is_picked,
                        false,
                        |ui, rect, color| {
                            paint_item_icon(
                                ui,
                                Rect::from_center_size(
                                    rect.center() - Vec2::new(0.0, 10.0),
                                    Vec2::splat(28.0),
                                ),
                                IconSource::from(item),
                                color,
                                p,
                                &app.shared.icons,
                            );
                            let galley = clip(ui, &item.name, 11.0, p.text, rect.width() - 12.0);
                            ui.painter().galley(
                                egui::pos2(
                                    rect.center().x - galley.size().x / 2.0,
                                    rect.bottom() - 24.0,
                                ),
                                galley,
                                p.text,
                            );
                            check(ui, p, rect, is_picked);
                        },
                    );
                    if response.clicked() {
                        if is_picked {
                            self.move_ids.retain(|i| *i != item.id);
                        } else {
                            self.move_ids.push(item.id.clone());
                        }
                    }
                }
            });
            ui.add_space(6.0);
        }
        note(
            ui,
            p,
            "Позначені дії одразу переїдуть у нову групу. Після створення група відкриється, щоб додати ще.",
        );
    }

    // ---------- Windows commands ----------

    fn system_fields(&mut self, ui: &mut Ui, p: &Palette, choice: &mut Option<Choice>) {
        label(ui, p, "Команда Windows");
        let width = (ui.available_width() - 6.0 * 4.0) / 5.0;
        for chunk in SYSTEM_ACTIONS.chunks(5) {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 6.0;
                for (id, name, glyph) in chunk {
                    let active = self.draft.target == *id;
                    let response = tile(
                        ui,
                        p,
                        Vec2::new(width, 76.0),
                        active,
                        false,
                        |ui, rect, color| {
                            paint_icon(
                                ui,
                                Rect::from_center_size(
                                    rect.center() - Vec2::new(0.0, 14.0),
                                    Vec2::splat(19.0),
                                ),
                                glyph,
                                color,
                            );
                            let galley = ui.fonts_mut(|f| {
                                f.layout(
                                    name.to_string(),
                                    font(10.0, Weight::Regular),
                                    color,
                                    rect.width() - 8.0,
                                )
                            });
                            ui.painter().galley(
                                egui::pos2(
                                    rect.center().x - galley.size().x / 2.0,
                                    rect.center().y + 2.0,
                                ),
                                galley,
                                color,
                            );
                        },
                    );
                    if response.double_clicked() {
                        self.draft.target = id.to_string();
                        *choice = Some(Choice::Submit(self.draft.clone(), false));
                    } else if response.clicked() {
                        self.draft.target = id.to_string();
                    }
                }
            });
            ui.add_space(6.0);
        }
    }

    // ---------- Saving ----------

    fn add_picked(&mut self, app: &mut App) -> bool {
        let mut next = app.settings.clone();
        let level = next.level_mut(&self.group_path);
        let free = MAX_ITEMS.saturating_sub(level.len());
        if self.picked.len() > free {
            self.error = format!(
                "У цьому колесі є місце ще для {free} {}.",
                model::actions_word(free)
            );
            return false;
        }
        let added: Vec<Action> = self
            .picked
            .iter()
            .map(|(_, a)| {
                let mut a = a.clone();
                a.id = model::new_id();
                a
            })
            .collect();
        let last = added.last().map(|a| a.id.clone());
        let n = added.len();
        level.extend(added);
        if app.save(next, &format!("Додано {n} {}", model::actions_word(n))) {
            if let Some(id) = last {
                app.selected = id;
            }
            true
        } else {
            false
        }
    }

    /// Returns true when the dialog is done.
    fn submit(&mut self, app: &mut App, mut item: Action, single: bool) -> bool {
        if item.kind == Kind::System {
            let existing_system = self.existing.as_ref().filter(|e| e.kind == Kind::System);
            if !self.name_typed || existing_system.is_some() {
                item.name = match existing_system {
                    Some(e) if e.target == item.target => e.name.clone(),
                    _ => model::system_name(&item.target).unwrap_or("").to_string(),
                };
            }
            item.args.clear();
        } else {
            item.name = item.name.trim().to_string();
            item.target = if item.kind == Kind::Group {
                String::new()
            } else {
                item.target.trim().to_string()
            };
            let keeps_args = item.kind == Kind::Script
                || item.kind == Kind::App && !self.url_mode && !item.target.starts_with("app-id:");
            if !keeps_args {
                item.args.clear();
            }
        }
        if !single && self.adding() && PICKABLE.contains(&item.kind) && !self.picked.is_empty() {
            return self.add_picked(app);
        }
        if item.name.is_empty() && !item.target.is_empty() && item.kind == Kind::Folder {
            item.name = model::folder_name(&item.target);
        }
        if item.name.is_empty() && !item.target.is_empty() && item.kind == Kind::Script {
            item.name = model::file_stem(&item.target);
        }
        if item.name.is_empty() && item.kind == Kind::Group {
            item.name = "Нова група".into();
        }
        if item.kind == Kind::App && item.target.is_empty() {
            self.error = "Оберіть застосунок зі списку, файл або вкажіть посилання.".into();
            self.focus = Some(if self.url_mode {
                "action-target"
            } else {
                "app-search"
            });
            return false;
        }
        if item.name.is_empty() {
            self.error = "Вкажіть назву дії.".into();
            self.details_open = true;
            self.focus = Some("action-name");
            return false;
        }
        let mut next = app.settings.clone();
        let moving = self.adding() && item.kind == Kind::Group && !self.move_ids.is_empty();
        if let Some(existing) = &self.existing {
            let Some(location) = next.find(&existing.id) else {
                return true;
            };
            let current = next.get(&location).clone();
            if item.kind == Kind::Group && current.kind == Kind::Group {
                item.children = current.children;
            }
            let index = location.index();
            next.siblings_mut(&location)[index] = item.clone();
        } else if moving {
            // Ticked actions move into the new group, which takes the place of the first of them.
            let level = next.level_mut(&self.group_path);
            let at = level
                .iter()
                .position(|e| self.move_ids.contains(&e.id))
                .unwrap_or(level.len());
            item.children = level
                .iter()
                .filter(|e| self.move_ids.contains(&e.id))
                .cloned()
                .collect();
            level.retain(|e| !self.move_ids.contains(&e.id));
            level.insert(at.min(level.len()), item.clone());
        } else {
            next.level_mut(&self.group_path).push(item.clone());
        }
        let n = self.move_ids.len();
        let message = if self.existing.is_some() {
            "Дію збережено".to_string()
        } else if item.kind == Kind::Group {
            if moving {
                format!("Групу створено, перенесено {n} {}", model::actions_word(n))
            } else {
                "Групу створено".into()
            }
        } else {
            "Дію додано".into()
        };
        if !app.save(next, &message) {
            return false;
        }
        app.selected = item.id.clone();
        // A new group opens right away so its actions can be added without finding it in the list.
        if self.adding() && item.kind == Kind::Group {
            app.open_group(&item.id);
        }
        true
    }
}

// ---------- Small pieces ----------

/// A bordered tile (kind choices, program and folder results, icons). Paints its content via `content(ui, rect, color)`.
fn tile(
    ui: &mut Ui,
    p: &Palette,
    size: Vec2,
    active: bool,
    focused: bool,
    content: impl FnOnce(&mut Ui, Rect, Color32),
) -> egui::Response {
    let (rect, response) = ui.allocate_exact_size(size, Sense::click());
    let hovered = response.hovered();
    // Night tiles on the graphite dialog; the chosen one turns steel with a paper ring.
    let radius = R_FIELD.min((size.y / 2.0) as u8);
    let fill = if active {
        p.active
    } else if hovered {
        p.hover
    } else {
        p.bg
    };
    ui.painter().rect_filled(rect, radius, fill);
    if active {
        ui.painter()
            .rect_stroke(rect, radius, Stroke::new(1.5, p.text), StrokeKind::Inside);
    }
    if focused {
        ui.painter().rect_stroke(
            rect.expand(3.0),
            radius + 3,
            Stroke::new(2.0, p.focus),
            StrokeKind::Outside,
        );
    }
    content(ui, rect, if active || hovered { p.text } else { p.muted });
    response.on_hover_cursor(egui::CursorIcon::PointingHand)
}

/// The tick box in a tile's corner. Returns true when the pointer is on it.
fn check(ui: &Ui, p: &Palette, rect: Rect, on: bool) -> bool {
    let r = Rect::from_min_size(rect.right_top() + Vec2::new(-25.0, 7.0), Vec2::splat(18.0));
    let hovered = ui.rect_contains_pointer(r);
    if on || hovered || ui.rect_contains_pointer(rect) {
        let off = if hovered { p.line_strong } else { p.panel };
        ui.painter()
            .rect_filled(r, 6, if on { p.primary } else { off });
        if on {
            paint_icon(ui, r.shrink(3.0), "check", p.on_primary);
        }
    }
    hovered
}

fn status(ui: &mut Ui, p: &Palette, message: &str) {
    ui.add_space(30.0);
    ui.vertical_centered(|ui| {
        ui.add(egui::Label::new(text(message, 12.0, Weight::Regular, p.muted)).wrap());
    });
}

fn clip(ui: &Ui, label: &str, size: f32, color: Color32, width: f32) -> Arc<egui::Galley> {
    let mut job = egui::text::LayoutJob::simple_singleline(
        label.to_string(),
        font(size, Weight::Medium),
        color,
    );
    job.wrap = egui::text::TextWrapping {
        max_width: width,
        max_rows: 1,
        break_anywhere: true,
        overflow_character: Some('…'),
    };
    job.halign = egui::Align::LEFT;
    ui.fonts_mut(|f| f.layout_job(job))
}

#[allow(dead_code)]
fn unused(_: &widgets::Kind) {}
