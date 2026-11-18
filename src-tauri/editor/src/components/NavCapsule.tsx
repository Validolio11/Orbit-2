import type { Page } from '../types';
import { Icon } from './Facet';

export function NavCapsule({ page, onPage }: { page: Page; onPage: (page: Page) => void }) {
  const pages = [['menus', 'Мої меню', 'wheel'], ['library', 'Усі дії', 'grid'], ['controls', 'Керування', 'mouse'], ['settings', 'Налаштування', 'settings']] as const;
  return <nav id="navigation" className="grid gap-0.5" aria-label="Робочий простір">{pages.map(([id, label, glyph]) =>
    <button key={id} type="button" className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm whitespace-nowrap text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-secondary aria-[current=page]:text-foreground [&_.glyph]:size-5" data-page={id} aria-current={page === id ? 'page' : undefined} onClick={() => onPage(id)}><Icon name={glyph} />{label}</button>)}</nav>;
}
