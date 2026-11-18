//! Shell icon adapter: egui textures are replaced with exact-physical-size PNG data URLs.
use crate::{
    model,
    platform::{IconImage, os},
    state::lock,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use std::{collections::HashMap, io::Cursor, sync::Mutex};

#[derive(Default)]
pub struct IconCache(Mutex<HashMap<(String, u32), Option<String>>>);

fn shell_path(target: &str) -> Option<String> {
    if target.starts_with("app-id:") {
        return model::validate_packaged_target(target, "")
            .ok()
            .map(|id| format!("shell:AppsFolder\\{id}"));
    }
    let lower = target.to_ascii_lowercase();
    (target.as_bytes().get(1) == Some(&b':')
        && (lower.ends_with(".exe") || lower.ends_with(".lnk")))
    .then(|| target.to_owned())
}
fn png(icon: IconImage, px: u32) -> Result<String, String> {
    let source = image::RgbaImage::from_raw(icon.width as u32, icon.height as u32, icon.rgba)
        .ok_or("Не вдалося прочитати значок.")?;
    // Resize premultiplied colours first, then encode PNG's straight alpha.
    let mut resized =
        image::imageops::resize(&source, px, px, image::imageops::FilterType::Lanczos3);
    for pixel in resized.pixels_mut() {
        let a = pixel[3] as u32;
        for channel in &mut pixel.0[..3] {
            *channel = if a == 0 {
                0
            } else {
                (((*channel as u32).min(a) * 255 + a / 2) / a) as u8
            };
        }
    }
    let mut bytes = Cursor::new(Vec::new());
    resized
        .write_to(&mut bytes, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(bytes.into_inner())
    ))
}
impl IconCache {
    pub fn get(&self, target: &str, physical_px: u32) -> Result<Option<String>, String> {
        let px = physical_px.clamp(8, 256);
        let key = (target.to_string(), px);
        if let Some(cached) = lock(&self.0).get(&key).cloned() {
            return Ok(cached);
        }
        let value = shell_path(target)
            .and_then(|path| os::app_icon(&path))
            .map(|image| png(image, px))
            .transpose()?;
        let mut cache = lock(&self.0);
        if cache.len() >= 400 {
            cache.clear();
        }
        cache.insert(key, value.clone());
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn png_has_requested_dimensions_and_straight_alpha() {
        let encoded = png(
            IconImage {
                width: 1,
                height: 1,
                rgba: vec![64, 32, 0, 128],
            },
            24,
        )
        .unwrap();
        let bytes = STANDARD
            .decode(encoded.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        let image = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(image.dimensions(), (24, 24));
        assert_eq!(image.get_pixel(0, 0).0, [128, 64, 0, 128]);
    }
    #[test]
    fn maps_only_supported_shell_icon_targets() {
        assert_eq!(
            shell_path("app-id:Microsoft.Photos_family!App").as_deref(),
            Some("shell:AppsFolder\\Microsoft.Photos_family!App")
        );
        assert!(shell_path("app-id:invalid").is_none());
        assert!(shell_path("https://example.com").is_none());
        assert!(shell_path("relative.exe").is_none());
    }
}
