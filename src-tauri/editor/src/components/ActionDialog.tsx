import { Check, Search } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/utils';
import { invoke, listen } from '../api';
import { fileStem, KIND_NAMES, SYSTEM_ACTIONS } from '../editor-state';
import type { Action, ActionEntry, Kind } from '../types';
import { Icon } from './icons';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';

export type ActionDialogRequest = { mode: 'add' } | { mode: 'edit'; entry: ActionEntry };
type Fields = { kind: Kind; name: string; target: string; args: string };
const KINDS: Kind[] = ['app', 'folder', 'script', 'system', 'group'];
const TARGET_HINT: Record<Kind, string> = {
  app: 'C:\\…\\програма.exe або https://…', folder: 'Виберіть папку', script: 'Файл .ps1, .py, .js або .cjs', system: '', group: '',
};

function initial(request: ActionDialogRequest): Fields {
  if (request.mode === 'edit') { const { kind, name, target, args } = request.entry.action; return { kind, name, target, args }; }
  return { kind: 'app', name: '', target: '', args: '' };
}

export function ActionDialog({ request, onClose, onSubmit }: {
  request: ActionDialogRequest | null; onClose: () => void;
  onSubmit: (fields: Fields, existing: Action | null) => boolean;
}) {
  return <Dialog open={request !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent id="action-dialog" aria-describedby={undefined} className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 p-0 sm:max-w-2xl">
      {request && <ActionForm key={request.mode === 'edit' ? request.entry.action.id : 'new'} request={request} onClose={onClose} onSubmit={onSubmit} />}
    </DialogContent>
  </Dialog>;
}

type Installed = { name: string; target: string; args: string };
const ICON_SIZE = 32;
// The tile grid is auto-fill, so the step between rows is read from the laid-out columns.
const columnsOf = (list: HTMLElement | null) => Math.max(1, (list ? getComputedStyle(list).gridTemplateColumns : '').split(' ').filter(Boolean).length);
function AppIcon({ target }: { target: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const load = (ask: (target: string, px: number, ready: () => void) => string | null) => {
      const update = () => { if (!disposed) setUrl(ask(target, Math.round(ICON_SIZE * (window.devicePixelRatio || 1)), update)); };
      update();
    };
    void import('../../../ui/wheel-renderer.js').then(({ requestIcon }) => { if (!disposed) load(requestIcon); }).catch(() => {});
    return () => { disposed = true; };
  }, [target]);
  return url ? <img src={url} alt="" draggable={false} className="size-8 flex-none" /> : <Icon name="app" className="size-8 flex-none text-muted-foreground" />;
}
function InstalledApps({ selected, onPick, onBrowse, onUrl }: { selected: string; onPick: (app: Installed) => void; onBrowse: () => void; onUrl: () => void }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ entries: Installed[]; loading: boolean; error: string | null }>({ entries: [], loading: true, error: null });
  const [reload, setReload] = useState(0);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    let current = true;
    invoke('catalog_search', { query, limit: 100 }).then((view) => { if (current) { setResult({ entries: view?.entries ?? [], loading: view?.loading ?? false, error: view?.error ?? null }); setActive(0); } })
      .catch(() => { if (current) setResult({ entries: [], loading: false, error: null }); });
    return () => { current = false; };
  }, [query, reload]);
  useEffect(() => {
    let off: (() => void) | undefined, gone = false;
    listen('catalog:changed', () => setReload((n) => n + 1)).then((stop) => { if (gone) stop(); else off = stop; }).catch(() => {});
    return () => { gone = true; off?.(); };
  }, []);
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [active]);
  // Arrows move through the results and Enter takes the highlighted one, so the search box alone is enough.
  const columns = () => columnsOf(list.current);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = result.entries.length - 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.min(last, Math.max(0, index + (event.key === 'ArrowDown' ? columns() : -columns())))); }
    else if (event.key === 'Enter' && result.entries[active]) { event.preventDefault(); onPick(result.entries[active]); }
  };
  return <section className="grid gap-3">
    <SectionHead title="Виберіть програму">
      <Button variant="ghost" size="sm" data-action="browse-file" onClick={onBrowse}><Icon name="folder" />Обрати файл…</Button>
      <Button variant="ghost" size="sm" data-action="enter-url" onClick={onUrl}><Icon name="external" />Вказати URL</Button></SectionHead>
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input id="installed-search" aria-label="Програма зі списку" type="search" className="h-10 pl-9" value={query} placeholder="Пошук серед встановлених програм" autoFocus autoComplete="off" onKeyDown={onKeyDown} onChange={(event) => setQuery(event.target.value)} /></div>
    <ul id="installed-apps" ref={list} aria-label="Встановлені програми" className="-mr-2 grid max-h-[clamp(7rem,30vh,17rem)] grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2 overflow-y-auto pr-2">
      {result.entries.map((app, index) => {
        const chosen = app.target === selected;
        return <li key={`${app.target}|${app.args}`} className="contents">
          <button type="button" data-installed={app.name} data-active={index === active} aria-current={chosen || undefined}
            className={cn(TILE, 'h-[5.5rem]', index === active && 'bg-accent')} onMouseEnter={() => setActive(index)} onClick={() => onPick(app)}>
            <AppIcon target={app.target} /><span className="line-clamp-2 w-full leading-tight break-words">{app.name}</span>{chosen && <Check className="absolute top-1.5 right-1.5 size-3.5 text-brand" aria-label="Вибрано" />}</button></li>;
      })}
      {!result.entries.length && <li className="col-span-full py-3 text-xs text-muted-foreground">{result.loading ? 'Шукаю встановлені програми…' : result.error ? 'Не вдалося прочитати список програм. Вкажіть шлях вручну.' : 'Нічого не знайдено. Вкажіть шлях вручну.'}</li>}
    </ul>
    <p className="text-xs text-muted-foreground">Клацніть програму, щоб вибрати її. Стрілки та Enter теж працюють.</p></section>;
}

// One tile look for every picker: bare icon over the label, the chosen one marked by the accent border.
const TILE = 'relative flex flex-col items-center justify-center gap-2 rounded-lg border px-2 text-center text-xs font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=true]:border-brand aria-[current=true]:bg-brand/10 aria-[current=true]:text-foreground';
const SYSTEM_ICONS: Record<string, string> = {
  explorer: 'folder', 'task-manager': 'chart', settings: 'settings', 'control-panel': 'sliders', 'recycle-bin': 'trash', search: 'search', run: 'run',
  'task-view': 'layers', desktop: 'desktop', lock: 'lock', screenshot: 'screenshot', clipboard: 'clipboard', emoji: 'emoji', dictation: 'mic',
  notifications: 'bell', mute: 'volumeMute', 'volume-down': 'volumeDown', 'volume-up': 'volumeUp', 'sound-settings': 'volume', bluetooth: 'bluetooth',
  'media-prev': 'trackPrev', 'media-play': 'playPause', 'media-next': 'trackNext', calculator: 'calculator', notepad: 'notepad',
};
function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="flex min-h-8 items-center justify-between gap-2"><h3 className="text-sm font-semibold">{title}</h3><div className="flex gap-1">{children}</div></div>;
}

function ActionForm({ request, onClose, onSubmit }: { request: ActionDialogRequest; onClose: () => void; onSubmit: (fields: Fields, existing: Action | null) => boolean }) {
  const editing = request.mode === 'edit', existing = request.mode === 'edit' ? request.entry.action : null;
  const [fields, setFields] = useState<Fields>(() => initial(request));
  const nameInput = useRef<HTMLInputElement>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<Fields>) => { setFields((current) => ({ ...current, ...patch })); setError(''); };
  const pickKind = (kind: Kind) => set({ kind, target: kind === 'system' ? SYSTEM_ACTIONS[0][0] : '', args: '' });
  const pickSystem = (target: string) => set({ target, name: fields.name.trim() ? fields.name : SYSTEM_ACTIONS.find(([id]) => id === target)?.[1] ?? '' });
  const browse = async () => {
    try {
      const path = fields.kind === 'folder' ? await invoke('pick_folder') : await invoke('pick_file', { kind: fields.kind === 'script' ? 'script' : 'app' });
      if (path) set({ target: path, name: fields.name.trim() ? fields.name : fileStem(path) });
    } catch (failure) { setError(String(failure)); }
  };
  const submit = () => {
    const name = fields.name.trim();
    if (!name) { setError('Введіть назву дії.'); return; }
    if (fields.kind !== 'group' && !fields.target.trim()) { setError(fields.kind === 'system' ? 'Виберіть команду.' : 'Вкажіть шлях або посилання.'); return; }
    if (onSubmit({ ...fields, name, target: fields.target.trim() }, existing)) onClose();
  };
  const picking = !editing && fields.kind === 'app';
  const hasArgs = fields.kind === 'app' || fields.kind === 'script';
  const argsBlock = <div className="grid gap-2"><Label htmlFor="action-args">Аргументи</Label>
    <Input id="action-args" value={fields.args} maxLength={4096} placeholder="Необов’язково" onChange={(event) => set({ args: event.target.value })} /></div>;
  const disclosure = 'border-t pt-3 text-sm [&>summary]:flex [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:gap-2 [&>summary]:text-muted-foreground [&>summary]:select-none [&>summary]:hover:text-foreground';
  const sectionTitle = fields.kind === 'folder' ? 'Виберіть папку' : fields.kind === 'script' ? 'Виберіть скрипт' : fields.kind === 'system' ? 'Команда Windows' : '';
  const moreSummary = (text: string) => <summary><Icon name="chevron" className="size-3.5 transition-transform in-open:rotate-90" />{text}</summary>;
  const showUrl = () => { setMore(true); window.setTimeout(() => document.getElementById('action-target')?.focus(), 0); };
  return <form noValidate onSubmit={(event) => { event.preventDefault(); submit(); }} className="flex min-h-0 flex-1 flex-col">
    <DialogHeader className="border-b px-6 py-4"><DialogTitle id="action-dialog-title">{editing ? 'Редагувати дію' : 'Додати дію'}</DialogTitle></DialogHeader>
    <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-6 py-5">
      <div role="radiogroup" id="action-kind" aria-label="Тип дії" className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
        {KINDS.map((kind) => <button key={kind} type="button" role="radio" aria-checked={fields.kind === kind} aria-current={fields.kind === kind || undefined} data-kind={kind} disabled={editing && existing?.kind === 'group'} onClick={() => pickKind(kind)}
          className={cn(TILE, 'h-16 gap-1.5 text-muted-foreground disabled:opacity-40')}><Icon name={kind} className="size-5" />{KIND_NAMES[kind]}</button>)}
      </div>
      {picking && <InstalledApps selected={fields.target} onBrowse={() => { void browse(); }} onUrl={showUrl} onPick={(app) => { set({ target: app.target, args: app.args, name: app.name }); nameInput.current?.focus(); nameInput.current?.select(); }} />}
      {fields.kind === 'system' && <section className="grid gap-3"><SectionHead title={sectionTitle} />
        <div id="action-system" role="radiogroup" aria-label="Команда Windows" className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
          {SYSTEM_ACTIONS.map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={fields.target === id} aria-current={fields.target === id || undefined} data-system={id} className={cn(TILE, 'h-[4.5rem] gap-1.5 leading-tight')} onClick={() => pickSystem(id)}>
            <Icon name={SYSTEM_ICONS[id] ?? 'system'} className="size-5" /><span className="line-clamp-2 w-full break-words">{label}</span></button>)}
        </div></section>}
      {(fields.kind === 'folder' || fields.kind === 'script') && <section className="grid gap-3"><SectionHead title={sectionTitle}>
        <Button variant="ghost" size="sm" data-action="browse" onClick={() => { void browse(); }}><Icon name={fields.kind === 'folder' ? 'folder' : 'script'} />{fields.kind === 'folder' ? 'Обрати папку…' : 'Обрати файл…'}</Button></SectionHead>
        <div className="grid gap-2"><Label htmlFor="action-target" className="sr-only">{fields.kind === 'folder' ? 'Папка' : 'Скрипт'}</Label>
          <Input id="action-target" className="h-10" value={fields.target} maxLength={4096} placeholder={TARGET_HINT[fields.kind]} onChange={(event) => set({ target: event.target.value })} /></div></section>}
      {fields.kind !== 'system' && <div className="grid gap-2"><Label htmlFor="action-name">{fields.kind === 'group' ? 'Назва групи' : 'Назва в колесі'}</Label>
        <Input ref={nameInput} id="action-name" className="h-10" value={fields.name} maxLength={100} placeholder={fields.kind === 'group' ? 'Нова група' : 'Наприклад, Браузер'} autoFocus={editing || fields.kind !== 'app'} onChange={(event) => set({ name: event.target.value })} />
        {picking && fields.target && <p className="truncate font-mono text-xs text-muted-foreground" title={fields.target}>{fields.target}</p>}</div>}
      {fields.kind === 'system' && <div className="grid gap-2"><Label htmlFor="action-name">Назва в колесі</Label>
        <Input ref={nameInput} id="action-name" className="h-10" value={fields.name} maxLength={100} placeholder="За замовчуванням — назва команди" onChange={(event) => set({ name: event.target.value })} /></div>}
      {picking && <details className={disclosure} open={more || !!fields.args} onToggle={(event) => setMore(event.currentTarget.open)}>{moreSummary('Шлях, посилання та аргументи')}<div className="mt-3 grid gap-4">
        <div className="grid gap-2"><Label htmlFor="action-target">Шлях або посилання</Label>
          <div className="flex gap-2"><Input id="action-target" value={fields.target} maxLength={4096} placeholder={TARGET_HINT.app} onChange={(event) => set({ target: event.target.value })} />
            <Button data-action="browse" onClick={() => { void browse(); }}><Icon name="folder" />Огляд…</Button></div></div>{argsBlock}</div></details>}
      {!picking && hasArgs && <details className={disclosure} open={more || !!fields.args} onToggle={(event) => setMore(event.currentTarget.open)}>{moreSummary('Аргументи запуску')}<div className="mt-3">{argsBlock}</div></details>}
      {error && <p role="alert" id="action-error" className="text-sm text-destructive">{error}</p>}
    </div>
    <DialogFooter className="border-t px-6 py-4">
      <Button onClick={onClose}>Скасувати</Button>
      <Button type="submit" variant="default">{editing ? 'Зберегти' : fields.kind === 'group' ? 'Створити групу' : 'Додати дію'}</Button>
    </DialogFooter>
  </form>;
}
