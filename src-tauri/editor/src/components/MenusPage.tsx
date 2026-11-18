import { activeMenu, ACTIVATION_NAMES, actionsWord } from '../editor-state';
import { Button, Header, Panel } from './Facet';
import { ActionList } from './ActionList';
import { WheelPreview } from './WheelPreview';
import { CardAction, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';

const quiet = 'flex min-h-24 flex-col justify-center gap-1.5 rounded-xl border bg-card p-4 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50';
import type { PageProps } from './types';

export function MenusPage({ state, ui, onPage, onSelect, onActivateMenu, onCommand }: PageProps) {
  const s = state.settings, menu = activeMenu(s), items = menu?.items || [];
  return <>
    <Header title="Мої меню" note="Програми, папки та команди, які відкриває колесо."><Button glyph="plus" data-action="create-menu" data-focus="create-menu" disabled={s.menus.length >= 20} title={s.menus.length >= 20 ? 'Можна створити до 20 меню.' : 'Створити меню'} onClick={() => onCommand('create-menu')}>Створити меню</Button><Button glyph="play" variant="default" data-action="preview" data-focus="preview" onClick={() => onCommand('preview')}>Викликати колесо</Button></Header>
    <div className="mb-5 grid grid-cols-[1.35fr_1fr_1fr] gap-3 max-[900px]:grid-cols-2">
      <button type="button" data-page="library" className="flex min-h-24 items-center gap-6 rounded-xl border bg-card px-6 py-4 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 max-[900px]:col-span-full" onClick={() => onPage('library')}><strong className="text-5xl leading-none font-semibold tracking-tighter">{items.length}</strong><span className="text-base">{actionsWord(items.length)}<small className="mt-1 block text-xs text-muted-foreground">у цьому колесі, до 12</small></span></button>
      <button type="button" data-page="controls" className={quiet} onClick={() => onPage('controls')}><span className="text-xs text-muted-foreground">Кнопка виклику</span><strong className="text-sm font-semibold">Бічна кнопка {s.triggerButton}</strong><small className="text-xs text-muted-foreground">Виклик колеса · Ctrl + Space</small></button>
      <button type="button" data-page="controls" className={quiet} onClick={() => onPage('controls')}><span className="text-xs text-muted-foreground">Спосіб запуску</span><strong className="text-sm font-semibold">{ACTIVATION_NAMES[s.activationMode]}</strong><small className="text-xs text-muted-foreground">{s.activationMode === 'hover' ? `Затримка ${s.hoverDelay} мс` : 'Спосіб запуску обраної дії'}</small></button>
    </div>
    <Tabs value={menu?.id ?? ''} onValueChange={onActivateMenu} className="mb-4"><TabsList aria-label="Меню">{s.menus.map((tab) => <TabsTrigger key={tab.id} value={tab.id} data-action="activate-menu" data-id={tab.id} data-focus={`menu-${tab.id}`}>{tab.name}<span className="font-mono text-xs opacity-70">{tab.items.length}</span></TabsTrigger>)}</TabsList></Tabs>
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start gap-6 max-[1150px]:gap-4 max-[900px]:grid-cols-1">
      <Panel className="preview-panel" aria-label="Попередній перегляд колеса"><CardHeader className="flex min-h-14 items-center justify-between py-4"><CardTitle role="heading" aria-level={2}>{menu?.name || 'Orbit'}</CardTitle></CardHeader><WheelPreview settings={s} selected={ui.selected} /><CardFooter className="border-t py-4 text-xs text-muted-foreground">Попередній перегляд · виберіть дію у списку</CardFooter></Panel>
      <Panel className="action-panel" aria-labelledby="actions-title"><CardHeader className="flex min-h-14 items-center justify-between py-4"><CardTitle role="heading" aria-level={2} id="actions-title">Дії в меню <span className="font-mono text-xs font-normal text-muted-foreground">{items.length}</span></CardTitle><CardAction><Button glyph="plus" size="sm" data-action="add-action" data-focus="add-action" disabled={items.length >= 12} title={items.length >= 12 ? 'У меню може бути до 12 дій.' : 'Додати дію'} onClick={() => onCommand('add-action')}>Додати дію</Button></CardAction></CardHeader><div className="pb-2"><ActionList entries={items.map((action) => ({ action }))} selected={ui.selected} onSelect={onSelect} onDelete={(id) => onCommand('delete-action', id)} onCommand={onCommand} /></div></Panel>
    </div><p className="mt-4 text-xs text-muted-foreground/70" id="save-note">Зміни зберігаються автоматично</p>
  </>;
}
