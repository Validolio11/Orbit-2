# Orbit 2: notes for developers and agents

## Design system: shadcn/ui (read before building any UI)

Every new screen, dialog or component in the editor (`src-tauri/editor`) uses **shadcn/ui, new-york style, zinc/neutral theme**. Source of truth: https://github.com/shadcn-ui/ui (`apps/v4/registry/new-york-v4/ui/*` for components, `apps/v4/app/globals.css` for tokens) and https://ui.shadcn.com/.

Rules:
- **Reuse before you invent.** Take the component from `src-tauri/editor/src/components/ui/` (Button, Input, Dialog, Select, Switch, Tabs, Slider, ...). If shadcn has a component we do not have yet, copy its official source from the repo above into `components/ui/` (keep its classes; adapt only imports such as `cn` from `../../lib/utils`).
- **Tokens, not literals.** Colours, radii and borders come from the shadcn token names (`bg-background`, `text-muted-foreground`, `border-input`, `ring-ring`, `rounded-md`/`rounded-lg`). They are defined in `src-tauri/ui/tokens.css` under shadcn's own names (`--background`, `--primary`, `--muted-foreground`, `--accent`, ...) and mapped one to one in `src-tauri/editor/src/index.css`. Both themes use the official shadcn values (dark and light). Do not add hex colours, legacy aliases or new radii in components.
- **One deliberate deviation:** the Orbit orange `--brand` / `--brand-foreground` (`text-brand`, `border-brand`, `bg-brand/10`; shadcn's own `--accent` is the neutral hover surface) marks the current choice, the wheel's selected sector and focus-adjacent emphasis. Kind colours (`--kind-app/folder/script/system/group`) are used only where a kind is shown (wheel, action rows). Everything else stays neutral.
- **Buttons:** primary action `variant="default"`, others `secondary`/`outline`/`ghost` (our default variant is `secondary`). Sizes `xs/sm/default/lg/icon*` as in shadcn.
- **Icons:** Phosphor glyphs in `components/icons.tsx` (`<Icon name=... />`); lucide-react only for shadcn internals (check, chevron, search, x). Do not draw or generate icons; follow the `concept-to-vector` workflow for new marks.
- **Pickers:** one tile look (`TILE` in `ActionDialog.tsx`): bare icon over a label, chosen tile marked with the accent border.
- Test with vitest (`npx vitest run`) and typecheck (`npx tsc --noEmit`) in `src-tauri/editor`; rebuild the bundle with `npm run build` before building the Tauri crate.

`docs/design.md` describes the retired egui interface and is kept only as history; this file wins when they disagree.
