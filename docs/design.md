# Orbit design system

Orbit is a Rust + Tauri app (HTML/CSS interface) with an ink/cream base, one orange accent and six pastel category tints. The editor and radial wheel share the same tokens, typography and controls in dark and light themes.

## Reference lock

Sources: `src/ui/theme.rs` (palette, `TINTS`, `kind_tint`, radii and fonts), `src/ui/widgets.rs` (controls), `src/ui/editor.rs` (pages), `src/ui/wheel.rs` (wheel), `src/ui/icon_paths.rs` and `assets/icons/map.json` (icons).

- Palette: dark canvas `#0e0e0f`, panels `#1a1a1c` and cream text `#f7f4ee`; light canvas `#f3eee3`, panels `#fffcf6` and ink text `#121212`. Orange (`#ff5f1f` dark, `#f2581b` light) is the single accent for the current choice, CTA and focus. Mint marks the on state; red is reserved for errors and destructive actions. Vendor colors stay inside program icons.
- Pastels: lilac `#d8c6ff`, lemon `#f2ec84`, mint `#6fe3a8`, sky `#aed8ff`, peach `#ffc9a6`, rose `#ffc2df`. Use them for kind chips, stat tiles and section header chips, with ink content on every pastel. Kind mapping: apps sky, folders lemon, scripts mint, system lilac, groups peach. Onboarding uses lilac.
- Surfaces and radii: filled tiles with restrained semantic hairlines where needed. The design rule is 14px fields and 28px tiles; the current `R_FIELD` token is 16px (`R_ITEM` is 14px). Buttons and search are pills; pill navigation sits in a floating capsule.
- Controls: orange CTA, neutral secondary, ghost and danger pill buttons; mint-on toggle with a spring knob; orange range on a neutral track; pill search and segmented control. Neutral primary buttons, open menu tabs and active segments retain theme-aware ink/cream inversion.
- Typography: bundled Geist Medium for body and SemiBold for headings. Titles 36px, sections 18px, body 12–14px, captions at least 11px. Field labels are uppercase and tracked; Geist Mono is used for shortcuts and counters.
- Icons: Phosphor Icons (MIT), vendored SVGs in `assets/icons`, with `LICENSE-phosphor.txt` and `map.json`. Glyphs use fill weight; controls use bold weight. Two custom glyphs were picked by the owner from Codex concepts and traced to vector: `orbit` (five petals around a dot, the brand mark and app icon) and `wheel` (six ring segments, the radial menu). Owner rule: do not generate icons or tokens; use existing packs. Marks that must be invented follow the concept-to-vector workflow: Codex concepts, owner picks, then the chosen concept is traced to vector.
- Wheel: rounded sector tiles with a maximum span of 64°. Show icons and labels through eight slots, icons only above eight; the hub shows the hovered action name. The selected sector is orange with ink content and a small pop; a hover-progress arc shows the launch delay. Groups have a pastel pip; hub dots show menu count and the current menu. Scroll switches menus; digits 1–9 launch the corresponding actions.
- Light theme parity: editor, wheel, fields, popups, focus and interaction states use the light palette with the same roles, geometry and behavior. Pastel tints and their ink content are shared across themes.
- Motion and commands: short functional transitions, a spring toggle knob and reduced-motion support. Keep explicit labels, groups, Escape, keyboard operation and discoverable shortcuts.
- User correction: radial gutters must have equal physical width at the inner and outer arcs. Use 6 viewBox units with parallel offset edges; angular gaps alone are incorrect.
- App identity: five rounded petals around a dot (owner-picked concept), cream on an ink rounded tile with the top petal in the orange accent. Editable `assets/orbit.svg` is the source; `assets/orbit.ico` and `assets/orbit-*.png` (16-256) are rendered from the same geometry.
- Windows integration: the same identity is embedded into the executable and assigned to both native windows and the tray. Use a dedicated Orbit AppUserModelID.
- Dropdowns: use Orbit surface, border, text, hover and active tokens for the closed field and popup. Use the field radius, 20px popup corners and 14px option corners; orange marks focus and the current option's check.
- Approved app discovery flow: search installed apps first, show actual program icons and versioned names, autofill target/name on explicit selection; name remains editable. File/URL fallbacks stay visible above the result popover. Advanced target/arguments use a collapsed disclosure. Preserve the 490×560 action-dialog frame and Orbit tokens. Keyboard interaction follows https://www.w3.org/WAI/ARIA/apg/patterns/combobox/ .
- Reject: decorative gradients, glass surfaces, bordered boxes where a filled tile works, orange used as decoration, marketing hero layout and fabricated usage statistics.
- Drag into groups: preserve the user's action-list layout. Drag the row body; editing, delete and reorder buttons retain their click behavior. An eligible group uses the active surface and a thin orange inset border; its subtitle changes to an explicit drop instruction. Invalid targets show a muted reason. No automatic group navigation while dragging. Source: user's annotated action-list screenshot and current action rows.
- Move outward: nested action rows expose only the outward arrow glyph, retaining the full tooltip and accessible name. Moving stays in the current group for repeated moves and uses the existing save toast. Source: user's request to move Work/Adobe Program back to the main wheel and later remove the visible button label.
- Preview rearrangement: dragging an icon, label or sector changes sibling order. A six-pixel movement threshold preserves ordinary click navigation/editing. Fade the source and outline the destination in orange on the active surface; a compact pointer-following label identifies the dragged item. Dropping on the center of a nested wheel moves the item exactly one level up. Root/full-parent centers show a muted reason and cannot accept the move. Keep live launcher behavior separate. Source: user's annotated sector and center-drop screenshots.
- Updates: settings show installed version, live status, check/download/install buttons and a mint progress bar on a neutral track. Keep the section layout stable during progress so settings do not flicker. Source is the user's public GitHub repository; preserve Orbit border, type and action roles. Installation is explicit and communicates the restart before the click.
- Wheel size: use the existing settings rows with an orange range control, visible percentage, reset to 100% and the wheel preview command. Range 60–150% in 5% increments; preserve the editor's schematic preview and apply size to the actual invoked wheel. Keep keyboard focus after saving and fit the wheel to the monitor work area. Sources: existing appearance/settings rows and user's circle-size request.

## Decision ledger

| Decision | Source | Role | Purpose |
|---|---|---|---|
| Ink/cream base with light theme parity | Orbit palette + user | Canvas and semantic tokens | Stable visual contrast |
| One orange accent; mint on state; six ink-on-pastel tints | Orbit palette and kind mapping | Choice, CTA, focus, state and categories | Consistent color roles |
| Pill controls, 14px field rule, 28px tiles | Orbit design rule; field token currently 16px | Surface hierarchy | Shared radii across editor and wheel |
| Floating capsule with pill navigation, menu action list, editable detail dialog | User feature brief | Management UI | Configuration with visible actions |
| Circular wheel and nested group navigation | User brief | Global overlay | Mouse-first Adobe launcher workflow |
| Release, hover, click activation settings | User hover brief + accidental activation concern | Execution behavior | User controls selection commitment |
| Global native mouse listener separate from renderer | Microsoft LowLevelMouseProc | Input service | Fast callback and deterministic cleanup |

## Scope

Native Windows desktop app in Rust (Tauri/WebView2 interface, Win32 services), local persistence, native XBUTTON1/XBUTTON2 listener. No account or cloud connection. Native side-button support must be verified on actual hardware, especially vendor-remapped buttons.
