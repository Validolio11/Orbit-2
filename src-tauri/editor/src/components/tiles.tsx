import type { KeyboardEvent, ReactNode } from 'react';

// One tile look for every picker: bare icon over the label, the chosen one marked by the accent border.
export const TILE = 'relative flex flex-col items-center justify-center gap-2 rounded-lg border px-1.5 text-center hyphens-auto text-xs font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=true]:border-brand aria-[current=true]:bg-brand/10 aria-[current=true]:text-foreground';
export const TILE_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2';

export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="flex min-h-8 items-center justify-between gap-2"><h3 className="text-sm font-semibold">{title}</h3><div className="flex gap-1">{children}</div></div>;
}

// The tile grids are auto-fill, so the step between rows is read from the laid-out columns.
export const columnsOf = (list: HTMLElement | null) => Math.max(1, (list ? getComputedStyle(list).gridTemplateColumns : '').split(' ').filter(Boolean).length);

const GRID_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
const tilesIn = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>('[data-tile]')].filter((tile) => !tile.matches(':disabled'));

/**
 * The tile a grid key leads to from `from`, or null at an edge. Up and Down go to the
 * nearest tile in the row above or below by on-screen position, so group headings
 * inside a grid do not shift columns; without layout (tests) they step by the column count.
 */
export function nextTile(list: HTMLElement, from: HTMLElement, key: string): HTMLElement | null {
  const tiles = tilesIn(list), index = tiles.indexOf(from);
  if (index < 0) return null;
  if (key === 'Home') return tiles[0] ?? null;
  if (key === 'End') return tiles.at(-1) ?? null;
  if (key === 'ArrowLeft') return tiles[index - 1] ?? null;
  if (key === 'ArrowRight') return tiles[index + 1] ?? null;
  const down = key === 'ArrowDown', box = from.getBoundingClientRect();
  if (!box.width && !box.height) { const step = columnsOf(list); return tiles[index + (down ? step : -step)] ?? null; }
  const rows = tiles.map((tile) => tile.getBoundingClientRect()).map((rect, i) => ({ rect, tile: tiles[i] }))
    .filter(({ rect }) => down ? rect.top > box.top + 1 : rect.top < box.top - 1);
  if (!rows.length) return null;
  const row = down ? Math.min(...rows.map(({ rect }) => rect.top)) : Math.max(...rows.map(({ rect }) => rect.top));
  const centre = box.left + box.width / 2;
  return rows.filter(({ rect }) => Math.abs(rect.top - row) < 2)
    .reduce((best, item) => Math.abs(item.rect.left + item.rect.width / 2 - centre) < Math.abs(best.rect.left + best.rect.width / 2 - centre) ? item : best).tile;
}

/** Arrow keys, Home and End move focus between the `[data-tile]` buttons of a grid; `onMove` sees the new tile. */
export function gridKeys(onMove?: (tile: HTMLElement) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (!GRID_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const from = (event.target as HTMLElement).closest<HTMLElement>('[data-tile]');
    if (!from || !event.currentTarget.contains(from)) return;
    event.preventDefault();
    const next = nextTile(event.currentTarget, from, event.key);
    if (!next) return;
    next.focus();
    next.scrollIntoView?.({ block: 'nearest' });
    onMove?.(next);
  };
}
