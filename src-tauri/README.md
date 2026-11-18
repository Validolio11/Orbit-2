# Orbit Tauri migration — Stage 3, Part A editor

This independent Tauri 2 crate uses plain HTML, CSS and ES modules. Stages 1–2 provide the native core and wheel overlay; Stage 3 Part A adds the editor shell and four pages. No bundler or npm dependencies are required. Action dialogs, group editing and drag/reorder remain Part B.

## Design direction

- **Shape:** Facet cut corners apply to panels and controls through shared helpers: 6 px for controls, 10 px for fields and 16 px for large panels. Typed-action holders are hexagons. Wheel sectors use straight chords, small rounded corners and parallel six-unit gutters; hub corners follow sector seams (a hexagon handles fewer than three sectors).
- **Colour:** ink/cream canvas and text, quiet panel surfaces, one orange accent for action/selection/focus, mint for the on state and red for errors. Category tints only identify action kinds: sky apps, lemon folders, mint scripts, lilac system and peach groups. Dark/light values come from `src/ui/theme.rs`.
- **Type:** locally bundled Geist Medium for body and SemiBold for headings; Geist Mono for shortcuts and counters. The size ladder is 36, 18, 14 and 12 px.
- **Product:** the wheel leads the menu page, beside its real action list. One orange action-count tile anchors the stat strip; the trigger and activation panels stay quiet. Lists use hairline separators and an orange selected-row bar. No decorative colour, gradients, glass, eyebrow labels or repeated badge cards. The floating navigation and bottom status/theme controls share the Facet helpers.

## Frontend files

`ui/index.html`, `app.js` and `app.css` implement the editor. `pages/` holds menus, library, controls and settings; `components/` holds shared HTML controls and action rows. `editor-state.js` contains DOM-free selectors, filtering, formatting and serialized settings saves. The editor subscribes before fetching its initial snapshot, ignores older revisions, overlays pending edits and restores keyboard focus/scroll after rendering. Native events are drained through `take_events` so retained startup events and live delivery do not duplicate toasts. Notices remain dismissible until acknowledged.

`ui/wheel.html`, `wheel.js` and `wheel.css` provide the transparent overlay. `wheel-renderer.js` is shared by the overlay controller and the editor's read-only schematic; importing it does not register overlay handlers or open/launch anything. `wheel-geometry.js` contains DOM-independent geometry. `wheel-icons.js` bundles the vendored icon pack; its Phosphor license accompanies it. Program icons use `item_icon` PNG data URLs at integer physical dimensions and snapped positions, outside scaled SVG content. Typed-action holders use kind-coloured hexagons; missing program icons use a bare glyph. `ui/api.js` wraps the Tauri global API. The old `placeholder.js/css` are unused historical scaffold files. `tokens.css` shares palette, typography, orange focus, Facet and reduced-motion helpers. Fonts and license are bundled in `ui/fonts/`.

The wheel supports release/click/hover activation, the separate group hover timer, nested groups/back, foreground-program or dialog add slots, empty levels, digits 1–9, arrow/Enter/Backspace/Escape keys and scrolling between menus. Labels appear through eight sectors; crowded wheels show icons and the selected action name in the hub. Part A adds menu creation/switching, action selection/deletion with confirmation, a recursive searchable library, all egui controls, appearance and wheel behaviour, native JSON export/import, updater status/actions/progress and toasts. Settings persist through `save_settings`; admin uses the existing native task command. Import validates through the shared storage code and then saves through the same native state path. Close hides to tray; minimize and maximize keep their native meanings.

Part B hooks are explicitly disabled with Ukrainian tooltips: action add/edit dialogs, group editing/deletion, movement/reorder and move-out-of-group. The preview does not navigate into groups, launch or mutate actions. The wheel add-dialog event brings up the editor with a Part B notice; it does not pretend a dialog was opened. No GUI is launched during verification; visual appearance, Windows integration and real interactions require later manual verification.

## Native scaffold

`src/main.rs` includes `model`, `storage`, `launcher`, `catalog`, `updater`, `install` and `platform` directly from the existing `src/` using `#[path]`. No original source is copied or edited. `state.rs` replaces egui shared state with serializable IPC views; `icons.rs` converts premultiplied Shell RGBA into exact-size straight-alpha PNG data URLs. `wheel.rs` ports placement, open/close sessions, foreground discovery, outside-click handling and launch-error routing. Entire native wheel lifecycle operations run on the UI thread to keep open and close ordered.

`startup.rs` preserves CLI installation, uninstallation, hidden launch, admin handoff, `--quit`, `--updated`, and the early headless `--self-test`. The existing Win32 service supplies single instance, native tray, mouse hook, Ctrl+Space and Escape, so there is no duplicate Tauri tray or single-instance plugin. Closing the editor hides it to the tray. Both webviews are created at startup; the wheel starts hidden, transparent, borderless, shadowless, non-focusable and outside the taskbar. Stage 2 positions the hidden window using physical cursor/monitor work-area pixels, sends `wheel:open`, and shows only for the current session after `wheel_painted(session)` or its 120 ms fallback. The page acknowledges after two animation frames. Close hides the persistent window before clearing its page; stale acknowledgements cannot reveal a closed or superseded session. The protocol and borderless native styles are implemented, but absence of flash has not been visually verified.

IPC commands: `get_state`, `save_settings`, `catalog_search`, `refresh_catalog`, `item_icon`, `launch_action` (stored action ID), `open_wheel_preview`, `close_wheel`, `add_foreground`, `open_add_dialog`, `pick_file`, `pick_folder`, `list_folders`, `list_scripts`, `export_settings`, `import_settings`, `set_admin`, `check_update`, `download_update`, `install_update`, `take_events`, `window_command`. File dialogs use the dialog plugin from Rust. Events: `state:changed`, `catalog:changed`, `update:changed`, `app:event`, `wheel:open`, `wheel:close`, `wheel:release`. Recovery notices are also retained in the initial state.

Stage 2 adds session-checked `wheel_painted`, `wheel_close`, `wheel_navigate`, `wheel_switch_menu`, `wheel_launch`, `wheel_add_foreground` and `wheel_open_add_dialog`, plus `wheel:shown`. Native release events include physical cursor coordinates; snapshots retain them for startup subscription recovery. A wheel-only Win32 subclass filters `WM_STYLECHANGING` so Tauri's later show/hide/focusability updates cannot restore caption or thick-frame bits. The original window procedure is preserved and restored when the window is destroyed.

## Stage 3 Part A verification (2026-11-17)

Changed: `README.md`, `src/commands.rs`, `src/startup.rs`, `ui/index.html`, `ui/wheel.js`, `ui/wheel.test.mjs`. Native changes register the JSON import/export commands, retain the egui admin restart/error feedback and update the bundled-asset self-test for `app.js`.

Created: `ui/app.js`, `ui/app.css`, `ui/editor-state.js`, `ui/components/html.js`, `ui/components/action-list.js`, `ui/pages/menus.js`, `ui/pages/library.js`, `ui/pages/controls.js`, `ui/pages/settings.js`, `ui/wheel-renderer.js`, `ui/editor-state.test.mjs`, `ui/pages.test.mjs`, `ui/app.test.mjs`.

Use the Stage 2 Cargo environment and command-line registry arguments below. The registry URL is only the identity of the existing offline cache: no proxy is started and no Cargo configuration file is written. All builds/tests use `C:/Users/Ivan/AppData/Local/Temp/claude/orbit-tauri-target`. Frontend verification now includes nested modules:

```powershell
Get-ChildItem src-tauri/ui -Recurse -File | Where-Object { $_.Extension -in '.js', '.mjs' } | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { throw "Syntax check failed" } }
node --test src-tauri/ui/*.test.mjs
Get-ChildItem src-tauri/src/*.rs | ForEach-Object { rustfmt --edition 2024 --config skip_children=true --check $_.FullName }
```

Final results: `cargo build --manifest-path src-tauri/Cargo.toml` passed; `cargo test --manifest-path src-tauri/Cargo.toml` passed (25 passed, 0 failed, 1 ignored explicit fixture generator), both with the external target and offline arguments below. Recursive `node --check` passed for all 19 JS/MJS files; `node --test src-tauri/ui/*.test.mjs` passed (41 including the wheel controller parent/subtests); Rust formatting passed. Expected warnings remain for native APIs reserved for Part B and Node's automatic ES-module detection. No Cargo configuration or proxy was created or started.

Tests cover recursive library context/filtering, Ukrainian counts, real wheel-size and update percentages, control options, escaped user content, disabled Part B hooks, serialized saves/rollback/stale events and the overlay renderer extraction, including shared icon-consumer notifications. Fake-DOM controller tests exercise IPC, navigation, focus/selection/scroll restoration, updater controls, native window commands, retry, toasts and cleanup. Browser/native interaction remains unverified: no GUI, installed Orbit, screenshots, live hook/shortcut/tray, UAC/autostart changes, file pickers, launches or update network/download/install were exercised. Headless DOM tests cannot establish visual layout, real keyboard focus, WebView2 compositing/no-flash behaviour, Shell icon fidelity, DPI or multiple monitors. The root egui crate was not rebuilt or edited; pre-existing worktree edits are preserved. No commit or push.

## Stage 2 verification (2026-11-17)

Changed: `README.md`, `src/main.rs`, `src/startup.rs`, `src/commands.rs`, `src/wheel.rs`, `ui/wheel.html`.

Created: `src/wheel_geometry_fixture.rs`, `ui/wheel.js`, `ui/wheel.css`, `ui/wheel-geometry.js`, `ui/wheel-geometry.test.mjs`, `ui/wheel-geometry.fixture.json`, `ui/wheel.test.mjs`, `ui/wheel-icons.js`, `ui/LICENSE-phosphor.txt`.

The fixture was generated once by the explicit ignored Rust test, using the actual reused `model::geometry` functions. Ordinary Rust tests compare it without writing; Node checks the port against its f32 reference values, straight chords, equal-width gutters, hub alignment, rounded corners and hit classification. The additional Node controller tests use a small mocked DOM and Tauri bridge, with no browser or GUI.

The Stage 1 dependency cache works offline with its existing registry identity. Stage 2 started no proxy and wrote no Cargo configuration. Both Cargo commands use the requested external target directory. Reproduce from the worktree root:

```powershell
$env:CARGO_HOME = 'C:/Users/Ivan/AppData/Local/Temp/claude/orbit-cargo-home'
$env:CARGO_TARGET_DIR = 'C:/Users/Ivan/AppData/Local/Temp/claude/orbit-tauri-target'
$registryArgs = @('--offline', '--locked', '--config', "source.crates-io.replace-with='orbit-local-https-proxy'", '--config', "source.orbit-local-https-proxy.registry='sparse+http://127.0.0.1:18765/'")
cargo build --manifest-path src-tauri/Cargo.toml @registryArgs
cargo test --manifest-path src-tauri/Cargo.toml @registryArgs
# Explicit regeneration only; not needed for ordinary verification:
cargo test --manifest-path src-tauri/Cargo.toml @registryArgs generate_wheel_geometry_fixture -- --ignored
Get-ChildItem src-tauri/ui -File | Where-Object { $_.Extension -in '.js', '.mjs' } | ForEach-Object { node --check $_.FullName }
node --test src-tauri/ui/wheel-geometry.test.mjs src-tauri/ui/wheel.test.mjs
Get-ChildItem src-tauri/src/*.rs | ForEach-Object { rustfmt --edition 2024 --config skip_children=true --check $_.FullName }
```

Final results: Cargo build passed; Cargo tests passed (25 passed, 0 failed, 1 ignored explicit generator); all JavaScript syntax checks passed; Node tests passed (19 including the parent controller test and its subtests); Rust formatting passed. Cargo reports dead-code warnings for APIs reserved for the editor; Node reports automatic ES-module detection because the root package does not declare its module type.

Not verified: visual appearance or actual absence of flash, WebView2 runtime/compositing, live IPC, native hook/Ctrl+Space/Escape/tray operation, focus restoration, real Shell icons/program launches, DPI changes and multiple monitors. The headless controller tests exercise event ordering and coordinate math, not actual browser layout or native integration. The editor remains the Stage 1 placeholder; its add-dialog form is Stage 3. The root egui crate was not rebuilt; existing `src/`, asset and design edits were preserved unchanged. No GUI, installed Orbit, commit or push was launched.

## Stage 1 verification (2026-11-17)

Created files, all under `src-tauri/`:

- Crate/config: `Cargo.toml`, `Cargo.lock`, `build.rs`, `tauri.conf.json`, `capabilities/default.json`, `.gitignore`, `README.md`.
- Rust: `src/main.rs`, `src/startup.rs`, `src/state.rs`, `src/wheel.rs`, `src/commands.rs`, `src/icons.rs`.
- Frontend: `ui/index.html`, `ui/wheel.html`, `ui/api.js`, `ui/placeholder.js`, `ui/tokens.css`, `ui/placeholder.css`.
- Bundled fonts/license: `ui/fonts/Geist-Medium.ttf`, `ui/fonts/Geist-SemiBold.ttf`, `ui/fonts/GeistMono-Regular.ttf`, `ui/fonts/OFL.txt`.
- Tauri also generates ignored ACL/schema files under `gen/` during the build.

The environment's Cargo/curl Schannel failed HTTPS with `SEC_E_NO_CREDENTIALS`. A temporary loopback-only Cargo registry proxy uses Python HTTPS with normal certificate verification. Temporary Cargo home/cache and target are outside the repository; no global Cargo config is changed. The lockfile retains canonical crates.io source URLs. Successful verification uses:

```powershell
$env:CARGO_HOME = Join-Path $env:TEMP 'claude/orbit-cargo-home'
$env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'claude/orbit-tauri-target'
cargo build --manifest-path src-tauri/Cargo.toml --config "$env:TEMP/claude/orbit-cargo-proxy.toml"
cargo test --manifest-path src-tauri/Cargo.toml --config "$env:TEMP/claude/orbit-cargo-proxy.toml"
& "$env:CARGO_TARGET_DIR/debug/orbit-tauri.exe" --self-test
node --check src-tauri/ui/api.js
node --check src-tauri/ui/placeholder.js
```

Build: passed (dead-code warnings are expected for core APIs used by later stages). Tests: 20 passed, 0 failed, covering the reused model/catalog/storage/updater plus snapshot serialization, physical wheel placement/session resets, Shell target mapping, PNG dimensions/alpha and bundled headless self-test. Executable `--self-test`: exit 0. Both JavaScript syntax checks: passed. Rust formatting is checked with `rustfmt --edition 2024 --config skip_children=true --check` on only `src-tauri/src/*.rs`, so formatting never edits path-included legacy sources.

Not verified: GUI/layout, WebView2 runtime availability, live IPC delivery, real tray/single-instance/hook/shortcut operation, DPI/multi-monitor/native focus behavior, file dialogs, program launching, autostart/admin changes, installer/uninstaller, live update check/download/install, release packaging or non-Windows builds. The shared updater still downloads the existing release channel's executable; release switch-over belongs to the later approved stage. The egui root crate was not rebuilt. Existing worktree edits and root `target/` are preserved. No GUI, installed Orbit, commit or push was run.
