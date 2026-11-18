// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { AppEvent, AppState, Settings } from "./types";

// These tests exercise the actual React shell and native bridge without a GUI.
// Zero layout dimensions keep the real read-only wheel renderer out of layout.
type NativeListener = (event: { payload: unknown }) => void;
type Call = { command: string; args: Record<string, unknown> };
const idle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function initialState(): AppState {
  return {
    revision: 1, catalogLoading: false, notices: [],
    settings: {
      version: 1, theme: "dark", wheelSize: 520, enabled: true, launchAtLogin: true,
      reducedMotion: false, closeOnOutsideClick: true, activationMode: "release",
      groupOpenMode: "hover", triggerButton: 4, hoverDelay: 350, wheelAddSlot: true,
      introPending: false, activeMenuId: "one", menus: [{ id: "one", name: "Основне", icon: "orbit", items: [
        { id: "editor", name: "Редактор", kind: "app", target: "editor.exe", args: "", icon: "app", children: [] },
      ] }],
    },
    runtime: { hookReady: true, hookError: null, shortcut: true, admin: { available: true, enabled: false, elevated: false } },
    update: { phase: "idle", currentVersion: "1.0", availableVersion: null, error: null, progress: null },
    wheel: { visible: false, session: 0, trigger: "preview", stack: [], selected: null,
      foreground: null, busy: false, released: false, releasePoint: null, size: 520,
      bounds: { x: 0, y: 0, width: 600, height: 600 }, scale: 1 },
  };
}

let root: Root | null, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); } });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); await idle(); });
  root = null; host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.reducedMotion;
});

function setup({ failFirstRead = false, deferSubscriptions = false, failFolders = false, failCatalog = false } = {}) {
  let native = initialState(), reads = 0;
  const calls: Call[] = [], listeners = new Map<string, NativeListener>(), unsubscribed: string[] = [];
  const queued: AppEvent[] = [], resolveListeners: Array<() => void> = [];
  const media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, "matches", { configurable: true, writable: true, value: false });
  const removeMedia = vi.spyOn(media, "removeEventListener");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => media });
  const emit = (name: string, payload?: unknown) => listeners.get(name)?.({ payload });
  Object.defineProperty(window, "__TAURI__", { configurable: true, value: {
    core: { invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args: structuredClone(args) });
      if (command === "get_state") {
        if (failFirstRead && ++reads === 1) throw new Error("offline");
        return structuredClone(native);
      }
      if (command === "save_settings") {
        native = { ...native, revision: native.revision + 1, settings: structuredClone(args.settings as Settings) };
        emit("state:changed", structuredClone(native)); return structuredClone(native.settings);
      }
      if (command === "take_events") return queued.splice(0);
      if (command === "catalog_search") {
        if (failCatalog) throw new Error("Каталог недоступний.");
        return { loading: false, error: null, entries: [{ name: "Firefox", target: String.raw`C:\Apps\firefox.exe`, args: "" }] };
      }
      if (command === "list_folders") {
        if (failFolders) throw "Доступ заборонено.";
        return [
          { group: "quick", name: "Проєкти", path: String.raw`D:\Projects`, icon: "folder" },
          { group: "known", name: "Робочий стіл", path: String.raw`C:\Users\me\Desktop`, icon: "desktop" },
          { group: "known", name: "Завантаження", path: String.raw`C:\Users\me\Downloads`, icon: "import" },
          { group: "drive", name: "Локальний диск (C:)", path: "C:\\", icon: "drive" },
        ];
      }
      if (command === "list_scripts") return { pythonAvailable: false, scripts: [
        { name: "backup", path: String.raw`C:\Users\me\Desktop\backup.ps1`, extension: "ps1", folder: "Desktop" },
        { name: "rename", path: String.raw`C:\Users\me\Documents\rename.py`, extension: "py", folder: "Documents" },
      ] };
      if (command === "check_update") native.update = { ...native.update, phase: "available", availableVersion: "2.0" };
      if (command === "download_update") native.update = { ...native.update, phase: "ready" };
      return null;
    } },
    event: { listen: async (name: string, listener: NativeListener) => {
      listeners.set(name, listener);
      if (deferSubscriptions) await new Promise<void>((resolve) => resolveListeners.push(resolve));
      return () => { unsubscribed.push(name); listeners.delete(name); };
    } },
  } });
  return {
    calls, listeners, unsubscribed, removeMedia, resolveListeners,
    native: () => native,
    emit: async (name: string, payload?: unknown) => { await act(async () => { emit(name, payload); await idle(); }); },
    replace: async (next: AppState) => { native = next; await act(async () => { emit("state:changed", structuredClone(next)); await idle(); }); },
    queue: async (event: AppEvent) => { queued.push(event); await act(async () => { emit("app:event", event); await idle(); }); },
    theme: async (matches: boolean) => { Object.assign(media, { matches }); await act(async () => { media.dispatchEvent(new Event("change")); await idle(); }); },
  };
}

async function mount() { await act(async () => { root!.render(<App />); await idle(); }); }
// Dialogs, select listboxes and toasts render in portals, so look through the whole document.
function element<T extends Element = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector); expect(node, selector).not.toBeNull(); return node!;
}
async function mouseDown(selector: string) {
  await act(async () => { element(selector).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); await idle(); });
}
async function key(selector: string, name: string, times = 1) {
  for (let i = 0; i < times; i++) await act(async () => { element(selector).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: name })); element(selector).dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: name })); await idle(); });
}
function options() { return [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent); }
async function choose(trigger: string, label: string) {
  await key(trigger, "Enter");
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent === label);
  expect(item, label).toBeDefined();
  await act(async () => { item!.click(); await idle(); });
}
async function click(selector: string) {
  await act(async () => { element<HTMLElement>(selector).click(); await idle(); });
}
async function change(selector: string, value: string, eventName = "change") {
  const input = element<HTMLInputElement | HTMLSelectElement>(selector);
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event(eventName, { bubbles: true })); await idle();
  });
}
// Paths are Windows paths, so their backslashes are escaped for the attribute selector.
const tile = (kind: string, path: string) => `[data-${kind}="${path.replaceAll("\\", "\\\\")}"]`;
async function submitDialog() {
  await act(async () => { element("#editor-dialog form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await idle(); });
}

Object.assign(Element.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} });

describe("React editor shell and native events", () => {
  it("navigates, saves controls and appearance, and ignores stale snapshots", async () => {
    const env = setup(); await mount();
    expect([...env.listeners.keys()]).toEqual(["state:changed", "update:changed", "app:event"]);
    expect(element("#workspace").textContent).toContain("Мої меню");
    expect(element("#status-card").textContent).toContain("Orbit активний");
    await click('#navigation [data-page="controls"]');
    expect(element('#navigation [data-page="controls"]').getAttribute("aria-current")).toBe("page");
    expect(document.activeElement).toBe(element("#workspace"));
    const trigger = element<HTMLElement>("#triggerButton"); trigger.focus();
    element("#workspace").scrollTop = 84;
    await key("#triggerButton", "Enter");
    expect(options()).toEqual(["Mouse 4 · назад", "Mouse 5 · вперед"]);
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent === "Mouse 5 · вперед")!.click(); await idle(); });
    expect(env.native().settings.triggerButton).toBe(5);
    expect(document.activeElement).toBe(element("#triggerButton"));
    expect(element("#workspace").scrollTop).toBe(84);
    await click("#enabled");
    expect(env.native().settings.enabled).toBe(false);
    expect(element("#status-card").textContent).toContain("Призупинено");
    await click('#navigation [data-page="settings"]');
    await click('#workspace [data-theme="light"]');
    expect(env.native().settings.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    element<HTMLElement>('#wheelSize [role="slider"]').focus();
    await key('#wheelSize [role="slider"]', "ArrowRight", 5);
    expect(element("#size-value").textContent).toBe("125%");
    expect(env.native().settings.wheelSize).toBe(650);
    await click('[data-action="reset-size"]');
    expect(env.native().settings.wheelSize).toBe(520);
    await click('#workspace [data-theme="system"]');
    expect(document.documentElement.dataset.theme).toBe("dark");
    await env.theme(true);
    expect(document.documentElement.dataset.theme).toBe("light");
    await env.replace({ ...env.native(), revision: 30, settings: { ...env.native().settings, reducedMotion: true } });
    await env.emit("state:changed", { ...env.native(), revision: 2, settings: { ...env.native().settings, reducedMotion: false } });
    expect(document.documentElement.dataset.reducedMotion).toBe("true");
    expect(env.calls.filter(({ command }) => command === "save_settings").every(({ args }) => (args.settings as Settings).menus[0].name === "Основне")).toBe(true);
  });

  it("retains search, selection and keyboard focus through native state updates", async () => {
    const env = setup(); await mount();
    await click('[data-action="select-action"][data-id="editor"]');
    expect(element('[data-action="select-action"][data-id="editor"]').getAttribute('aria-pressed')).toBe('true');
    await env.replace({ ...env.native(), revision: 20 });
    expect(element('[data-action="select-action"][data-id="editor"]').getAttribute("aria-pressed")).toBe("true");
    await click('#navigation [data-page="library"]');
    await change("#action-search", "Немає редактора", "input");
    const search = element<HTMLInputElement>("#action-search"); search.focus(); search.setSelectionRange(3, 5);
    await env.replace({ ...env.native(), revision: 21 });
    expect(document.activeElement).toBe(search);
    expect(search.value).toBe("Немає редактора");
    expect([search.selectionStart, search.selectionEnd]).toEqual([3, 5]);
    expect(element("#result-count").textContent).toBe("0 дій");
    expect(element("#library-results").textContent).toContain("Дій не знайдено");
  });

  it("creates menus and confirms deletion",async () => {
    const env = setup(); await mount();
    await click('[data-action="create-menu"]');
    expect(element("#editor-dialog").getAttribute("data-state")).toBe("open");
    await change("#menu-name", "   ", "input"); await submitDialog();
    expect(element("#menu-name-error").textContent).toBe("Введіть назву меню.");
    expect(element("#menu-name").getAttribute("aria-invalid")).toBe("true");
    expect(env.native().settings.menus).toHaveLength(1);
    await change("#menu-name", "  Робота  ", "input");
    expect(document.querySelector("#menu-name-error")).toBeNull();
    await submitDialog();
    expect(env.native().settings.menus).toHaveLength(2);
    expect(env.native().settings.menus[1].name).toBe("Робота");
    expect(env.native().settings.activeMenuId).toBe(env.native().settings.menus[1].id);
    expect(document.querySelector("#editor-dialog")).toBeNull();
    await mouseDown('[data-action="activate-menu"][data-id="one"]');
    await click('[data-action="delete-action"][data-id="editor"]');
    expect(element("#editor-dialog").textContent).toContain("Видалити дію?");
    expect(env.native().settings.menus[0].items).toHaveLength(1);
    await submitDialog();
    expect(env.native().settings.menus[0].items).toHaveLength(0);
    expect(element("#workspace").textContent).toContain("Додайте першу дію");
  });

  it("adds, edits and reorders actions through the real dialog", async () => {
    const env = setup(); await mount();
    const menu = () => env.native().settings.menus.find((entry) => entry.id === env.native().settings.activeMenuId)!;
    const before = menu().items.length;
    await click('[data-action="add-action"]');
    expect(element("#action-dialog").getAttribute("data-state")).toBe("open");
    await act(async () => { element("#action-dialog form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await idle(); });
    expect(element("#action-error").textContent).toContain("назву");
    await click('[data-installed="Firefox"]');
    expect((element("#action-target") as HTMLInputElement).value).toBe(String.raw`C:\Apps\firefox.exe`);
    expect((element("#action-name") as HTMLInputElement).value).toBe("Firefox");
    await change("#action-name", "Нотатки", "input");
    await click('[data-kind="system"]');
    await click('[data-system="notepad"]');
    await act(async () => { element("#action-dialog form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await idle(); });
    expect(document.querySelector("#action-dialog")).toBeNull();
    expect(menu().items).toHaveLength(before + 1);
    const added = menu().items.at(-1)!;
    expect([added.name, added.kind, added.target]).toEqual(["Нотатки", "system", "notepad"]);
    await click(`[data-action="move-up"][data-id="${added.id}"]`);
    expect(menu().items.at(-2)!.id).toBe(added.id);
    await click(`[data-action="edit-action"][data-id="${added.id}"]`);
    await change("#action-name", "Блокнот Windows", "input");
    await act(async () => { element("#action-dialog form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await idle(); });
    expect(menu().items.find((item) => item.id === added.id)!.name).toBe("Блокнот Windows");
  });

  it("picks folders and scripts from tiles, by keyboard, and keeps manual paths", async () => {
    const env = setup(); await mount();
    const menu = () => env.native().settings.menus.find((entry) => entry.id === env.native().settings.activeMenuId)!;
    await click('[data-action="add-action"]');
    await click('[data-kind="folder"]');
    expect(element('[data-kind="folder"]').getAttribute("tabindex")).toBe("0");
    expect(element('[data-kind="app"]').getAttribute("tabindex")).toBe("-1");
    expect(element("#folder-tiles").textContent).toContain("Швидкий доступ");
    expect(element("#folder-tiles").textContent).toContain("Диски");
    await click(tile("folder", String.raw`C:\Users\me\Desktop`));
    expect((element("#action-target") as HTMLInputElement).value).toBe(String.raw`C:\Users\me\Desktop`);
    expect((element("#action-name") as HTMLInputElement).value).toBe("Робочий стіл");
    expect(element(tile("folder", String.raw`C:\Users\me\Desktop`)).getAttribute("aria-current")).toBe("true");
    // A later pick replaces the suggested name; the arrows walk the tiles and Enter/click picks.
    element<HTMLElement>(tile("folder", String.raw`C:\Users\me\Desktop`)).focus();
    await key(tile("folder", String.raw`C:\Users\me\Desktop`), "ArrowRight");
    expect(document.activeElement?.getAttribute("data-folder")).toBe(String.raw`C:\Users\me\Downloads`);
    await key(tile("folder", String.raw`C:\Users\me\Downloads`), "Home");
    expect(document.activeElement?.getAttribute("data-folder")).toBe(String.raw`D:\Projects`);
    await click(tile("folder", String.raw`D:\Projects`));
    expect((element("#action-name") as HTMLInputElement).value).toBe("Проєкти");
    // Typed names stay; typed paths still work.
    await change("#action-name", "Мої проєкти", "input");
    await click(tile("folder", String.raw`C:\Users\me\Downloads`));
    expect((element("#action-name") as HTMLInputElement).value).toBe("Мої проєкти");
    await change("#action-target", String.raw`E:\Archive`, "input");
    expect(document.querySelector('[data-folder][aria-current="true"]')).toBeNull();
    await act(async () => { element("#action-dialog form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await idle(); });
    expect([menu().items.at(-1)!.kind, menu().items.at(-1)!.target, menu().items.at(-1)!.name]).toEqual(["folder", String.raw`E:\Archive`, "Мої проєкти"]);

    await click('[data-action="add-action"]');
    await click('[data-kind="script"]');
    expect(element("#script-tiles").textContent).toContain(".ps1 · Desktop");
    await click(tile("script", String.raw`C:\Users\me\Documents\rename.py`));
    expect((element("#action-name") as HTMLInputElement).value).toBe("rename");
    expect(element("#python-missing").textContent).toContain("Python не знайдено");
    await key('[data-kind="script"]', "ArrowLeft");
    expect(document.activeElement?.getAttribute("data-kind")).toBe("folder");
    expect(element('[data-kind="folder"]').getAttribute("aria-checked")).toBe("true");
    // The suggested script name does not follow into another kind; Windows commands suggest their own.
    expect((element("#action-name") as HTMLInputElement).value).toBe("");
    await click('[data-kind="system"]');
    expect((element("#action-name") as HTMLInputElement).value).toBe("Провідник");
    await click('[data-system="notepad"]');
    expect((element("#action-name") as HTMLInputElement).value).toBe("Блокнот");
  });

  it("falls back to manual entry when the folder list cannot be read", async () => {
    setup({ failFolders: true }); await mount();
    await click('[data-action="add-action"]');
    await click('[data-kind="folder"]');
    expect(element('#folder-tiles [role="alert"]').textContent).toContain("Доступ заборонено.");
    await change("#action-target", String.raw`D:\Work`, "input");
    expect((element("#action-target") as HTMLInputElement).value).toBe(String.raw`D:\Work`);
  });

  it("tells the user when the installed-app list cannot be read instead of reporting no results", async () => {
    setup({ failCatalog: true }); await mount();
    await click('[data-action="add-action"]');
    expect(element("#installed-apps").textContent).toContain("Не вдалося прочитати список програм");
    expect(element("#installed-apps").textContent).not.toContain("Нічого не знайдено");
  });

  it("recovers from a failed state read using retry without duplicating subscriptions", async () => {
    const env = setup({ failFirstRead: true }); await mount();
    expect(element("#workspace").textContent).toContain("Не вдалося завантажити Orbit");
    expect(element("#workspace").textContent).not.toContain("Error:");
    await click('[data-action="retry"]');
    expect(element("#workspace").textContent).toContain("Програми, папки та команди");
    expect(env.calls.filter(({ command }) => command === "get_state")).toHaveLength(2);
    expect(env.listeners.size).toBe(3);
  });

  it("drains retained native events once, refreshes updates and forwards titlebar commands", async () => {
    const env = setup(); await mount();
    await env.queue({ type: "toast", message: "Збережено", error: false });
    await env.emit("app:event", { type: "toast", message: "Збережено", error: false });
    await vi.waitFor(() => expect(document.body.textContent).toContain("Збережено"));
    expect([...document.querySelectorAll("[data-sonner-toast]")].some((node) => node.textContent?.includes("Збережено"))).toBe(true);
    await click('#navigation [data-page="settings"]');
    const reads = env.calls.filter(({ command }) => command === "get_state").length;
    await env.emit("update:changed");
    expect(env.calls.filter(({ command }) => command === "get_state")).toHaveLength(reads + 1);
    await click('[data-action="check-update"]'); await click('[data-action="download-update"]'); await click('[data-action="install-update"]');
    expect(env.calls.some(({ command }) => command === "install_update")).toBe(true);
    for (const action of ["minimize", "toggle_maximize", "hide"]) await click(`[data-window="${action}"]`);
    await act(async () => {
      element("#brand").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
      element("#brand").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await idle();
    });
    expect(env.calls.filter(({ command }) => command === "window_command").map(({ args }) => args.action)).toEqual(["minimize", "toggle_maximize", "hide", "drag", "toggle_maximize"]);
    await click('#navigation [data-page="menus"]'); await click('[data-action="preview"]');
    expect(env.calls.some(({ command }) => command === "open_wheel_preview")).toBe(true);
    await act(async () => { root!.unmount(); root = null; await idle(); });
    expect(env.unsubscribed).toEqual(["state:changed", "update:changed", "app:event"]);
    expect(env.removeMedia).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("unsubscribes listeners whose asynchronous registration finishes after unmount", async () => {
    const env = setup({ deferSubscriptions: true }); await mount();
    expect(env.resolveListeners.length).toBeGreaterThan(0);
    await act(async () => { root!.unmount(); root = null; await idle(); });
    await act(async () => { for (const resolve of env.resolveListeners.splice(0)) resolve(); await idle(); });
    expect(env.listeners.size).toBe(0);
    expect(env.unsubscribed.length).toBeGreaterThan(0);
    expect(env.calls.some(({ command }) => command === "get_state")).toBe(false);
  });
});
