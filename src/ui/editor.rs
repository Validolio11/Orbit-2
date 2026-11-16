//! The editor pages: menus with the preview wheel and action list, the library, controls and settings.

use super::dialogs::Dialog;
use super::item_icon::{IconSource, paint_item_icon};
use super::theme::{Palette, R_TILE, Weight, font, paint_icon, text};
use super::wheel::{self, DragView, Hit, Style, WheelView};
use super::widgets::{self, Button, icon_button, section, select, setting_row, toggle};
use crate::app::{App, Page, status_label};
use crate::model::{
    self, Action, Activation, DEFAULT_WHEEL_SIZE, GroupOpen, HOVER_DELAYS, Kind, MAX_ITEMS,
    MAX_MENUS, Theme,
};
use crate::updater::Phase;
use egui::{Align2, Color32, Pos2, Rect, Sense, Stroke, StrokeKind, Ui, Vec2};

/// A drag inside the preview wheel; it becomes active after six pixels so clicks still work.
pub struct WheelDrag {
    pub id: String,
    pub target: Option<String>,
    pub center: Option<Option<String>>,
    pub pointer: Pos2,
}

impl App {
    pub fn workspace(&mut self, ui: &mut Ui) {
        let p = self.palette;
        // A minimized or hidden window has no room; the page layouts below assume a real width.
        if ui.available_width() < 400.0 {
            return;
        }
        let mut scroll = egui::ScrollArea::vertical()
            .id_salt(("workspace", self.page as u8))
            .auto_shrink([false, false]);
        if std::mem::take(&mut self.scroll_top) {
            scroll = scroll.vertical_scroll_offset(0.0);
        }
        scroll.show(ui, |ui| {
            let width = ui.available_width().min(1320.0);
            let margin = ((ui.available_width() - width) / 2.0).max(0.0);
            ui.horizontal(|ui| {
                ui.add_space(margin + 34.0);
                ui.vertical(|ui| {
                    ui.set_width(width - 68.0);
                    ui.add_space(32.0);
                    ui.horizontal(|ui| {
                        ui.label(text("Робочий простір", 11.0, Weight::Regular, p.faint));
                        widgets::corner(0);
                        super::theme::icon(ui, "chevron", 10.0, p.faint);
                        ui.label(text(self.page.label(), 11.0, Weight::Regular, p.muted));
                    });
                    ui.add_space(22.0);
                    match self.page {
                        Page::Menus => self.menus_page(ui),
                        Page::Library => self.library_page(ui),
                        Page::Controls => self.controls_page(ui),
                        Page::Settings => self.settings_page(ui),
                    }
                    ui.add_space(28.0);
                });
            });
        });
    }

    fn page_header(
        &mut self,
        ui: &mut Ui,
        title: &str,
        note: &str,
        actions: impl FnOnce(&mut Self, &mut Ui),
    ) {
        let p = self.palette;
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                ui.label(text(title, 30.0, Weight::Semibold, p.text));
                ui.add_space(2.0);
                ui.label(text(note, 13.0, Weight::Regular, p.muted));
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                actions(self, ui)
            });
        });
        ui.add_space(26.0);
    }

    // ---------- Menus ----------

    fn menus_page(&mut self, ui: &mut Ui) {
        let p = self.palette;
        self.page_header(
            ui,
            "Мої меню",
            "Програми, папки та команди, які відкриває колесо.",
            |app, ui| {
                if Button::new("Викликати колесо")
                    .icon("play", 14.0)
                    .accent()
                    .show(ui)
                    .clicked()
                {
                    app.preview_wheel();
                }
                if Button::new("Створити меню")
                    .icon("plus", 15.0)
                    .show(ui)
                    .clicked()
                {
                    app.dialog = Some(Dialog::menu(None));
                }
            },
        );
        if self.settings.intro_pending {
            self.intro_card(ui);
        }
        self.menu_tabs(ui);
        let (items, name) = {
            let (i, n) = self.level();
            (i.clone(), n.to_string())
        };
        let nested = !self.group_path.is_empty();
        let total = ui.available_width();
        let left_width = ((total - 20.0) * 1.05 / 2.05).max(320.0);
        let right_width = total - 20.0 - left_width;
        ui.horizontal_top(|ui| {
            ui.spacing_mut().item_spacing.x = 20.0;
            let column = egui::Layout::top_down(egui::Align::Min);
            ui.allocate_ui_with_layout(Vec2::new(left_width, 0.0), column, |ui| {
                ui.set_width(left_width);
                self.preview_panel(ui, &items, &name, nested);
            });
            ui.allocate_ui_with_layout(Vec2::new(right_width, 0.0), column, |ui| {
                ui.set_width(right_width);
                self.action_panel(ui, &items, &name, nested);
            });
        });
        ui.add_space(12.0);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 16.0;
            let width = (ui.available_width() - 16.0) / 2.0;
            let trigger = format!("Бічна кнопка {}", self.settings.trigger_button);
            let mode = self.settings.activation_mode;
            let detail = if mode == Activation::Hover {
                format!("Затримка {} мс", self.settings.hover_delay)
            } else {
                "Спосіб запуску обраної дії".into()
            };
            for (icon, title, note) in [
                ("mouse", trigger.as_str(), "Виклик колеса · Ctrl + Space"),
                (
                    if mode == Activation::Hover {
                        "mouse"
                    } else {
                        "play"
                    },
                    mode.label(),
                    detail.as_str(),
                ),
            ] {
                let (rect, response) =
                    ui.allocate_exact_size(Vec2::new(width, 62.0), Sense::click());
                ui.painter().rect_filled(
                    rect,
                    20,
                    if response.hovered() { p.hover } else { p.panel },
                );
                let badge = rect.left_center() + Vec2::new(31.0, 0.0);
                ui.painter().circle_filled(badge, 19.0, p.bg);
                paint_icon(
                    ui,
                    Rect::from_center_size(badge, Vec2::splat(18.0)),
                    icon,
                    p.text,
                );
                ui.painter().text(
                    rect.left_center() + Vec2::new(62.0, -8.0),
                    Align2::LEFT_CENTER,
                    title,
                    font(12.0, Weight::Medium),
                    p.text,
                );
                ui.painter().text(
                    rect.left_center() + Vec2::new(62.0, 9.0),
                    Align2::LEFT_CENTER,
                    note,
                    font(11.0, Weight::Regular),
                    p.muted,
                );
                paint_icon(
                    ui,
                    Rect::from_center_size(
                        rect.right_center() - Vec2::new(20.0, 0.0),
                        Vec2::splat(14.0),
                    ),
                    "chevron",
                    p.muted,
                );
                if response
                    .on_hover_cursor(egui::CursorIcon::PointingHand)
                    .clicked()
                {
                    self.set_page(Page::Controls);
                }
            }
        });
        ui.add_space(14.0);
        ui.horizontal(|ui| {
            super::theme::icon(ui, "check", 12.0, p.faint);
            ui.label(text(
                "Зміни зберігаються автоматично",
                11.0,
                Weight::Regular,
                p.faint,
            ));
        });
    }

    fn intro_card(&mut self, ui: &mut Ui) {
        let p = self.palette;
        // The onboarding tile is the one volt surface in the app.
        let white = Color32::WHITE;
        egui::Frame::new().corner_radius(R_TILE).fill(p.volt).inner_margin(egui::Margin::symmetric(22, 18)).show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 16.0;
                super::theme::icon(ui, "mouse", 22.0, white);
                let width = ui.available_width() - 120.0;
                ui.vertical(|ui| {
                    ui.set_width(width);
                    ui.label(text(format!("Спробуйте зараз: затисніть бічну кнопку {} у будь-якій програмі", self.settings.trigger_button), 14.0, Weight::Semibold, white));
                    ui.add(egui::Label::new(text("Колесо з’явиться біля курсора. Також працює Ctrl + Space. Сектор «+» на колесі додає програму, в якій ви зараз працюєте.", 12.0, Weight::Regular, white.gamma_multiply(0.8))).wrap());
                });
                if Button::new("Зрозуміло").small().primary().show(ui).clicked() { self.change(|s| s.intro_pending = false, ""); }
            });
        });
        ui.add_space(18.0);
    }

    fn menu_tabs(&mut self, ui: &mut Ui) {
        let p = self.palette;
        let mut chosen = None;
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 8.0;
            for menu in &self.settings.menus {
                let active = menu.id == self.settings.active_menu_id;
                let label = menu.name.clone();
                let count = menu.items.len().to_string();
                let galley =
                    ui.painter()
                        .layout_no_wrap(label.clone(), font(12.0, Weight::Medium), p.text);
                let counter =
                    ui.painter()
                        .layout_no_wrap(count.clone(), font(10.0, Weight::Mono), p.text);
                let (slot, response) = ui.allocate_exact_size(
                    Vec2::new(galley.size().x + counter.size().x + 58.0, 36.0),
                    Sense::click(),
                );
                // Tab pills: the open menu is inverted, the others are graphite.
                let rect = slot;
                ui.painter().rect_filled(
                    rect,
                    18,
                    if active {
                        p.primary
                    } else if response.hovered() {
                        p.active
                    } else {
                        p.panel
                    },
                );
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
                        egui::pos2(rect.left() + 14.0, rect.center().y - 8.0),
                        Vec2::splat(16.0),
                    ),
                    "wheel",
                    color,
                );
                ui.painter().text(
                    egui::pos2(rect.left() + 35.0, rect.center().y),
                    Align2::LEFT_CENTER,
                    &label,
                    font(12.0, Weight::Medium),
                    color,
                );
                ui.painter().text(
                    egui::pos2(rect.right() - 14.0, rect.center().y),
                    Align2::RIGHT_CENTER,
                    count,
                    font(10.0, Weight::Mono),
                    color.gamma_multiply(0.6),
                );
                if response
                    .on_hover_cursor(egui::CursorIcon::PointingHand)
                    .clicked()
                    && !active
                {
                    chosen = Some(menu.id.clone());
                }
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.spacing_mut().item_spacing.x = 3.0;
                if self.settings.menus.len() > 1
                    && icon_button(ui, "trash", 14.0, "Видалити меню", true, true).clicked()
                {
                    self.dialog = Some(Dialog::Delete {
                        menu: true,
                        id: String::new(),
                    });
                }
                if icon_button(ui, "copy", 14.0, "Дублювати меню", false, true).clicked()
                {
                    self.duplicate_menu();
                }
                if icon_button(ui, "edit", 14.0, "Перейменувати меню", false, true).clicked()
                {
                    let name = self.settings.current_menu().name.clone();
                    self.dialog = Some(Dialog::menu(Some(name)));
                }
            });
        });
        ui.add_space(16.0);
        if let Some(id) = chosen {
            self.group_path.clear();
            self.selected.clear();
            self.change(|s| s.active_menu_id = id, "");
        }
    }

    fn duplicate_menu(&mut self) {
        if self.settings.menus.len() >= MAX_MENUS {
            self.toast("Можна створити до 20 меню.", true);
            return;
        }
        let mut copy = self.settings.current_menu().clone();
        copy.id = model::new_id();
        copy.name.push_str(" — копія");
        model::renew_ids(&mut copy.items);
        let id = copy.id.clone();
        self.group_path.clear();
        self.change(
            |s| {
                s.menus.push(copy);
                s.active_menu_id = id;
            },
            "Меню продубльовано",
        );
    }

    fn panel_head(ui: &mut Ui, p: &Palette, title: &str, right: impl FnOnce(&mut Ui)) {
        ui.horizontal(|ui| {
            ui.set_height(56.0);
            ui.add_space(22.0);
            ui.label(text(title, 15.0, Weight::Semibold, p.text));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.add_space(16.0);
                right(ui);
            });
        });
    }

    fn preview_panel(&mut self, ui: &mut Ui, items: &[Action], name: &str, nested: bool) {
        let p = self.palette;
        // A night tile with a hairline ring: the stage the graphite wheel sits on, as it does over the desktop.
        egui::Frame::new().stroke(Stroke::new(1.0, p.line)).corner_radius(R_TILE).fill(p.bg).show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.spacing_mut().item_spacing.y = 4.0;
            Self::panel_head(ui, &p, "Попередній перегляд", |ui| { super::theme::chip(ui, &format!("{} / 12", items.len()), p.panel, p.muted, false); });
            let width = ui.available_width();
            let (surface, _) = ui.allocate_exact_size(Vec2::new(width, width.max(320.0)), Sense::hover());
            // Dotted canvas.
            let painter = ui.painter_at(surface);
            let mut y = surface.top() + (surface.height() % 16.0) / 2.0;
            while y < surface.bottom() {
                let mut x = surface.left() + (surface.width() % 16.0) / 2.0;
                while x < surface.right() {
                    let d = (egui::pos2(x, y) - surface.center()).length() / (surface.width() * 0.6);
                    let alpha = (1.0 - ((d - 0.45) / 0.45).clamp(0.0, 1.0)).max(0.0);
                    if alpha > 0.02 { painter.circle_filled(egui::pos2(x, y), 0.6, p.line_strong.gamma_multiply(alpha)); }
                    x += 16.0;
                }
                y += 16.0;
            }
            let wheel_rect = Rect::from_center_size(surface.center(), Vec2::splat(surface.width().min(surface.height()) * 0.9));
            let response = ui.interact(wheel_rect, egui::Id::unique("preview-wheel"), Sense::click_and_drag());
            let hover = response.hover_pos();
            let selected = self.selected.clone();
            let drag_view = self.wheel_drag.as_ref().map(|d| DragView { source: Some(d.id.clone()), target: d.target.clone(), center: d.center.clone() });
            let view = WheelView { items, title: if nested { name } else { "Orbit" }, selected: Some(selected.as_str()), back: nested, add_slot: items.len() < MAX_ITEMS,
                add_item: None, add_selected: false, drag: drag_view.as_ref(), style: Style::Preview, appear: 1.0 };
            let g = wheel::paint(ui, wheel_rect, &view, &p, &self.shared.icons, if self.wheel_drag.is_some() { None } else { hover });
            if hover.is_some() && self.wheel_drag.is_none() {
                if let Some(h) = hover { if !matches!(g.hit(h, items.len(), 92.0, 207.0), Hit::Nothing | Hit::Center) || nested { ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand); } }
            }
            self.preview_interaction(ui, &response, &g, items, nested);
            if nested {
                let back = Rect::from_min_size(surface.min + Vec2::new(12.0, 12.0), Vec2::new(80.0, 29.0));
                let mut child = ui.new_child(egui::UiBuilder::new().max_rect(back));
                if Button::new("Назад").icon("back", 13.0).small().show(&mut child).clicked() { self.group_path.pop(); }
            }
            let label = if nested { name.to_uppercase() } else { "ORBIT / RADIAL MENU".into() };
            ui.painter().text(surface.right_bottom() - Vec2::new(16.0, 12.0), Align2::RIGHT_BOTTOM, label, font(8.0, Weight::Mono), p.faint);
            ui.horizontal(|ui| {
                ui.set_height(52.0);
                ui.add_space(22.0);
                super::theme::icon(ui, "info", 15.0, p.faint);
                ui.label(text("Перетягніть сектор, щоб змінити порядок. Центр переносить дію на рівень вище.", 11.0, Weight::Regular, p.muted));
            });
        });
    }

    fn preview_interaction(
        &mut self,
        ui: &mut Ui,
        response: &egui::Response,
        g: &wheel::Geometry,
        items: &[Action],
        nested: bool,
    ) {
        let pointer = ui.ctx().input(|i| i.pointer.interact_pos());
        if response.drag_started() {
            let origin = ui
                .ctx()
                .input(|i| i.pointer.press_origin())
                .unwrap_or_default();
            if let Hit::Item(i) = g.hit(origin, items.len(), 92.0, 207.0) {
                self.wheel_drag = Some(WheelDrag {
                    id: items[i].id.clone(),
                    target: None,
                    center: None,
                    pointer: origin,
                });
            }
        }
        if let (Some(drag), Some(pos)) = (self.wheel_drag.as_mut(), pointer) {
            if response.dragged() || response.drag_stopped() {
                drag.pointer = pos;
                drag.target = None;
                drag.center = None;
                match g.hit(pos, items.len(), 92.0, 207.0) {
                    Hit::Center => {
                        let error = if !nested {
                            Some("Уже в головному меню".to_string())
                        } else {
                            let mut parent = self.group_path.clone();
                            parent.pop();
                            (self.settings.level(&parent).0.len() >= MAX_ITEMS)
                                .then(|| "На попередньому рівні вже 12 дій".to_string())
                        };
                        drag.center = Some(error);
                    }
                    Hit::Item(i) if items[i].id != drag.id => {
                        drag.target = Some(items[i].id.clone())
                    }
                    _ => {}
                }
            }
        }
        if ui.ctx().input(|i| i.key_pressed(egui::Key::Escape)) {
            self.wheel_drag = None;
        }
        if let Some(drag) = &self.wheel_drag {
            // The dragged item follows the pointer as a compact label.
            if let Some(item) = items.iter().find(|i| i.id == drag.id) {
                let p = self.palette;
                let painter = ui.ctx().layer_painter(egui::LayerId::new(
                    egui::Order::Tooltip,
                    egui::Id::unique("wheel-ghost"),
                ));
                let galley =
                    painter.layout_no_wrap(item.name.clone(), font(11.0, Weight::Regular), p.text);
                let rect = Rect::from_min_size(
                    drag.pointer + Vec2::new(14.0, -38.0),
                    Vec2::new(galley.size().x + 48.0, 36.0),
                );
                painter.rect(
                    rect,
                    18,
                    p.active,
                    Stroke::new(1.0, p.line_strong),
                    StrokeKind::Inside,
                );
                let icon = Rect::from_min_size(
                    rect.left_center() + Vec2::new(10.0, -10.0),
                    Vec2::splat(20.0),
                );
                let layer_ui = ui.new_child(
                    egui::UiBuilder::new()
                        .layer_id(painter.layer_id())
                        .max_rect(rect),
                );
                paint_item_icon(
                    &layer_ui,
                    icon,
                    IconSource::from(item),
                    p.text,
                    &p,
                    &self.shared.icons,
                );
                painter.galley(
                    rect.left_center() + Vec2::new(38.0, -galley.size().y / 2.0),
                    galley,
                    p.text,
                );
                ui.ctx().set_cursor_icon(egui::CursorIcon::Grabbing);
            }
        }
        if response.drag_stopped() {
            if let Some(drag) = self.wheel_drag.take() {
                match (drag.center, drag.target) {
                    (Some(Some(error)), _) => self.toast(error, true),
                    (Some(None), _) => match model::move_to_parent(&self.settings, &drag.id) {
                        Ok(next) => {
                            self.save(next, "Переміщено на рівень вище");
                        }
                        Err(e) => self.toast(e, true),
                    },
                    (None, Some(target)) => match model::reorder(&self.settings, &drag.id, &target)
                    {
                        Ok(next) => {
                            self.save(next, "Порядок змінено");
                        }
                        Err(e) => self.toast(e, true),
                    },
                    _ => {}
                }
            }
        } else if response.clicked() {
            if let Some(pos) = pointer {
                match g.hit(pos, items.len(), 92.0, 207.0) {
                    Hit::Item(i) => {
                        let id = items[i].id.clone();
                        self.activate(&id);
                    }
                    Hit::Add => self.open_action_dialog(None),
                    Hit::Center if nested => {
                        self.group_path.pop();
                    }
                    _ if items.is_empty() => self.open_action_dialog(None),
                    _ => {}
                }
            }
        }
    }

    fn action_panel(&mut self, ui: &mut Ui, items: &[Action], name: &str, nested: bool) {
        let p = self.palette;
        egui::Frame::new()
            .corner_radius(R_TILE)
            .fill(p.panel)
            .show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.spacing_mut().item_spacing.y = 4.0;
                let mut add = false;
                Self::panel_head(
                    ui,
                    &p,
                    if nested { name } else { "Дії в меню" },
                    |ui| {
                        add = Button::new("Додати")
                            .icon("plus", 13.0)
                            .ghost()
                            .small()
                            .enabled(items.len() < MAX_ITEMS)
                            .show(ui)
                            .clicked();
                    },
                );
                if add {
                    self.open_action_dialog(None);
                }
                ui.spacing_mut().item_spacing.y = 0.0;
                if items.is_empty() {
                    ui.vertical_centered(|ui| {
                        ui.add_space(50.0);
                        super::theme::icon(ui, "plus", 26.0, p.muted);
                        ui.add_space(10.0);
                        ui.label(text("Поки що порожньо", 13.0, Weight::Semibold, p.text));
                        ui.add_space(6.0);
                        ui.label(text(
                            "Додайте програму, папку або команду до цього колеса.",
                            12.0,
                            Weight::Regular,
                            p.muted,
                        ));
                        ui.add_space(12.0);
                        if Button::new("Додати дію").show(ui).clicked() {
                            self.open_action_dialog(None);
                        }
                        ui.add_space(50.0);
                    });
                } else {
                    self.action_list(ui, items, nested);
                }
                ui.horizontal(|ui| {
                    ui.set_height(44.0);
                    ui.add_space(22.0);
                    ui.label(text(
                        if nested {
                            "Вкладене меню"
                        } else {
                            "Перетягніть дію на групу, щоб перемістити"
                        },
                        10.0,
                        Weight::Regular,
                        p.faint,
                    ));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.add_space(22.0);
                        ui.label(text(
                            format!("{} / 12", items.len()),
                            10.0,
                            Weight::Mono,
                            p.faint,
                        ));
                    });
                });
            });
    }

    /// Rows can be dragged onto a group row to move them into that group.
    fn action_list(&mut self, ui: &mut Ui, items: &[Action], nested: bool) {
        let pointer = ui.ctx().input(|i| i.pointer.hover_pos());
        let mut group_rects = Vec::new();
        let mut dropped = false;
        let target = self.list_drag.as_ref().and_then(|source| {
            let id = ui
                .ctx()
                .data(|d| d.get_temp::<String>(egui::Id::unique("list-drop-target")))?;
            Some((id.clone(), model::move_error(&self.settings, source, &id)))
        });
        for (index, item) in items.iter().enumerate() {
            let drop = target
                .as_ref()
                .filter(|(id, _)| *id == item.id)
                .map(|(_, e)| *e);
            let row = self.action_row(ui, item, index, false, None, nested, drop);
            if item.is_group() {
                group_rects.push((item.id.clone(), row.rect));
            }
            if row.drag_started() && !row.dragged_by(egui::PointerButton::Secondary) {
                self.list_drag = Some(item.id.clone());
            }
            if row.drag_stopped() {
                dropped = true;
            }
        }
        let over = pointer.and_then(|pos| {
            group_rects
                .iter()
                .find(|(_, r)| r.contains(pos))
                .map(|(id, _)| id.clone())
        });
        ui.ctx().data_mut(|d| match &over {
            Some(id) if self.list_drag.is_some() => {
                d.insert_temp(egui::Id::unique("list-drop-target"), id.clone());
            }
            _ => {
                d.remove::<String>(egui::Id::unique("list-drop-target"));
            }
        });
        if self.list_drag.is_some() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::Grabbing);
        }
        if ui.ctx().input(|i| i.key_pressed(egui::Key::Escape)) {
            self.list_drag = None;
        }
        if dropped {
            if let (Some(source), Some(group)) = (self.list_drag.take(), over) {
                match model::move_to_group(&self.settings, &source, &group) {
                    Ok(next) => {
                        let name = self
                            .settings
                            .action(&group)
                            .map(|g| g.name.clone())
                            .unwrap_or_default();
                        let previous = std::mem::replace(&mut self.selected, group.clone());
                        if !self.save(next, &format!("Переміщено до «{name}»")) {
                            self.selected = previous;
                        }
                    }
                    Err(e) => self.toast(e, true),
                }
            }
            self.list_drag = None;
        }
    }

    /// One action row. `context` is the menu path shown in the library.
    pub fn action_row(
        &mut self,
        ui: &mut Ui,
        item: &Action,
        index: usize,
        library: bool,
        context: Option<&str>,
        nested: bool,
        drop: Option<Option<&str>>,
    ) -> egui::Response {
        let p = self.palette;
        let width = ui.available_width();
        let (rect, response) = ui.allocate_exact_size(
            Vec2::new(width, 63.0),
            if library {
                Sense::click()
            } else {
                Sense::click_and_drag()
            },
        );
        let selected = self.selected == item.id;
        let dragging = self.list_drag.as_deref() == Some(item.id.as_str());
        let painter = ui.painter();
        // Rows are inset rounded items on the graphite tile: steel when selected, lighter on hover.
        let pill = rect.shrink2(Vec2::new(8.0, 2.0));
        let fill = match drop {
            Some(None) => Some(p.active),
            _ if selected => Some(p.active),
            _ if response.hovered() => Some(p.hover),
            _ => None,
        };
        if let Some(fill) = fill {
            painter.rect_filled(pill, 16, fill);
        }
        if let Some(error) = drop {
            painter.rect_stroke(
                pill,
                16,
                if error.is_none() {
                    Stroke::new(2.0, p.accent_ink())
                } else {
                    Stroke::new(1.0, p.line_strong)
                },
                StrokeKind::Inside,
            );
        }
        let alpha = if dragging { 0.4 } else { 1.0 };
        let mut x = rect.left() + 22.0;
        if !library {
            painter.text(
                egui::pos2(x, rect.center().y),
                Align2::LEFT_CENTER,
                format!("{:02}", index + 1),
                font(9.0, Weight::Mono),
                p.faint.gamma_multiply(alpha),
            );
            x += 23.0;
        }
        let icon_box =
            Rect::from_min_size(egui::pos2(x, rect.center().y - 17.0), Vec2::splat(34.0));
        painter.rect_filled(icon_box, 11, p.bg);
        paint_item_icon(
            ui,
            Rect::from_center_size(icon_box.center(), Vec2::splat(19.0)),
            IconSource::from(item),
            p.muted.gamma_multiply(alpha),
            &p,
            &self.shared.icons,
        );
        x += 44.0;
        let tools_width = if library {
            90.0
        } else {
            100.0 + if nested { 25.0 } else { 0.0 }
        } + if library { 80.0 } else { 0.0 };
        let text_width = (rect.right() - tools_width - x).max(60.0);
        let description = item.description();
        let sub = match drop {
            Some(Some(error)) => error.to_string(),
            Some(None) => "Відпустіть, щоб перемістити сюди".into(),
            None => context
                .map(String::from)
                .unwrap_or_else(|| description.clone()),
        };
        let name = ui.fonts_mut(|f| {
            f.layout(
                item.name.clone(),
                font(12.0, Weight::Medium),
                p.text,
                f32::INFINITY,
            )
        });
        let name = clip(
            ui,
            &item.name,
            12.0,
            Weight::Medium,
            p.text.gamma_multiply(alpha),
            text_width,
        )
        .unwrap_or(name);
        let sub_galley = clip(
            ui,
            &sub,
            10.0,
            Weight::Regular,
            p.muted.gamma_multiply(alpha),
            text_width.min(230.0),
        )
        .unwrap();
        painter.galley(egui::pos2(x, rect.center().y - 15.0), name, p.text);
        painter.galley(egui::pos2(x, rect.center().y + 2.0), sub_galley, p.muted);
        // Tools, right to left.
        let mut tool_x = rect.right() - 18.0;
        let mut tool =
            |ui: &mut Ui, icon: &str, size: f32, tip: &str, danger: bool, enabled: bool| -> bool {
                tool_x -= 26.0;
                let r = Rect::from_min_size(
                    egui::pos2(tool_x, rect.center().y - 13.5),
                    Vec2::new(25.0, 27.0),
                );
                let mut child = ui.new_child(egui::UiBuilder::new().max_rect(r));
                widgets::icon_button_sized(
                    &mut child,
                    icon,
                    size,
                    Vec2::new(25.0, 27.0),
                    tip,
                    danger,
                    enabled,
                )
                .clicked()
            };
        let mut action: Option<&str> = None;
        if item.is_group() {
            if tool(ui, "trash", 13.0, "Видалити групу", true, true) {
                action = Some("delete");
            }
            if tool(ui, "edit", 13.0, "Редагувати групу", false, true) {
                action = Some("edit");
            }
            if tool(
                ui,
                "chevron",
                15.0,
                &format!("Відкрити групу {}", item.name),
                false,
                true,
            ) {
                action = Some("open");
            }
        } else {
            if tool(ui, "trash", 13.0, "Видалити дію", true, true) {
                action = Some("delete");
            }
            if tool(
                ui,
                "edit",
                13.0,
                &format!("Редагувати {}", item.name),
                false,
                true,
            ) {
                action = Some("edit");
            }
        }
        if !library {
            if tool(
                ui,
                "arrowUp",
                12.0,
                &format!("Перемістити {} вище", item.name),
                false,
                index > 0,
            ) {
                action = Some("up");
            }
            if nested
                && tool(
                    ui,
                    "moveRoot",
                    13.0,
                    "Перемістити в головне меню",
                    false,
                    true,
                )
            {
                action = Some("root");
            }
        } else {
            let badge = item.kind.label();
            let galley =
                ui.painter()
                    .layout_no_wrap(badge.to_string(), font(10.0, Weight::Medium), p.text);
            let r = Rect::from_min_size(
                egui::pos2(tool_x - galley.size().x - 28.0, rect.center().y - 11.0),
                Vec2::new(galley.size().x + 18.0, 22.0),
            );
            ui.painter().rect_filled(r, 11, p.bg);
            ui.painter()
                .galley(r.center() - galley.size() / 2.0, galley, p.text);
        }
        let id = item.id.clone();
        match action {
            Some("delete") => self.dialog = Some(Dialog::Delete { menu: false, id }),
            Some("edit") => {
                self.selected = id.clone();
                self.open_action_dialog(Some(id));
            }
            Some("open") => self.open_group(&id),
            Some("up") => {
                if let Some(next) = model::move_up(&self.settings, &id) {
                    self.save(next, "");
                }
            }
            Some("root") => match model::move_to_root(&self.settings, &id) {
                Ok(next) => {
                    let name = item.name.clone();
                    self.save(next, &format!("«{name}» переміщено в головне меню"));
                }
                Err(e) => self.toast(e, true),
            },
            _ if response.clicked() && self.list_drag.is_none() => self.activate(&id),
            _ => {}
        }
        if !library && response.hovered() && self.list_drag.is_none() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        response
    }

    // ---------- Library ----------

    fn library_page(&mut self, ui: &mut Ui) {
        let p = self.palette;
        self.page_header(
            ui,
            "Усі дії",
            "Знайдіть і налаштуйте дію в будь-якому меню.",
            |app, ui| {
                if Button::new("Додати дію")
                    .icon("plus", 15.0)
                    .primary()
                    .show(ui)
                    .clicked()
                {
                    app.set_page(Page::Menus);
                    app.open_action_dialog(None);
                }
            },
        );
        let query = self.search.to_lowercase();
        let entries: Vec<(Action, String)> = self
            .settings
            .flatten()
            .into_iter()
            .filter(|(item, menu, path)| {
                format!(
                    "{} {} {} {}",
                    item.name,
                    item.kind.label(),
                    menu.name,
                    path.join(" ")
                )
                .to_lowercase()
                .contains(&query)
            })
            .map(|(item, menu, path)| {
                let mut context = vec![menu.name.as_str()];
                context.extend(path.iter().copied());
                (item.clone(), context.join(" / "))
            })
            .collect();
        ui.horizontal(|ui| {
            let mut search = self.search.clone();
            ui.spacing_mut().item_spacing.x = 14.0;
            ui.allocate_ui(Vec2::new(380.0, 42.0), |ui| {
                widgets::search_pill(ui, "action-search", &mut search, "Знайти дію…", 380.0);
            });
            self.search = search;
            ui.label(text(
                format!("{} дій", entries.len()),
                10.0,
                Weight::Mono,
                p.faint,
            ));
        });
        ui.add_space(16.0);
        egui::Frame::new()
            .corner_radius(R_TILE)
            .fill(p.panel)
            .inner_margin(egui::Margin::symmetric(0, 8))
            .show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.spacing_mut().item_spacing.y = 0.0;
                if entries.is_empty() {
                    ui.vertical_centered(|ui| {
                        ui.add_space(50.0);
                        ui.label(text("Дій не знайдено", 13.0, Weight::Semibold, p.text));
                        ui.add_space(6.0);
                        ui.label(text(
                            "Спробуйте іншу назву.",
                            12.0,
                            Weight::Regular,
                            p.muted,
                        ));
                        ui.add_space(50.0);
                    });
                }
                for (i, (item, context)) in entries.iter().enumerate() {
                    self.action_row(ui, item, i, true, Some(context), false, None);
                }
            });
    }

    // ---------- Controls ----------

    fn controls_page(&mut self, ui: &mut Ui) {
        let p = self.palette;
        self.page_header(
            ui,
            "Керування",
            "Налаштуйте мишу та спосіб вибору дій.",
            |_, _| {},
        );
        let runtime = self.shared.runtime();
        let s = self.settings.clone();
        ui.allocate_ui(Vec2::new(ui.available_width(), 0.0), |ui| {
            ui.spacing_mut().item_spacing.y = 20.0;
            section(ui, &p, None, |ui| {
                ui.add_space(22.0);
                ui.horizontal(|ui| {
                    ui.add_space(26.0);
                    let (diagram, _) = ui.allocate_exact_size(Vec2::new(70.0, 105.0), Sense::hover());
                    ui.painter().rect(diagram, 32, p.bg, Stroke::new(1.0, p.line_strong), StrokeKind::Inside);
                    ui.painter().hline(diagram.x_range(), diagram.top() + 38.0, Stroke::new(1.0, p.line_strong));
                    ui.painter().vline(diagram.center().x, diagram.top()..=diagram.top() + 38.0, Stroke::new(1.0, p.line_strong));
                    // Mouse 5 (forward) is the upper side button, Mouse 4 (back) the lower one.
                    for (button, y) in [(5u8, 44.0), (4u8, 64.0)] {
                        let r = Rect::from_min_size(egui::pos2(diagram.left() - 4.0, diagram.top() + y), Vec2::new(6.0, 16.0));
                        ui.painter().rect_filled(r, 3, if s.trigger_button == button { p.accent_ink() } else { p.line_strong });
                    }
                    ui.add_space(20.0);
                    ui.vertical(|ui| {
                        ui.add_space(12.0);
                        ui.label(text("Виклик колеса мишею", 16.0, Weight::Semibold, p.text));
                        ui.label(text("Стандартні бічні кнопки Mouse 4 та Mouse 5.", 12.0, Weight::Regular, p.muted));
                        ui.add_space(6.0);
                        // The status chip: pulse while the hook is live, steel otherwise.
                        let on = s.enabled && runtime.hook_ready;
                        let (fill, ink) = if on { (p.green, p.on_accent) } else { (p.active, p.text) };
                        super::theme::chip(ui, status_label(&s, &runtime), fill, ink, true);
                    });
                });
                ui.add_space(20.0);
                setting_row(ui, "Orbit у фоновому режимі", "Коли ввімкнено, обрана бічна кнопка викликає колесо замість переходу назад або вперед.", |ui| {
                    if toggle(ui, s.enabled, true, "Orbit у фоновому режимі").clicked() { self.change(|x| x.enabled = !x.enabled, ""); }
                });
                setting_row(ui, "Запускати разом з Windows", "Orbit стартує у фоні після входу в систему, тож бічна кнопка працює одразу.", |ui| {
                    if toggle(ui, s.launch_at_login, true, "Запускати разом з Windows").clicked() { self.change(|x| x.launch_at_login = !x.launch_at_login, ""); }
                });
                let admin = runtime.admin;
                let note = if !admin.available { "Доступно у встановленому Orbit для облікового запису адміністратора.".to_string() }
                    else if admin.enabled { if admin.elevated { "Orbit працює з правами адміністратора: бічна кнопка діє й у програмах, запущених від імені адміністратора." } else { "Перезапустіть Orbit, щоб застосувати права адміністратора." }.to_string() + " Програми з колеса теж відкриватимуться з цими правами." }
                    else { "Без цього бічна кнопка не працює у програмах, запущених від імені адміністратора. Windows попросить підтвердження один раз.".into() };
                setting_row(ui, "Запускати з правами адміністратора", &note, |ui| {
                    if toggle(ui, admin.enabled, admin.available && !self.admin_busy, "Запускати з правами адміністратора").clicked() { self.set_admin_start(!admin.enabled); }
                });
                setting_row(ui, "Кнопка виклику", "Затисніть кнопку, щоб відкрити колесо біля курсора.", |ui| {
                    if let Some(i) = select(ui, "trigger", &["Mouse 4 · назад".into(), "Mouse 5 · вперед".into()], (s.trigger_button == 5) as usize, 200.0) { self.change(|x| x.trigger_button = if i == 1 { 5 } else { 4 }, ""); }
                });
                let note = if runtime.shortcut { "Доступний у будь-якій програмі." } else if cfg!(windows) { "Скорочення недоступне: можливо, його зайняла інша програма." } else { "Додатковий спосіб відкрити колесо." };
                setting_row(ui, "Клавіатурний виклик", note, |ui| widgets::kbd(ui, "Ctrl + Space"));
            });
            section(ui, &p, Some(("Вибір дії", "Як колесо запускає дії та відкриває вкладки.")), |ui| {
                let note = match s.activation_mode { Activation::Release => "Наведіть на сектор і відпустіть бічну кнопку.", Activation::Hover => "Затримайте курсор над сектором для запуску.", Activation::Click => "Натисніть лівою кнопкою на потрібний сектор." };
                setting_row(ui, "Запускати дію", note, |ui| {
                    let options: Vec<String> = Activation::ALL.iter().map(|a| a.label().to_string()).collect();
                    let current = Activation::ALL.iter().position(|a| *a == s.activation_mode).unwrap_or(0);
                    if let Some(i) = select(ui, "activation", &options, current, 200.0) { self.change(|x| x.activation_mode = Activation::ALL[i], ""); }
                });
                setting_row(ui, "Сектор «+» на колесі", "Додає програму, в якій ви працюєте, просто з колеса. Спрацьовує лише клацанням, не наведенням.", |ui| {
                    if toggle(ui, s.wheel_add_slot, true, "Сектор «+» на колесі").clicked() { self.change(|x| x.wheel_add_slot = !x.wheel_add_slot, ""); }
                });
                let note = if s.group_open_mode == GroupOpen::Click { "Натисніть лівою кнопкою на вкладку, щоб відкрити її." } else { "Наведіть курсор на вкладку, щоб відкрити її." };
                setting_row(ui, "Відкривати вкладки", note, |ui| {
                    let options: Vec<String> = GroupOpen::ALL.iter().map(|a| a.label().to_string()).collect();
                    if let Some(i) = select(ui, "group-open", &options, (s.group_open_mode == GroupOpen::Click) as usize, 200.0) { self.change(|x| x.group_open_mode = GroupOpen::ALL[i], ""); }
                });
                if s.activation_mode == Activation::Hover {
                    setting_row(ui, "Затримка наведення", "Збільште, якщо дії запускаються випадково.", |ui| {
                        let options: Vec<String> = HOVER_DELAYS.iter().map(|d| format!("{d} мс")).collect();
                        let current = HOVER_DELAYS.iter().position(|d| *d == s.hover_delay).unwrap_or(2);
                        if let Some(i) = select(ui, "hover-delay", &options, current, 200.0) { self.change(|x| x.hover_delay = HOVER_DELAYS[i], ""); }
                    });
                }
            });
            info_box(ui, &p, &format!("{} Центр колеса повертає на рівень вище. Esc закриває колесо. Спеціальні кнопки мишей можуть потребувати налаштування у програмі виробника.",
                if s.group_open_mode == GroupOpen::Click { "Вкладені групи відкриваються клацанням." } else { "Вкладені групи відкриваються наведенням." }));
            if let Some(error) = runtime.hook_error.filter(|e| !e.is_empty()) { info_box(ui, &p, &error); }
            if Button::new("Перевірити колесо").icon("play", 14.0).show(ui).clicked() { self.preview_wheel(); }
        });
    }

    fn set_admin_start(&mut self, enabled: bool) {
        self.admin_busy = true;
        let shared = self.shared.clone();
        std::thread::spawn(move || {
            let result = crate::platform::os::admin_set(enabled);
            let status = crate::platform::os::admin_status();
            shared.set_runtime(|r| r.admin = status);
            match result {
                Ok(false) => {}
                Ok(true) if status.enabled == enabled => {
                    if enabled != status.elevated {
                        shared.send(crate::shared::AppEvent::Toast(
                            "Перезапустіть Orbit, щоб застосувати права адміністратора.".into(),
                            false,
                        ));
                    }
                }
                Ok(true) => shared.send(crate::shared::AppEvent::Toast(
                    format!(
                        "Windows не {} завдання запуску Orbit.",
                        if enabled {
                            "створив"
                        } else {
                            "видалив"
                        }
                    ),
                    true,
                )),
                Err(e) => shared.send(crate::shared::AppEvent::Toast(e, true)),
            }
        });
        self.admin_busy = false;
    }

    // ---------- Settings ----------

    fn settings_page(&mut self, ui: &mut Ui) {
        let p = self.palette;
        self.page_header(
            ui,
            "Налаштування",
            "Вигляд, поведінка колеса, дані та оновлення.",
            |_, _| {},
        );
        let s = self.settings.clone();
        ui.allocate_ui(Vec2::new(ui.available_width(), 0.0), |ui| {
            ui.spacing_mut().item_spacing.y = 20.0;
            section(ui, &p, Some(("Зовнішній вигляд", "Тема, розмір колеса й анімації.")), |ui| {
                setting_row(ui, "Тема", "Застосовується до редактора й колеса.", |ui| {
                    let current = match s.theme { Theme::Light => 0, Theme::Dark => 1, Theme::System => 2 };
                    if let Some(i) = widgets::segmented(ui, &[("sun", "Світла"), ("moon", "Темна"), ("system", "Системна")], current) {
                        self.change(|x| x.theme = [Theme::Light, Theme::Dark, Theme::System][i], "");
                    }
                });
                setting_row(ui, "Розмір кола", "Масштаб меню під час виклику.", |ui| self.wheel_size(ui));
                setting_row(ui, "Зменшити анімації", "Миттєві переходи без зміни масштабу.", |ui| {
                    if toggle(ui, s.reduced_motion, true, "Зменшити анімації").clicked() { self.change(|x| x.reduced_motion = !x.reduced_motion, ""); }
                });
            });
            section(ui, &p, Some(("Поведінка колеса", "Налаштуйте закриття кругового меню.")), |ui| {
                setting_row(ui, "Закривати меню натисканням поза ним", "Натискання поза колом скасовує вибір так само, як Esc.", |ui| {
                    if toggle(ui, s.close_on_outside_click, true, "Закривати меню натисканням поза ним").clicked() { self.change(|x| x.close_on_outside_click = !x.close_on_outside_click, ""); }
                });
            });
            self.updates_section(ui);
            section(ui, &p, Some(("Налаштування меню", "Збережіть резервну копію або перенесіть меню на інший комп’ютер.")), |ui| {
                setting_row(ui, "Експорт", "Меню, шляхи та налаштування у JSON-файлі.", |ui| { if Button::new("Експортувати").icon("export", 15.0).show(ui).clicked() { self.export(); } });
                setting_row(ui, "Імпорт", "Замінює поточні меню. Перед імпортом можна зробити резервну копію.", |ui| { if Button::new("Імпортувати").icon("import", 15.0).show(ui).clicked() { self.dialog = Some(Dialog::Import); } });
            });
            section(ui, &p, None, |ui| {
                setting_row(ui, &format!("Orbit {}", crate::updater::CURRENT), "Windows · локальне зберігання · без облікового запису", |ui| { super::theme::icon(ui, "orbit", 32.0, p.text); });
            });
            info_box(ui, &p, "Кнопка закриття згортає Orbit у системний трей. Щоб завершити роботу, оберіть «Вийти з Orbit» у меню іконки біля годинника.");
        });
    }

    fn wheel_size(&mut self, ui: &mut Ui) {
        let p = self.palette;
        let saved = (self.settings.wheel_size as f32 / DEFAULT_WHEEL_SIZE as f32 * 100.0).round();
        ui.vertical(|ui| {
            ui.horizontal(|ui| {
                let mut value = self.size_percent.unwrap_or(saved);
                let (rect, response) =
                    ui.allocate_exact_size(Vec2::new(190.0, 20.0), Sense::click_and_drag());
                let t = ((value - 60.0) / 90.0).clamp(0.0, 1.0);
                // The system's range: a pulse fill on a steel track, a paper dot ringed in night and paper.
                let track =
                    Rect::from_center_size(rect.center(), Vec2::new(rect.width() - 20.0, 8.0));
                ui.painter().rect_filled(track, 4, p.active);
                ui.painter().rect_filled(
                    Rect::from_min_max(
                        track.min,
                        egui::pos2(track.left() + track.width() * t, track.bottom()),
                    ),
                    4,
                    p.green,
                );
                let knob = egui::pos2(track.left() + track.width() * t, rect.center().y);
                let grow = if response.dragged() { 1.0 } else { 0.0 };
                ui.painter().circle(
                    knob,
                    8.5 + grow,
                    p.on_accent,
                    Stroke::new(1.5, if p.dark { p.text } else { p.on_accent }),
                );
                ui.painter().circle_filled(
                    knob,
                    4.5 + grow,
                    if p.dark { p.text } else { Color32::WHITE },
                );
                if response.has_focus() {
                    ui.painter()
                        .circle_stroke(knob, 13.0, Stroke::new(2.0, p.focus));
                }
                if let Some(pos) = response.interact_pointer_pos() {
                    value = (60.0
                        + ((pos.x - track.left()) / track.width()).clamp(0.0, 1.0) * 90.0)
                        .round();
                    value = (value / 5.0).round() * 5.0;
                    self.size_percent = Some(value);
                }
                if response.has_focus() {
                    ui.ctx().input(|i| {
                        if i.key_pressed(egui::Key::ArrowLeft)
                            || i.key_pressed(egui::Key::ArrowDown)
                        {
                            value -= 5.0;
                        }
                        if i.key_pressed(egui::Key::ArrowRight) || i.key_pressed(egui::Key::ArrowUp)
                        {
                            value += 5.0;
                        }
                        if i.key_pressed(egui::Key::Home) {
                            value = 60.0;
                        }
                        if i.key_pressed(egui::Key::End) {
                            value = 150.0;
                        }
                    });
                    value = value.clamp(60.0, 150.0);
                    if value != saved {
                        self.size_percent = Some(value);
                    }
                }
                ui.label(text(format!("{value}%"), 11.0, Weight::Mono, p.muted));
                // The size is saved once the drag ends (or right away for keys).
                if let Some(v) = self.size_percent {
                    if !response.dragged() && !ui.ctx().input(|i| i.pointer.any_down()) {
                        self.size_percent = None;
                        let size = (v * DEFAULT_WHEEL_SIZE as f32 / 100.0).round() as u32;
                        if size != self.settings.wheel_size {
                            self.change(|x| x.wheel_size = size, "");
                        }
                    }
                }
            });
            ui.with_layout(egui::Layout::left_to_right(egui::Align::Center), |ui| {
                if Button::new("Перевірити")
                    .icon("play", 12.0)
                    .small()
                    .show(ui)
                    .clicked()
                {
                    self.preview_wheel();
                }
                if Button::new("Скинути до 100%")
                    .ghost()
                    .small()
                    .enabled(self.settings.wheel_size != DEFAULT_WHEEL_SIZE)
                    .show(ui)
                    .clicked()
                {
                    self.change(|x| x.wheel_size = DEFAULT_WHEEL_SIZE, "");
                }
            });
        });
    }

    fn updates_section(&mut self, ui: &mut Ui) {
        let p = self.palette;
        let phase = self.updater.phase();
        let version = self.updater.version().unwrap_or_default();
        let message = match &phase {
            Phase::Idle => "Перевірте, чи доступна нова версія.".to_string(),
            Phase::Checking => "Перевіряємо нові версії…".into(),
            Phase::Available => format!("Доступна версія {version}."),
            Phase::UpToDate => "Встановлено останню версію.".into(),
            Phase::Downloading(pct) => format!("Завантаження {}%…", pct.round()),
            Phase::Ready => "Оновлення готове. Під час встановлення Orbit перезапуститься.".into(),
            Phase::Installing => "Установлюємо оновлення…".into(),
            Phase::Error(e) => e.clone(),
        };
        section(
            ui,
            &p,
            Some(("Оновлення", "Нові версії Orbit з GitHub.")),
            |ui| {
                let top = ui.cursor().top();
                ui.painter().hline(
                    ui.max_rect().x_range().shrink(22.0),
                    top,
                    Stroke::new(1.0, p.line),
                );
                ui.add_space(16.0);
                ui.horizontal(|ui| {
                    ui.add_space(22.0);
                    ui.vertical(|ui| {
                        ui.set_width(ui.available_width() - 330.0);
                        ui.label(text(
                            format!("Встановлено {}", crate::updater::CURRENT),
                            13.0,
                            Weight::Medium,
                            p.text,
                        ));
                        ui.add(
                            egui::Label::new(text(
                                &message,
                                12.0,
                                Weight::Regular,
                                if matches!(phase, Phase::Error(_)) {
                                    p.error
                                } else {
                                    p.muted
                                },
                            ))
                            .wrap(),
                        );
                        if let Phase::Downloading(pct) = phase {
                            let (r, _) = ui.allocate_exact_size(
                                Vec2::new(ui.available_width().min(260.0), 8.0),
                                Sense::hover(),
                            );
                            ui.painter().rect_filled(r, 4, p.active);
                            ui.painter().rect_filled(
                                Rect::from_min_size(
                                    r.min,
                                    Vec2::new((r.width() * pct / 100.0).max(8.0), 8.0),
                                ),
                                4,
                                p.green,
                            );
                            ui.ctx()
                                .request_repaint_after(std::time::Duration::from_millis(200));
                        }
                    });
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.add_space(20.0);
                        let busy = matches!(
                            phase,
                            Phase::Checking | Phase::Downloading(_) | Phase::Installing
                        );
                        let install = matches!(phase, Phase::Ready | Phase::Installing);
                        if matches!(
                            phase,
                            Phase::Available
                                | Phase::Downloading(_)
                                | Phase::Ready
                                | Phase::Installing
                        ) {
                            let label = if install {
                                "Установити й перезапустити"
                            } else if busy {
                                "Завантажуємо…"
                            } else {
                                "Завантажити"
                            };
                            if Button::new(label)
                                .primary()
                                .enabled(!busy)
                                .show(ui)
                                .clicked()
                            {
                                if install {
                                    if let Err(e) = self.updater.install() {
                                        self.toast(e, true);
                                    }
                                } else {
                                    self.updater.download();
                                }
                            }
                        }
                        if !install
                            && Button::new(if phase == Phase::Checking {
                                "Перевіряємо…"
                            } else {
                                "Перевірити оновлення"
                            })
                            .enabled(!busy)
                            .show(ui)
                            .clicked()
                        {
                            self.updater.check();
                        }
                    });
                });
                ui.add_space(16.0);
                let y = ui.cursor().top();
                ui.painter().hline(
                    ui.max_rect().x_range().shrink(22.0),
                    y,
                    Stroke::new(1.0, p.line),
                );
                ui.horizontal(|ui| {
                    ui.set_height(48.0);
                    ui.add_space(22.0);
                    ui.label(text(
                        "Меню та налаштування зберігаються.",
                        11.0,
                        Weight::Regular,
                        p.muted,
                    ));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.add_space(14.0);
                        if Button::new("GitHub · Validolio11/Orbit ↗")
                            .ghost()
                            .small()
                            .show(ui)
                            .clicked()
                        {
                            let _ = crate::platform::os::shell_open(&format!(
                                "https://github.com/{}",
                                crate::updater::REPOSITORY
                            ));
                        }
                    });
                });
            },
        );
    }

    fn export(&mut self) {
        let Some(file) = rfd::FileDialog::new()
            .set_title("Експортувати налаштування Orbit")
            .set_file_name("orbit-settings.json")
            .add_filter("Orbit JSON", &["json"])
            .save_file()
        else {
            return;
        };
        match crate::storage::export(&file, &self.settings) {
            Ok(()) => self.toast("Налаштування експортовано", false),
            Err(e) => self.toast(e.to_string(), true),
        }
    }
}

fn clip(
    ui: &Ui,
    label: &str,
    size: f32,
    weight: Weight,
    color: Color32,
    width: f32,
) -> Option<std::sync::Arc<egui::Galley>> {
    let mut job =
        egui::text::LayoutJob::simple_singleline(label.to_string(), font(size, weight), color);
    job.wrap = egui::text::TextWrapping {
        max_width: width,
        max_rows: 1,
        break_anywhere: true,
        overflow_character: Some('…'),
    };
    Some(ui.fonts_mut(|f| f.layout_job(job)))
}

pub fn info_box(ui: &mut Ui, p: &Palette, message: &str) {
    egui::Frame::new()
        .corner_radius(18)
        .fill(p.panel)
        .inner_margin(egui::Margin::symmetric(20, 15))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal_top(|ui| {
                super::theme::icon(ui, "info", 17.0, p.muted);
                ui.add(egui::Label::new(text(message, 11.0, Weight::Regular, p.muted)).wrap());
            });
        });
}

#[allow(dead_code)]
fn unused(_: Kind) -> Pos2 {
    Pos2::ZERO
}
