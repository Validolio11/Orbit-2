import { test, assert } from "vitest";
import type { AppState, Settings, UpdatePhase } from "./types";
import { fixture, snapshot } from "./test-fixtures";
import {
  activeMenu, flattenActions, filterActions, actionsWord, statusLabel,
  wheelPercent, wheelSize, updatePresentation, removeAction, createSettingsStore, addAction, updateAction, moveAction, moveOut, fileStem,
} from "./editor-state";

const deferred = () => {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("active menu falls back safely without changing native settings", () => {
  const settings = fixture();
  assert.strictEqual(activeMenu(settings)!.id, "work");
  settings.activeMenuId = "home";
  assert.strictEqual(activeMenu(settings)!.id, "home");
  settings.activeMenuId = "missing";
  assert.strictEqual(activeMenu(settings)!.id, "work");
  assert.strictEqual(settings.activeMenuId, "missing");
  assert.strictEqual(activeMenu({ menus: [] }), null);
  assert.strictEqual(activeMenu(null), null);
});

test("library includes groups and descendants with independent paths and menu context", () => {
  const settings = fixture(), before = structuredClone(settings);
  const entries = flattenActions(settings);
  assert.deepEqual(entries.map(({ action }) => action.id), ["editor", "tools", "docs", "scripts", "build", "lock"]);
  assert.strictEqual(entries.length, 6);
  assert.strictEqual(activeMenu(settings)!.items.length, 2);
  assert.strictEqual(entries[4].menu.name, "Робота");
  assert.deepEqual(entries[4].path, ["Інструменти", "Автоматизація"]);
  assert.deepEqual(entries[4].groupIds, ["tools", "scripts"]);
  assert.strictEqual(entries[4].context, "Робота / Інструменти / Автоматизація");
  assert.deepEqual(entries[5].path, []);
  assert.deepEqual(entries[5].groupIds, []);
  assert.deepEqual(settings, before);
  assert.deepEqual(flattenActions(null), []);
});

test("library filtering matches Ukrainian names, kind, menu, groups and target paths", () => {
  const settings = fixture();
  const ids = (query: string) => filterActions(settings, query).map(({ action }) => action.id);
  assert.deepEqual(ids("  РЕДАКТОР  "), ["editor"]);
  assert.deepEqual(ids("застосунок"), ["editor"]);
  assert.deepEqual(ids("Windows"), ["lock"]);
  assert.deepEqual(ids("ДІМ"), ["lock"]);
  assert.deepEqual(ids("Інструменти"), ["tools", "docs", "scripts", "build"]);
  assert.deepEqual(ids("Автоматизація"), ["scripts", "build"]);
  assert.deepEqual(ids("d:\\archive"), ["docs"]);
  assert.deepEqual(ids("скрипт"), ["build"]);
  assert.deepEqual(ids("неіснуюче"), []);
  assert.strictEqual(ids("   ").length, 6);
});

test("action removal copies settings and removes nested actions without changing siblings", () => {
  const settings = fixture(), before = structuredClone(settings);
  const menus = removeAction(settings, "build");
  assert.deepEqual(settings, before);
  assert.deepEqual(menus[0].items[1].children[1].children, []);
  assert.strictEqual(menus[0].items[1].children[0].id, "docs");
  assert.deepEqual(removeAction(settings, "unknown"), settings.menus);
  const removedGroup = removeAction(settings, "tools");
  assert.deepEqual(removedGroup[0].items.map((item) => item.id), ["editor"]);
});

test("Ukrainian counts preserve singular, small plurals and teen exceptions", () => {
  for (const count of [1, 21, 101, 121]) assert.strictEqual(actionsWord(count), "дію", String(count));
  for (const count of [2, 3, 4, 22, 23, 24, 102]) assert.strictEqual(actionsWord(count), "дії", String(count));
  for (const count of [0, 5, 10, 11, 12, 13, 14, 15, 20, 25, 111, 112, 114]) assert.strictEqual(actionsWord(count), "дій", String(count));
});

test("runtime status distinguishes paused, ready, failed and starting", () => {
  assert.strictEqual(statusLabel({ enabled: false }, { hookReady: true, hookError: "error" }), "Призупинено");
  assert.strictEqual(statusLabel({ enabled: true }, { hookReady: true, hookError: "old error" }), "Orbit активний");
  assert.strictEqual(statusLabel({ enabled: true }, { hookError: "error" }), "Миша недоступна");
  assert.strictEqual(statusLabel({ enabled: true }, { hookError: "" }), "Запуск модуля миші…");
});

test("wheel percent respects 60–150 bounds and five percent steps", () => {
  assert.strictEqual(wheelSize(60), 312);
  assert.strictEqual(wheelSize(100), 520);
  assert.strictEqual(wheelSize(150), 780);
  assert.strictEqual(wheelSize(-50), 312);
  assert.strictEqual(wheelSize(999), 780);
  assert.strictEqual(wheelSize(62), 312);
  assert.strictEqual(wheelSize(63), 338);
  assert.strictEqual(wheelSize("105"), 546);
  for (let percent = 60; percent <= 150; percent += 5) {
    assert.strictEqual(wheelPercent(wheelSize(percent)), percent);
  }
});

test("updater shows percent on a 0–100 scale and gates commands by phase", () => {
  const gates = {
    idle: [false, false, false], checking: [true, false, false],
    available: [false, true, false], upToDate: [false, false, false],
    downloading: [true, false, false], ready: [false, false, true],
    installing: [true, false, false], error: [false, false, false],
  };
  for (const [phase, expected] of Object.entries(gates)) {
    const view = updatePresentation({ phase: phase as UpdatePhase, progress: 73.6, availableVersion: "2.0", error: "Помилка мережі" });
    assert.deepEqual([view.busy, view.canDownload, view.canInstall], expected, phase);
    assert.strictEqual(view.phase, phase);
    assert.strictEqual(view.progress, 73.6);
  }
  assert.strictEqual(updatePresentation({ phase: "downloading", progress: 73.6 }).message, "Завантаження 74%…");
  assert.strictEqual(updatePresentation({ phase: "downloading", progress: 100 }).progress, 100);
  assert.strictEqual(updatePresentation({ progress: 150 }).progress, 100);
  assert.strictEqual(updatePresentation({ progress: -5 }).progress, 0);
  assert.strictEqual(updatePresentation({ progress: null }).progress, 0);
  assert.strictEqual(updatePresentation({ phase: "available", availableVersion: "2.0" }).message, "Доступна версія 2.0.");
  assert.strictEqual(updatePresentation({ phase: "error", error: "Помилка мережі" }).message, "Помилка мережі");
});

test("settings saves serialize patches against canonical snapshots and preserve unrelated settings", async () => {
  let native = snapshot(), active = 0, maxActive = 0;
  const requests: Settings[] = [], saves: ReturnType<typeof deferred>[] = [];
  const store = createSettingsStore({
    save: async (settings) => {
      requests.push(structuredClone(settings)); active++; maxActive = Math.max(maxActive, active);
      const save = deferred(); saves.push(save); await save.promise;
      native = snapshot(native.revision + 1, structuredClone(settings)); active--;
    },
    refresh: async () => structuredClone(native), changed: () => {}, failed: (error) => assert.fail(String(error)),
  });
  const initial = structuredClone(native);
  store.receive(native);
  const first = store.patch({ theme: "light" });
  const second = store.patch({ triggerButton: 5 });
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(store.view()!.settings.theme, "light");
  assert.strictEqual(store.view()!.settings.triggerButton, 5);
  assert.strictEqual(store.busy, true);
  saves[0].resolve(); await settle();
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[1].theme, "light");
  assert.strictEqual(requests[1].triggerButton, 5);
  assert.deepEqual(requests[1].menus, initial.settings.menus);
  saves[1].resolve(); await Promise.all([first, second]);
  assert.strictEqual(maxActive, 1);
  assert.strictEqual(store.busy, false);
  assert.strictEqual(store.view()!.revision, 3);
  assert.strictEqual(store.view()!.settings.theme, "light");
  assert.strictEqual(store.view()!.settings.triggerButton, 5);
  assert.deepEqual(initial.settings, fixture());
});

test("a failed write rolls back only its edit while later edits still save", async () => {
  let native = snapshot();
  const firstSave = deferred(), requests: Settings[] = [], errors: unknown[] = [], views: AppState[] = [];
  const store = createSettingsStore({
    save: async (settings) => {
      requests.push(structuredClone(settings));
      if (requests.length === 1) return firstSave.promise;
      native = snapshot(2, structuredClone(settings));
    },
    refresh: async () => native,
    changed: (value) => value && views.push(structuredClone(value)), failed: (error) => errors.push(error),
  });
  store.receive(native);
  const first = store.patch({ theme: "light" }), second = store.patch({ reducedMotion: true });
  const error = new Error("disk full"); firstSave.reject(error);
  await Promise.all([first, second]);
  assert.deepEqual(errors, [error]);
  assert.strictEqual(requests[1].theme, "dark");
  assert.strictEqual(requests[1].reducedMotion, true);
  assert.strictEqual(store.view()!.settings.theme, "dark");
  assert.strictEqual(store.view()!.settings.reducedMotion, true);
  assert.ok(views.some((view) => view.settings.theme === "dark" && view.settings.reducedMotion));
});

test("new native revisions preserve pending edits and obsolete events cannot regress state", async () => {
  const gate = deferred(), secondGate = deferred(), firstNative = snapshot(1), views: AppState[] = [], requests: Settings[] = [];
  let canonical = snapshot(4, { ...fixture(), theme: "light", triggerButton: 5, enabled: false });
  const store = createSettingsStore({
    save: async (settings) => { requests.push(structuredClone(settings)); await (requests.length === 1 ? gate.promise : secondGate.promise); },
    refresh: async () => canonical, changed: (view) => view && views.push(structuredClone(view)), failed: (error) => assert.fail(String(error)),
  });
  store.receive(firstNative);
  const first = store.patch({ theme: "light" }), second = store.patch({ reducedMotion: true });
  store.receive(snapshot(3, { ...fixture(), triggerButton: 5, enabled: false }));
  assert.strictEqual(store.view()!.revision, 3);
  assert.strictEqual(store.view()!.settings.theme, "light");
  assert.strictEqual(store.view()!.settings.reducedMotion, true);
  assert.strictEqual(store.view()!.settings.triggerButton, 5);
  assert.strictEqual(store.view()!.settings.enabled, false);
  const count = views.length;
  store.receive(firstNative);
  assert.strictEqual(views.length, count);
  gate.resolve(); await settle();
  assert.strictEqual(requests[1].triggerButton, 5);
  assert.strictEqual(requests[1].enabled, false);
  assert.strictEqual(requests[1].reducedMotion, true);
  canonical = snapshot(5, { ...canonical.settings, reducedMotion: true });
  secondGate.resolve();
  await Promise.all([first, second]);
  store.receive(snapshot(2));
  assert.strictEqual(store.view()!.revision, 5);
  assert.strictEqual(store.view()!.settings.enabled, false);
  assert.strictEqual(store.view()!.settings.reducedMotion, true);
});

test("a stale post-save refresh does not replace a newer native event", async () => {
  const gate = deferred();
  const store = createSettingsStore({
    save: async () => gate.promise,
    refresh: async () => snapshot(2), changed: () => {}, failed: (error) => assert.fail(String(error)),
  });
  store.receive(snapshot(1));
  const saved = store.patch({ theme: "light" });
  store.receive(snapshot(9, { ...fixture(), theme: "light", enabled: false }));
  gate.resolve(); await saved;
  assert.strictEqual(store.view()!.revision, 9);
  assert.strictEqual(store.view()!.settings.theme, "light");
  assert.strictEqual(store.view()!.settings.enabled, false);
});



test("addAction, updateAction, moveAction and moveOut never mutate and respect group levels", () => {
  const settings = fixture(), before = structuredClone(settings);
  const fresh = { id: "new", name: "Нова", kind: "app" as const, target: "C:\a.exe", args: "", icon: "", children: [] };
  const added = addAction(settings, "work", fresh)!;
  assert.deepEqual(added.find((menu) => menu.id === "work")!.items.map((item) => item.id), ["editor", "tools", "new"]);
  assert.equal(addAction(settings, "missing", fresh), null);
  const full = structuredClone(settings); full.menus[1].items = Array.from({ length: 12 }, (_, i) => ({ ...fresh, id: `f${i}` }));
  assert.equal(addAction(full, "home", fresh), null);
  assert.equal(updateAction(settings, "docs", { name: "Архів" })![0].items[1].children[0].name, "Архів");
  assert.equal(updateAction(settings, "nope", { name: "x" }), null);
  assert.deepEqual(moveAction(settings, "editor", 1)![0].items.map((item) => item.id), ["tools", "editor"]);
  assert.equal(moveAction(settings, "editor", -1), null);
  assert.equal(moveAction(settings, "tools", 1), null);
  const out = moveOut(settings, "docs")!;
  assert.deepEqual(out[0].items.map((item) => item.id), ["editor", "tools", "docs"]);
  assert.deepEqual(out[0].items[1].children.map((item) => item.id), ["scripts"]);
  assert.equal(moveOut(settings, "editor"), null);
  assert.deepEqual(settings, before);
  assert.equal(fileStem(String.raw`C:\Program Files\Code\Code.exe`), "Code");
  assert.equal(fileStem(String.raw`C:\Users\Ivan\Documents\ `.trim()), "Documents");
});
