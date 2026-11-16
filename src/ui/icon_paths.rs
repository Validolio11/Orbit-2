//! Line icons drawn from the same 24×24 SVG paths as the Electron interface.

pub fn markup(name: &str) -> Option<String> {
    let body = match name {
        "orbit" => {
            r##"<ellipse cx="12" cy="12" rx="9" ry="4.5" transform="rotate(-40 12 12)"/><circle cx="12" cy="12" r="3"/><circle cx="18.9" cy="6.2" r="1.3" fill="currentColor" stroke="none"/>"##
        }
        "wheel" => {
            r##"<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.25"/><path d="M12 3v5.75M12 15.25V21M3 12h5.75M15.25 12H21"/>"##
        }
        "grid" => {
            r##"<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>"##
        }
        "mouse" => {
            r##"<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M6 9h12m-6-7v7M4 8v5"/>"##
        }
        "settings" => return None, // generated gear
        "plus" => r##"<path d="M12 5v14M5 12h14"/>"##,
        "play" => r##"<path d="m9 5 11 7-11 7z"/>"##,
        "chevron" => r##"<path d="m9 5 7 7-7 7"/>"##,
        "down" => r##"<path d="m6 9 6 6 6-6"/>"##,
        "back" => r##"<path d="m14 5-7 7 7 7M7 12h14"/>"##,
        "folder" => r##"<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>"##,
        "app" => {
            r##"<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 8h18M7 5.5h.01m3 0h.01"/>"##
        }
        "script" => r##"<path d="m8 6-5 6 5 6m8-12 5 6-5 6m-3-15-2 18"/>"##,
        "system" => {
            r##"<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>"##
        }
        "group" => r##"<path d="M3 6h7l2 2h9v13H3zM3 3h7l2 2h9"/>"##,
        "browser" => {
            r##"<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>"##
        }
        "screenshot" => {
            r##"<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/><rect x="7" y="7" width="10" height="10" rx="1"/>"##
        }
        "volume" => {
            r##"<path d="M11 4 6 8H3v8h3l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>"##
        }
        "tasks" => {
            r##"<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 16v-4m5 4V7m5 9v-6"/>"##
        }
        "sun" => {
            r##"<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>"##
        }
        "moon" => r##"<path d="M21 13.5A9 9 0 0 1 10.5 3 9 9 0 1 0 21 13.5Z"/>"##,
        "check" => r##"<path d="m5 12 4 4L19 6"/>"##,
        "close" => r##"<path d="m6 6 12 12M6 18 18 6"/>"##,
        "minus" => r##"<path d="M5 12h14"/>"##,
        "edit" => r##"<path d="m15 5 4 4M4 20l4-1L21 6l-4-4L4 15z"/>"##,
        "copy" => {
            r##"<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 4V3H3v13h1"/>"##
        }
        "trash" => r##"<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>"##,
        "search" => r##"<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>"##,
        "refresh" => {
            r##"<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>"##
        }
        "drag" => {
            r##"<circle cx="9" cy="5" r=".8"/><circle cx="15" cy="5" r=".8"/><circle cx="9" cy="12" r=".8"/><circle cx="15" cy="12" r=".8"/><circle cx="9" cy="19" r=".8"/><circle cx="15" cy="19" r=".8"/>"##
        }
        "arrowUp" => r##"<path d="m6 10 6-6 6 6m-6-6v16"/>"##,
        "moveRoot" => {
            r##"<path d="M14 4h6v6m0-6-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>"##
        }
        "arrowDown" => r##"<path d="m6 14 6 6 6-6m-6 6V4"/>"##,
        "import" => r##"<path d="M3 15v6h18v-6M12 3v12m-5-5 5 5 5-5"/>"##,
        "export" => r##"<path d="M3 15v6h18v-6M12 15V3m-5 5 5-5 5 5"/>"##,
        "keyboard" => {
            r##"<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01m4 0h.01m4 0h.01m4 0h.01M6 12h.01m4 0h.01m4 0h.01m4 0h.01M7 16h10"/>"##
        }
        "info" => r##"<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>"##,
        "external" => r##"<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>"##,
        "pause" => r##"<path d="M8 5v14m8-14v14"/>"##,
        "volumeMute" => r##"<path d="M11 4 6 8H3v8h3l5 4zM16 9l5 6m0-6-5 6"/>"##,
        "volumeUp" => r##"<path d="M11 4 6 8H3v8h3l5 4zM15 12h6m-3-3v6"/>"##,
        "volumeDown" => r##"<path d="M11 4 6 8H3v8h3l5 4zM15 12h6"/>"##,
        "desktop" => {
            r##"<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M7 13h4"/>"##
        }
        "lock" => {
            r##"<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>"##
        }
        "playPause" => r##"<path d="m3 6 8 6-8 6zM16 6v12m4-12v12"/>"##,
        "trackPrev" => r##"<path d="M6 5v14m13-13-9 6 9 6z"/>"##,
        "trackNext" => r##"<path d="M18 5v14M5 6l9 6-9 6z"/>"##,
        "sliders" => {
            r##"<path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>"##
        }
        "run" => {
            r##"<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M7 12l3 2.5L7 17m5 0h4"/>"##
        }
        "windows" => {
            r##"<rect x="3" y="7" width="13" height="11" rx="1.5"/><path d="M8 7V4.5A1.5 1.5 0 0 1 9.5 3h10A1.5 1.5 0 0 1 21 4.5v9a1.5 1.5 0 0 1-1.5 1.5H16"/>"##
        }
        "clipboard" => {
            r##"<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6m-6 4h6m-6 4h3"/>"##
        }
        "emoji" => {
            r##"<circle cx="12" cy="12" r="9"/><path d="M8 14a5 5 0 0 0 8 0M9 9.5h.01m6 0h.01"/>"##
        }
        "mic" => {
            r##"<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3"/>"##
        }
        "bell" => r##"<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>"##,
        "bluetooth" => r##"<path d="m7 7 10 10-5 4V3l5 4L7 17"/>"##,
        "calculator" => {
            r##"<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8v3H8zM8 14h.01m4 0h.01m4 0h.01M8 17.5h.01m4 0h.01m4 0h.01"/>"##
        }
        "notepad" => r##"<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 11h7m-7 3h7m-7 3h4"/>"##,
        "image" => {
            r##"<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>"##
        }
        "film" => {
            r##"<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4"/>"##
        }
        "music" => {
            r##"<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>"##
        }
        "home" => r##"<path d="M3 11 12 4l9 7v9H3z"/><path d="M10 20v-6h4v6"/>"##,
        "cloud" => r##"<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z"/>"##,
        "drive" => {
            r##"<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13 7.5 5h9L19 13M17 16.5h.01"/>"##
        }
        "briefcase" => {
            r##"<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12h18"/>"##
        }
        "palette" => {
            r##"<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 21 9.6C21 5.9 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>"##
        }
        "gamepad" => {
            r##"<path d="M7 8h10a4 4 0 0 1 4 4l.6 4.2a2 2 0 0 1-3.6 1.4L16 15H8l-2 2.6a2 2 0 0 1-3.6-1.4L3 12a4 4 0 0 1 4-4z"/><path d="M8 11v2m-1-1h2m6.5-.5h.01m2 1.5h.01"/>"##
        }
        "star" => {
            r##"<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>"##
        }
        "heart" => {
            r##"<path d="M12 20s-8-4.9-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.1-8 11-8 11z"/>"##
        }
        "bookmark" => r##"<path d="M6 3h12v18l-6-4-6 4z"/>"##,
        "users" => {
            r##"<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7m2 2.5a6.5 6.5 0 0 1 3.5 6"/>"##
        }
        "user" => r##"<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>"##,
        "calendar" => {
            r##"<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4"/>"##
        }
        "clock" => r##"<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>"##,
        "mail" => r##"<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>"##,
        "chat" => r##"<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8m-8 3h5"/>"##,
        "phone" => r##"<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>"##,
        "layers" => r##"<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5M3 17l9 5 9-5"/>"##,
        "cube" => {
            r##"<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>"##
        }
        "camera" => {
            r##"<path d="M3 8a2 2 0 0 1 2-2h2.5L9 4h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>"##
        }
        "video" => {
            r##"<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>"##
        }
        "tv" => {
            r##"<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 2 4 4 4-4M9 22h6"/>"##
        }
        "headphones" => {
            r##"<path d="M4 18v-6a8 8 0 0 1 16 0v6"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>"##
        }
        "trophy" => {
            r##"<path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4m8-4h3a3 3 0 0 1-3 4M12 14v4m-4 3h8l-1-3H9z"/>"##
        }
        "wifi" => {
            r##"<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>"##
        }
        "map" => r##"<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15m6-12v15"/>"##,
        "sparkles" => {
            r##"<path d="M11 3c.5 4 2 5.5 6 6-4 .5-5.5 2-6 6-.5-4-2-5.5-6-6 4-.5 5.5-2 6-6z"/><path d="M18.5 14c.2 1.6.8 2.3 2.5 2.5-1.7.2-2.3.9-2.5 2.5-.2-1.6-.8-2.3-2.5-2.5 1.7-.2 2.3-.9 2.5-2.5zM5.5 16c.2 1.2.6 1.7 1.8 1.8-1.2.2-1.6.6-1.8 1.8-.2-1.2-.6-1.6-1.8-1.8 1.2-.1 1.6-.6 1.8-1.8z"/>"##
        }
        "bot" => {
            r##"<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4M9 13h.01m6 0h.01M9.5 16.5h5M2 13v3m20-3v3"/><circle cx="12" cy="3.5" r=".8"/>"##
        }
        "cpu" => {
            r##"<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5" rx=".5"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>"##
        }
        "database" => {
            r##"<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>"##
        }
        "server" => {
            r##"<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6m-6 9h6"/>"##
        }
        "zap" => r##"<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>"##,
        "rocket" => {
            r##"<path d="M12 15 9 12c2-5.5 6-8.5 12-9-.5 6-3.5 10-9 12z"/><path d="M9 12H5l2-3h4.5M12 15v4l3-2v-4.5M7 17c-2 0-3 1.5-3 3 1.5 0 3-1 3-3z"/>"##
        }
        "shield" => {
            r##"<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9 12 2 2 4-4"/>"##
        }
        "key" => r##"<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3m-5-1 2 2"/>"##,
        "book" => {
            r##"<path d="M4 19V5a2 2 0 0 1 2-2h14v14H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14M8 7h8"/>"##
        }
        "graduation" => {
            r##"<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6"/>"##
        }
        "chart" => r##"<path d="M4 4v16h16"/><path d="m8 15 4-4 3 3 5-6"/>"##,
        "wallet" => {
            r##"<path d="M18 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6"/><path d="M16 14h.01"/>"##
        }
        "cart" => {
            r##"<path d="M3 4h2l2.5 11h11L21 8H6.5"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>"##
        }
        "box" => {
            r##"<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>"##
        }
        "printer" => {
            r##"<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>"##
        }
        "flask" => {
            r##"<path d="M9 3h6m-5 0v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10"/>"##
        }
        "leaf" => r##"<path d="M5 19C5 10 10 5 20 4c-1 10-6 15-15 15z"/><path d="m5 19 8-8"/>"##,
        "coffee" => {
            r##"<path d="M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3m4-3v3"/>"##
        }
        "gift" => {
            r##"<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8C11 5 7 3 6 5.5S9 8 12 8zm0 0c1-3 5-5 6-2.5S15 8 12 8z"/>"##
        }
        "tag" => r##"<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>"##,
        _ => return None,
    };
    Some(body.to_string())
}

/// The settings gear: one tooth repeated every 60 degrees.
fn gear() -> String {
    let point = |radius: f32, degrees: f32| {
        let a = degrees.to_radians();
        format!(
            "{:.3},{:.3}",
            12.0 + radius * a.cos(),
            12.0 + radius * a.sin()
        )
    };
    let mut outline = String::new();
    for index in 0..6 {
        let angle = -90.0 + index as f32 * 60.0;
        outline.push_str(&format!(
            "{}{} L{} L{} L{} A7.5 7.5 0 0 1 {} ",
            if index == 0 { "M" } else { "L" },
            point(7.5, angle - 22.0),
            point(10.0, angle - 11.0),
            point(10.0, angle + 11.0),
            point(7.5, angle + 22.0),
            point(7.5, angle + 38.0)
        ));
    }
    format!(r#"<path d="{}Z"/><circle cx="12" cy="12" r="3"/>"#, outline)
}

/// A complete SVG document in white, to be tinted when painted. Unknown names fall back to "app".
pub fn svg(name: &str) -> String {
    let body = if name == "settings" {
        gear()
    } else {
        markup(name).or_else(|| markup("app")).unwrap_or_default()
    };
    format!(r#"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">{body}</svg>"#)
        .replace("currentColor", "white")
}

pub fn exists(name: &str) -> bool {
    name == "settings" || markup(name).is_some()
}
