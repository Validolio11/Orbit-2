import type { Action, AppState, Settings } from "./types";

export const action = (value: Pick<Action, "id" | "name" | "kind"> & Partial<Action>): Action => ({
  target: "", args: "", icon: "", children: [], ...value,
});

export function fixture(): Settings {
  return {
    version: 1, enabled: true, theme: "dark", wheelSize: 520, triggerButton: 4,
    activeMenuId: "work", reducedMotion: false, activationMode: "hover", groupOpenMode: "click",
    hoverDelay: 750, closeOnOutsideClick: true, launchAtLogin: true, wheelAddSlot: true, introPending: false,
    menus: [
      { id: "work", name: "Робота", icon: "orbit", items: [
        action({ id: "editor", name: "Редактор", kind: "app", target: "C:\\Apps\\Code.exe" }),
        action({ id: "tools", name: "Інструменти", kind: "group", children: [
          action({ id: "docs", name: "Документи", kind: "folder", target: "D:\\Archive" }),
          action({ id: "scripts", name: "Автоматизація", kind: "group", children: [
            action({ id: "build", name: "Збірка", kind: "script", target: "C:\\Scripts\\build.ps1" }),
          ] }),
        ] }),
      ] },
      { id: "home", name: "Дім", icon: "orbit", items: [
        action({ id: "lock", name: "Заблокувати", kind: "system", target: "lock" }),
      ] },
    ],
  };
}

export const snapshot = (revision = 1, settings = fixture()): AppState => ({
  revision, settings,
  runtime: { hookReady: true, hookError: null, shortcut: true, admin: { available: true, enabled: false, elevated: false } },
  update: { phase: "idle", currentVersion: "1.0", progress: null, error: null, availableVersion: null },
  wheel: {
    visible: false, session: 0, trigger: "preview", stack: [], selected: null, foreground: null,
    busy: false, released: false, releasePoint: null, size: 520, bounds: { x: 0, y: 0, width: 600, height: 600 }, scale: 1,
  },
  catalogLoading: false, notices: [],
});
