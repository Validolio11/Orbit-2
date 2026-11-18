> Цей журнал перевірок стосується версії на Electron (0.1.x).

# Orbit QA inventory

User-visible requirements and implementation checks:

- Geist: inspect dark/light main editor, wheel, dialog; no clipped text, overlaps or decorative color accents.
- Menu lifecycle: create, rename, duplicate (unique nested IDs), switch, delete; last menu retained.
- Action lifecycle: add/edit/delete programs, filesystem folders, scripts, Windows actions and groups; browse opens native picker; reorder changes wheel order.
- Nested groups: open/back in editor and global overlay, edit nested action, keyboard navigation and Escape.
- Activation: release, hover with configurable delay, click. No action executes merely from opening the overlay; Escape cancels pending timers.
- Side buttons: native helper install/readiness/shutdown for Mouse4 and Mouse5; actual physical device check remains user hardware validation.
- Settings: enabled state, both trigger buttons, themes (round trip), reduced motion, atomic JSON persistence, import/export dialogs.
- Window behavior: custom controls, tray and shortcut, overlay on current display; close cleans native helper on quit.
- Responsive: launch dimensions and minimum 1050×720; all action controls remain reachable.
- Off happy path: unknown app path shows actionable error; duplicated identifiers/oversized groups/invalid system commands rejected; pointer transition into group must not execute the child under the stationary cursor.

Method: pure core and radial math tests; native lifecycle script; Electron smoke; interactive Electron QA with isolated --e2e storage and executor disabled; separate native UI inspection and packaged launch.

Evidence and outcomes recorded after verification below.

## Verified 2026-11-01

- `npm test`: 11 tests pass. Covers schema/allowlist/IDs/limits, Windows argument escaping, monitor geometry, radial selection and constant-width gutters. Gutters are 6 viewBox units, with each edge offset by 3 units from the shared radial boundary at both radii.
- `scripts/test-native.ps1`: native self-test, actual hook install/readiness for button 4 and button 5, stdin shutdown and orphan-parent watchdog pass. This does not substitute for pressing a physical mouse button.
- `npm run test:ui`: pass. All five action types; menu create/rename/duplicate/delete; nested group add/back; order changes; persistence after reload; search/empty results; button/mode/delay changes; enabled and reduced-motion round trips; light/system/dark; overlay click and keyboard group navigation; Escape; JSON import/export and action deletion. Native picker destinations were substituted with a temporary test path; actual IPC and persistence were exercised.
- Portable `Orbit.exe --smoke-test`: pass. Main and overlay bridges/rendering plus native helper work from the packaged app. The native executable is unpacked outside app.asar, which is necessary for child-process spawning.
- Portable normal launch: `hookReady:true`, `hookError:null`, `shortcutRegistered:true`; userData is `%APPDATA%/Orbit`. A temporary action pointing at a nonexistent executable produced a visible main-window error and was then removed.
- Visual: dark and light main editor, nested Adobe wheel, action dialog and settings inspected. At launched 1260×862, the workspace is 814px high with scrollHeight814. At minimum 1050×722, both primary editor panels fit below 689px, with secondary convenience shortcuts reachable by scrolling. No horizontal overflow.
- Screenshot evidence: `docs/orbit-dark.png`, `docs/orbit-light.png`, `docs/orbit-wheel.png`, `docs/orbit-compact.png`. The final dark screenshot is from the portable app with its native module active.
- No observed primary-control clipping, overlap, unhandled renderer errors or unequal radial gutters in these inspected states.

Remaining hardware validation: press Mouse4/Mouse5 on the user's actual mouse, especially with vendor remapping software. Multi-monitor geometry was unit-tested with negative coordinates and restricted work areas; mixed-DPI behavior still benefits from testing on physical monitors at different scales.

## Application icon and Windows Settings correction

- App icon: editable SVG and reproducible PNG/ICO exports. ICO contains 16,20,24,32,40,48,64,128,256px frames for Windows DPI variants.
- PE resources were read from the rebuilt `Orbit.exe` using the packager's resedit library. All nine embedded image payloads exactly match `assets/orbit.ico`; the Electron icon is replaced in the executable itself.
- Both BrowserWindows use `assets/orbit.ico`; tray uses the same icon. Windows AppUserModelID is `com.creationsoft.orbit`.
- Packaged smoke passed with `iconLoaded:true`. Existing 11 tests and interactive UI script passed after the icon/label changes.
- The Settings outline had an asymmetric manually accumulated relative path. Replaced with six identical teeth rotated around the icon center, preserving the outline weight and theme color.
- Wheel labels now wrap to two lines with sector-aware widths instead of ellipsis. Isolated visual checks confirm the full «Параметри Windows» label fits in both editor and overlay.

## Dropdown styling

- Existing native select semantics are preserved with Chromium `appearance:base-select`; both trigger and picker now use Orbit theme tokens.
- Visual QA: dark controls page and light action-dialog Windows-command picker inspected (`docs/dropdown-dark.png`, `docs/dropdown-light.png`). Selected option, hover surface, checkmark, border, shadow and scroll area match the current theme.
- Actual ArrowUp+Enter selection persisted the changed activation mode in isolated testing. Escape closed the picker while preserving the action dialog; a second Escape closed the dialog.
- Existing UI checks passed. Fixed test-window selection to identify the editor explicitly, since the overlay can finish loading first.

## Dropdown placement and action-category transitions

- Pickers open downward in the top layer over dialog/footer content. CSS anchor positioning aligns the picker with its trigger; vertical auto-flipping is disabled. Height is capped to the available area below the trigger and long lists scroll.
- Actual Windows-command picker: trigger bottom534.5px, first option below it, picker height315.5px inside an862px viewport. Short two-option picker retains intrinsic height. Smaller560px viewport also clamps long content below the trigger without flipping.
- Action-category redraws reuse the existing backdrop, dialog and header; only form and footer content update. All five category transitions preserve dialog identity and draft name, emit no new entry-animation events and focus the selected category. Closing restores the original Add button focus.
- Existing UI suite passed after both changes. No user configuration was changed during isolated QA.

## Consistent action-dialog dimensions

- All five Add/Edit Action categories share a490×560px frame (height capped at90vh). Header/footer stay fixed; the form body can scroll on smaller viewports. Other dialogs retain their existing sizes.
- Verified identical dialog dimensions, top position and footer position across app/folder/script/system/group at1260×862 and1050×722. Category content caused no body scrollbar at the standard size.
- In the compact window the Windows picker still opens downward over the dialog and Escape preserves the parent dialog. Existing UI suite passed.

## Installed-app search and per-action deletion

- Windows catalog reads Start Menu shortcuts, registered App Paths and packaged app IDs, preserving separate versions and deduplicating equivalent launch targets. Read-only discovery on this PC found170 entries after deduplication, including8 Adobe matches. Cached queries completed in1ms in the backend probe; cold query2.86s. A bounded24h local cache stores names/launch metadata, without icon payloads.
- Displayed classic apps use their real Windows file icons; icons are loaded lazily and reused in the action list and wheel. Packaged apps use the generic fallback where a file icon is unavailable.
- Actual Illustrator2026 search was visually inspected. Search results form a keyboard-accessible combobox/popover with generation guards; stale query results cannot be selected, and dismissals cancel pending debounce callbacks.
- `npm test`:22 tests pass, including catalog validation, aliases, versions, cache, refresh/cancellation and app-ID validation. Existing full UI suite passes.
- `npm run test:search`: actual installed-app search, autofocus, keyboard choice without submission, automatic target/name, custom alias, persistence, empty search, Escape, file picker fallback, URL and per-action trash cancellation/confirmation pass. Tests use isolated settings and block application execution.
- Trash controls are now visible for every individual action as well as groups. Confirmation removes only the menu entry and updates the wheel.

## Outside-click cancellation

- Added persistent `closeOnOutsideClick`, defaulting to `true` for old and new configurations, under Settings → Wheel behavior. Renderer tests cover on/off persistence, inside-center clicks, outside-circle clicks inside the transparent square, and Escape in either mode.
- Global native observation handles left/right/middle button-down without consuming those events. Main process converts physical coordinates to DIP and cancels only when the click is outside the functional circle. Side-button capture remains separate; observer mode (button 0) supports manual wheel preview while side capture is paused.
- Normal, global and Escape cancellation share `closeWheel()` and its `onWheelClosed` broadcast, which clears renderer group/hover timers.
- 26 unit tests pass, including preference migration, opt-out, circle geometry on negative/scaled displays and global-event filtering. Native self-test verifies normal event emission/pass-through and observer side-button behavior. Lifecycle checks cover buttons 0/4/5 plus parent watchdog modes. Existing UI suite passes including the new preference checks. Packaged application smoke test also passes.

## Wheel size

- Appearance settings include a keyboard-accessible slider from 60% to 150%, a visible percentage, reset to 100% and preview. Input updates the readout immediately; committed changes persist automatically and restore slider focus.
- The invoked wheel scales as a whole, including labels, icons, center, borders and gutters. A separate scale wrapper preserves the existing entry animation. The editor preview remains schematic.
- `wheelSize` defaults to 520 for existing configurations. Validation accepts integers 312–780. Window geometry fits the monitor work area, including negative monitor origins. Each opening sends its actual mount size to the renderer; global and local outside-click cancellation use the displayed size.
- Unit suite: 29 tests pass, including validation, migration and scaled geometry. UI coverage includes minimum/maximum keyboard input, reset, reload persistence, monitor fitting, inside clicks and outside-circle cancellation at each size.
- Visually inspected dark wheel at 60% and 150%; captures: `output/playwright/wheel-size-60.png` and `output/playwright/wheel-size-150.png`.
- Full UI suite and packaged smoke test pass. Light appearance settings inspected at the minimum native window size (Windows/DPI rounded the requested 1050×720 to viewport 1052×722), without clipping. Capture: `output/playwright/wheel-size-settings-light.png`.
- Keyboard-only UI tests wait for entry animation and temporarily isolate unrelated shared-desktop pointer movements; the guard is removed in `finally`. Mouse and outside-click tests run without that guard.

## GitHub updates · 0.1.1

- Public source and release repository: `Validolio11/Orbit`. The runtime uses no GitHub credentials. Updates are explicit: check, download, install and restart. Current version comes from the packaged app.
- Stable version comparison, exact release asset naming, bounded HTTPS downloads and redirects, release SHA-256 verification, archive traversal/link checks, and product/version/platform markers protect the update path. The controller rejects concurrent operations and permits installation only in packaged normal mode.
- Windows helper prepares files before shutdown, confirms readiness, waits for a commit and main/native process exit, preserves the old directory, swaps the prepared directory, runs an isolated startup probe and restores the old version on failed startup. Settings in AppData are not moved.
- `npm test`: 37 tests pass. Update tests cover metadata, versions, unsafe endpoints, failed requests/retry, concurrency, corrupt downloads, progress/preparation, isolated-mode refusal, and helper/flush/quit ordering.
- `npm run test:updater`: real Windows fixtures verify preparation, bad checksum, traversal, wrong version, commit timeout, live-parent timeout, waiting for both processes, successful swap/health/restart/backup and failed-health rollback. Fixture settings retain their SHA-256 fingerprint.
- Existing full UI suite passes. `npm run test:updates` covers no update, available, progress without replacing settings DOM, ready/install action, install errors, network retry and fixed repository IPC. Dark ready and light error views were inspected; screenshots under `output/playwright/updates-*.png` are excluded from the repository.
- Directory replacement uses two renames and preserves a journal and backup. Recovery from sudden power loss between renames may require restoring the preserved `.Orbit-update-backup-*` directory next to the application. It is not a versioned-launcher design.
- GitHub Actions release run `41339126792` completed successfully and published `v0.1.1`. The same updater downloaded the public release ZIP, verified its GitHub SHA-256 digest and safely prepared the complete real bundle; the unapplied staging files were removed through scoped cleanup. No actual user installation was replaced by this probe.
- Packaged update UI tests pass. A live packaged UI check against the public feed reports `up-to-date` for `0.1.1`. `scripts/verify-release.cjs` repeats the public download/preparation check and actual UI feed check; `--ui-only` skips downloading.

## Drag actions into groups · 0.1.2

- Native row dragging moves an action to the end of a group's children, removes it from its previous parent and persists through the existing validated save IPC. Names, targets, arguments, icons, IDs, sibling order and nested children are preserved. Group rows display a drop instruction and monochrome border; unavailable targets display the reason. Edit, delete and reorder buttons retain their click behavior.
- Pure move tests cover regular/nested/cross-menu moves, immutable inputs, missing targets, cycles, full groups and the existing depth limit. `npm test`: 43 tests pass.
- `npm run test:drag` exercises real mouse dragging, repeated moves, reload persistence, nested wheel contents, no accidental dialog, ordinary editing, full/self/outside rejection, nested-group preservation and target highlight. Existing full UI suite passes when run separately from other mouse-driven sessions. Capture: `output/playwright/drag-group-target.png`.
- Packaged `0.1.2` passes the same real mouse drag scenario. The release retains the existing update feed and settings schema.

## Editor group navigation · 0.1.3

- Group icons, SVG sectors and action-list rows open the group's nested menu. Enter on a focused group row follows the same route. Ordinary actions retain their editor behavior; groups have a separate pencil button for editing. Existing center/back controls return to the parent.
- Existing full UI suite passes with actual mouse checks for icon/sector/row navigation, row keyboard activation, center/back navigation, group pencil editing and ordinary-action editing. The drag suite also passes with the revised group-row behavior. User settings schema is unchanged.
- The complete UI suite also passes against the packaged `0.1.3` executable (`npm run test:ui -- --packaged`).

## Move to main menu and clear program icons · 0.1.4

- Nested action rows include "На головне", moving an item directly to its own root menu while keeping the current group open for further moves. Filesystem paths, arguments, IDs, icons, sibling order and group subtrees are preserved. Full root menus reject the move before detaching the source. A fresh mouse click clears trailing drag-click suppression.
- Unit suite: 48 tests pass, including nested folder/group moves, correct containing menu, root no-op, capacity rejection and immutable inputs. Full UI suite and drag suite pass. Actual Work-folder tests verify moving to root, root wheel appearance, reload persistence and rejection without data loss at 12 root actions.
- Electron's small icon extraction produced 16×16 PNGs; large produced 48×48 on this PC. The main process now keeps the largest Electron representation and requests the original Windows Shell icon when needed, using `IShellItemImageFactory` with ICONONLY/BIGGERSIZEOK and no SCALEUP. Native extraction runs separately without an input hook, with a two-worker limit, bounded response and timeout; GDI/COM resources are released.
- Actual Me/Ae/Ps/Ai/Pr icons arrive through IPC as 256×256 PNGs (6.3–8.5k data URL characters), within both existing cache bounds. At 150% wheel scale and 150% DPI the display requires 57 physical pixels. `scripts/check-icons.cjs --dpi150` passes source-size/render checks; the actual wheel screenshot `output/playwright/icons-sharp-wheel-150-dpi150.png` was inspected for sharpness, colors and alpha. Five native lifecycle cases also pass.
- Packaged `0.1.4` passes `test:icons -- --packaged --dpi150` and `test:drag -- --packaged`, including move-to-root and capacity rejection.

## Preview sector rearrangement · 0.1.5

- Pointer dragging on preview icons, labels or SVG sectors reorders siblings by insertion at the target's original position. A movement threshold preserves ordinary clicks; source fading, destination outline and a floating icon/name show the gesture. The floating label stays above the pointer so the center's drop instruction remains readable.
- Dropping onto a nested center appends the source to the immediately enclosing collection, without jumping over levels or changing the current editor view. Root centers and full parent collections reject drops without data loss. Full-root shortcut buttons now show only their glyph, retaining the tooltip and accessible name.
- Pure unit suite: 55 tests pass, covering reorder direction/indices, sibling boundaries, immutable source data, one-level parent moves, capacity and subtree retention.
- Actual mouse scenario `scripts/check-wheel-drag.cjs` passes icon and exposed SVG drags, list/wheel/state order, persistence, group drag without navigation, center moves from depth two to one, empty-group behavior, root/full/outside/Escape cancellation and icon-only shortcut markup. The global launcher is checked separately and remains non-editable. Existing full UI suite also passes.
- Visual evidence: `output/playwright/wheel-drag-sector-target.png` and `output/playwright/wheel-drag-center-target.png`.
- Packaged `0.1.5` passes both `test:wheel-drag -- --packaged` and the existing `test:drag -- --packaged` scenarios.

## Group open mode · 0.1.6

- "Відкривати вкладки" adds a hover/click choice for groups. In click mode hovering only highlights a group; a left click opens it. Older configurations migrate to hover. Unit suite: 56 tests pass.
- The full UI suite currently stops at the keyboard overlay check (`[data-sector="adobe"].selected`); the same failure reproduces on 0.1.5 without this change.

## Updater package validation · 0.1.7

- Inside Electron the patched `fs` reports `resources/app.asar` as a directory, so the updater rejected every valid package with "Пакет Orbit неповний.". The updater now uses `original-fs` under Electron. A staged package with a real `app.asar` fails with the 0.1.6 updater and passes with the fix under `ELECTRON_RUN_AS_NODE`.
- Installs at 0.1.6 or older carry the faulty check and must install 0.1.7 manually once; later releases update automatically.
- `npm run verify:release` now prepares the public release inside Electron (`ELECTRON_RUN_AS_NODE`) and asserts that Electron's asar handling is active, matching the running app. Against the published `v0.1.7` it passes with the fixed updater and fails with "Пакет Orbit неповний." with the 0.1.6 updater.
- Old updaters also left `.Orbit-update-stage-*` folders holding a locked `resources/app.asar` next to the app after each failed attempt. The fixed updater removes its stage completely; leftovers are freed once the old Orbit process exits.

## Working in-app updates and installer · 0.1.8

- The install step never ran in the real app: Node starts `detached` children as DETACHED_PROCESS, and Windows PowerShell exits with code 0 without running its script then. Non-detached children sit in libuv's kill-on-close job and die with Orbit. Orbit now starts `Update.ps1 -Detach` normally; the script relaunches itself as a hidden grandchild (outside the job) and exits. The updater waits for that process's `ready.json` instead of failing on the launcher's exit.
- The relaunched helper used Orbit's working directory, which is the install folder, so moving that folder failed with "in use". The helper now runs from its own workspace. A failure before the old folder moves restarts the previous Orbit instead of leaving it closed.
- After a verified install only the latest `.Orbit-update-backup-*` is kept; older ones were never removed and added a full app copy per update.
- End-to-end: the current code packaged as 0.1.6 was installed with the installer, then updated through Налаштування → Перевірити оновлення → Завантажити → Установити й перезапустити to the published `v0.1.7`. The folder was swapped, the smoke check passed and Orbit restarted from the install folder as 0.1.7. Unit suite (56) and `npm run test:updater` pass.
- `installer/Setup.cs` builds `Orbit-Setup-<version>.exe` (`npm run installer`) with the release ZIP embedded. It installs per user to `%LOCALAPPDATA%\Programs\Orbit` (writable by the updater), stops running Orbit copies, swaps folders, adds Start menu and desktop shortcuts and an Apps entry with an uninstaller that keeps `%APPDATA%\Orbit`. `/silent`, `/nolaunch` and `/dir=` support tests. The release workflow builds it, installs it silently as a smoke test and uploads it.
- Installs at 0.1.7 or older need this installer once; 0.1.8 and later update in-app.

## Faster flows, wheel "+", app grid · 0.1.9

- Windows commands are picked from 25 icon tiles (5 themed rows) and take the tile's name; power actions are left out because hover activation could trigger them.
- Update leftovers (finished/abandoned work folders with ~150 MB archives, orphaned stages) are removed 30 s after start; an interrupted install is kept for recovery. "Запускати разом з Windows" (on by default) registers `--hidden`, verified in a packaged build: no window, hook running, Run entry present. The installer writes DisplayVersion and Orbit refreshes it.
- Editing flows: picking a program, double-clicking a Windows tile or choosing a file adds at once; several programs can be ticked and added together; a new group opens with Add focused; Explorer drops of programs, shortcuts, scripts and folders become actions; the preview wheel ends with a "+" sector.
- The real wheel ends with a "+" slot. The hook reports the foreground executable on the side-button press (and on a `foreground` stdin request for Ctrl+Space); the catalog maps it to its shortcut. Click, Enter or release adds it and keeps the wheel open; hover never does. Shell processes, Orbit itself and Store apps without a catalog entry are not offered; otherwise "+" opens the add dialog at the same level. `npm run test:wheel-add` covers hover, add, re-offer and fallback; the physical side button was not exercised.
- First run: Adobe only when installed, popular installed apps fill the main menu, a dismissible hint explains the side button. Tray: single click opens, menu adds "Додати дію…" and menu switching.
- The app tab is an inline tile grid filtered by search (no dropdown); Store apps get real icons via `shell:AppsFolder`, uninstall shortcuts are excluded. Enter before results refresh searches first; the advanced section is read from the DOM when picking.
- Unit 63, UI, search (3 consecutive runs), drag, wheel-drag, wheel-add, icons and updates suites pass. The keyboard UI check was fixed by installing its pointer guard before the wheel opens.

## Folder, script and group tabs · 0.1.10

- Папка: tiles for Quick Access folders (Shell.Application, ~140 ms), standard folders with Ukrainian names and own icons, and drives labelled as in "This PC". A click adds the folder under its own name; ticks add several; "Обрати папку…" adds at once; the manual path is under "Вказати шлях вручну" and an empty name comes from the folder. A picked folder is written into the form before submit, since submit re-reads it.
- Скрипт: .ps1/.py/.js/.cjs files from the desktop, Documents, Downloads and folders of existing script actions (two levels, bounded, newest first) as tiles with a type badge; filter, click-to-add named after the file, ticks, and "Обрати файл…". Arguments are under the advanced section, where a picked script only fills the form. .py tiles are marked when py.exe is missing; an empty result shows an "Обрати файл…" prompt.
- Група: name suggestions that also pick an icon, nine icons, and "Перенести в групу" moving ticked actions into the new group at the first one's place.
- Names Orbit filled in no longer carry over when the action type changes.
- `npm run test:wheel-add` covers the folder tile, the carry-over fix, script tiles (type, filter, add) and group creation with moved actions. Quick Access and drive labels are skipped in isolated tests; the query was run against the real Explorer.

## Review fixes, durable settings, startup log · 0.1.11

- unslop contract applied by hand to the Ukrainian UI copy (its scanners are English-only): 11 confirmed slogan/filler/contradiction spans repaired.
- ECC reviewers (security, JavaScript, silent-failure, C#, accessibility) ran read-only; about 35 findings were confirmed against the code and fixed: settings reset protection, reporting of failed in-app installs, no rollback on a failed post-update restart, dialog races and limits, py.exe by absolute path, no network paths in the script scan, non-blocking drive checks, mouse-hook exception guard and off-hook process lookup, installer registration order and self-delete, and WCAG fixes (aria-selected for picks, Space to tick, contrast, focus).
- Settings are flushed to disk before replacing settings.json and the previous good file is kept as settings.json.bak; an empty or damaged file is restored from it (tests/settings-file.test.cjs).
- startup.log records each start (version, autostart or manual, login-item state). On this PC the Run entry survived a simulated sign-out (WM_QUERYENDSESSION/WM_ENDSESSION) and the exact Run command started Orbit hidden with the hook and unchanged settings; a real sign-in at 11:17 did not launch it and is to be re-checked with the log.
- Unit 67, UI (twice), search, drag, wheel-drag, wheel-add, icons, updates and updater transaction suites pass; the installer was compiled, not run.

## Mouse diagram · 0.1.12

- The settings mouse diagram lit the lower side button for Mouse 5. Mouse 5 (forward) is now the upper side button and Mouse 4 (back) the lower one; `npm run test:ui` checks which button is lit for both choices.
- A report that Orbit did not react was checked on the user's PC: no window was elevated, Ctrl+Space and an injected Mouse 4 both opened the wheel. The PC has an ASUS ROG mouse with Armoury Crate, which can remap side buttons per profile.

## Settings saved into another app's copy · 0.1.13

- A wheel built on 2026-11-02 was missing the next day. That Orbit had been started from a Claude Desktop session, and Windows redirected its AppData writes into `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Orbit`; the Orbit started at sign-in read the real `%APPDATA%\Orbit`, which still held an older wheel. The design was restored with Import from the redirected copy.
- The redirected process reports no package identity (GetCurrentPackageFullName returns APPMODEL_ERROR_NO_PACKAGE), so Orbit now checks with a probe file instead; `explorer.exe <exe>` was confirmed to write to the real folder. On a redirected start Orbit restarts through Explorer, and a second redirected start within a minute shows a warning instead of looping (tests/redirect-check.test.cjs, and the check found the Claude copy when run from a session).
- Unit 70 pass. The restart through Explorer was not run in a packaged build.

## Start as administrator · 0.1.14

- Orbit had to be restarted as administrator by hand for the side button to work over elevated windows (UIPI blocks a non-elevated hook there). Settings now has «Запускати з правами адміністратора»: it creates the Task Scheduler task «Orbit (administrator)» with the highest run level after one UAC confirmation, and every later start (shortcut, sign-in, `--quit` from the installer) is handed to that task, so Orbit runs elevated without a prompt. Turning it off removes the task and restarts Orbit unelevated through Explorer.
- `IRegisteredTask.Run(param)` was confirmed to pass the start mode as `$(Arg0)` with a temporary test task, which was then deleted. The task only starts the Orbit.exe of the folder that registered it.
- The installer and uninstaller close an elevated Orbit with `Orbit.exe --quit`; a normal uninstall also removes the task.
- Unit 70 pass, smoke and `npm run test:ui` pass; the status check reported `available:true` in a mock installed folder layout. The elevated flow with a real UAC confirmation was not run in an installed build.

## Wheel above pinned windows · 0.1.15

- The wheel opened behind a Chrome window. The wheel is always-on-top but is shown without activation, so an always-on-top window activated after it (such as one pinned with PowerToys Always On Top, which runs on this PC) stayed above it. The wheel is now raised to the top of the always-on-top windows on every open, still without taking focus.
- `npm run test:wheel-add` pins and activates a second always-on-top window over a shown wheel, reopens the wheel and checks the window order with `GetWindow`: it fails without the fix ("below") and passes with it.
- Unit 70, UI, wheel-add and wheel-drag suites pass.

## App audit and group icons · 0.1.16

- Tray toggles, the tray menu switch and the first-run flag were written later through the save queue with a copy of the state taken at click time, so they could undo a save queued just before them. `patchState` now merges the change into the state current when its turn comes.
- Library search redraws only the list instead of the whole window; app search normalizes names once per catalog; script discovery stats a folder's files in parallel.
- Error toasts drop Electron's "Error invoking remote method" prefix; moving an action that was already removed no longer throws; stale renderer defaults are gone. Electron 45.2.3, Playwright 1.65.0.
- The group editor offers 63 icons instead of 9, ordered by theme. `npm run test:wheel-add` checks that every icon draws its own glyph.
- Unit 70, smoke, UI, search, drag, wheel-add, wheel-drag, icons and updates suites pass. One wheel-add run timed out on the "+" step and passed on rerun.
