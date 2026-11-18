import { updatePresentation, wheelPercent, wheelSize } from '../editor-state';
import { Button, Header, Section, SettingRow, Slider, ThemeControl, Toggle } from './Facet';
import { CardFooter } from './ui/card';
import { Progress } from './ui/progress';
import type { PageProps } from './types';

export function SettingsPage({ state, ui, onPatch, onCommand }: PageProps) {
  const s = state.settings, update = state.update, u = updatePresentation(update);
  return <><Header title="Налаштування" note="Вигляд, поведінка колеса, дані та оновлення." />
    <Section title="Зовнішній вигляд" note="Тема, розмір колеса й анімації.">
      <SettingRow id="theme" label="Тема" note="Застосовується до редактора й колеса."><ThemeControl theme={s.theme} onChange={(theme) => onPatch({ theme })} /></SettingRow>
      <SettingRow id="wheelSize" label="Розмір кола" note="Масштаб меню під час виклику."><div><Slider id="wheelSize" label="Розмір кола" value={wheelPercent(s.wheelSize)} onChange={(percent) => onPatch({ wheelSize: wheelSize(percent) })} /><div className="flex flex-wrap items-center gap-2"><Button glyph="play" size="sm" data-action="preview" data-focus="preview" onClick={() => onCommand('preview')}>Перевірити</Button><Button size="sm" variant="ghost" data-action="reset-size" data-focus="reset-size" disabled={s.wheelSize === 520} onClick={() => onPatch({ wheelSize: 520 })}>Скинути до 100%</Button></div></div></SettingRow>
      <SettingRow id="reducedMotion" label="Зменшити анімації" note="Миттєві переходи без зміни масштабу."><Toggle id="reducedMotion" label="Зменшити анімації" checked={s.reducedMotion} onChange={(reducedMotion) => onPatch({ reducedMotion })} /></SettingRow>
    </Section>
    <Section title="Налаштування меню" note="Збережіть резервну копію або перенесіть меню на інший комп’ютер.">
      <SettingRow id="export" label="Експорт" note="Меню, шляхи та налаштування у JSON-файлі."><Button glyph="export" disabled={ui.dataBusy} data-action="export" data-focus="export" onClick={() => onCommand('export')}>Експортувати</Button></SettingRow>
      <SettingRow id="import" label="Імпорт" note="Замінює поточні меню. Перед імпортом можна зробити резервну копію."><Button glyph="import" disabled={ui.dataBusy} data-action="import" data-focus="import" onClick={() => onCommand('import')}>Імпортувати</Button></SettingRow>
    </Section>
    <Section title="Оновлення" note="Нові версії Orbit з GitHub."><div className="flex min-h-28 items-center justify-between gap-5 border-t px-6 py-4"><div className="min-w-45 flex-1"><strong className="text-sm">Встановлено {update.currentVersion}</strong><p id="update-message" role="status" className={`mt-1.5 text-xs ${u.phase === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{u.message}</p><Progress className="mt-3.5 max-w-65" value={u.progress} aria-label="Завантаження оновлення" hidden={u.phase !== 'downloading'} /></div><div className="flex max-w-1/2 flex-wrap items-center justify-end gap-2"><Button disabled={u.busy || ui.updateBusy} data-action="check-update" data-focus="check-update" onClick={() => onCommand('check-update')}>{u.phase === 'checking' ? 'Перевіряємо…' : 'Перевірити оновлення'}</Button>{['available', 'downloading'].includes(u.phase) && <Button variant="default" disabled={!u.canDownload || ui.updateBusy} data-action="download-update" data-focus="download-update" onClick={() => onCommand('download-update')}>{u.phase === 'downloading' ? 'Завантажуємо…' : 'Завантажити'}</Button>}{['ready', 'installing'].includes(u.phase) && <Button variant="default" disabled={!u.canInstall || ui.updateBusy} data-action="install-update" data-focus="install-update" onClick={() => onCommand('install-update')}>Установити й перезапустити</Button>}</div></div><CardFooter className="border-t py-4 text-xs text-muted-foreground">Меню та налаштування зберігаються.</CardFooter></Section>
    <p className="text-muted-foreground">Orbit {update.currentVersion} · Windows · локальне зберігання · без облікового запису</p><p className="my-4 rounded-lg border bg-muted p-4 text-xs text-muted-foreground">Кнопка закриття згортає Orbit у системний трей. Щоб завершити роботу, оберіть «Вийти з Orbit» у меню іконки біля годинника.</p>
  </>;
}
