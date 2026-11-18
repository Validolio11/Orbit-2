import { useEffect, useRef, useState } from 'react';
import { KIND_NAMES } from '../editor-state';
import type { Action, ActionEntry } from '../types';
import { Button, HexIcon, Icon } from './Facet';
import type { PageCommand } from './types';
import { Badge } from './ui/badge';

function ProgramIcon({ action }: { action: Action }) {
  const holder = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<{ url: string; size: number; left: number; top: number } | null>(null);
  const [glyph, setGlyph] = useState(action.icon || action.kind);
  useEffect(() => {
    let disposed = false;
    let update = () => {};
    setImage(null);
    void import('../../../ui/wheel-renderer.js').then(({ requestIcon, iconName }) => {
      if (disposed) return;
      setGlyph(iconName(action));
      update = () => {
        if (disposed || !holder.current) return;
        const dpr = window.devicePixelRatio || 1;
        const physicalPx = Math.max(8, Math.min(256, Math.round(28 * dpr)));
        const url = action.target ? requestIcon(action.target, physicalPx, update) : null;
        if (!url) { setImage(null); return; }
        const size = physicalPx / dpr, rect = holder.current.getBoundingClientRect();
        setImage({ url, size, left: Math.round((rect.left + (rect.width - size) / 2) * dpr) / dpr - rect.left, top: Math.round((rect.top + (rect.height - size) / 2) * dpr) / dpr - rect.top });
      };
      update();
      window.addEventListener('resize', update);
    });
    return () => { disposed = true; window.removeEventListener('resize', update); };
  }, [action]);
  return <span ref={holder} className="action-icon program-icon relative inline-flex size-8 flex-none items-center justify-center" data-program={action.id}>{image ? <img src={image.url} alt="" draggable={false} style={{ width: image.size, height: image.size, left: image.left, top: image.top }} /> : <Icon name={glyph} />}</span>;
}
type ListEntry = Pick<ActionEntry, 'action'> & Partial<ActionEntry>;
export function ActionList({ entries, selected, library = false, onSelect, onDelete, onCommand }: { entries: ListEntry[]; selected: string | null; library?: boolean; onSelect: (id: string) => void; onDelete: (id: string) => void; onCommand: (command: PageCommand, id?: string) => void }) {
  if (!entries.length) return <div className="px-6 py-12 text-center"><h3 className="text-sm font-semibold">{library ? 'Дій не знайдено' : 'Додайте першу дію'}</h3><p className="mt-2 mb-4 text-xs text-muted-foreground">{library ? 'Спробуйте іншу назву.' : 'Програми, папки та команди з’являться в цьому колесі.'}</p>{!library && <Button glyph="plus" data-action="add-action" onClick={() => onCommand('add-action')}>Додати дію</Button>}</div>;
  const tool = (id: string, glyph: string, label: string, command: PageCommand) => <Button key={command} glyph={glyph} size="icon" variant="ghost" className="size-7 text-muted-foreground" aria-label={label} title={label} data-action={command} data-id={id} onClick={() => onCommand(command, id)} />;
  return <>{entries.map(({ action, context, groupIds = [] }, index) => {
    const description = action.kind === 'group' ? `${action.children?.length || 0} дій у вкладеному меню` : action.target || 'Виберіть шлях до застосунку';
    return <div key={action.id} className={`relative flex min-h-17 items-center gap-2 border-t px-2 first:border-t-0 hover:bg-accent ${selected === action.id ? 'bg-secondary before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-sm before:bg-brand' : ''}`} data-row={action.id}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch rounded-md px-1.5 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" data-action="select-action" data-id={action.id} data-focus={`row-${action.id}`} aria-pressed={selected === action.id} onClick={() => onSelect(action.id)}>
        <span className="w-4.5 flex-none text-center font-mono text-xs text-muted-foreground/70">{index + 1}</span>{action.kind === 'app' ? <ProgramIcon action={action} /> : <HexIcon kind={action.kind} glyph={action.icon || action.kind} />}
        <span className="grid min-w-0 gap-0.5"><strong className="truncate text-sm font-semibold">{action.name}</strong><span className="truncate text-xs text-muted-foreground" title={description}>{description}</span>{library && <span className="truncate text-xs text-muted-foreground/70">{context}</span>}</span>
      </button>
      {library && <Badge variant="outline" className="text-muted-foreground" data-kind={action.kind}>{KIND_NAMES[action.kind]}</Badge>}
      <div className="flex flex-none gap-0 pr-1">{groupIds.length > 0 && tool(action.id, 'back', 'Перемістити на рівень вище', 'move-out')}{tool(action.id, 'arrowUp', 'Перемістити вгору', 'move-up')}{tool(action.id, 'arrowDown', 'Перемістити вниз', 'move-down')}{tool(action.id, 'edit', 'Редагувати дію', 'edit-action')}<Button glyph="trash" size="icon" variant="ghost" className="size-7 text-muted-foreground hover:bg-destructive/15 hover:text-destructive" data-action="delete-action" data-id={action.id} data-focus={`delete-${action.id}`} title={`Видалити ${action.name}`} aria-label={`Видалити ${action.name}`} onClick={() => onDelete(action.id)} /></div>
    </div>;
  })}</>;
}
