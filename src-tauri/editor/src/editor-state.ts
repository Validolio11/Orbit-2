import type { Action, ActionEntry, AppState, Menu, RuntimeView, Settings, UpdateView, UpdatePhase } from "./types";
// DOM-free selectors and persistence coordination. Never mutate an IPC snapshot.
export const KIND_NAMES = { app: "Застосунок", folder: "Папка", script: "Скрипт", system: "Windows", group: "Група" };
export const ACTIVATION_NAMES = { release: "Відпускання кнопки", hover: "Наведення курсора", click: "Клацання мишею" };
export const HOVER_DELAYS = [150, 250, 350, 500, 750, 1000, 1500, 2000];
export const DEFAULT_WHEEL_SIZE = 520;
export function activeMenu(settings: Partial<Pick<Settings, "menus" | "activeMenuId">> | null | undefined): Menu | null {
  return settings?.menus?.find((menu) => menu.id === settings.activeMenuId) || settings?.menus?.[0] || null;
}
export function flattenActions(settings: Pick<Settings, "menus"> | null | undefined): ActionEntry[] {
  const result: ActionEntry[] = [];
  function walk(items: Action[], menu: Menu, path: string[] = [], groupIds: string[] = []) {
    for (const action of items) {
      result.push({ action, menu, path, groupIds, context: [menu.name, ...path].join(" / ") });
      if (action.kind === "group") walk(action.children || [], menu, [...path, action.name], [...groupIds, action.id]);
    }
  }
  for (const menu of settings?.menus || []) walk(menu.items, menu);
  return result;
}
export function filterActions(settings: Pick<Settings, "menus"> | null | undefined, query = "") {
  const needle = query.trim().toLocaleLowerCase("uk");
  return flattenActions(settings).filter(({ action, context }) =>
    `${action.name} ${KIND_NAMES[action.kind]} ${context} ${action.target || ""}`.toLocaleLowerCase("uk").includes(needle));
}
export function actionsWord(count: number) {
  return count % 10 === 1 && count % 100 !== 11 ? "дію" : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? "дії" : "дій";
}
export function statusLabel(settings: Pick<Settings, "enabled"> | null | undefined, runtime: Partial<RuntimeView> = {}) {
  return !settings?.enabled ? "Призупинено" : runtime.hookReady ? "Orbit активний" : runtime.hookError ? "Миша недоступна" : "Запуск модуля миші…";
}
export function wheelPercent(size: number) { return Math.round(size / DEFAULT_WHEEL_SIZE * 100); }
export function wheelSize(percent: number | string) { return Math.round(Math.max(60, Math.min(150, Math.round(Number(percent) / 5) * 5)) * DEFAULT_WHEEL_SIZE / 100); }
export function updatePresentation(update: Partial<UpdateView> = {}) {
  const progress = Math.max(0, Math.min(100, Number(update.progress) || 0));
  const phase = update.phase || "idle";
  const messages: Record<UpdatePhase, string> = {
    idle: "Перевірте, чи доступна нова версія.", checking: "Перевіряємо нові версії…",
    available: `Доступна версія ${update.availableVersion || ""}.`, upToDate: "Встановлено останню версію.",
    downloading: `Завантаження ${Math.round(progress)}%…`, ready: "Оновлення готове. Під час встановлення Orbit перезапуститься.",
    installing: "Установлюємо оновлення…", error: update.error || "Не вдалося перевірити оновлення.",
  };
  return { message: messages[phase] || messages.idle, progress, busy: ["checking", "downloading", "installing"].includes(phase), canDownload: phase === "available", canInstall: phase === "ready", phase };
}
export function removeAction(settings: Settings, id: string): Menu[] {
  const next = structuredClone(settings);
  function remove(items: Action[]): boolean {
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) { items.splice(index, 1); return true; }
    return items.some((item) => item.kind === "group" && remove(item.children));
  }
  for (const menu of next.menus) if (remove(menu.items)) break;
  return next.menus;
}

// Windows commands, mirroring SYSTEM_ACTIONS in src/model.rs (id, name); the native side rejects any other id.
export const SYSTEM_ACTIONS: readonly (readonly [string, string])[] = [
  ["explorer", "Провідник"], ["task-manager", "Диспетчер завдань"], ["settings", "Параметри Windows"], ["control-panel", "Панель керування"],
  ["recycle-bin", "Кошик"], ["search", "Пошук Windows"], ["run", "Виконати"], ["task-view", "Усі вікна"], ["desktop", "Показати робочий стіл"],
  ["lock", "Заблокувати комп’ютер"], ["screenshot", "Знімок екрана"], ["clipboard", "Буфер обміну"], ["emoji", "Емодзі"],
  ["dictation", "Голосове введення"], ["notifications", "Сповіщення"], ["mute", "Вимкнути / увімкнути звук"],
  ["volume-down", "Зменшити гучність"], ["volume-up", "Збільшити гучність"], ["sound-settings", "Налаштування звуку"], ["bluetooth", "Bluetooth"],
  ["media-prev", "Попередній трек"], ["media-play", "Відтворення / пауза"], ["media-next", "Наступний трек"], ["calculator", "Калькулятор"], ["notepad", "Блокнот"],
];
export const MAX_ITEMS = 12;
export function fileStem(path: string) {
  const name = path.replace(/[\\/]+$/u, "").split(/[\\/]/u).pop() || "";
  return name.replace(/\.[^.]+$/u, "");
}
interface Located { list: Action[]; index: number; parent: Action[] | null; parentIndex: number }
function locate(items: Action[], id: string, parent: Action[] | null = null, parentIndex = -1): Located | null {
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) return { list: items, index, parent, parentIndex };
  for (const [position, item] of items.entries()) {
    if (item.kind !== "group") continue;
    const found = locate(item.children, id, items, position);
    if (found) return found;
  }
  return null;
}
function inMenus<T>(settings: Settings, id: string, change: (found: Located) => T | null): { menus: Menu[]; result: T } | null {
  const next = structuredClone(settings);
  for (const menu of next.menus) {
    const found = locate(menu.items, id);
    if (!found) continue;
    const result = change(found);
    return result === null ? null : { menus: next.menus, result };
  }
  return null;
}
/** Appends an action to the end of a menu; null when the menu is missing or already holds 12 items. */
export function addAction(settings: Settings, menuId: string, action: Action): Menu[] | null {
  const next = structuredClone(settings), menu = next.menus.find((entry) => entry.id === menuId);
  if (!menu || menu.items.length >= MAX_ITEMS) return null;
  menu.items.push(action);
  return next.menus;
}
export function updateAction(settings: Settings, id: string, fields: Partial<Pick<Action, "name" | "kind" | "target" | "args" | "icon">>): Menu[] | null {
  return inMenus(settings, id, ({ list, index }) => { Object.assign(list[index], fields); return true; })?.menus ?? null;
}
/** Moves an action one place up or down among its siblings; null at the ends. */
export function moveAction(settings: Settings, id: string, direction: -1 | 1): Menu[] | null {
  return inMenus(settings, id, ({ list, index }) => {
    const target = index + direction;
    if (target < 0 || target >= list.length) return null;
    [list[index], list[target]] = [list[target], list[index]];
    return true;
  })?.menus ?? null;
}
/** Takes an action out of its group and places it right after that group; null at the top level or when the parent level is full. */
export function moveOut(settings: Settings, id: string): Menu[] | null {
  return inMenus(settings, id, ({ list, index, parent, parentIndex }) => {
    if (!parent || parent.length >= MAX_ITEMS) return null;
    const [item] = list.splice(index, 1);
    parent.splice(parentIndex + 1, 0, item);
    return true;
  })?.menus ?? null;
}
// Serial saves merge each patch into the latest native snapshot; pending edits remain
// visible across state:changed and a failed write rolls back only that edit.
export function createSettingsStore({ save, refresh, changed, failed }: SettingsStoreOptions) {
  let snapshot: AppState | null = null; const pending: PendingPatch[] = []; let running = false;
  function view(): AppState | null {
    if (!snapshot) return null;
    return { ...snapshot, settings: Object.assign({}, snapshot.settings, ...pending.map((entry) => entry.patch)) };
  }
  function receive(next: AppState | null | undefined) {
    if (!next || (snapshot && next.revision < snapshot.revision)) return;
    snapshot = next; changed(view());
  }
  async function pump() {
    if (running) return;
    running = true;
    while (pending.length) {
      const entry = pending[0];
      try {
        await save({ ...snapshot!.settings, ...entry.patch });
        // save_settings emits state:changed before replying. Refresh also recovers
        // a missed event and obtains the canonical revision after normalization.
        const next = await refresh();
        if (!snapshot || next.revision >= snapshot.revision) snapshot = next;
      } catch (error) { failed(error); }
      pending.shift(); changed(view()); entry.resolve();
    }
    running = false;
  }
  return { receive, view, get busy() { return running; }, patch(patch: Partial<Settings>) {
    if (!snapshot) return Promise.resolve();
    const done = new Promise<void>((resolve) => pending.push({ patch, resolve }));
    changed(view()); void pump(); return done;
  } };
}

interface PendingPatch { patch: Partial<Settings>; resolve: () => void }
export interface SettingsStoreOptions {
  save: (settings: Settings) => Promise<unknown>;
  refresh: () => Promise<AppState>;
  changed: (state: AppState | null) => void;
  failed: (error: unknown) => void;
}
export type SettingsStore = ReturnType<typeof createSettingsStore>;
