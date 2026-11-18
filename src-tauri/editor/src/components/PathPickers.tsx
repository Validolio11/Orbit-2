import { Check, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage, invoke } from '../api';
import { cn } from '../lib/utils';
import { Icon } from './icons';
import { Input } from './ui/input';
import { gridKeys, TILE, TILE_GRID } from './tiles';

export type FolderEntry = { group: string; name: string; path: string; icon: string };
export type ScriptEntry = { name: string; path: string; extension: string; folder: string };
type Load<T> = { items: T[]; loading: boolean; error: string | null };

const FOLDER_GROUPS: [string, string][] = [['quick', 'Швидкий доступ'], ['known', 'Стандартні папки'], ['drive', 'Диски']];
/** Windows paths compare without case and without a trailing separator. */
export const samePath = (a: string, b: string) => !!a.trim() && a.trim().replace(/[\\/]+$/u, '').toLowerCase() === b.trim().replace(/[\\/]+$/u, '').toLowerCase();

/** Native lists are optional: an older or failing backend falls back to manual entry instead of breaking the dialog. */
function useNative<T>(read: () => Promise<T[] | null | undefined>, deps: unknown[] = []): Load<T> {
  const [state, setState] = useState<Load<T>>({ items: [], loading: true, error: null });
  useEffect(() => {
    let current = true;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    read().then((items) => { if (current) setState({ items: Array.isArray(items) ? items : [], loading: false, error: null }); })
      .catch((error) => { if (current) setState({ items: [], loading: false, error: errorMessage(error) }); });
    return () => { current = false; };
  }, deps);
  return state;
}

function Status({ load, empty }: { load: Load<unknown>; empty: string }) {
  if (load.items.length) return null;
  const text = load.loading ? 'Завантаження…' : load.error ? `Не вдалося прочитати список: ${load.error} Вкажіть шлях вручну.` : empty;
  return <p role={load.error ? 'alert' : 'status'} className="py-3 text-xs text-muted-foreground">{text}</p>;
}

function PathTile({ data, label, detail, icon, title, chosen, tabStop, onPick }: {
  data: Record<string, string>; label: string; detail?: string; icon: string; title: string; chosen: boolean; tabStop: boolean; onPick: () => void;
}) {
  // Folder tiles carry one label and match the Windows-command tiles; script tiles add a detail line.
  return <li className="contents"><button type="button" data-tile {...data} aria-current={chosen || undefined} title={title} tabIndex={tabStop ? 0 : -1}
    className={cn(TILE, detail ? 'h-[5.5rem] gap-1.5' : 'h-[4.5rem] gap-1.5 leading-tight')} onClick={onPick}>
    <Icon name={icon} className="size-6 flex-none text-muted-foreground" />
    <span className="line-clamp-2 w-full leading-tight break-words">{label}</span>
    {detail && <span className="w-full truncate text-[0.6875rem] leading-none font-normal text-muted-foreground">{detail}</span>}
    {chosen && <Check className="absolute top-1.5 right-1.5 size-3.5 text-brand" aria-label="Вибрано" />}</button></li>;
}

export function FolderPicker({ selected, onPick }: { selected: string; onPick: (folder: FolderEntry) => void }) {
  const load = useNative<FolderEntry>(() => invoke('list_folders'));
  const groups = FOLDER_GROUPS.map(([id, title]) => ({ id, title, items: load.items.filter((folder) => folder.group === id) })).filter((group) => group.items.length);
  const known = new Set(FOLDER_GROUPS.map(([id]) => id));
  const other = load.items.filter((folder) => !known.has(folder.group));
  if (other.length) groups.push({ id: 'other', title: 'Інші', items: other });
  const ordered = groups.flatMap((group) => group.items);
  const stop = Math.max(0, ordered.findIndex((folder) => samePath(folder.path, selected)));
  return <div id="folder-tiles" role="group" aria-label="Папки" className="grid gap-3" onKeyDown={gridKeys()}>
    {groups.map((group) => <div key={group.id} className="grid gap-2">
      <h4 className="text-xs font-medium text-muted-foreground">{group.title}</h4>
      <ul aria-label={group.title} className={TILE_GRID}>{group.items.map((folder) => <PathTile key={folder.path} data={{ 'data-folder': folder.path }} label={folder.name} icon={folder.icon || 'folder'} title={folder.path}
        chosen={samePath(folder.path, selected)} tabStop={ordered[stop] === folder} onPick={() => onPick(folder)} />)}</ul></div>)}
    <Status load={load} empty="Стандартних папок не знайдено. Вкажіть шлях вручну." />
  </div>;
}

/** Scripts match by name, file extension or containing folder. */
export function filterScripts(scripts: ScriptEntry[], query: string) {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  return scripts.filter((script) => { const text = `${script.name} .${script.extension} ${script.folder}`.toLowerCase(); return words.every((word) => text.includes(word)); });
}

export function ScriptPicker({ selected, onPick }: { selected: string; onPick: (script: ScriptEntry) => void }) {
  const [python, setPython] = useState(true);
  const load = useNative<ScriptEntry>(() => invoke('list_scripts').then((view) => { setPython(view?.pythonAvailable !== false); return view?.scripts ?? []; }));
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => filterScripts(load.items, query), [load.items, query]);
  useEffect(() => { setActive(0); }, [query]);
  const chosen = shown.findIndex((script) => samePath(script.path, selected));
  const stop = query ? Math.min(active, shown.length - 1) : chosen >= 0 ? chosen : 0;
  const focusTile = (index: number) => list.current?.querySelectorAll<HTMLElement>('[data-tile]')[index]?.focus();
  // The search box keeps typing focus: Down enters the grid, Enter takes the first match.
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && shown.length) { event.preventDefault(); focusTile(Math.max(0, stop)); }
    else if (event.key === 'Enter' && shown[Math.max(0, stop)]) { event.preventDefault(); onPick(shown[Math.max(0, stop)]); }
  };
  const pickedPy = /\.py$/iu.test(selected.trim());
  return <div className="grid gap-3">
    {load.items.length > 8 && <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input id="script-search" aria-label="Пошук скриптів" type="search" className="h-10 pl-9" value={query} placeholder="Пошук за назвою, розширенням або папкою" autoComplete="off"
        onKeyDown={onSearchKey} onChange={(event) => setQuery(event.target.value)} /></div>}
    <ul id="script-tiles" ref={list} aria-label="Знайдені скрипти" className={cn(TILE_GRID, '-mr-2 max-h-[clamp(7rem,30vh,17rem)] overflow-y-auto pr-2')}
      onKeyDown={gridKeys((tile) => setActive(Number(tile.dataset.index)))}>
      {shown.map((script, index) => <PathTile key={script.path} data={{ 'data-script': script.path, 'data-index': String(index) }} label={script.name} detail={`.${script.extension} · ${script.folder}`} icon="script"
        title={script.path} chosen={samePath(script.path, selected)} tabStop={index === stop} onPick={() => onPick(script)} />)}
    </ul>
    {!shown.length && (load.items.length && query
      ? <p role="status" className="text-xs text-muted-foreground">Нічого не знайдено. Вкажіть шлях вручну.</p>
      : <Status load={load} empty="На робочому столі, у документах і завантаженнях немає скриптів .ps1, .py, .js або .cjs. Вкажіть шлях вручну." />)}
    {pickedPy && !python && <p id="python-missing" role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Icon name="info" className="size-3.5" />Python не знайдено: цей скрипт не запуститься, доки Python не встановлено.</p>}
  </div>;
}
