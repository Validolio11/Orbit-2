//! Paints the radial menu and reports what the pointer is over. Shared by the editor preview and the wheel window.

use super::item_icon::{IconCache, IconSource, paint_item_icon};
use super::theme::{Palette, Weight, font, paint_icon};
use crate::model::{Action, Kind, geometry};
use crate::shared::Foreground;
use egui::epaint::{Mesh, PathShape, PathStroke};
use egui::{Align2, Color32, Pos2, Rect, Stroke, Ui, Vec2};

#[derive(Clone, Copy, PartialEq)]
pub enum Style {
    Preview,
    Overlay,
}

/// Editor drag feedback: the dragged item, the sibling under the pointer, and the center as a "move up" target.
#[derive(Clone, Default)]
pub struct DragView {
    pub source: Option<String>,
    pub target: Option<String>,
    pub center: Option<Option<String>>,
}

pub struct WheelView<'a> {
    pub items: &'a [Action],
    pub title: &'a str,
    pub selected: Option<&'a str>,
    pub back: bool,
    pub add_slot: bool,
    pub add_item: Option<&'a Foreground>,
    pub add_selected: bool,
    pub drag: Option<&'a DragView>,
    pub style: Style,
    /// 0..1 for the opening animation.
    pub appear: f32,
}

/// What lies under a point of the wheel.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Hit {
    Center,
    Item(usize),
    Add,
    Nothing,
}

pub struct Geometry {
    pub center: Pos2,
    pub scale: f32,
    pub count: usize,
}
impl Geometry {
    pub fn new(rect: Rect, items: usize, add_slot: bool) -> Self {
        let slot = add_slot && items > 0;
        Geometry {
            center: rect.center(),
            scale: rect.width() / 480.0,
            count: items + slot as usize,
        }
    }
    pub fn local(&self, p: Pos2) -> Vec2 {
        (p - self.center) / self.scale
    }
    pub fn at(&self, local: [f32; 2]) -> Pos2 {
        self.center + Vec2::new(local[0], local[1]) * self.scale
    }
    pub fn slot_center(&self, index: usize) -> Pos2 {
        let a = geometry::slot_angle(index, self.count);
        self.center + Vec2::new(a.cos(), a.sin()) * 150.0 * self.scale
    }
    /// The hit test used for clicks and hover. Items are 74×64 buttons around their slot; sectors are the ring.
    pub fn hit(&self, p: Pos2, items: usize, inner: f32, outer: f32) -> Hit {
        let local = self.local(p);
        if local.length() <= 74.4 {
            return Hit::Center;
        }
        match geometry::sector_at(local.x, local.y, self.count, inner, outer) {
            Some(i) if i < items => Hit::Item(i),
            Some(_) => Hit::Add,
            None => Hit::Nothing,
        }
    }
}

pub fn paint(
    ui: &Ui,
    rect: Rect,
    view: &WheelView,
    p: &Palette,
    icons: &IconCache,
    hover: Option<Pos2>,
) -> Geometry {
    let painter = ui.painter_at(rect.expand(40.0));
    let g = Geometry::new(rect, view.items.len(), view.add_slot);
    let s = g.scale;
    let overlay = view.style == Style::Overlay;
    let alpha = view.appear;
    let fade = |c: Color32| c.gamma_multiply(alpha);
    // Dashed guide circle: only on the editor's stage, the real wheel floats clean over the desktop.
    let guide = p.line_strong.gamma_multiply(0.6);
    for i in 0..if overlay { 0 } else { 90 } {
        let a0 = i as f32 / 90.0 * std::f32::consts::TAU;
        let a1 = a0 + std::f32::consts::TAU / 90.0 * 0.25;
        painter.line_segment(
            [
                g.at([224.0 * a0.cos(), 224.0 * a0.sin()]),
                g.at([224.0 * a1.cos(), 224.0 * a1.sin()]),
            ],
            Stroke::new(0.7, fade(guide)),
        );
    }
    let hovered = hover.map(|h| g.hit(h, view.items.len(), 92.0, 207.0));
    let drag = view.drag.cloned().unwrap_or_default();
    for index in 0..g.count {
        let is_add = index >= view.items.len();
        let item = view.items.get(index);
        let id = item.map(|i| i.id.as_str());
        let selected = if is_add {
            view.add_selected
        } else {
            view.selected.is_some() && view.selected == id
        };
        let is_target = id.is_some() && drag.target.as_deref() == id;
        let is_source = id.is_some() && drag.source.as_deref() == id;
        let hot = !overlay && hovered == Some(if is_add { Hit::Add } else { Hit::Item(index) });
        let (outer, inner) = geometry::sector_outline(index, g.count, 92.0, 207.0, 6.0, 48);
        // Graphite tiles; the selected one is inverted (paper tile, night content), the "+" slot is a night tile.
        let mut fill = if selected {
            p.primary
        } else if hot {
            p.hover
        } else if is_add {
            p.bg
        } else {
            p.panel
        };
        let mut stroke = if selected {
            p.primary
        } else if is_add {
            p.line_strong
        } else {
            p.line
        };
        if is_target {
            stroke = p.accent_ink();
            fill = p.active;
        }
        if is_source {
            fill = fill.gamma_multiply(0.4);
        }
        // Sectors are tiles: their four corners are rounded like every other surface of the system.
        let outer: Vec<Pos2> = outer.iter().map(|q| g.at(*q)).collect();
        let inner: Vec<Pos2> = inner.iter().map(|q| g.at(*q)).collect();
        let (outer, inner) = rounded_sector(&outer, &inner, 11.0 * s);
        let mut mesh = Mesh::default();
        for (o, i) in outer.iter().zip(inner.iter()) {
            let base = mesh.vertices.len() as u32;
            mesh.colored_vertex(*o, fade(fill));
            mesh.colored_vertex(*i, fade(fill));
            if base >= 2 {
                mesh.add_triangle(base - 2, base - 1, base);
                mesh.add_triangle(base - 1, base + 1, base);
            }
        }
        painter.add(mesh);
        let outline: Vec<Pos2> = outer
            .iter()
            .copied()
            .chain(inner[1..inner.len() - 1].iter().rev().copied())
            .collect();
        // A plain tile is stroked in its own colour, which only smooths its edge.
        if !is_target && !is_add && !selected {
            stroke = fill;
        }
        let width = if is_target { 2.0 } else { 1.0 };
        painter.add(PathShape::closed_line(
            outline,
            PathStroke::new(width, fade(stroke)),
        ));
        // Icon and label.
        let center = g.slot_center(index);
        let color = if selected && !is_target {
            p.on_primary
        } else if hot || is_target {
            p.text
        } else {
            p.muted
        };
        let color = fade(if is_source {
            color.gamma_multiply(0.4)
        } else {
            color
        });
        let icon_size = 25.0
            * if overlay {
                s.max(0.8)
            } else {
                s.clamp(0.6, 1.0)
            };
        let label_size = if overlay { 11.0 } else { 9.0 } * s.clamp(0.75, 1.2);
        let icon_rect =
            Rect::from_center_size(center - Vec2::new(0.0, 8.0 * s), Vec2::splat(icon_size));
        let label = if is_add {
            view.add_item.map(|f| f.name.as_str()).unwrap_or("Додати")
        } else {
            item.map(|i| i.name.as_str()).unwrap_or("")
        };
        if is_add {
            if let Some(app) = view.add_item {
                paint_item_icon(
                    ui,
                    icon_rect,
                    IconSource {
                        kind: Kind::App,
                        name: &app.name,
                        target: &app.target,
                        icon: "app",
                    },
                    color,
                    p,
                    icons,
                );
                let badge = Rect::from_center_size(
                    icon_rect.right_bottom() - Vec2::splat(2.0),
                    Vec2::splat(14.0),
                );
                painter.circle_filled(badge.center(), 7.0, fade(p.green));
                paint_icon(ui, badge.shrink(2.5), "plus", fade(p.on_accent));
            } else {
                paint_icon(
                    ui,
                    Rect::from_center_size(
                        icon_rect.center(),
                        Vec2::splat(22.0 * s.clamp(0.6, 1.2)),
                    ),
                    "plus",
                    color,
                );
            }
        } else if let Some(item) = item {
            paint_item_icon(ui, icon_rect, IconSource::from(item), color, p, icons);
            if item.kind == Kind::Group {
                painter.text(
                    center + Vec2::new(0.0, 27.0 * s),
                    Align2::CENTER_CENTER,
                    "···",
                    font(13.0 * s.clamp(0.7, 1.0), Weight::Regular),
                    if selected {
                        color.gamma_multiply(0.6)
                    } else {
                        fade(p.faint)
                    },
                );
            }
        }
        let max_width =
            (geometry::label_width(geometry::slot_angle(index, g.count), g.count).min(84.0) * s)
                .max(30.0);
        // Labels wrap to two centered lines before they are cut with an ellipsis.
        let galley = label_galley(ui, label, label_size, color, max_width);
        painter.galley(
            Pos2::new(center.x, icon_rect.bottom() + 5.0 * s),
            galley,
            color,
        );
    }
    // Center.
    let radius = 0.155 * rect.width();
    let center_state = drag.center.clone();
    let center_hot = !overlay && hovered == Some(Hit::Center) && view.back;
    let (fill, stroke) = match &center_state {
        Some(None) => (p.active, p.accent_ink()),
        Some(Some(_)) => (p.panel, p.line_strong),
        None => (if center_hot { p.hover } else { p.bg }, p.line),
    };
    let ring = if matches!(center_state, Some(None)) {
        2.0
    } else {
        1.0
    };
    painter.circle(
        g.center,
        radius,
        fade(fill),
        Stroke::new(ring, fade(stroke)),
    );
    let icon_size = if view.back { 24.0 } else { 30.0 } * s.clamp(0.6, 1.3);
    paint_icon(
        ui,
        Rect::from_center_size(g.center - Vec2::new(0.0, 18.0 * s), Vec2::splat(icon_size)),
        if view.back { "back" } else { "orbit" },
        fade(p.text),
    );
    let title_size = if overlay { 16.0 } else { 14.0 } * s.clamp(0.7, 1.2);
    let title = ellipsize(ui, view.title, title_size, p.text, radius * 1.7);
    painter.galley(
        Pos2::new(g.center.x - title.size().x / 2.0, g.center.y + 4.0 * s),
        title,
        fade(p.text),
    );
    let small = match &center_state {
        Some(Some(error)) => error.clone(),
        Some(None) => "Перемістити на рівень вище".into(),
        None => {
            if view.back {
                "Назад".into()
            } else {
                format!("{} дій", view.items.len())
            }
        }
    };
    painter.text(
        g.center + Vec2::new(0.0, 32.0 * s),
        Align2::CENTER_CENTER,
        small,
        font(
            if overlay { 10.0 } else { 9.0 } * s.clamp(0.7, 1.2),
            Weight::Regular,
        ),
        fade(p.muted),
    );
    if view.items.is_empty() {
        painter.text(
            Pos2::new(g.center.x, rect.top() + rect.height() * 0.8),
            Align2::CENTER_CENTER,
            "Додайте першу дію",
            font(12.0, Weight::Regular),
            fade(p.muted),
        );
    }
    g
}

/// Point at arc length `d` along a polyline.
fn along(points: &[Pos2], d: f32) -> Pos2 {
    let mut left = d;
    for pair in points.windows(2) {
        let step = (pair[1] - pair[0]).length();
        if left <= step && step > 0.0 {
            return pair[0] + (pair[1] - pair[0]) * (left / step);
        }
        left -= step;
    }
    *points.last().unwrap_or(&Pos2::ZERO)
}

/// Rounds the four corners of an annular sector. Returns its outer and inner rails: equally long point
/// lists that both run from the middle of one radial side to the middle of the other.
fn rounded_sector(outer: &[Pos2], inner: &[Pos2], radius: f32) -> (Vec<Pos2>, Vec<Pos2>) {
    const ARC: usize = 40;
    const CORNER: usize = 7;
    let length =
        |points: &[Pos2]| -> f32 { points.windows(2).map(|p| (p[1] - p[0]).length()).sum() };
    let (lo, li) = (outer[0], inner[0]);
    let (ro, ri) = (outer[outer.len() - 1], inner[inner.len() - 1]);
    let (outer_len, inner_len) = (length(outer), length(inner));
    let r = radius
        .min((lo - li).length() * 0.3)
        .min(inner_len * 0.3)
        .max(0.0);
    let (down_left, down_right) = ((li - lo).normalized(), (ri - ro).normalized());
    let corner = |rail: &mut Vec<Pos2>, a: Pos2, c: Pos2, b: Pos2| {
        for j in 0..=CORNER {
            let t = j as f32 / CORNER as f32;
            let u = 1.0 - t;
            rail.push(
                (a.to_vec2() * (u * u) + c.to_vec2() * (2.0 * u * t) + b.to_vec2() * (t * t))
                    .to_pos2(),
            );
        }
    };
    let rail = |arc: &[Pos2], len: f32, left: Pos2, right: Pos2, sign: f32| {
        let mut rail = vec![li + (lo - li) * 0.5];
        corner(&mut rail, left + down_left * r * sign, left, along(arc, r));
        for j in 0..ARC {
            rail.push(along(
                arc,
                r + (len - 2.0 * r) * j as f32 / (ARC - 1) as f32,
            ));
        }
        corner(
            &mut rail,
            along(arc, len - r),
            right,
            right + down_right * r * sign,
        );
        rail.push(ri + (ro - ri) * 0.5);
        rail
    };
    (
        rail(outer, outer_len, lo, ro, 1.0),
        rail(inner, inner_len, li, ri, -1.0),
    )
}

/// A wheel label: up to two centered lines, the second ending with an ellipsis when it does not fit.
fn label_galley(
    ui: &Ui,
    label: &str,
    size: f32,
    color: Color32,
    max_width: f32,
) -> std::sync::Arc<egui::Galley> {
    // A word that is wider than the sector would be split mid-word; such labels stay on one line.
    let widest_word = label
        .split_whitespace()
        .map(|word| {
            ui.painter()
                .layout_no_wrap(word.to_string(), font(size, Weight::Regular), color)
                .size()
                .x
        })
        .fold(0.0, f32::max);
    // A word that is only a little too wide gets a slightly smaller type instead of being cut.
    if widest_word > max_width && widest_word <= max_width * 1.35 {
        return label_galley(
            ui,
            label,
            size * max_width / widest_word * 0.98,
            color,
            max_width,
        );
    }
    if widest_word > max_width {
        let mut job = egui::text::LayoutJob::simple_singleline(
            label.to_string(),
            font(size, Weight::Regular),
            color,
        );
        job.halign = egui::Align::Center;
        job.wrap = egui::text::TextWrapping {
            max_width,
            max_rows: 1,
            break_anywhere: true,
            overflow_character: Some('…'),
        };
        return ui.fonts_mut(|f| f.layout_job(job));
    }
    let mut job = egui::text::LayoutJob::simple(
        label.to_string(),
        font(size, Weight::Regular),
        color,
        max_width,
    );
    job.halign = egui::Align::Center;
    job.wrap = egui::text::TextWrapping {
        max_width,
        max_rows: 2,
        break_anywhere: false,
        overflow_character: Some('…'),
    };
    ui.fonts_mut(|f| f.layout_job(job))
}

fn ellipsize(
    ui: &Ui,
    label: &str,
    size: f32,
    color: Color32,
    max_width: f32,
) -> std::sync::Arc<egui::Galley> {
    let mut job = egui::text::LayoutJob::simple_singleline(
        label.to_string(),
        font(size, Weight::Regular),
        color,
    );
    job.wrap = egui::text::TextWrapping {
        max_width,
        max_rows: 1,
        break_anywhere: true,
        overflow_character: Some('…'),
    };
    ui.fonts_mut(|f| f.layout_job(job))
}
