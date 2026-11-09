const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseShortcut, KEY_NAMES } = require('../src/shortcuts.cjs');
const { validateState, validateAction, menuForProgram, programName } = require('../src/core.cjs');
const { createUsage, sanitize } = require('../src/usage.cjs');
const { createBackups } = require('../src/backups.cjs');
const { legacyPaths, readLegacyState, legacyRunValues } = require('../src/legacy.cjs');

const action = (id, kind = 'app', target = 'C:\\Apps\\Editor.exe') => ({ id, name: 'Дія ' + id, kind, target, args: '', icon: '', children: [] });
const legacyConfig = () => ({ version: 1, theme: 'dark', triggerButton: 4, activationMode: 'hover', hoverDelay: 350, enabled: true, reducedMotion: false,
  activeMenuId: 'main', menus: [{ id: 'main', name: 'Головне', icon: 'orbit', items: [action('a')] }] });
const temp = async t => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit2-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; };

test('shortcuts normalize names and order modifiers before the key', () => {
  assert.deepEqual(parseShortcut('shift+ctrl+t'), { text: 'Ctrl+Shift+T', keys: [0x11, 0x10, 0x54] });
  assert.deepEqual(parseShortcut('Alt+F4'), { text: 'Alt+F4', keys: [0x12, 0x73] });
  assert.deepEqual(parseShortcut('Win+Left').keys, [0x5B, 0x25]);
  assert.equal(parseShortcut('Ctrl+=').text, 'Ctrl+=');
  assert.equal(parseShortcut('Ctrl+Num+').text, 'Ctrl+Num+');
  assert.equal(parseShortcut('Control+Windows+D').text, 'Ctrl+Win+D');
  for (const bad of ['', 'Ctrl+Q+W', 'Ctrl+Banana', 'x'.repeat(65), null]) assert.throws(() => parseShortcut(bad));
});

test('every key the renderer can record is accepted by the main process', async () => {
  const { keyName, shortcutFromEvent, shortcutParts } = await import('../src/renderer/shortcut.mjs');
  const codes = ['KeyA', 'KeyZ', 'Digit0', 'Digit9', 'Numpad5', 'F1', 'F24', 'Enter', 'Escape', 'Tab', 'Space', 'ArrowUp', 'ArrowLeft', 'PageDown', 'Minus', 'Equal',
    'BracketLeft', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'Backslash', 'Backquote', 'NumpadAdd', 'NumpadDivide', 'AudioVolumeUp', 'MediaPlayPause', 'PrintScreen'];
  for (const code of codes) {
    const name = keyName(code);
    assert.ok(name && KEY_NAMES.includes(name), code);
    const recorded = shortcutFromEvent({ code, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
    assert.equal(recorded.complete, true);
    assert.equal(parseShortcut(recorded.text).text, recorded.text);
  }
  assert.deepEqual(shortcutFromEvent({ code: 'ControlLeft', ctrlKey: true }), { text: 'Ctrl', complete: false });
  assert.equal(shortcutFromEvent({ code: 'IntlRo' }), null);
  assert.deepEqual(shortcutParts('Ctrl+Num+'), ['Ctrl', 'Num+']);
});

test('keys and text actions are validated and normalized', () => {
  assert.equal(validateAction(action('k', 'keys', 'ctrl+shift+t')).target, 'Ctrl+Shift+T');
  assert.throws(() => validateAction(action('k', 'keys', 'Ctrl+Nope')), /не підтримується/);
  const text = validateAction({ ...action('t', 'text', '  Привіт,\nсвіт  '), args: 'ignored' });
  assert.equal(text.target, '  Привіт,\nсвіт  ');
  assert.equal(text.args, '');
  assert.throws(() => validateAction(action('t', 'text', '')), /текст/);
  for (const target of ['close-window', 'minimize-window', 'maximize-window', 'desktop-next', 'desktop-prev']) assert.equal(validateAction(action(target, 'system', target)).target, target);
});

test('Orbit settings upgrade to version 2 with Orbit 2 defaults and keep the menus', () => {
  const result = validateState(legacyConfig());
  assert.equal(result.version, 2);
  assert.deepEqual([result.accent, result.hotkey, result.wheelLabels, result.contextMenus, result.autoBackup], ['blue', 'Control+Space', true, true, true]);
  assert.deepEqual(result.menus[0].items.map(item => item.id), ['a']);
  assert.equal(result.menus[0].apps, undefined);
  const round = validateState(JSON.parse(JSON.stringify({ ...result, accent: 'rose', hotkey: '', wheelLabels: false })));
  assert.deepEqual([round.accent, round.hotkey, round.wheelLabels], ['rose', '', false]);
  for (const patch of [{ accent: 'purple' }, { hotkey: 'Ctrl+Q' }, { wheelLabels: 'yes' }, { contextMenus: 1 }, { autoBackup: null }]) assert.throws(() => validateState({ ...legacyConfig(), ...patch }));
});

test('menus linked to programs open over those programs only', () => {
  const config = legacyConfig();
  config.menus.push({ id: 'ps', name: 'Photoshop', icon: 'orbit', apps: ['C:\\Program Files\\Adobe\\Photoshop.EXE', 'photoshop.exe', 'chrome'.concat('.exe')], items: [action('b')] });
  const state = validateState(config);
  assert.deepEqual(state.menus[1].apps, ['photoshop.exe', 'chrome.exe']);
  assert.equal(menuForProgram(state, 'D:\\Adobe\\PHOTOSHOP.exe').id, 'ps');
  assert.equal(menuForProgram(state, 'C:\\Windows\\notepad.exe'), null);
  assert.equal(menuForProgram({ ...state, contextMenus: false }, 'D:\\photoshop.exe'), null);
  assert.equal(programName('C:/Tools/Blender.exe'), 'blender.exe');
  for (const apps of [['notepad.txt'], ['a<b.exe'], Array.from({ length: 31 }, (_, i) => `app${i}.exe`), 'chrome.exe'])
    assert.throws(() => validateState({ ...legacyConfig(), menus: [{ ...legacyConfig().menus[0], apps }] }));
});

test('usage counts launches per action and per day and survives a restart', async t => {
  const dir = await temp(t), file = path.join(dir, 'usage.json');
  let now = new Date(2026, 10, 7, 10, 0);
  const changes = [];
  const usage = createUsage({ file, now: () => now, onChange: value => changes.push(value) });
  await usage.record('a'); await usage.record('a'); now = new Date(2026, 10, 8, 9, 0); await usage.record('b');
  await usage.dispose();
  const reloaded = await createUsage({ file }).get();
  assert.equal(reloaded.actions.a.count, 2);
  assert.equal(reloaded.actions.b.last, now.toISOString());
  assert.deepEqual(reloaded.days, { '2026-11-07': 2, '2026-11-08': 1 });
  assert.equal(changes.length, 3);
  assert.deepEqual(sanitize({ actions: { x: { count: -1 }, y: { count: 2, last: 'bad' } }, days: { nope: 1 } }), { version: 1, actions: { y: { count: 2, last: null } }, days: {} });
  const reset = createUsage({ file });
  assert.deepEqual((await reset.reset()).actions, {});
  assert.deepEqual((await createUsage({ file }).get()).actions, {});
});

test('backups keep one automatic copy per day, list newest first and refuse unknown names', async t => {
  const dir = await temp(t);
  let now = new Date(2026, 10, 7, 9, 5, 7);
  const backups = createBackups({ dir, keep: 3, now: () => now });
  const config = JSON.stringify(validateState(legacyConfig()));
  assert.equal(await backups.daily(config), 'settings-2026-11-07.json');
  assert.equal(await backups.daily(config), null);
  assert.equal(await backups.manual(config), 'settings-2026-11-07-090507.json');
  now = new Date(2026, 10, 8); await backups.daily(config);
  now = new Date(2026, 10, 9); await backups.daily(config);
  const list = await backups.list();
  assert.deepEqual(list.map(entry => entry.name), ['settings-2026-11-09.json', 'settings-2026-11-08.json', 'settings-2026-11-07-090507.json']);
  assert.deepEqual([list[2].manual, list[2].date, list[0].menus, list[0].actions], [true, '2026-11-07 09:05', 1, 1]);
  assert.equal(await backups.read('settings-2026-11-09.json'), config);
  for (const name of ['../settings.json', 'settings.json', 'settings-2026-11-09.json.bak']) await assert.rejects(backups.read(name));
});

test('Orbit menus are imported from its settings or their backup copy', async t => {
  const dir = await temp(t), paths = legacyPaths({ appData: dir, localAppData: dir });
  assert.equal(paths.executable, path.join(dir, 'Programs', 'Orbit', 'Orbit.exe'));
  assert.equal(await readLegacyState(paths, validateState), null);
  await fs.mkdir(path.dirname(paths.settings), { recursive: true });
  await fs.writeFile(paths.settings, '{broken');
  await fs.writeFile(paths.settings + '.bak', JSON.stringify(legacyConfig()));
  const imported = await readLegacyState(paths, validateState);
  assert.equal(imported.version, 2);
  assert.equal(imported.menus[0].items[0].id, 'a');
});

test('closing Orbit removes only the sign-in entries that start its own Orbit.exe', () => {
  const output = [
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    '    com.creationsoft.orbit    REG_SZ    "C:\\Users\\Me\\AppData\\Local\\Programs\\Orbit\\Orbit.exe" --hidden',
    '    com.creationsoft.orbit2    REG_SZ    "C:\\Users\\Me\\AppData\\Local\\Programs\\Orbit 2\\Orbit2.exe" --hidden',
    '    Discord    REG_SZ    "C:\\Users\\Me\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe',
    '    Old Orbit    REG_EXPAND_SZ    c:\\users\\me\\appdata\\local\\programs\\orbit\\orbit.exe',
    '',
  ].join('\r\n');
  assert.deepEqual(legacyRunValues(output, 'C:\\Users\\Me\\AppData\\Local\\Programs\\Orbit\\Orbit.exe'), ['com.creationsoft.orbit', 'Old Orbit']);
  assert.deepEqual(legacyRunValues(output, ''), []);
  assert.deepEqual(legacyRunValues('', 'C:\\Orbit.exe'), []);
});

test('the hover arc follows its sector and covers the whole ring for a single action', async () => {
  const { sectorArc } = await import('../src/renderer/wheel.mjs');
  for (const count of [1, 2, 5, 12]) for (let index = 0; index < count; index++) assert.equal(/NaN|Infinity/.test(sectorArc(index, count)), false);
  assert.match(sectorArc(0, 4), /^M[\d.]+,[\d.]+ A216,216 0 0 1 /);
  assert.equal((sectorArc(0, 1).match(/A216/g) || []).length, 2);
});

test('groups are either nested wheels or sequences, and menu shortcuts are distinct Ctrl+Alt digits', () => {
  const group = target => ({ ...action('g', 'group', target), children: [action('c1'), action('c2', 'keys', 'Ctrl+C')] });
  assert.equal(validateAction(group('sequence')).target, 'sequence');
  assert.equal(validateAction(group('anything else')).target, '');
  const config = legacyConfig();
  config.menus[0].hotkey = 'Control+Alt+1';
  config.menus.push({ id: 'two', name: 'Друге', icon: 'orbit', hotkey: 'Control+Alt+2', items: [] });
  const state = validateState(config);
  assert.deepEqual(state.menus.map(menu => menu.hotkey), ['Control+Alt+1', 'Control+Alt+2']);
  assert.equal(validateState({ ...config, menus: config.menus.map(menu => ({ ...menu, hotkey: '' })) }).menus[0].hotkey, undefined);
  for (const hotkeys of [['Control+Alt+1', 'Control+Alt+1'], ['Control+Alt+0', ''], ['Control+Space', '']])
    assert.throws(() => validateState({ ...config, menus: config.menus.map((menu, index) => ({ ...menu, hotkey: hotkeys[index] })) }), /Menu shortcuts/);
});

test('game mode defaults on for Orbit settings and keeps an explicit opt-out', () => {
  assert.equal(validateState(legacyConfig()).gameMode, true);
  assert.equal(validateState({ ...legacyConfig(), gameMode: false }).gameMode, false);
  assert.throws(() => validateState({ ...legacyConfig(), gameMode: 'on' }), /gameMode/);
});

test('excluded programs are normalized .exe names and default to none', () => {
  assert.deepEqual(validateState(legacyConfig()).excludedApps, []);
  const state = validateState({ ...legacyConfig(), excludedApps: ['D:\\Games\\Game.EXE', 'game.exe', 'steam.exe'] });
  assert.deepEqual(state.excludedApps, ['game.exe', 'steam.exe']);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))).excludedApps, ['game.exe', 'steam.exe']);
  // The hook receives the list joined by "|", which no valid name may contain.
  for (const excludedApps of [['a|b.exe'], ['notes.txt'], 'game.exe', Array.from({ length: 31 }, (_, i) => `g${i}.exe`)])
    assert.throws(() => validateState({ ...legacyConfig(), excludedApps }));
});
