//! Jastics MB controls: buttons, icon buttons, switches, segmented controls, selects and setting rows.

use super::theme::{Palette, R_FIELD, R_ITEM, R_TILE, Weight, font, paint_icon, pal, text};
use egui::{Align2, Color32, CornerRadius, Rect, Response, Sense, Stroke, StrokeKind, Ui, Vec2};

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Secondary,
    Primary,
    Ghost,
    Danger,
    /// The pulse call to action.
    Accent,
}

pub struct Button<'a> {
    label: &'a str,
    icon: Option<&'a str>,
    kind: Kind,
    small: bool,
    enabled: bool,
    icon_size: f32,
}
impl<'a> Button<'a> {
    pub fn new(label: &'a str) -> Self {
        Button {
            label,
            icon: None,
            kind: Kind::Secondary,
            small: false,
            enabled: true,
            icon_size: 15.0,
        }
    }
    pub fn icon(mut self, icon: &'a str, size: f32) -> Self {
        self.icon = Some(icon);
        self.icon_size = size;
        self
    }
    pub fn primary(mut self) -> Self {
        self.kind = Kind::Primary;
        self
    }
    pub fn ghost(mut self) -> Self {
        self.kind = Kind::Ghost;
        self
    }
    pub fn accent(mut self) -> Self {
        self.kind = Kind::Accent;
        self
    }
    pub fn danger(mut self) -> Self {
        self.kind = Kind::Danger;
        self
    }
    pub fn small(mut self) -> Self {
        self.small = true;
        self
    }
    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
    pub fn show(self, ui: &mut Ui) -> Response {
        let p = pal(ui.ctx());
        let (height, size, pad) = if self.small {
            (30.0, 12.0, 13.0)
        } else {
            (36.0, 13.0, 17.0)
        };
        let galley =
            ui.painter()
                .layout_no_wrap(self.label.to_string(), font(size, Weight::Medium), p.text);
        let icon_w = self
            .icon
            .map(|_| self.icon_size + if self.label.is_empty() { 0.0 } else { 7.0 })
            .unwrap_or(0.0);
        let width = galley.size().x + icon_w + pad * 2.0;
        let sense = if self.enabled {
            Sense::click()
        } else {
            Sense::hover()
        };
        let (rect, response) = ui.allocate_exact_size(Vec2::new(width, height), sense);
        if ui.is_rect_visible(rect) {
            let hovered = response.hovered() && self.enabled;
            let (mut fill, mut fg) = match self.kind {
                Kind::Primary => (p.primary, p.on_primary),
                Kind::Accent => (p.green, p.on_accent),
                Kind::Ghost => (Color32::TRANSPARENT, p.text),
                Kind::Danger => (p.error, if p.dark { p.on_accent } else { Color32::WHITE }),
                Kind::Secondary => (p.active, p.text),
            };
            if hovered {
                fill = match self.kind {
                    Kind::Ghost => p.hover,
                    Kind::Primary if p.dark => Color32::WHITE,
                    _ => mix(fill, p.text, 0.12),
                };
            }
            if !self.enabled {
                fg = fg.gamma_multiply(0.4);
                fill = fill.gamma_multiply(0.4);
            }
            // The pill sinks a little while pressed.
            let rect = if response.is_pointer_button_down_on() {
                rect.shrink(1.0)
            } else {
                rect
            };
            let radius = (height / 2.0) as u8;
            let painter = ui.painter();
            if hovered && self.kind == Kind::Accent {
                painter.add(
                    egui::epaint::Shadow {
                        offset: [0, 0],
                        blur: 22,
                        spread: 0,
                        color: p.green.gamma_multiply(0.35),
                    }
                    .as_shape(rect, radius),
                );
            }
            painter.rect_filled(rect, radius, fill);
            let mut x = rect.left() + pad;
            if let Some(icon) = self.icon {
                paint_icon(
                    ui,
                    Rect::from_min_size(
                        egui::pos2(x, rect.center().y - self.icon_size / 2.0),
                        Vec2::splat(self.icon_size),
                    ),
                    icon,
                    fg,
                );
                x += icon_w;
            }
            painter.text(
                egui::pos2(x, rect.center().y),
                Align2::LEFT_CENTER,
                self.label,
                font(size, Weight::Medium),
                fg,
            );
            if response.has_focus() {
                painter.rect_stroke(
                    rect.expand(3.0),
                    radius + 3,
                    Stroke::new(2.0, p.focus),
                    StrokeKind::Outside,
                );
            }
        }
        if self.enabled {
            response.on_hover_cursor(egui::CursorIcon::PointingHand)
        } else {
            response
        }
    }
}

/// Blends `a` toward `b` by `t`.
pub fn mix(a: Color32, b: Color32, t: f32) -> Color32 {
    let l = |x: u8, y: u8| (x as f32 + (y as f32 - x as f32) * t).round() as u8;
    Color32::from_rgb(l(a.r(), b.r()), l(a.g(), b.g()), l(a.b(), b.b()))
}

/// A round tool button with a line icon (29×29 by default).
pub fn icon_button(
    ui: &mut Ui,
    icon: &str,
    icon_size: f32,
    tooltip: &str,
    danger: bool,
    enabled: bool,
) -> Response {
    icon_button_sized(
        ui,
        icon,
        icon_size,
        Vec2::splat(29.0),
        tooltip,
        danger,
        enabled,
    )
}
pub fn icon_button_sized(
    ui: &mut Ui,
    icon: &str,
    icon_size: f32,
    size: Vec2,
    tooltip: &str,
    danger: bool,
    enabled: bool,
) -> Response {
    let p = pal(ui.ctx());
    let (rect, response) = ui.allocate_exact_size(
        size,
        if enabled {
            Sense::click()
        } else {
            Sense::hover()
        },
    );
    let hovered = response.hovered() && enabled;
    if hovered {
        let radius = (size.min_elem() / 2.0) as u8;
        ui.painter()
            .rect_filled(rect, radius, mix(p.hover, p.text, 0.08));
    }
    let color = if !enabled {
        p.muted.gamma_multiply(0.4)
    } else if hovered {
        if danger { p.error } else { p.text }
    } else {
        p.muted
    };
    paint_icon(
        ui,
        Rect::from_center_size(rect.center(), Vec2::splat(icon_size)),
        icon,
        color,
    );
    let response = if tooltip.is_empty() {
        response
    } else {
        response.on_hover_text(tooltip)
    };
    if enabled {
        response.on_hover_cursor(egui::CursorIcon::PointingHand)
    } else {
        response
    }
}

/// The on/off switch: pulse when on, steel when off, with a springy knob.
pub fn toggle(ui: &mut Ui, on: bool, enabled: bool, label: &str) -> Response {
    let p = pal(ui.ctx());
    let (rect, response) = ui.allocate_exact_size(
        Vec2::new(46.0, 26.0),
        if enabled {
            Sense::click()
        } else {
            Sense::hover()
        },
    );
    let t = ui.ctx().animate_bool_with_time(response.id, on, 0.2);
    // Ease-out-back, the system's spring curve.
    let spring = 1.0 + 2.70158 * (t - 1.0).powi(3) + 1.70158 * (t - 1.0).powi(2);
    let alpha = if enabled { 1.0 } else { 0.4 };
    ui.painter()
        .rect_filled(rect, 13, mix(p.active, p.green, t).gamma_multiply(alpha));
    let x = egui::lerp(rect.left() + 13.0..=rect.right() - 13.0, spring);
    let knob = if p.dark { p.text } else { Color32::WHITE };
    ui.painter().circle_filled(
        egui::pos2(x, rect.center().y),
        9.0,
        mix(knob, p.on_accent, t).gamma_multiply(alpha),
    );
    if response.has_focus() {
        ui.painter().rect_stroke(
            rect.expand(3.0),
            16,
            Stroke::new(2.0, p.focus),
            StrokeKind::Outside,
        );
    }
    response.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, enabled, on, label));
    if enabled {
        response.on_hover_cursor(egui::CursorIcon::PointingHand)
    } else {
        response
    }
}

/// Pills side by side in a track; the active one is inverted. Returns the clicked index.
pub fn segmented(ui: &mut Ui, options: &[(&str, &str)], active: usize) -> Option<usize> {
    let p = pal(ui.ctx());
    let mut clicked = None;
    // The whole track is measured first so it sits correctly in right-aligned rows.
    let widths: Vec<f32> = options
        .iter()
        .map(|(_, label)| {
            ui.painter()
                .layout_no_wrap(label.to_string(), font(12.0, Weight::Medium), p.text)
                .size()
                .x
                + 45.0
        })
        .collect();
    let total = widths.iter().sum::<f32>() + 2.0 * (options.len() as f32 - 1.0) + 8.0;
    let (track, _) = ui.allocate_exact_size(Vec2::new(total, 36.0), Sense::hover());
    ui.painter().rect_filled(track, 18, p.bg);
    let mut x = track.left() + 4.0;
    for (i, (icon, label)) in options.iter().enumerate() {
        let rect =
            Rect::from_min_size(egui::pos2(x, track.top() + 4.0), Vec2::new(widths[i], 28.0));
        x += widths[i] + 2.0;
        let response = ui.interact(
            rect,
            ui.scope_id().with(("segment", *label)),
            Sense::click(),
        );
        let selected = i == active;
        if selected {
            ui.painter().rect_filled(rect, 14, p.primary);
        }
        let color = if selected {
            p.on_primary
        } else if response.hovered() {
            p.text
        } else {
            p.muted
        };
        paint_icon(
            ui,
            Rect::from_min_size(
                egui::pos2(rect.left() + 12.0, rect.center().y - 7.0),
                Vec2::splat(14.0),
            ),
            icon,
            color,
        );
        ui.painter().text(
            egui::pos2(rect.left() + 33.0, rect.center().y),
            Align2::LEFT_CENTER,
            *label,
            font(12.0, Weight::Medium),
            color,
        );
        if response
            .on_hover_cursor(egui::CursorIcon::PointingHand)
            .clicked()
        {
            clicked = Some(i);
        }
    }
    clicked
}

/// A dropdown: a night field that opens a graphite list. Returns the newly chosen index.
pub fn select(
    ui: &mut Ui,
    id: &str,
    options: &[String],
    current: usize,
    width: f32,
) -> Option<usize> {
    let p = pal(ui.ctx());
    let mut chosen = None;
    let label = options.get(current).cloned().unwrap_or_default();
    let (rect, response) = ui.allocate_exact_size(Vec2::new(width, 36.0), Sense::click());
    let hovered = response.hovered();
    let popup_id = egui::Id::unique(id);
    let open = egui::Popup::is_id_open(ui.ctx(), popup_id);
    ui.painter().rect(
        rect,
        R_FIELD,
        p.bg,
        if open || response.has_focus() {
            Stroke::new(2.0, p.focus)
        } else {
            Stroke::new(1.0, if hovered { p.line_strong } else { p.line })
        },
        StrokeKind::Inside,
    );
    ui.painter().text(
        egui::pos2(rect.left() + 14.0, rect.center().y),
        Align2::LEFT_CENTER,
        &label,
        font(12.0, Weight::Medium),
        p.text,
    );
    paint_icon(
        ui,
        Rect::from_center_size(
            egui::pos2(rect.right() - 18.0, rect.center().y),
            Vec2::splat(14.0),
        ),
        "down",
        if open { p.text } else { p.muted },
    );
    let response = response.on_hover_cursor(egui::CursorIcon::PointingHand);
    egui::Popup::menu(&response)
        .id(popup_id)
        .width(width)
        .show(|ui| {
            ui.set_min_width(width - 12.0);
            ui.spacing_mut().item_spacing.y = 2.0;
            for (i, option) in options.iter().enumerate() {
                let (row, r) =
                    ui.allocate_exact_size(Vec2::new(width - 12.0, 34.0), Sense::click());
                if r.hovered() {
                    ui.painter().rect_filled(row, R_ITEM, p.hover);
                }
                ui.painter().text(
                    egui::pos2(row.left() + 12.0, row.center().y),
                    Align2::LEFT_CENTER,
                    option,
                    font(12.0, Weight::Regular),
                    p.text,
                );
                if i == current {
                    paint_icon(
                        ui,
                        Rect::from_center_size(
                            egui::pos2(row.right() - 16.0, row.center().y),
                            Vec2::splat(14.0),
                        ),
                        "check",
                        p.accent_ink(),
                    );
                }
                if r.on_hover_cursor(egui::CursorIcon::PointingHand).clicked() {
                    chosen = Some(i);
                    ui.close();
                }
            }
        });
    chosen
}

/// A settings row: title and note on the left, the control on the right, a divider above.
pub fn setting_row(ui: &mut Ui, title: &str, note: &str, control: impl FnOnce(&mut Ui)) {
    let p = pal(ui.ctx());
    let top = ui.cursor().top();
    // Rows are separated by an inset hairline; the first row of a tile has none.
    if top - ui.max_rect().top() > 2.0 {
        ui.painter().hline(
            ui.max_rect().x_range().shrink(22.0),
            top,
            Stroke::new(1.0, p.line),
        );
    }
    ui.add_space(16.0);
    ui.horizontal(|ui| {
        ui.add_space(22.0);
        let control_width = 280.0;
        let width = (ui.available_width() - control_width - 20.0).max(200.0);
        ui.vertical(|ui| {
            ui.set_width(width);
            ui.label(text(title, 13.0, Weight::Medium, p.text));
            if !note.is_empty() {
                ui.add(egui::Label::new(text(note, 12.0, Weight::Regular, p.muted)).wrap());
            }
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.add_space(22.0);
            control(ui);
        });
    });
    ui.add_space(16.0);
}

/// A graphite tile of settings rows.
pub fn section(ui: &mut Ui, p: &Palette, title: Option<(&str, &str)>, body: impl FnOnce(&mut Ui)) {
    egui::Frame::new()
        .corner_radius(R_TILE)
        .fill(p.panel)
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.spacing_mut().item_spacing.y = 0.0;
            if let Some((heading, note)) = title {
                ui.add_space(20.0);
                ui.horizontal(|ui| {
                    ui.add_space(22.0);
                    ui.vertical(|ui| {
                        ui.label(text(heading, 16.0, Weight::Semibold, p.text));
                        ui.add_space(4.0);
                        ui.label(text(note, 12.0, Weight::Regular, p.muted));
                    });
                });
                ui.add_space(18.0);
            }
            body(ui);
        });
}

pub fn kbd(ui: &mut Ui, label: &str) {
    let p = pal(ui.ctx());
    egui::Frame::new()
        .fill(p.active)
        .corner_radius(8)
        .inner_margin(egui::Margin::symmetric(9, 4))
        .show(ui, |ui| {
            ui.label(text(label, 11.0, Weight::Mono, p.text));
        });
}

/// A one-line text field: a night field with a hairline ring that turns volt on focus.
pub fn text_field(ui: &mut Ui, id: &str, value: &mut String, hint: &str, width: f32) -> Response {
    let p = pal(ui.ctx());
    let inner = egui::Frame::new()
        .stroke(Stroke::new(1.0, p.line))
        .corner_radius(R_FIELD)
        .fill(p.bg)
        .inner_margin(egui::Margin::symmetric(14, 10))
        .show(ui, |ui| {
            ui.add(
                egui::TextEdit::singleline(value)
                    .id(egui::Id::unique(id))
                    .frame(egui::Frame::NONE)
                    .hint_text(text(hint, 13.0, Weight::Regular, p.faint))
                    .font(font(13.0, Weight::Regular))
                    .text_color(p.text)
                    .desired_width(width - 30.0)
                    .char_limit(4096),
            )
        });
    let response = inner.inner;
    if response.has_focus() {
        ui.painter().rect_stroke(
            inner.response.rect,
            R_FIELD,
            Stroke::new(2.0, p.focus),
            StrokeKind::Inside,
        );
    }
    response
}

/// The system's search pill: an inverted capsule with the query inside.
pub fn search_pill(ui: &mut Ui, id: &str, value: &mut String, hint: &str, width: f32) -> Response {
    let p = pal(ui.ctx());
    let inner = egui::Frame::new()
        .corner_radius(20)
        .fill(p.primary)
        .inner_margin(egui::Margin {
            left: 18,
            right: 18,
            top: 5,
            bottom: 5,
        })
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing.x = 10.0;
            ui.visuals_mut().text_cursor.stroke.color = p.on_primary;
            ui.horizontal(|ui| {
                super::theme::icon(ui, "search", 16.0, p.on_primary);
                ui.add(
                    egui::TextEdit::singleline(value)
                        .id(egui::Id::unique(id))
                        .frame(egui::Frame::NONE)
                        .hint_text(text(
                            hint,
                            13.0,
                            Weight::Regular,
                            mix(p.on_primary, p.primary, 0.45),
                        ))
                        .font(font(13.0, Weight::Medium))
                        .text_color(p.on_primary)
                        .desired_width(width - 60.0)
                        .margin(egui::Margin::symmetric(0, 6))
                        .char_limit(4096),
                )
            })
            .inner
        });
    let response = inner.inner;
    if response.has_focus() {
        ui.painter().rect_stroke(
            inner.response.rect.expand(3.0),
            23,
            Stroke::new(2.0, p.focus),
            StrokeKind::Outside,
        );
    }
    response
}

pub fn corner(r: u8) -> CornerRadius {
    CornerRadius::same(r)
}
