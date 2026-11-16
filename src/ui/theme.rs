//! Jastics MB design tokens (night / graphite / steel / paper, pulse and volt accents), fonts and painting helpers.

use super::icon_paths;
use egui::{
    Color32, FontData, FontDefinitions, FontFamily, FontId, Id, Rect, RichText, Stroke, Ui,
};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Palette {
    pub dark: bool,
    /// The canvas ("night").
    pub bg: Color32,
    /// Tiles, dialogs and popups ("graphite").
    pub panel: Color32,
    pub subtle: Color32,
    /// Hovered rows and controls.
    pub hover: Color32,
    /// Filled controls and selected rows ("steel").
    pub active: Color32,
    pub line: Color32,
    pub line_strong: Color32,
    /// "paper" in the dark theme.
    pub text: Color32,
    /// "fog".
    pub muted: Color32,
    pub faint: Color32,
    pub primary: Color32,
    pub on_primary: Color32,
    /// "pulse": the enabled state and the main call to action. Always carries `on_accent` content.
    pub green: Color32,
    pub on_accent: Color32,
    /// "volt": onboarding tiles; `focus` is its glow, used for focus rings.
    pub volt: Color32,
    pub focus: Color32,
    /// "signal".
    pub error: Color32,
}

impl Palette {
    /// The accent for thin marks (ticks, outlines): pulse reads on dark surfaces only.
    pub fn accent_ink(&self) -> Color32 {
        if self.dark { self.green } else { self.text }
    }
}

const fn hex(v: u32) -> Color32 {
    Color32::from_rgb((v >> 16) as u8, (v >> 8) as u8, v as u8)
}

/// Corner radii: the system's field / tile / capsule steps at desktop density.
pub const R_FIELD: u8 = 14;
pub const R_TILE: u8 = 24;
pub const R_ITEM: u8 = 12;

pub const DARK: Palette = Palette {
    dark: true,
    bg: hex(0x090a0a),
    panel: hex(0x1c1c1e),
    subtle: hex(0x141415),
    hover: hex(0x2c2c2e),
    active: hex(0x3a3a3c),
    line: hex(0x2c2c2e),
    line_strong: hex(0x3a3a3c),
    text: hex(0xf4f4f2),
    muted: hex(0xa1a1a6),
    faint: hex(0x7c7c81),
    primary: hex(0xf4f4f2),
    on_primary: hex(0x090a0a),
    green: hex(0x13f287),
    on_accent: hex(0x090a0a),
    volt: hex(0x6408fa),
    focus: hex(0x8f5bff),
    error: hex(0xff4d4f),
};
/// The system ships dark only; the light theme mirrors it with paper as the canvas.
pub const LIGHT: Palette = Palette {
    dark: false,
    bg: hex(0xf4f4f2),
    panel: hex(0xffffff),
    subtle: hex(0xfafaf8),
    hover: hex(0xececea),
    active: hex(0xdfdfdc),
    line: hex(0xe4e4e1),
    line_strong: hex(0xcdcdc9),
    text: hex(0x090a0a),
    muted: hex(0x5f5f64),
    faint: hex(0x85858a),
    primary: hex(0x090a0a),
    on_primary: hex(0xf4f4f2),
    green: hex(0x13f287),
    on_accent: hex(0x090a0a),
    volt: hex(0x6408fa),
    focus: hex(0x6408fa),
    error: hex(0xe5383b),
};

pub fn set_palette(ctx: &egui::Context, palette: Palette) {
    ctx.data_mut(|d| d.insert_temp(Id::unique("orbit-palette"), palette));
    let mut visuals = if palette.dark {
        egui::Visuals::dark()
    } else {
        egui::Visuals::light()
    };
    visuals.panel_fill = palette.bg;
    visuals.window_fill = palette.panel;
    visuals.extreme_bg_color = palette.bg;
    visuals.faint_bg_color = palette.subtle;
    visuals.override_text_color = Some(palette.text);
    visuals.selection.bg_fill = palette
        .green
        .gamma_multiply(if palette.dark { 0.35 } else { 0.6 });
    visuals.selection.stroke = Stroke::new(1.0, palette.text);
    visuals.text_edit_bg_color = Some(palette.bg);
    visuals.window_stroke = Stroke::new(1.0, palette.line);
    visuals.window_corner_radius = R_TILE.into();
    visuals.menu_corner_radius = 18.into();
    visuals.popup_shadow = egui::Shadow {
        offset: [0, 20],
        blur: 56,
        spread: 0,
        color: Color32::from_black_alpha(if palette.dark { 170 } else { 45 }),
    };
    for (state, fill) in [
        (&mut visuals.widgets.inactive, palette.active),
        (&mut visuals.widgets.hovered, palette.hover),
        (&mut visuals.widgets.active, palette.active),
        (&mut visuals.widgets.open, palette.hover),
    ] {
        state.bg_fill = fill;
        state.weak_bg_fill = fill;
        state.corner_radius = R_ITEM.into();
        state.bg_stroke = Stroke::NONE;
        state.fg_stroke = Stroke::new(1.0, palette.text);
        state.expansion = 0.0;
    }
    visuals.widgets.noninteractive.bg_stroke = Stroke::new(1.0, palette.line);
    visuals.widgets.noninteractive.fg_stroke = Stroke::new(1.0, palette.text);
    ctx.set_visuals(visuals);
}
pub fn pal(ctx: &egui::Context) -> Palette {
    ctx.data(|d| d.get_temp(Id::unique("orbit-palette")))
        .unwrap_or(DARK)
}

pub fn install_fonts(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    let mut add = |name: &str, bytes: &'static [u8]| {
        fonts
            .font_data
            .insert(name.into(), Arc::new(FontData::from_static(bytes)));
    };
    add(
        "geist",
        include_bytes!("../../assets/fonts/Geist-Regular.ttf"),
    );
    add(
        "geist-medium",
        include_bytes!("../../assets/fonts/Geist-Medium.ttf"),
    );
    add(
        "geist-semibold",
        include_bytes!("../../assets/fonts/Geist-SemiBold.ttf"),
    );
    add(
        "geist-mono",
        include_bytes!("../../assets/fonts/GeistMono-Regular.ttf"),
    );
    let fallback: Vec<String> = fonts
        .families
        .get(&FontFamily::Proportional)
        .cloned()
        .unwrap_or_default();
    let family = |first: &str| {
        let mut list = vec![first.to_string()];
        list.extend(fallback.iter().cloned());
        list
    };
    fonts
        .families
        .insert(FontFamily::Proportional, family("geist-medium"));
    // The system sets body text at 500 and labels in bold, so every weight sits one step heavier.
    fonts
        .families
        .insert(FontFamily::Name("light".into()), family("geist"));
    fonts
        .families
        .insert(FontFamily::Name("medium".into()), family("geist-semibold"));
    fonts.families.insert(
        FontFamily::Name("semibold".into()),
        family("geist-semibold"),
    );
    let mut mono = vec!["geist-mono".to_string()];
    mono.extend(fallback.iter().cloned());
    fonts.families.insert(FontFamily::Monospace, mono);
    ctx.set_fonts(fonts);
    ctx.global_style_mut(|style| {
        style.spacing.item_spacing = egui::vec2(8.0, 8.0);
        style.spacing.button_padding = egui::vec2(14.0, 8.0);
        style.spacing.interact_size.y = 30.0;
        style.interaction.selectable_labels = false;
        style
            .text_styles
            .insert(egui::TextStyle::Body, FontId::proportional(13.0));
        style
            .text_styles
            .insert(egui::TextStyle::Button, FontId::proportional(12.0));
        style
            .text_styles
            .insert(egui::TextStyle::Small, FontId::proportional(11.0));
        style
            .text_styles
            .insert(egui::TextStyle::Monospace, FontId::monospace(11.0));
        style.text_styles.insert(
            egui::TextStyle::Heading,
            FontId::new(27.0, FontFamily::Name("semibold".into())),
        );
    });
}

#[derive(Clone, Copy)]
pub enum Weight {
    Regular,
    Medium,
    Semibold,
    Mono,
}
pub fn font(size: f32, weight: Weight) -> FontId {
    FontId::new(
        size,
        match weight {
            Weight::Regular => FontFamily::Proportional,
            Weight::Medium => FontFamily::Name("medium".into()),
            Weight::Semibold => FontFamily::Name("semibold".into()),
            Weight::Mono => FontFamily::Monospace,
        },
    )
}
pub fn text(s: impl Into<String>, size: f32, weight: Weight, color: Color32) -> RichText {
    RichText::new(s.into())
        .font(font(size, weight))
        .color(color)
}
/// The system's field label: small, bold, uppercase and tracked.
pub fn caps(s: &str, color: Color32) -> RichText {
    RichText::new(s.to_uppercase())
        .font(font(10.0, Weight::Medium))
        .extra_letter_spacing(0.8)
        .color(color)
}
/// A filled pill with centered content colour, e.g. a status chip. Returns its rect.
pub fn chip(ui: &mut Ui, label: &str, fill: Color32, fg: Color32, dot: bool) -> Rect {
    let galley = ui
        .painter()
        .layout_no_wrap(label.to_string(), font(11.0, Weight::Medium), fg);
    let lead = if dot { 12.0 } else { 0.0 };
    let (rect, _) = ui.allocate_exact_size(
        egui::vec2(galley.size().x + 22.0 + lead, 24.0),
        egui::Sense::hover(),
    );
    ui.painter().rect_filled(rect, 12, fill);
    if dot {
        ui.painter()
            .circle_filled(egui::pos2(rect.left() + 13.0, rect.center().y), 3.0, fg);
    }
    ui.painter().galley(
        egui::pos2(
            rect.left() + 11.0 + lead,
            rect.center().y - galley.size().y / 2.0,
        ),
        galley,
        fg,
    );
    rect
}

// ---------- Icons ----------

/// Paints a line icon tinted with `color` into `rect`.
pub fn paint_icon(ui: &Ui, rect: Rect, name: &str, color: Color32) {
    let name = if icon_paths::exists(name) {
        name
    } else {
        "app"
    };
    let uri = format!("bytes://orbit-icon/{name}.svg");
    egui::Image::from_bytes(uri, icon_paths::svg(name).into_bytes())
        .tint(color)
        .paint_at(ui, rect);
}
/// Allocates and paints an icon inline.
pub fn icon(ui: &mut Ui, name: &str, size: f32, color: Color32) -> egui::Response {
    let (rect, response) = ui.allocate_exact_size(egui::vec2(size, size), egui::Sense::hover());
    paint_icon(ui, rect, name, color);
    response
}
