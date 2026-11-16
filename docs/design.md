# Orbit · approved direction

On 2026-11-15 the user asked to redesign Orbit 2 with the Jastics MB design system (local source: `Desktop/Design system/Jastics system/MB`, tokens in `src/index.css`, components in `src/design-system`). It replaces the earlier Vercel Geist direction. Where the system has no matching element, one is derived from its rules.

## Reference lock

Primary: Jastics MB — `src/index.css` (tokens), `core.tsx`, `forms.tsx`, `menus.tsx`, `overlays.tsx`.

- Colors: night `#090a0a` canvas, graphite `#1c1c1e` tiles, steel `#3a3a3c` filled controls, fog `#a1a1a6` secondary text, paper `#f4f4f2` text and primary fills. Pulse `#13f287` marks the enabled state and the main call to action, always with night content. Volt `#6408fa` is reserved for the onboarding tile; its glow `#8f5bff` is the focus ring. Signal `#ff4d4f` is for errors and destructive buttons. Vendor colors appear only inside program icons.
- Surfaces: filled tiles without borders. A hairline ring (white at 10%) appears only on night-on-night surfaces: fields, the preview stage, dialogs.
- Radii: the system's field 20 / tile 32 / capsule 40 steps scaled to desktop density as field 14 / tile 24 / dialog 28. Buttons, tabs, chips, toggles and the toast are full pills.
- Inversion marks selection: the current page, the open menu tab, the active segment and the selected wheel sector are paper with night content.
- Typography: the system asks for SF Pro Display or Inter at weight 500 with bold labels. Orbit keeps its bundled Geist files one step heavier (Medium for body, SemiBold for labels and titles); field labels are small uppercase tracked fog. Monospace stays for shortcuts and counters.
- Controls: pill buttons (paper primary, steel secondary, ghost, pulse accent, signal danger); toggle is pulse/steel with a spring knob; range is a pulse fill on a steel track with a ringed paper dot; search on the library page is the system's inverted search pill.
- Derived elements (not in the system): the radial wheel (graphite sectors, night "+" sector, paper selection, pulse drop outline), the mouse diagram, window chrome, and the light theme, which mirrors the dark one with paper as the canvas and white tiles.
- Motion: short functional transitions with the system's spring on the toggle knob; reduced-motion support.
- Command patterns: groups, explicit labels, Escape, keyboard operation and discoverable shortcuts, adapted to a pointer-first radial menu from the user's brief.
- Media: code-native SVG icons and wheel geometry; no bitmap imagery is needed.
- User correction: radial gutters must have equal physical width at the inner and outer arcs. Use 6 viewBox units with parallel offset edges; angular gaps alone are incorrect.
- App identity: extend the existing single tilted orbit glyph into a monochrome Windows icon. Editable `assets/orbit.svg` is the source; black rounded tile, white orbit, center dot and satellite. `scripts/build-icons.cjs` exports ICO sizes 16–256px, with stronger strokes at small sizes. No generated bitmap art is needed for this geometric mark.
- Windows integration: the same identity is embedded into the executable and assigned to both native windows and the tray. Use a dedicated Orbit AppUserModelID.
- Dropdowns: apply the existing Geist surface/border/text/hover/active tokens to both the closed control and its picker; 6px control corners, 8px picker corners, 4px option corners. Chromium customizable select keeps browser-managed keyboard behavior and top-layer positioning. Technical references: https://developer.chrome.com/blog/a-customizable-select and https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Customizable_select .
- Approved app discovery flow: search installed apps first, show actual program icons and versioned names, autofill target/name on explicit selection; name remains editable. File/URL fallbacks stay visible above the result popover. Advanced target/arguments use a collapsed disclosure. Preserve the 490×560 action-dialog frame and Geist tokens. Keyboard interaction follows https://www.w3.org/WAI/ARIA/apg/patterns/combobox/ .
- Reject: decorative gradients, glass surfaces, bordered boxes where a filled tile works, accents used as decoration (pulse and volt keep their single roles), marketing hero layout, fabricated usage statistics.
- Drag into groups: preserve the user's action-list layout. Drag the row body; editing, delete and reorder buttons retain their click behavior. An eligible group uses the existing active surface and a thin monochrome inset border; its subtitle changes to an explicit drop instruction. Invalid targets show a muted reason. No automatic group navigation while dragging. Source: user's annotated action-list screenshot and existing Geist selected/action rows.
- Move outward: nested action rows expose only the outward arrow glyph, retaining the full tooltip and accessible name. Moving stays in the current group for repeated moves and uses the existing save toast. Source: user's request to move Work/Adobe Program back to the main wheel and later remove the visible button label.
- Preview rearrangement: dragging an icon, label or sector changes sibling order. A six-pixel movement threshold preserves ordinary click navigation/editing. Fade the source and outline the destination using existing active/text tokens; a compact pointer-following label identifies the dragged item. Dropping on the center of a nested wheel moves the item exactly one level up. Root/full-parent centers show a muted reason and cannot accept the move. Keep live launcher behavior separate. Source: user's annotated sector and center-drop screenshots.
- Updates: extend the existing settings sections with installed version, live status, check/download/install buttons and a restrained monochrome progress bar. Keep the section DOM stable during progress so settings do not flicker. Source is the user's public GitHub repository; preserve the existing Geist border, type and action roles. Installation is explicit and communicates the restart before the click.
- Wheel size: extend the approved Geist settings rows with a monochrome range control, visible percentage, reset to 100% and the existing wheel preview command. Range 60–150% in 5% increments; preserve the editor's schematic preview and apply size to the actual invoked wheel. Keep keyboard focus after saving and fit the wheel to the monitor work area. Sources: existing appearance/settings rows, user request for circle size, existing preview interaction.

## Decision ledger

| Decision | Source | Role | Purpose |
|---|---|---|---|
| Night canvas with a mirrored light theme | Jastics MB tokens + user | Canvas and semantic tokens | Stable visual contrast |
| Paper primary action, pulse call to action | Jastics MB buttons | Primary actions only | Clear next action |
| Pill controls, 14px fields, 24px tiles | Jastics MB radii at desktop density | Surface hierarchy | One rounded language across editor and wheel |
| Sidebar, menu action list, editable detail dialog | User feature brief | Management UI | Fast configuration without hiding actions |
| Circular wheel and nested group navigation | User brief | Global overlay | Mouse-first Adobe launcher workflow |
| Release, hover, click activation settings | User hover brief + accidental activation concern | Execution behavior | User controls selection commitment |
| Global native mouse listener separate from renderer | Microsoft LowLevelMouseProc | Input service | Fast callback and deterministic cleanup |

## Scope

Native Windows desktop app in Rust (egui interface, Win32 services), local persistence, native XBUTTON1/XBUTTON2 listener. No account or cloud connection. Native side-button support must be verified on actual hardware, especially vendor-remapped buttons.
