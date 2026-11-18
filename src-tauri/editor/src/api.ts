import type { AppEvent, AppState, Settings, UpdateView, Kind } from './types';

export type WindowAction = 'minimize' | 'toggle_maximize' | 'hide' | 'drag';
type CatalogEntry = { name: string; target: string; args: string };
interface Commands {
  get_state: [undefined, AppState];
  save_settings: [{ settings: Settings }, Settings];
  catalog_search: [{ query: string; limit?: number }, { entries: CatalogEntry[]; loading: boolean; error: string | null }];
  refresh_catalog: [undefined, void];
  item_icon: [{ target: string; physicalPx: number }, string | null];
  launch_action: [{ id: string }, void];
  open_wheel_preview: [undefined, void];
  close_wheel: [undefined, void];
  add_foreground: [undefined, string];
  open_add_dialog: [{ groupPath: string[] }, void];
  pick_file: [{ kind?: Kind }, string | null];
  pick_folder: [undefined, string | null];
  list_folders: [undefined, { group: string; name: string; path: string; icon: string }[]];
  list_scripts: [undefined, { scripts: { name: string; path: string; extension: string; folder: string }[]; pythonAvailable: boolean }];
  export_settings: [undefined, boolean];
  import_settings: [undefined, Settings | null];
  set_admin: [{ enabled: boolean }, boolean];
  check_update: [undefined, UpdateView];
  download_update: [undefined, UpdateView];
  install_update: [undefined, void];
  take_events: [undefined, AppEvent[]];
  window_command: [{ action: WindowAction }, void];
}
interface Events { 'state:changed': AppState; 'update:changed': null; 'catalog:changed': null; 'app:event': AppEvent }
export interface TauriGlobal {
  core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen<T>(event: string, callback: (event: { payload: T }) => void): Promise<() => void> };
}
declare global { interface Window { __TAURI__?: TauriGlobal } }
function tauri(): TauriGlobal {
  if (!window.__TAURI__) throw new Error('Немає з’єднання з Orbit. Відкрийте сторінку у застосунку.');
  return window.__TAURI__;
}
export function invoke<C extends keyof Commands>(command: C, ...args: Commands[C][0] extends undefined ? [args?: undefined] : [args: Commands[C][0]]): Promise<Commands[C][1]> {
  return tauri().core.invoke(command, args[0]);
}
export function listen<E extends keyof Events>(event: E, callback: (payload: Events[E]) => void): Promise<() => void> {
  return tauri().event.listen<Events[E]>(event, ({ payload }) => callback(payload));
}
export const getState = () => invoke('get_state');
export const openWheelPreview = () => invoke('open_wheel_preview');
export const closeWheel = () => invoke('close_wheel');
export const windowCommand = (action: WindowAction) => invoke('window_command', { action });
