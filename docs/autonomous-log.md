# Autonomous work log (branch `orbit2/autonomous-improve`)

Working rules for every block: re-read this log first; small verified steps; tests green before every push
(`npx tsc --noEmit`, `npx vitest run` in `src-tauri/editor`; `node --test ui/wheel.test.mjs ui/wheel-geometry.test.mjs`
and `cargo test` in `src-tauri`); screenshots stay out of git.

Owner feedback patterns to apply: tiles/buttons must not look too wide; elements need spacing and never touch;
the wheel forms a full ring even with few actions; shortcut digits sit in one consistent place; no visual noise
or decorative colour; icons, wheel and the whole app are rated separately.

How visuals are checked here: `npm run build` in `src-tauri/editor`, then a headless Chrome (puppeteer-core,
outside the repo) loads `src-tauri/dist/index.html` over a local HTTP server with a mocked `window.__TAURI__`
(same command shapes as `src/api.ts`), clicks through pages and dialogs in dark and light, and saves PNGs that are
reviewed by eye. This is Chromium on Linux, not WebView2 on Windows: fonts, DPI and native windows can differ.

## Block 1 — 2026-11-18: folder and script pickers

Changed
- Action dialog, Folder kind: tile picker fed by the existing `list_folders` command, grouped as Quick access,
  Standard folders (Desktop, Documents, Downloads, Pictures, Videos, Music, Home, OneDrive) and Drives. Manual path
  entry stays as a labelled field under the tiles, plus the native "Обрати папку…" button.
- Script kind: tile picker fed by `list_scripts` (.ps1 .py .js .cjs on Desktop, Documents, Downloads and folders that
  already hold script actions). Each tile shows name plus `.ext · folder`; a search box appears above 8 scripts;
  a quiet note appears when a .py script is chosen and Python was not found.
- Keyboard: all tile grids (kinds, apps, folders, scripts, Windows commands) now use one roving tab stop, arrows,
  Home and End (`components/tiles.tsx`, `nextTile`). Up/Down use on-screen rows, so group headings don't shift
  columns. Radio-style grids (kind, Windows command) select as the arrows move, like native radio buttons.
- Names: a name filled in by a pick follows later picks; a name the user typed is kept.
- Loading, empty and error states for both lists; a failed native list shows the reason and keeps manual entry.
- Tile padding px-2 → px-1.5 plus `hyphens-auto` so single long words ("Завантаження") no longer split mid-word.

Verified: tsc; vitest 33 (new: folder/script picking, keyboard movement, typed names kept, manual path, failing
folder list, `nextTile` with gapped rows, path comparison, script filter); screenshots of every kind in both themes.

Chose not to: add a search box to folders (lists are short); add new Rust commands (they already existed and are
tested on the Rust side); show script tiles in a nested scroll for folders (removed — one scroll area per dialog).

Lesson: CSS attribute selectors need escaped backslashes for Windows paths in tests (`tile()` helper).

## Block 2 — 2026-11-18: official Card, page headers, duplicate setting

Changed
- `components/ui/card.tsx` is now the official new-york-v4 Card (Card, CardHeader, CardTitle, CardDescription,
  CardAction, CardContent, CardFooter with `data-slot`), only the `cn` import adapted.
- Pages stay tidy by composing it: `Panel` = Card with `gap-0 py-0 overflow-hidden` (rows run edge to edge with
  their own `px-6` hairlines) and `role="region"` when labelled; `Section` = CardHeader + CardTitle (heading level 2)
  + CardDescription. Menu panels use CardHeader/CardTitle/CardAction; footers use CardFooter with `border-t`.
- Removed the "Попередній перегляд" label from the wheel card header (the footer already says it).
- Removed the "Поведінка колеса" section from Settings: its only row duplicated "Закривати меню натисканням поза
  ним" on the Controls page (same setting, same id). One place per setting, less noise.

Verified: tsc, vitest 33, node wheel tests 21, cargo test 22 (Linux, webkit2gtk dev libs installed for the check);
screenshots of all pages in both themes, 0/5/12 actions.

Lesson: overriding CardHeader's grid with `flex … items-center` (tailwind-merge drops `grid`) is the clean way to
centre a title against a button; `grid-rows-[auto_auto]` otherwise leaves an empty second row and an 8 px offset.

## Block 3 — 2026-11-18: library, dialogs, names

Changed
- Library kind badges are neutral `outline` badges: the kind colour already shows on the icon, a second coloured
  chip per row was decorative noise. `.kind-chip` CSS removed.
- Library search uses the shadcn `Input` with the same search-icon pattern as the dialog (was a hand-rolled field).
- Create-menu dialog: shadcn-style description, inline `role="alert"` error with `aria-invalid` instead of the
  browser's native validation bubble (which ignores the theme in WebView2), form spaced with `grid gap-4`.
- Action dialog names: switching kind clears a name that came from a pick (a script name no longer lands in a group);
  Windows commands suggest their own label on switch and on pick; typed names are always kept.
- Removed `hyphens-auto` from tiles again: it hyphenated "ро-бочий" where a plain break at the space reads better.
  The px-1.5 padding alone keeps "Завантаження" whole.

Verified: tsc; vitest 33 (create-menu error, kind-switch names); node 21; cargo 22; screenshots of every dialog.

Lesson: try a typographic fix on every grid that uses the shared tile, not just the one that prompted it.

## Block 4 — 2026-11-18: wheel audit, command errors, export, tile alignment

Re-read this log first; applied "try a fix on every grid that uses the shared tile" (Block 3 lesson).

Changed
- Wheel: no code change. Screenshots of 1–12 actions × dark/light × idle / keyboard selection / mouse hover without
  the add slot, reviewed as contact sheets and zoomed crops. Full ring at every count (one action = one ring with a
  single seam), digits on one radius between hub and icon (1–9, then Q W E for 10–12), labels hidden from 8 actions
  on, group pip clear of neighbours, hub text and menu dots centred, selected sector readable in both themes.
- `errorMessage()` in `api.ts`: command failures become plain Ukrainian text. Rust rejects with strings (kept),
  JS `Error`s lost their English "Error:" prefix, `{ message }` objects are read, empty failures get a sentence.
  Used by toasts, the load-error screen, the action dialog and the path pickers (replaced a local helper there).
- Installed-app picker: a rejected `catalog_search` now says the list could not be read instead of "nothing found".
- `storage::export` no longer writes `unwrap_or_default()` (an empty file) on a serialization error; it writes and
  syncs a sibling temp file and renames it over the target, removing the temp on failure, so a failed export never
  truncates an older one.
- Tiles: labels reserve two lines (`TILE_LABEL`), script tiles reserve two name lines plus the detail line, so
  icons line up across a row in the app, folder, script and Windows-command grids (a wrapped label used to lift its
  icon ~8 px). Folder/script icons are size-5 like the Windows-command tiles to keep 8 px padding.

Verified: tsc; vitest 38 (new: `api.test.ts` error cases, catalog failure, no "Error:" on the load screen); node
wheel tests 21; cargo test 24 (new: export→import round trip with no leftover files; import rejects empty, array,
wrong version, non-JSON, oversized and missing files); cargo check; screenshots of all pages and dialogs, both themes.
No settings format change in this block, so no new old-settings fixture was needed (`reads_the_electron_settings_format`
and the backup-recovery test still cover old files).

Chose not to:
- Hide "Скинути до 100%" at the default size: disabled is the shadcn pattern, and a button that vanishes on click
  drops keyboard focus.
- Remove the sidebar theme switch even though Settings also has Theme: it is a quick toggle the owner may use daily;
  flagged below for the owner instead of deciding alone.
- Truncate long tile names to one line: "Локальний диск (C:)" would lose its drive letter.
- Add the "Клавіші" / "Текст" kinds: out of scope until a human has confirmed the current work on Windows.

Lesson: when a fixed-height tile centres its content, any wrapping label moves the icon; reserve the label's
maximum height instead of centring variable content.

## Block 5 — 2026-11-18: one theme control, neutral count, spacing, accessibility

Owner instruction this block: work alone until 2026-11-19 and make every decision without asking. Applied: the
open question from Block 4 (sidebar theme switch) is decided here, not left to the owner.

Changed
- Decided: removed the sidebar theme switch. Theme lives only in Settings (one place per setting, as in Block 2).
  `ThemeControl`/`Segmented` lost the unused compact mode. Reversible in one line; settings untouched.
- The "N дій" count on the menus page is neutral text: brand orange is reserved for the current choice.
- Folder/script path field moved out of the picker section, so every form field in the action dialog is 20 px apart
  (it sat 12 px under the tiles).
- axe-core audit (outside the repo, in the screenshot harness) of every page and dialog in both themes:
  dialogs had no accessible name (custom `DialogTitle` ids broke Radix's `aria-labelledby`); menu tabs pointed
  `aria-controls` at panels that never rendered (now one official `TabsContent`, inactive tabs drop the attribute;
  `Tabs`/`TabsContent` copied from new-york-v4); our own `text-muted-foreground/70` dimming failed contrast (back to
  the token). Wheel overlay: shortcut digits `aria-hidden` + `aria-keyshortcuts` on the sector; the non-interactive
  hub and empty target no longer carry a label or tab stop.

Verified: tsc; vitest 39 (new: one theme control; dialogs named and tabs referencing existing panels); node 21;
cargo test 24 (no Rust change this block); axe re-run — editor clean except shadcn's own light-theme pairs; wheel clean
except an empty menu (0 actions, add slot off) and an axe SVG-text quirk on some sector names; screenshots both themes.

Chose not to:
- Change tokens for the 4.2–4.34:1 light pairs (`muted-foreground` on `secondary`/`muted`: kbd, selected row,
  segmented control). They are shadcn's official values and CLAUDE.md forbids custom colours.
- Rebuild the empty wheel (0 actions) as a one-sector ring with the add slot: it changes the JS/Rust hit-test
  contract and fixture, the state is rare, and only Windows can confirm it. The floating "Додайте першу дію" label stays.
- Remove the empty-state caption under the editor's wheel preview: it is the wheel renderer's own empty state.

Lesson: an automated audit (axe) finds structural problems screenshots never show; run it with every visual pass.

## Final summary — 2026-11-18

Branch `orbit2/autonomous-improve`, all gates green at the last push: `npx tsc --noEmit`, `npx vitest run` (38),
`node --test ui/wheel.test.mjs ui/wheel-geometry.test.mjs` (21), `cargo test` (24) and `cargo check` for the Tauri crate.
`main` untouched, no tags, releases or force-pushes; a draft PR is left unmerged for review.

Done
- Folder picker (quick access, standard folders, drives) and script discovery (.ps1 .py .js .cjs) as tiles fed by the
  Rust commands, manual path entry kept, native pickers kept.
- One keyboard model for every tile grid (roving tab stop, arrows, Home/End); radio-style grids select as you move.
- Official new-york-v4 `Card`; pages composed from it; duplicate "close on outside click" setting removed.
- Quieter library rows (neutral badges), shadcn search inputs, themed inline validation in the create-menu dialog.
- Name handling: picked names follow later picks, typed names are always kept, kind switches clear picked names.
- Loading / empty / error states for every native list; readable error text at the command boundary; safer export;
  import validation covered by tests.
- Tile icons aligned regardless of label length.
- Wheel audited at 1–12 actions in both themes; no overlaps found.

Verified only here (Linux, headless Chromium with a mocked `window.__TAURI__`, Rust tests on Linux)
- Layout, spacing, states and keyboard behaviour of the editor bundle; wheel rendering of `wheel.html`; Rust logic.

Needs a human on Windows (cannot be checked from the cloud)
- WebView2 rendering: Segoe/real fonts, DPI scaling at 125–200 %, the `2lh` tile labels (Chromium 109+, fine on
  evergreen WebView2), native window chrome.
- Real data in the pickers: the user's Quick access folders, OneDrive, drives, scripts on Desktop/Documents/Downloads,
  Python detection, real .exe icons in the app picker and action list.
- Mouse hook, side buttons, Ctrl+Space, wheel opening over other windows, admin mode, launching folders/scripts.
- Export/import through the native save/open dialogs, including replacing an existing export file.
- That the owner's existing `%APPDATA%\Orbit\settings.json` loads unchanged (no format change was made on this branch).

Recommended next
1. Owner: run the branch build on Windows, rate icons, wheel and app separately, and note anything that looks wide,
   touching or noisy.
2. (Decided in Block 5: the sidebar theme switch was removed; Settings → Тема is the single place.)
3. If the picker tiles feel top-heavy with one-line labels, try a slightly shorter tile; keep the two-line reservation.
4. Only after that: "Клавіші" and "Текст" kinds, with optional fields and an old-settings fixture test.
