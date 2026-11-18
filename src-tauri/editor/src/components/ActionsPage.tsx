import { filterActions } from '../editor-state';
import { Button, Header, Icon, Panel } from './Facet';
import { ActionList } from './ActionList';
import type { PageProps } from './types';

export function ActionsPage({ state, ui, onSearch, onSelect, onCommand }: PageProps) {
  const entries = filterActions(state.settings, ui.search);
  return <><Header title="Усі дії" note="Знайдіть і налаштуйте дію в будь-якому меню."><Button glyph="plus" data-action="add-action" data-focus="add-action" onClick={() => onCommand('add-action')}>Додати дію</Button></Header><div className="mb-4 flex items-center gap-4"><label className="flex min-h-9 w-full max-w-md items-center gap-2.5 rounded-md border border-input px-3 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 [&_.glyph]:size-4 [&_.glyph]:text-muted-foreground"><Icon name="search" /><input className="w-full min-w-0 border-0 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground" type="search" id="action-search" data-focus="action-search" placeholder="Пошук дій…" aria-label="Пошук дій" value={ui.search} onChange={(event) => onSearch(event.target.value)} /></label><span className="font-mono text-xs text-muted-foreground" id="result-count" role="status">{entries.length} дій</span></div><Panel className="pb-2" id="library-results" aria-label="Усі дії"><ActionList entries={entries} selected={ui.selected} library onSelect={onSelect} onDelete={(id) => onCommand('delete-action', id)} onCommand={onCommand} /></Panel></>;
}
