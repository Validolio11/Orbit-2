//! The wheel window: a transparent, always-on-top window that the input thread places at the cursor.

use super::theme::pal;
use super::wheel::{self, Hit, Style, WheelView};
use crate::model::{Action, Activation, GroupOpen, Kind, MAX_ITEMS, geometry};
use crate::shared::{OVERLAY_TITLE, Shared, Trigger, overlay_id};
use egui::{Key, Pos2, Rect, Vec2, ViewportBuilder};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub fn builder() -> ViewportBuilder {
    ViewportBuilder::default()
        .with_title(OVERLAY_TITLE)
        .with_decorations(false)
        .with_transparent(true)
        .with_always_on_top()
        .with_taskbar(false)
        .with_resizable(false)
        .with_visible(false)
        .with_inner_size([600.0, 600.0])
        .with_active(false)
}

pub fn register(ctx: &egui::Context, shared: Arc<Shared>) {
    ctx.show_viewport_deferred(overlay_id(), builder(), move |ui, _| show(ui, &shared));
}

enum Do {
    Close,
    Launch(Action),
    AddForeground,
    AddDialog(Vec<String>),
}

/// One level of the wheel: its actions and, while there is room, the "+" slot at the end.
struct Level {
    items: Vec<Action>,
    add_slot: bool,
    title: String,
}

fn show(ui: &mut egui::Ui, shared: &Shared) {
    let ctx = ui.ctx().clone();
    let p = pal(&ctx);
    let settings = shared.store.get();
    let mut todo = Vec::new();
    {
        let mut w = shared.wheel();
        if !w.visible {
            return;
        }
        // Keep only the groups that still exist (the menu may have changed while the wheel is open).
        let mut items = &settings.current_menu().items;
        let mut title = "Orbit".to_string();
        let mut kept = Vec::new();
        for id in &w.stack {
            match items.iter().find(|i| &i.id == id && i.kind == Kind::Group) {
                Some(g) => {
                    kept.push(id.clone());
                    items = &g.children;
                    title = g.name.clone();
                }
                None => break,
            }
        }
        w.stack = kept;
        let level = Level {
            items: items.clone(),
            add_slot: settings.wheel_add_slot && !items.is_empty() && items.len() < MAX_ITEMS,
            title,
        };
        let count = level.items.len() + level.add_slot as usize;
        if w.selected.is_some_and(|s| s >= count) {
            w.selected = None;
        }
        let full = ui.max_rect();
        let size = w
            .size
            .min(full.width() - 30.0)
            .min(full.height() - 60.0)
            .max(120.0);
        let appear = if settings.reduced_motion {
            1.0
        } else {
            (w.opened_at.elapsed().as_secs_f32() / 0.14).min(1.0)
        };
        let eased = 1.0 - (1.0 - appear).powi(3);
        let rect = Rect::from_center_size(full.center(), Vec2::splat(size * (0.96 + 0.04 * eased)));
        let g = wheel::Geometry::new(rect, level.items.len(), level.add_slot);
        let now = Instant::now();

        // Selecting a sector starts the hover timers; the "+" slot never activates by hovering.
        let select = |w: &mut crate::shared::WheelState, index: Option<usize>, keyboard: bool| {
            if index == w.selected {
                return;
            }
            w.selected = index;
            w.selected_at = (!keyboard).then_some(Instant::now());
            w.focus_keyboard = keyboard;
        };

        let (pointer, pressed, released_click) = ctx.input(|i| {
            (
                i.pointer.latest_pos(),
                i.pointer.any_pressed(),
                i.pointer.primary_released(),
            )
        });
        if !w.busy {
            if let Some(pos) = pointer {
                if w.pointer != Some(pos) {
                    w.pointer = Some(pos);
                    let near_origin = w.origin.is_some_and(|o| o.distance(pos) < 12.0);
                    if !near_origin {
                        w.origin = None;
                        let local = g.local(pos);
                        select(
                            &mut w,
                            geometry::sector_at(local.x, local.y, count, 88.0, 225.0),
                            false,
                        );
                    }
                }
            }
        }
        // Clicking outside the ring closes the wheel like Escape.
        if pressed && settings.close_on_outside_click {
            if let Some(pos) = pointer {
                if g.local(pos).length() > 207.0 {
                    todo.push(Do::Close);
                }
            }
        }
        let mut commit = false;
        if released_click {
            if let Some(pos) = pointer {
                match g.hit(pos, level.items.len(), 88.0, 225.0) {
                    Hit::Center if !w.stack.is_empty() => {
                        w.stack.pop();
                        w.selected = None;
                        w.origin = Some(pos);
                    }
                    Hit::Item(i) => {
                        w.selected = Some(i);
                        commit = true;
                    }
                    Hit::Add => {
                        w.selected = Some(level.items.len());
                        commit = true;
                    }
                    _ if level.items.is_empty()
                        && rect.contains(pos)
                        && pos.y > rect.top() + rect.height() * 0.72
                        && settings.wheel_add_slot =>
                    {
                        todo.push(Do::AddDialog(w.stack.clone()))
                    }
                    _ => {}
                }
            }
        }
        ctx.input(|i| {
            if i.key_pressed(Key::Escape) {
                todo.push(Do::Close);
            }
            let step = if i.key_pressed(Key::ArrowRight) || i.key_pressed(Key::ArrowDown) {
                1
            } else if i.key_pressed(Key::ArrowLeft) || i.key_pressed(Key::ArrowUp) {
                -1
            } else {
                0
            };
            if step != 0 && count > 0 {
                let current = w.selected.map(|s| s as i32).unwrap_or(-1);
                let next = ((current + step + count as i32) % count as i32) as usize;
                select(&mut w, Some(next), true);
            }
            if i.key_pressed(Key::Enter) {
                commit = true;
            }
            if i.key_pressed(Key::Backspace) && !w.stack.is_empty() {
                w.stack.pop();
                w.selected = None;
                w.origin = pointer;
            }
        });
        // Releasing the side button launches the selection in "release" mode.
        if std::mem::take(&mut w.released)
            && w.trigger == Trigger::Mouse
            && settings.activation_mode == Activation::Release
        {
            match w.selected.and_then(|s| level.items.get(s)) {
                Some(item) if item.kind != Kind::Group => commit = true,
                _ if w.stack.is_empty() && !w.selected.is_some_and(|s| s >= level.items.len()) => {
                    todo.push(Do::Close)
                }
                _ => {}
            }
        }
        // Hover timers: groups open after 300 ms, actions launch after the hover delay.
        if let (Some(index), Some(since)) = (w.selected, w.selected_at) {
            if !w.busy {
                let elapsed = now.duration_since(since);
                if let Some(item) = level.items.get(index) {
                    let wait = if item.kind == Kind::Group {
                        (settings.group_open_mode == GroupOpen::Hover).then_some(300)
                    } else {
                        (settings.activation_mode == Activation::Hover
                            && w.trigger == Trigger::Mouse)
                            .then_some(settings.hover_delay as u64)
                    };
                    if let Some(ms) = wait {
                        if elapsed >= Duration::from_millis(ms) {
                            commit = true;
                            w.selected_at = None;
                        } else {
                            ctx.request_repaint_after(Duration::from_millis(ms) - elapsed);
                        }
                    }
                }
            }
        }
        if commit && !w.busy {
            match w.selected {
                Some(i) if i < level.items.len() => {
                    let item = level.items[i].clone();
                    if item.kind == Kind::Group {
                        w.stack.push(item.id.clone());
                        w.selected = None;
                        w.selected_at = None;
                        w.origin = pointer;
                    } else {
                        todo.push(Do::Launch(item));
                    }
                }
                Some(_) => {
                    if w.foreground.is_some() {
                        todo.push(Do::AddForeground);
                    } else {
                        todo.push(Do::AddDialog(w.stack.clone()));
                    }
                }
                None => {}
            }
        }

        let foreground = w
            .foreground
            .clone()
            .filter(|f| !level.items.iter().any(|i| i.target == f.target));
        let selected_id = w
            .selected
            .and_then(|s| level.items.get(s))
            .map(|i| i.id.clone());
        let view = WheelView {
            items: &level.items,
            title: &level.title,
            selected: selected_id.as_deref(),
            back: !w.stack.is_empty(),
            add_slot: level.add_slot,
            add_item: foreground.as_ref(),
            add_selected: w.selected == Some(level.items.len()) && level.add_slot,
            drag: None,
            style: Style::Overlay,
            appear: 0.35 + 0.65 * eased,
        };
        // A soft shadow under the ring.
        // Stacked translucent discs fade out past the rim, like a blurred drop shadow.
        let rim = rect.width() * 207.0 / 480.0;
        for layer in 0..12 {
            ui.painter().circle_filled(
                rect.center() + Vec2::new(0.0, 8.0),
                rim - 6.0 + layer as f32 * 3.0,
                egui::Color32::from_black_alpha((7.0 * eased) as u8),
            );
        }
        // A translucent night disc keeps the hub readable over busy windows.
        ui.painter().circle_filled(
            rect.center(),
            rect.width() * 98.0 / 480.0,
            p.bg.gamma_multiply(0.7 * eased),
        );
        wheel::paint(ui, rect, &view, &p, &shared.icons, None);
        if appear < 1.0 {
            ctx.request_repaint();
        }
        if std::mem::take(&mut w.focus_keyboard) {
            ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
        }
        let _ = Pos2::ZERO;
    }
    for action in todo {
        match action {
            Do::Close => shared.close_wheel(),
            Do::Launch(item) => shared.launch(item),
            Do::AddDialog(path) => shared.open_add_dialog(path),
            Do::AddForeground => {
                shared.wheel().busy = true;
                let result = shared.add_foreground();
                let mut w = shared.wheel();
                w.busy = false;
                match result {
                    Ok(id) => {
                        let s = shared.store.get();
                        w.selected = s.level(&w.stack).0.iter().position(|i| i.id == id);
                        w.selected_at = None;
                    }
                    Err(e) => {
                        drop(w);
                        shared.send(crate::shared::AppEvent::Toast(e, true));
                    }
                }
            }
        }
    }
}
