import { filterActions } from '../editor-state';
import { Search } from 'lucide-react';
import { Button, Header, Panel } from './Facet';
import { Input } from './ui/input';
import { ActionList } from './ActionList';
import type { PageProps } from './types';

export function ActionsPage({ state, ui, onSearch, onSelect, onCommand }: PageProps) {
  const entries = filterActions(state.settings, ui.search);
  return <><Header title="Усі дії" note="Знайдіть і налаштуйте дію в будь-якому меню."><Button glyph="plus" data-action="add-action" data-focus="add-action" onClick={() => onCommand('add-action')}>Додати дію</Button></Header><div className="mb-4 flex items-center gap-4"><div className="relative w-full max-w-md"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" type="search" id="action-search" data-focus="action-search" placeholder="Пошук дій…" aria-label="Пошук дій" autoComplete="off" value={ui.search} onChange={(event) => onSearch(event.target.value)} /></div><span className="font-mono text-xs text-muted-foreground" id="result-count" role="status">{entries.length} дій</span></div><Panel className="pb-2" id="library-results" aria-label="Усі дії"><ActionList entries={entries} selected={ui.selected} library onSelect={onSelect} onDelete={(id) => onCommand('delete-action', id)} onCommand={onCommand} /></Panel></>;
}
