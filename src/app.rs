//! The editor window and the glue between the input thread, the wheel window and the settings.

use crate::model::{self, MAX_ITEMS, Settings, Theme};
use crate::platform::{InputEvent, TrayCommand, os};
use crate::shared::{AppEvent, Shared, Trigger, overlay_id};
use crate::ui::dialogs::Dialog;
use crate::ui::theme::{self, Palette, Weight, font, paint_icon, text};
use crate::ui::{overlay, widgets};
use crate::updater::Updater;
use egui::{Align2, Color32, Rect, Sense, Stroke, Vec2};
use std::sync::{Arc, OnceLock};
use std::time::Instant;

static SHARED: OnceLock<Arc<Shared>> = OnceLock::new();
pub fn shared() -> Arc<Shared> {
    SHARED.get().expect("Orbit is not running").clone()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Page {
    Menus,
    Library,
    Controls,
    Settings,
}
impl Page {
    pub const ALL: [Page; 4] = [Page::Menus, Page::Library, Page::Controls, Page::Settings];
    pub fn label(self) -> &'static str {
        match self {
            Page::Menus => "Мої меню",
            Page::Library => "Усі дії",
            Page::Controls => "Керування",
            Page::Settings => "Налаштування",
        }
    }
    pub fn icon(self) -> &'static str {
        match self {
            Page::Menus => "wheel",
            Page::Library => "grid",
            Page::Controls => "mouse",
            Page::Settings => "settings",
        }
    }
}

/// Startup options from the command line.
pub struct Launch {
    pub notice: Option<(String, String)>,
    pub first_run: bool,
}

pub struct App {
    pub shared: Arc<Shared>,
    pub settings: Settings,
    revision: u64,
    pub page: Page,
    pub group_path: Vec<String>,
    pub selected: String,
    pub search: String,
    pub dialog: Option<Dialog>,
    toast: Option<(String, bool, Instant)>,
    pub updater: Updater,
    pub list_drag: Option<String>,
    pub wheel_drag: Option<crate::ui::editor::WheelDrag>,
    pub size_percent: Option<f32>,
    pub admin_busy: bool,
    quitting: bool,
    pub palette: Palette,
    file_hover: bool,
    pub focus_request: Option<egui::Id>,
    pub scroll_top: bool,
}

impl App {
    pub fn new(cc: &eframe::CreationContext, shared: Arc<Shared>, launch: Launch) -> Self {
        let ctx = cc.egui_ctx.clone();
        let _ = shared.ctx.set(ctx.clone());
        let _ = SHARED.set(shared.clone());
        egui_extras::install_image_loaders(&ctx);
        theme::install_fonts(&ctx);
        let (settings, revision) = shared.store.snapshot();
        let notify: Arc<dyn Fn() + Send + Sync> = {
            let ctx = ctx.clone();
            Arc::new(move || ctx.request_repaint())
        };
        let updater = Updater::new(crate::storage::data_dir().join("updates"), notify);
        // The input thread: mouse hook, Ctrl + Space, Escape and the tray icon.
        let sink_shared = shared.clone();
        os::start_input(
            if settings.enabled {
                settings.trigger_button
            } else {
                0
            },
            Box::new(move |event| handle_input(&sink_shared, event)),
        );
        shared.set_runtime(|r| {
            r.hook_ready = cfg!(windows) && settings.enabled;
            r.shortcut = cfg!(windows);
        });
        let admin_shared = shared.clone();
        std::thread::spawn(move || {
            let status = os::admin_status();
            admin_shared.set_runtime(|r| r.admin = status);
        });
        sync_tray(&settings);
        os::set_login_item(settings.launch_at_login && crate::install::is_installed_copy());
        shared.catalog.warm();
        if launch.first_run {
            seed_first_run(shared.clone());
        }
        let mut app = App {
            shared,
            settings,
            revision,
            page: Page::Menus,
            group_path: vec![],
            selected: String::new(),
            search: String::new(),
            dialog: None,
            toast: None,
            updater,
            list_drag: None,
            wheel_drag: None,
            size_percent: None,
            admin_busy: false,
            quitting: false,
            palette: theme::DARK,
            file_hover: false,
            focus_request: None,
            scroll_top: false,
        };
        if let Some((title, body)) = launch.notice {
            app.dialog = Some(Dialog::Notice { title, body });
        }
        app
    }

    pub fn toast(&mut self, message: impl Into<String>, error: bool) {
        self.toast = Some((message.into(), error, Instant::now()));
    }

    /// Validates and saves a whole configuration; failures are shown, never thrown.
    pub fn save(&mut self, next: Settings, message: &str) -> bool {
        let previous = self.settings.clone();
        match self.shared.store.save(next) {
            Ok(saved) => {
                self.apply_side_effects(&previous, &saved);
                self.settings = saved;
                self.revision = self.shared.store.revision();
                if !message.is_empty() {
                    self.toast(message, false);
                }
                true
            }
            Err(error) => {
                self.toast(error, true);
                false
            }
        }
    }
    pub fn change(&mut self, change: impl FnOnce(&mut Settings), message: &str) -> bool {
        let mut next = self.settings.clone();
        change(&mut next);
        self.save(next, message)
    }

    fn apply_side_effects(&self, previous: &Settings, next: &Settings) {
        if previous.enabled != next.enabled || previous.trigger_button != next.trigger_button {
            os::set_trigger_button(if next.enabled { next.trigger_button } else { 0 });
            self.shared
                .set_runtime(|r| r.hook_ready = cfg!(windows) && next.enabled);
        }
        if !next.enabled {
            self.shared.close_wheel();
        }
        if previous.launch_at_login != next.launch_at_login {
            os::set_login_item(next.launch_at_login && crate::install::is_installed_copy());
        }
        sync_tray(next);
    }

    pub fn level(&self) -> (&Vec<model::Action>, &str) {
        self.settings.level(&self.group_path)
    }

    pub fn open_group(&mut self, id: &str) {
        let Some(location) = self.settings.find(id) else {
            return;
        };
        if !self.settings.get(&location).is_group() {
            return;
        }
        let menu = self.settings.menus[location.menu].id.clone();
        if menu != self.settings.active_menu_id && !self.change(|s| s.active_menu_id = menu, "") {
            return;
        }
        let mut path = location.groups.clone();
        path.push(id.to_string());
        self.group_path = path;
        self.page = Page::Menus;
        self.selected.clear();
    }
    /// A click on a row or a wheel item: groups open, actions open their editor.
    pub fn activate(&mut self, id: &str) {
        match self.settings.action(id) {
            Some(a) if a.is_group() => self.open_group(id),
            Some(_) => {
                self.selected = id.to_string();
                self.open_action_dialog(Some(id.to_string()));
            }
            None => {}
        }
    }
    pub fn open_action_dialog(&mut self, id: Option<String>) {
        if id.is_none() && self.level().0.len() >= MAX_ITEMS {
            self.toast(
                "У цьому колесі вже 12 дій. Створіть групу або інше меню.",
                true,
            );
            return;
        }
        self.dialog = Some(Dialog::Action(Box::new(
            crate::ui::dialogs::ActionDialog::new(self, id),
        )));
    }
    pub fn set_page(&mut self, page: Page) {
        self.page = page;
        self.group_path.clear();
        self.scroll_top = true;
    }

    pub fn preview_wheel(&self) {
        let shared = self.shared.clone();
        // The click that asked for it must not land on the freshly opened wheel.
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(60));
            shared.open_wheel(Trigger::Preview, None, 0);
        });
    }

    fn handle_events(&mut self, ctx: &egui::Context) {
        for event in self.shared.take_events() {
            match event {
                AppEvent::ShowMain => {
                    ctx.send_viewport_cmd(egui::ViewportCommand::Visible(true));
                    ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
                }
                AppEvent::Navigate { group_path, add } => {
                    self.page = Page::Menus;
                    self.dialog = None;
                    self.settings = self.shared.store.get();
                    self.group_path = self.settings.trim_group_path(&group_path);
                    self.selected.clear();
                    if add {
                        self.open_action_dialog(None);
                    }
                }
                AppEvent::Toast(message, error) => self.toast(message, error),
                AppEvent::ActionError { id, error } => {
                    self.selected = id;
                    self.toast(error, true);
                }
                AppEvent::Quit => self.quit(ctx),
            }
        }
    }

    fn quit(&mut self, ctx: &egui::Context) {
        self.quitting = true;
        self.shared.close_wheel();
        os::stop_input();
        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
    }

    // ---------- Shell ----------

    fn titlebar(&mut self, ui: &mut egui::Ui) {
        let p = self.palette;
        let rect = ui.max_rect();
        let drag = ui.interact(
            rect,
            egui::Id::unique("titlebar-drag"),
            Sense::click_and_drag(),
        );
        if drag.drag_started() {
            ui.ctx().send_viewport_cmd(egui::ViewportCommand::StartDrag);
        }
        if drag.double_clicked() {
            let max = ui.ctx().input(|i| i.viewport().maximized.unwrap_or(false));
            ui.ctx()
                .send_viewport_cmd(egui::ViewportCommand::Maximized(!max));
        }
        let left = rect.left() + 23.0;
        paint_icon(
            ui,
            Rect::from_center_size(egui::pos2(left + 12.0, rect.center().y), Vec2::splat(24.0)),
            "orbit",
            p.text,
        );
        ui.painter().text(
            egui::pos2(left + 33.0, rect.center().y),
            Align2::LEFT_CENTER,
            "Orbit",
            font(14.0, Weight::Semibold),
            p.text,
        );
        ui.painter().text(
            egui::pos2(left + 80.0, rect.center().y + 1.0),
            Align2::LEFT_CENTER,
            crate::updater::CURRENT,
            font(10.0, Weight::Mono),
            p.faint,
        );
        let mut x = rect.right() - 45.0 * 3.0;
        for (icon, size, label, close) in [
            ("minus", 15.0, "Згорнути", false),
            ("app", 13.0, "Розгорнути", false),
            ("close", 16.0, "Згорнути в трей", true),
        ] {
            let button =
                Rect::from_min_size(egui::pos2(x, rect.top()), Vec2::new(45.0, rect.height()));
            let response = ui
                .interact(
                    button,
                    egui::Id::unique(("window-control", label)),
                    Sense::click(),
                )
                .on_hover_text(label);
            if response.hovered() {
                ui.painter().rect_filled(
                    button,
                    0,
                    if close {
                        Color32::from_rgb(0xc4, 0x2b, 0x1c)
                    } else {
                        p.hover
                    },
                );
            }
            paint_icon(
                ui,
                Rect::from_center_size(button.center(), Vec2::splat(size)),
                icon,
                if close && response.hovered() {
                    Color32::WHITE
                } else {
                    p.muted
                },
            );
            if response.clicked() {
                let ctx = ui.ctx();
                match label {
                    "Згорнути" => {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Minimized(true))
                    }
                    "Розгорнути" => {
                        let max = ctx.input(|i| i.viewport().maximized.unwrap_or(false));
                        ctx.send_viewport_cmd(egui::ViewportCommand::Maximized(!max));
                    }
                    _ => ctx.send_viewport_cmd(egui::ViewportCommand::Visible(false)),
                }
            }
            x += 45.0;
        }
    }

    fn sidebar(&mut self, ui: &mut egui::Ui) {
        let p = self.palette;
        let rect = ui.max_rect();
        let mut y = rect.top() + 24.0;
        ui.painter().text(
            egui::pos2(rect.left() + 28.0, y + 6.0),
            Align2::LEFT_CENTER,
            "РОБОЧИЙ ПРОСТІР",
            font(10.0, Weight::Medium),
            p.faint,
        );
        y += 24.0;
        for page in Page::ALL {
            let row = Rect::from_min_size(
                egui::pos2(rect.left() + 12.0, y),
                Vec2::new(rect.width() - 24.0, 40.0),
            );
            let response = ui.interact(row, egui::Id::unique(("nav", page as u8)), Sense::click());
            let active = self.page == page;
            // Navigation pills: the current page is inverted, the rest sit on the canvas.
            if active {
                ui.painter().rect_filled(row, 20, p.primary);
            } else if response.hovered() {
                ui.painter().rect_filled(row, 20, p.panel);
            }
            let color = if active {
                p.on_primary
            } else if response.hovered() {
                p.text
            } else {
                p.muted
            };
            paint_icon(
                ui,
                Rect::from_min_size(
                    egui::pos2(row.left() + 14.0, row.center().y - 9.0),
                    Vec2::splat(18.0),
                ),
                page.icon(),
                color,
            );
            ui.painter().text(
                egui::pos2(row.left() + 42.0, row.center().y),
                Align2::LEFT_CENTER,
                page.label(),
                font(13.0, Weight::Medium),
                color,
            );
            if page == Page::Menus {
                let count = self.settings.menus.len().to_string();
                let badge = Rect::from_center_size(
                    egui::pos2(row.right() - 22.0, row.center().y),
                    Vec2::new(22.0, 20.0),
                );
                ui.painter().rect_filled(
                    badge,
                    10,
                    if active {
                        p.on_primary.gamma_multiply(0.12)
                    } else {
                        p.active
                    },
                );
                ui.painter().text(
                    badge.center(),
                    Align2::CENTER_CENTER,
                    count,
                    font(10.0, Weight::Medium),
                    if active { p.on_primary } else { p.text },
                );
            }
            if response
                .on_hover_cursor(egui::CursorIcon::PointingHand)
                .clicked()
            {
                self.set_page(page);
            }
            y += 44.0;
        }
        // Engine card and footer.
        let runtime = self.shared.runtime();
        let on = self.settings.enabled && runtime.hook_ready;
        let card = Rect::from_min_size(
            egui::pos2(rect.left() + 16.0, rect.bottom() - 162.0),
            Vec2::new(rect.width() - 32.0, 98.0),
        );
        ui.painter().rect_filled(card, 20, p.panel);
        let dot = egui::pos2(card.left() + 17.0, card.top() + 20.0);
        if on {
            ui.painter()
                .circle_filled(dot, 6.0, p.green.gamma_multiply(0.25));
        }
        ui.painter()
            .circle_filled(dot, 3.5, if on { p.green } else { p.faint });
        ui.painter().text(
            egui::pos2(card.left() + 29.0, card.top() + 20.0),
            Align2::LEFT_CENTER,
            status_label(&self.settings, &runtime),
            font(12.0, Weight::Medium),
            p.text,
        );
        let note = if self.settings.enabled {
            format!("Виклик — бічна кнопка {}", self.settings.trigger_button)
        } else {
            "Увімкніть у розділі «Керування»".into()
        };
        ui.painter().text(
            egui::pos2(card.left() + 14.0, card.top() + 42.0),
            Align2::LEFT_CENTER,
            note,
            font(11.0, Weight::Regular),
            p.muted,
        );
        let kbd = Rect::from_min_size(
            egui::pos2(card.left() + 14.0, card.top() + 60.0),
            Vec2::new(88.0, 24.0),
        );
        ui.painter().rect_filled(kbd, 8, p.active);
        ui.painter().text(
            kbd.center(),
            Align2::CENTER_CENTER,
            "Ctrl + Space",
            font(10.0, Weight::Mono),
            p.text,
        );
        let footer_y = rect.bottom() - 36.0;
        ui.painter().text(
            egui::pos2(rect.left() + 23.0, footer_y),
            Align2::LEFT_CENTER,
            "Локально на вашому ПК",
            font(11.0, Weight::Regular),
            p.faint,
        );
        let theme_button =
            Rect::from_center_size(egui::pos2(rect.right() - 30.0, footer_y), Vec2::splat(30.0));
        let response = ui
            .interact(
                theme_button,
                egui::Id::unique("toggle-theme"),
                Sense::click(),
            )
            .on_hover_text("Перемкнути тему");
        ui.painter().rect_filled(
            theme_button,
            15,
            if response.hovered() {
                p.active
            } else {
                p.panel
            },
        );
        paint_icon(
            ui,
            Rect::from_center_size(theme_button.center(), Vec2::splat(14.0)),
            if p.dark { "sun" } else { "moon" },
            if response.hovered() { p.text } else { p.muted },
        );
        if response.clicked() {
            let next = if p.dark { Theme::Light } else { Theme::Dark };
            self.change(|s| s.theme = next, "");
        }
    }

    fn toast_layer(&mut self, ctx: &egui::Context) {
        let Some((message, error, since)) = self.toast.clone() else {
            return;
        };
        let lifetime = if error { 6.0 } else { 2.5 };
        let elapsed = since.elapsed().as_secs_f32();
        if elapsed > lifetime {
            self.toast = None;
            return;
        }
        ctx.request_repaint_after(std::time::Duration::from_millis(100));
        let p = self.palette;
        let fade = (elapsed / 0.15).min(1.0).min((lifetime - elapsed) / 0.15);
        let screen = ctx.content_rect();
        egui::Area::new(egui::Id::unique("toast"))
            .order(egui::Order::Tooltip)
            .interactable(false)
            .anchor(
                Align2::CENTER_BOTTOM,
                Vec2::new(0.0, -22.0 + 12.0 * (1.0 - fade)),
            )
            .show(ctx, |ui| {
                ui.set_max_width(screen.width() * 0.85);
                // The system's toast: a capsule with a status dot and bold copy.
                let ink = if error && !p.dark {
                    Color32::WHITE
                } else {
                    p.on_primary
                };
                egui::Frame::new()
                    .fill(if error { p.error } else { p.primary }.gamma_multiply(fade))
                    .corner_radius(22)
                    .shadow(egui::Shadow {
                        offset: [0, 16],
                        blur: 40,
                        spread: 0,
                        color: Color32::from_black_alpha((120.0 * fade) as u8),
                    })
                    .inner_margin(egui::Margin::symmetric(20, 13))
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 10.0;
                            if !error {
                                let (dot, _) =
                                    ui.allocate_exact_size(Vec2::splat(16.0), Sense::hover());
                                ui.painter().circle_filled(
                                    dot.center(),
                                    8.0,
                                    p.green.gamma_multiply(fade),
                                );
                                paint_icon(
                                    ui,
                                    dot.shrink(3.0),
                                    "check",
                                    p.on_accent.gamma_multiply(fade),
                                );
                            }
                            ui.add(
                                egui::Label::new(text(
                                    message,
                                    12.0,
                                    Weight::Medium,
                                    ink.gamma_multiply(fade),
                                ))
                                .wrap(),
                            );
                        });
                    });
            });
    }

    /// Files dragged in from Explorer become actions in the open menu or group.
    fn file_drop(&mut self, ctx: &egui::Context) {
        let (hovering, dropped) = ctx.input(|i| {
            (
                !i.raw.hovered_files.is_empty(),
                i.raw
                    .dropped_files
                    .iter()
                    .map(|f| f.path().to_path_buf())
                    .filter(|p| !p.as_os_str().is_empty())
                    .collect::<Vec<_>>(),
            )
        });
        self.file_hover = hovering && self.dialog.is_none();
        if dropped.is_empty() || self.dialog.is_some() {
            return;
        }
        let found = crate::launcher::inspect_dropped(&dropped);
        if found.is_empty() {
            self.toast("Перетягніть програму (.exe, .lnk), папку або скрипт.", true);
            return;
        }
        if self.page != Page::Menus {
            self.page = Page::Menus;
            self.group_path.clear();
        }
        let mut next = self.settings.clone();
        let level = next.level_mut(&self.group_path);
        let free = MAX_ITEMS.saturating_sub(level.len());
        if free == 0 {
            self.toast(
                "У цьому колесі вже 12 дій. Створіть групу або інше меню.",
                true,
            );
            return;
        }
        let added: Vec<_> = found.iter().take(free).cloned().collect();
        let skipped = found.len() - added.len();
        let last = added.last().map(|a| a.id.clone()).unwrap_or_default();
        level.extend(added.iter().cloned());
        let n = added.len();
        let message = if skipped > 0 {
            format!(
                "Додано {n} {}; ще {skipped} не вмістилося в колесо",
                model::actions_word(n)
            )
        } else {
            format!("Додано {n} {}", model::actions_word(n))
        };
        if self.save(next, &message) {
            self.selected = last;
        }
    }
}

pub fn status_label(settings: &Settings, runtime: &crate::shared::Runtime) -> &'static str {
    if !settings.enabled {
        "Призупинено"
    } else if runtime.hook_ready {
        "Orbit активний"
    } else if runtime.hook_error.as_deref().is_some_and(|e| !e.is_empty()) {
        "Миша недоступна"
    } else {
        "Запуск модуля миші…"
    }
}

fn sync_tray(settings: &Settings) {
    os::set_tray(os::TrayModel {
        menus: settings
            .menus
            .iter()
            .map(|m| (m.id.clone(), m.name.clone()))
            .collect(),
        active: settings.active_menu_id.clone(),
        enabled: settings.enabled,
    });
}

/// Input-thread events. Runs on that thread, so it only touches shared state.
fn handle_input(shared: &Arc<Shared>, event: InputEvent) {
    let enabled = shared.store.read(|s| s.enabled);
    match event {
        InputEvent::TriggerDown {
            x,
            y,
            foreground_pid,
        } => {
            if enabled {
                shared.open_wheel(Trigger::Mouse, Some((x, y)), foreground_pid)
            }
        }
        InputEvent::TriggerUp => {
            let mut w = shared.wheel();
            if w.visible {
                w.released = true;
                drop(w);
                shared.repaint_wheel();
            }
        }
        InputEvent::Click { x, y } => shared.outside_click(x, y),
        InputEvent::Hotkey { foreground_pid } => {
            if shared.wheel().visible {
                shared.close_wheel();
            } else {
                shared.open_wheel(Trigger::Keyboard, None, foreground_pid);
            }
        }
        InputEvent::Escape => shared.close_wheel(),
        InputEvent::Tray(command) => match command {
            TrayCommand::Open => shared.show_main(),
            TrayCommand::ShowWheel => shared.open_wheel(Trigger::Preview, None, 0),
            TrayCommand::Add => {
                shared.show_main();
                shared.send(AppEvent::Navigate {
                    group_path: vec![],
                    add: true,
                });
            }
            TrayCommand::SelectMenu(id) => {
                let _ = shared.store.update(|s| s.active_menu_id = id);
                shared.repaint_main();
            }
            TrayCommand::ToggleEnabled => {
                let _ = shared.store.update(|s| s.enabled = !s.enabled);
                shared.repaint_main();
            }
            TrayCommand::Quit => shared.send(AppEvent::Quit),
        },
        InputEvent::SecondInstance { quit } => {
            if quit {
                shared.send(AppEvent::Quit)
            } else {
                shared.show_main()
            }
        }
        InputEvent::HookFailed(error) => {
            if error.is_empty() {
                shared.set_runtime(|r| r.shortcut = false);
            } else {
                shared.set_runtime(|r| {
                    r.hook_ready = false;
                    r.hook_error = Some(error);
                });
            }
        }
    }
}

/// Popular programs added to a brand-new wheel when they are installed.
fn seed_first_run(shared: Arc<Shared>) {
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
    std::thread::spawn(move || {
        for _ in 0..60 {
            if !shared.catalog.is_loading() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        let revision = shared.store.revision();
        let found = shared.catalog.find_named(&APPS);
        if found.is_empty() || shared.store.revision() != revision {
            return;
        }
        let _ = shared.store.update(|s| {
            let items = &mut s.menus[0].items;
            // Leave one free slot so the wheel's "+" stays available.
            for entry in found.iter().take(11usize.saturating_sub(items.len())).rev() {
                let mut action =
                    model::Action::new(model::Kind::App, entry.name.clone(), entry.target.clone());
                action.args = entry.args.clone();
                action.icon = "app".into();
                items.insert(0, action);
            }
        });
        shared.repaint_main();
    });
}

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Saves made by the wheel or the tray reach the editor here.
        let revision = self.shared.store.revision();
        if revision != self.revision {
            let previous = std::mem::replace(&mut self.settings, self.shared.store.get());
            self.revision = revision;
            let next = self.settings.clone();
            self.apply_side_effects(&previous, &next);
            self.group_path = self.settings.trim_group_path(&self.group_path);
        }
        self.handle_events(ctx);
        // A click or Escape in the editor closes an open wheel, as clicks elsewhere on screen do.
        if self.shared.wheel().visible
            && ctx.input(|i| i.key_pressed(egui::Key::Escape) || i.pointer.any_pressed())
        {
            self.shared.close_wheel();
        }
        // Closing the window keeps Orbit in the tray.
        if ctx.input(|i| i.viewport().close_requested()) && !self.quitting {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            ctx.send_viewport_cmd(egui::ViewportCommand::Visible(false));
        }
        let dark = match self.settings.theme {
            Theme::Dark => true,
            Theme::Light => false,
            Theme::System => ctx.system_theme() != Some(egui::Theme::Light),
        };
        self.palette = if dark { theme::DARK } else { theme::LIGHT };
        if theme::pal(ctx) != self.palette
            || ctx.global_style().visuals.panel_fill != self.palette.bg
        {
            theme::set_palette(ctx, self.palette);
        }
        overlay::register(ctx, self.shared.clone());
        // Off Windows the wheel window is shown through viewport commands.
        if !cfg!(windows) {
            let pending = self.shared.wheel().pending_show.take();
            if let Some(show) = pending {
                let w = self.shared.wheel();
                let (bounds, scale) = (w.bounds, w.scale);
                drop(w);
                if show {
                    ctx.send_viewport_cmd_to(
                        overlay_id(),
                        egui::ViewportCommand::OuterPosition(egui::pos2(
                            bounds.x as f32 / scale,
                            bounds.y as f32 / scale,
                        )),
                    );
                    ctx.send_viewport_cmd_to(
                        overlay_id(),
                        egui::ViewportCommand::InnerSize(Vec2::new(
                            bounds.width as f32 / scale,
                            bounds.height as f32 / scale,
                        )),
                    );
                }
                ctx.send_viewport_cmd_to(overlay_id(), egui::ViewportCommand::Visible(show));
                if show {
                    ctx.send_viewport_cmd_to(overlay_id(), egui::ViewportCommand::Focus);
                }
            }
        }
        if self.updater.phase() == crate::updater::Phase::Installing && !self.quitting {
            self.quit(ctx);
        }
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        let p = self.palette;
        egui::Panel::top("titlebar")
            .exact_size(48.0)
            .show_separator_line(false)
            .frame(egui::Frame::new().fill(p.bg))
            .show(ui, |ui| self.titlebar(ui));
        egui::Panel::left("sidebar")
            .exact_size(202.0)
            .resizable(false)
            .show_separator_line(false)
            .frame(egui::Frame::new().fill(p.bg))
            .show(ui, |ui| self.sidebar(ui));
        egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(p.bg))
            .show(ui, |ui| self.workspace(ui));
        self.file_drop(&ctx);
        if self.file_hover {
            let screen = ctx.content_rect();
            let painter = ctx.layer_painter(egui::LayerId::new(
                egui::Order::Foreground,
                egui::Id::unique("file-drop"),
            ));
            let area = Rect::from_min_max(egui::pos2(212.0, 58.0), screen.max - Vec2::splat(10.0));
            painter.rect(
                area,
                theme::R_TILE,
                p.green.gamma_multiply(0.06),
                Stroke::new(2.0, p.green),
                egui::StrokeKind::Inside,
            );
            let label = Rect::from_center_size(
                egui::pos2(area.center().x, area.bottom() - 44.0),
                Vec2::new(240.0, 40.0),
            );
            painter.rect_filled(label, 20, p.green);
            painter.text(
                label.center(),
                Align2::CENTER_CENTER,
                "Відпустіть, щоб додати дію",
                font(13.0, Weight::Medium),
                p.on_accent,
            );
        }
        self.dialogs(&ctx);
        self.toast_layer(&ctx);
        if let Some(id) = self.focus_request.take() {
            ctx.memory_mut(|m| m.request_focus(id));
        }
        let _ = widgets::corner(0);
    }

    fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
        [0.0, 0.0, 0.0, 0.0]
    }

    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        os::stop_input();
    }
}
