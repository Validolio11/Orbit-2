// Mirrors the camelCase serde IPC views in model.rs, state.rs and wheel.rs.
export type Theme = "dark" | "light" | "system";
export type Activation = "release" | "hover" | "click";
export type GroupOpen = "hover" | "click";
export type Kind = "app" | "folder" | "script" | "system" | "group";
export type Page = "menus" | "library" | "controls" | "settings";
export interface Action {
  id: string;
  name: string;
  kind: Kind;
  target: string;
  args: string;
  icon: string;
  children: Action[];
}
export interface Menu { id: string; name: string; icon: string; items: Action[] }
export interface Settings {
  version: number;
  theme: Theme;
  triggerButton: number;
  activationMode: Activation;
  groupOpenMode: GroupOpen;
  hoverDelay: number;
  enabled: boolean;
  reducedMotion: boolean;
  closeOnOutsideClick: boolean;
  launchAtLogin: boolean;
  wheelAddSlot: boolean;
  introPending: boolean;
  wheelSize: number;
  menus: Menu[];
  activeMenuId: string;
}
export interface ActionEntry {
  action: Action;
  menu: Menu;
  path: string[];
  groupIds: string[];
  context: string;
}
export interface AdminView { available: boolean; enabled: boolean; elevated: boolean }
export interface RuntimeView { hookReady: boolean; hookError: string | null; shortcut: boolean; admin: AdminView }
export type UpdatePhase = "idle" | "checking" | "available" | "upToDate" | "downloading" | "ready" | "installing" | "error";
export interface UpdateView { phase: UpdatePhase; progress: number | null; error: string | null; currentVersion: string; availableVersion: string | null }
export interface Foreground { name: string; target: string; args: string }
export interface WheelView {
  visible: boolean;
  session: number;
  trigger: "mouse" | "keyboard" | "preview";
  stack: string[];
  selected: number | null;
  foreground: Foreground | null;
  busy: boolean;
  released: boolean;
  releasePoint: [number, number] | null;
  size: number;
  bounds: { x: number; y: number; width: number; height: number };
  scale: number;
}
export type AppEvent =
  | { type: "showMain" }
  | { type: "navigate"; groupPath: string[]; add: boolean }
  | { type: "toast"; message: string; error: boolean }
  | { type: "actionError"; id: string; error: string }
  | { type: "notice"; title: string; body: string };
export interface AppState {
  settings: Settings;
  revision: number;
  runtime: RuntimeView;
  wheel: WheelView;
  update: UpdateView;
  catalogLoading: boolean;
  notices: AppEvent[];
}
