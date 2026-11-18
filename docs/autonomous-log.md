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
