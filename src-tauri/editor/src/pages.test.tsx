import { test, assert } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { ActionEntry, AppState, Settings, UpdatePhase } from "./types";
import type { PageProps, PageUI } from "./components/types";
import { MenusPage } from "./components/MenusPage";
import { ActionsPage } from "./components/ActionsPage";
import { ControlsPage } from "./components/ControlsPage";
import { SettingsPage } from "./components/SettingsPage";
import { ActionList } from "./components/ActionList";
import { Icon } from "./components/Facet";
import { filterActions } from "./editor-state";
import { action, snapshot } from "./test-fixtures";

const ui = (): PageUI => ({ selected: null, search: "", adminBusy: false, dataBusy: false, updateBusy: false });
function state(): AppState {
  const value = snapshot();
  value.settings.triggerButton = 5;
  value.settings.activeMenuId = "main";
  value.settings.menus = [{ id: "main", name: "Робота", icon: "orbit", items: [
    action({ id: "app", name: "Редактор", kind: "app", target: "C:\\Code.exe" }),
    action({ id: "group", name: "Інструменти", kind: "group" }),
  ] }];
  return value;
}
const noop = () => {};
const props = (value: AppState, ui: PageUI): PageProps => ({ state: value, ui, onPage: noop, onSelect: noop, onSearch: noop, onPatch: noop, onActivateMenu: noop, onCommand: noop });
const menusPage = (value: AppState, ui: PageUI) => renderToStaticMarkup(<MenusPage {...props(value, ui)} />);
const libraryPage = (value: AppState, ui: PageUI) => renderToStaticMarkup(<ActionsPage {...props(value, ui)} />);
const controlsPage = (value: AppState, ui: PageUI) => renderToStaticMarkup(<ControlsPage {...props(value, ui)} />);
const settingsPage = (value: AppState, ui: PageUI) => renderToStaticMarkup(<SettingsPage {...props(value, ui)} />);
const actionList = (entries: (Pick<ActionEntry, "action"> & Partial<ActionEntry>)[], selected: string | null, { library = false } = {}) => renderToStaticMarkup(<ActionList entries={entries} selected={selected} library={library} onSelect={noop} onDelete={noop} onCommand={noop} />);
const libraryResults = (settings: Settings, ui: PageUI) => {
  const entries = filterActions(settings, ui.search);
  return { count: entries.length, html: actionList(entries, ui.selected, { library: true }) };
};
const icon = (name: string) => renderToStaticMarkup(<Icon name={name} />);
const esc = (value: ReactNode) => renderToStaticMarkup(<span>{value}</span>).slice(6, -7);

const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gu)].map(([markup]) => markup);
const actionButton = (html: string, action: string) => buttons(html).find((markup) => markup.includes(`data-action="${action}"`))!;
// Radix Select and Slider fill in their values on the client, so static markup only proves the controls exist; values are checked in App.test.
const hasControl = (html: string, id: string, role: string) => new RegExp(`<[^>]*id="${id}"[^>]*role="${role}"|<[^>]*role="${role}"[^>]*id="${id}"`, "u").test(html);

test("page templates escape user names, identifiers, paths, search and native errors", () => {
  const snapshot = state(), malicious = '"><img src=x onerror="boom">&\'М';
  snapshot.settings.menus[0].name = malicious;
  Object.assign(snapshot.settings.menus[0].items[0], { name: malicious, id: malicious, target: malicious });
  snapshot.runtime.hookError = malicious;
  snapshot.update = { ...snapshot.update, phase: "error", currentVersion: malicious, error: malicious };
  for (const html of [menusPage(snapshot, ui()), libraryPage(snapshot, { ...ui(), search: malicious }), controlsPage(snapshot, ui()), settingsPage(snapshot, ui())]) {
    assert.ok(!html.includes("<img src=x"));
    assert.ok(!html.includes('onerror="boom"'));
    assert.ok(html.includes(esc(malicious)));
  }
});

test("untrusted icon names cannot resolve inherited object properties", () => {
  for (const name of ["__proto__", "constructor", "toString", "missing-icon"]) {
    assert.strictEqual(icon(name), icon("app"), name);
    assert.doesNotThrow(() => actionList([{ action: action({ id: "one", name: "Дія", kind: "app", icon: name }) }], null));
  }
});

test("controls expose the native setting controls and runtime availability", () => {
  const snapshot = state(), html = controlsPage(snapshot, ui());
  for (const id of ["triggerButton", "activationMode", "groupOpenMode", "hoverDelay"]) assert.ok(hasControl(html, id, "combobox"), id);
  for (const setting of ["enabled", "launchAtLogin", "wheelAddSlot", "closeOnOutsideClick"]) assert.match(html, new RegExp(`data-toggle="${setting}"`, "u"));
  assert.match(html, /Ctrl \+ Space/u);
  assert.match(html, /Доступний у будь-якій програмі/u);
  snapshot.settings.activationMode = "click";
  snapshot.runtime.admin.available = false;
  const changed = controlsPage(snapshot, ui());
  assert.ok(!hasControl(changed, "hoverDelay", "combobox"));
  assert.ok(buttons(changed).find((markup) => markup.includes('data-toggle="admin"'))!.includes(" disabled=\"\""));
});

test("settings use real percent bounds, persistent theme modes and data actions", () => {
  const html = settingsPage(state(), ui());
  assert.match(html, /id="size-value"[^>]*>100%</u);
  assert.ok(actionButton(html, "reset-size").includes(" disabled=\"\""));
  assert.ok(!actionButton(html, "export").includes(" disabled=\"\""));
  assert.ok(!actionButton(html, "import").includes(" disabled=\"\""));
  for (const theme of ["light", "dark", "system"]) assert.ok(buttons(html).some((markup) => markup.includes(`data-theme="${theme}"`)));
  assert.match(html, /Замінює поточні меню/u);
  const snapshot = state(); snapshot.settings.wheelSize = 780;
  const busy = settingsPage(snapshot, { ...ui(), dataBusy: true });
  assert.match(busy, /id="size-value"[^>]*>150%</u);
  assert.ok(!actionButton(busy, "reset-size").includes(" disabled=\"\""));
  assert.ok(actionButton(busy, "export").includes(" disabled=\"\""));
  assert.ok(actionButton(busy, "import").includes(" disabled=\"\""));
});

test("update templates show real progress and gate check, download and install", () => {
  for (const phase of ["idle", "checking", "available", "downloading", "ready", "installing", "error"]) {
    const snapshot = state(); snapshot.update = { ...snapshot.update, phase: phase as UpdatePhase, currentVersion: "1.0", availableVersion: "2.0", progress: 42.5 };
    const html = settingsPage(snapshot, ui());
    assert.strictEqual(actionButton(html, "check-update").includes(" disabled=\"\""), ["checking", "downloading", "installing"].includes(phase), phase);
    const download = actionButton(html, "download-update"), install = actionButton(html, "install-update");
    assert.strictEqual(Boolean(download), ["available", "downloading"].includes(phase), phase);
    assert.strictEqual(Boolean(install), ["ready", "installing"].includes(phase), phase);
    if (download) assert.strictEqual(download.includes(" disabled=\"\""), phase !== "available");
    if (install) assert.strictEqual(install.includes(" disabled=\"\""), phase !== "ready");
    const progress = html.match(/<div\b[^>]*role="progressbar"[^>]*>/u)?.[0];
    assert.ok(progress!.includes('aria-valuenow="42.5"'));
    assert.strictEqual(progress!.includes(" hidden=\"\""), phase !== "downloading");
  }
});

test("row tools and add buttons are real, enabled controls and actions remain selectable", () => {
  const snapshot = state(), html = menusPage(snapshot, ui());
  for (const command of ["add-action", "move-up", "move-down", "edit-action"]) assert.ok(!actionButton(html, command).includes(" disabled=\"\""), command);
  assert.ok(!html.includes('data-action="todo"'));
  assert.ok(!actionButton(html, "select-action").includes(" disabled=\"\""));
  assert.ok(!actionButton(html, "delete-action").includes(" disabled=\"\""));
  for (const label of ["Перемістити вгору", "Перемістити вниз", "Редагувати дію", "Видалити Інструменти"]) assert.ok(html.includes(`aria-label="${label}"`));
  const nested = actionList([{ action: snapshot.settings.menus[0].items[0], groupIds: ["parent"] }], null, { library: true });
  assert.match(nested, /aria-label="Перемістити на рівень вище"/u);
});

test("library empty results include count and helpful copy without a fake active add button", () => {
  const snapshot = state(), result = libraryResults(snapshot.settings, { ...ui(), search: "неіснуюча дія" });
  assert.strictEqual(result.count, 0);
  assert.match(result.html, /Дій не знайдено/u);
  assert.match(result.html, /Спробуйте іншу назву/u);
  assert.strictEqual(buttons(result.html).length, 0);
  const html = libraryPage(snapshot, { ...ui(), search: "неіснуюча дія" });
  assert.match(html, /id="result-count" role="status">0 дій/u);
  assert.ok(!actionButton(html, "add-action").includes(" disabled=\"\""));
});


