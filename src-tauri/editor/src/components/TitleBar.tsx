import type { WindowAction } from '../api';
import { Icon } from './Facet';

export function TitleBar({ onCommand }: { onCommand: (action: WindowAction) => void }) {
  const controls = [
    ['minimize', 'Згорнути', 'minus'],
    ['toggle_maximize', 'Розгорнути або відновити', 'windows'],
    ['hide', 'Закрити у системний трей', 'close'],
  ] as const;
  return <header className="flex h-12 items-center border-b pl-5 select-none" id="titlebar"
    onMouseDown={(event) => { if (event.button === 0 && event.detail !== 2 && !(event.target as Element).closest('button')) onCommand('drag'); }}
    onDoubleClick={(event) => { if (!(event.target as Element).closest('button')) onCommand('toggle_maximize'); }}>
    <span className="brand relative inline-flex items-center gap-2 text-base font-semibold" id="brand"><Icon name="orbit-base" /><Icon name="orbit-accent" className="brand-top" /><span>Orbit</span></span>
    <span className="pointer-events-none ml-7 flex-1 text-xs text-muted-foreground">Редактор меню</span>
    <nav className="flex gap-0.5 pr-1.5" aria-label="Керування вікном">{controls.map(([action, label, glyph]) =>
      <button key={action} type="button" className={`flex h-9 w-11 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_.glyph]:size-3.5${action === 'hide' ? ' hover:!bg-destructive hover:text-white' : ''}`} data-window={action} aria-label={label} title={label} onClick={() => onCommand(action)}><Icon name={glyph} /></button>)}</nav>
  </header>;
}
