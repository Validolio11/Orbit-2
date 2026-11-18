import { ACTIVATION_NAMES, HOVER_DELAYS, statusLabel } from '../editor-state';
import type { Settings } from '../types';
import { Button, Header, Icon, Section, Select, SettingRow, Toggle } from './Facet';
import { Kbd } from './ui/kbd';
import type { PageProps } from './types';

const note = 'my-4 rounded-lg border bg-muted p-4 text-xs text-muted-foreground';

export function ControlsPage({ state, ui, onPatch, onCommand }: PageProps) {
  const s = state.settings, r = state.runtime, admin = r.admin;
  const adminNote = !admin.available ? 'Доступно у встановленому Orbit для облікового запису адміністратора.' : admin.enabled ? (admin.elevated ? 'Orbit працює з правами адміністратора: бічна кнопка діє й у програмах, запущених від імені адміністратора.' : 'Перезапустіть Orbit, щоб застосувати права адміністратора.') + ' Програми з колеса теж відкриватимуться з цими правами.' : 'Без цього бічна кнопка не працює у програмах, запущених від імені адміністратора. Windows попросить підтвердження один раз.';
  const activationNote = { release: 'Наведіть на сектор і відпустіть бічну кнопку.', hover: 'Затримайте курсор над сектором для запуску.', click: 'Натисніть лівою кнопкою на потрібний сектор.' };
  const toggle = (id: 'enabled' | 'launchAtLogin' | 'wheelAddSlot' | 'closeOnOutsideClick', label: string) => <Toggle id={id} label={label} checked={s[id]} onChange={(checked) => onPatch({ [id]: checked })} />;
  return <><Header title="Керування" note="Налаштуйте мишу та спосіб вибору дій." />
    <Section title="Виклик колеса мишею" note="Стандартні бічні кнопки Mouse 4 та Mouse 5.">
      <div className="flex items-center gap-3 px-6 pb-5 text-xs [&_.glyph]:size-7 [&_.glyph]:text-muted-foreground"><Icon name="mouse" /><span className={`inline-block size-2 flex-none rounded-full ${s.enabled && r.hookReady ? 'bg-success' : 'bg-muted-foreground/50'}`} />{statusLabel(s, r)}</div>
      <SettingRow id="enabled" label="Orbit у фоновому режимі" note="Коли ввімкнено, обрана бічна кнопка викликає колесо замість переходу назад або вперед.">{toggle('enabled', 'Orbit у фоновому режимі')}</SettingRow>
      <SettingRow id="launchAtLogin" label="Запускати разом з Windows" note="Orbit стартує у фоні після входу в систему, тож бічна кнопка працює одразу.">{toggle('launchAtLogin', 'Запускати разом з Windows')}</SettingRow>
      <SettingRow id="admin" label="Запускати з правами адміністратора" note={adminNote}><Toggle id="admin" label="Запускати з правами адміністратора" checked={admin.enabled} disabled={!admin.available || ui.adminBusy} onChange={() => onCommand('admin')} /></SettingRow>
      <SettingRow id="triggerButton" label="Кнопка виклику" note="Затисніть кнопку, щоб відкрити колесо біля курсора."><Select id="triggerButton" value={s.triggerButton} options={[[4, 'Mouse 4 · назад'], [5, 'Mouse 5 · вперед']]} onChange={(triggerButton) => onPatch({ triggerButton })} /></SettingRow>
      <SettingRow id="shortcut" label="Клавіатурний виклик" note={r.shortcut ? 'Доступний у будь-якій програмі.' : 'Скорочення недоступне: можливо, його зайняла інша програма.'}><Kbd id="shortcut">Ctrl + Space</Kbd></SettingRow>
    </Section>
    <Section title="Вибір дії" note="Як колесо запускає дії та відкриває вкладки.">
      <SettingRow id="activationMode" label="Запускати дію" note={activationNote[s.activationMode]}><Select<Settings['activationMode']> id="activationMode" value={s.activationMode} options={Object.entries(ACTIVATION_NAMES) as [Settings['activationMode'], string][]} onChange={(activationMode) => onPatch({ activationMode })} /></SettingRow>
      <SettingRow id="wheelAddSlot" label="Сектор «+» на колесі" note="Додає програму, в якій ви працюєте, просто з колеса. Спрацьовує лише клацанням, не наведенням.">{toggle('wheelAddSlot', 'Сектор «+» на колесі')}</SettingRow>
      <SettingRow id="groupOpenMode" label="Відкривати вкладки" note={s.groupOpenMode === 'click' ? 'Натисніть лівою кнопкою на вкладку, щоб відкрити її.' : 'Наведіть курсор на вкладку, щоб відкрити її.'}><Select<Settings['groupOpenMode']> id="groupOpenMode" value={s.groupOpenMode} options={[["hover", ACTIVATION_NAMES.hover], ["click", ACTIVATION_NAMES.click]]} onChange={(groupOpenMode) => onPatch({ groupOpenMode })} /></SettingRow>
      {s.activationMode === 'hover' && <SettingRow id="hoverDelay" label="Затримка наведення" note="Збільште, якщо дії запускаються випадково."><Select id="hoverDelay" value={s.hoverDelay} options={HOVER_DELAYS.map((delay) => [delay, `${delay} мс`] as const)} onChange={(hoverDelay) => onPatch({ hoverDelay })} /></SettingRow>}
      <SettingRow id="closeOnOutsideClick" label="Закривати меню натисканням поза ним" note="Натискання поза колом скасовує вибір так само, як Esc.">{toggle('closeOnOutsideClick', 'Закривати меню натисканням поза ним')}</SettingRow>
    </Section>
    <p className={note}>{s.groupOpenMode === 'click' ? 'Вкладені групи відкриваються клацанням.' : 'Вкладені групи відкриваються наведенням.'} Центр колеса повертає на рівень вище. Esc закриває колесо. Спеціальні кнопки мишей можуть потребувати налаштування у програмі виробника.</p>{r.hookError && <p className={`${note} !text-destructive`}>{r.hookError}</p>}<Button glyph="play" data-action="preview" data-focus="preview" onClick={() => onCommand('preview')}>Перевірити колесо</Button>
  </>;
}
