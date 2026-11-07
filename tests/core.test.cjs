const { test } = require('node:test');
const assert = require('node:assert/strict');
const { foregroundCandidate, droppedAction, validateState, validateAction, parseArguments, wheelGeometry, wheelMountSize, pointIsOutsideWheel, shouldCloseWheelOnClick } = require('../src/core.cjs');

const action = (id = 'item', kind = 'app', target = 'C:\\Apps\\Editor.exe') => ({ id, name: 'Дія', kind, target, args: '', icon: 'app', children: [] });
function configuration() {
  return { version: 1, theme: 'dark', triggerButton: 4, activationMode: 'release', hoverDelay: 350,
    enabled: true, reducedMotion: false, activeMenuId: 'main', menus: [{ id: 'main', name: 'Головне', icon: 'orbit', items: [action()] }] };
}

test('configuration is copied and unknown imported properties are discarded', () => {
  const input = configuration(); input.untrusted = true; input.menus[0].items[0].shell = true;
  const result = validateState(input);
  assert.equal(result.untrusted, undefined); assert.equal(result.menus[0].items[0].shell, undefined);
  result.menus[0].items[0].name = 'Changed';
  assert.equal(input.menus[0].items[0].name, 'Дія');
});

test('import rejects missing active menus and duplicate identifiers across groups', () => {
  const input = configuration(); input.activeMenuId = 'missing';
  assert.throws(() => validateState(input), /active menu/);
  input.activeMenuId = 'main';
  input.menus[0].items.push({ ...action('group', 'group', ''), children: [action()] });
  assert.throws(() => validateState(input), /unique/);
});

test('wheel capacity is 12 actions and group nesting is bounded', () => {
  const input = configuration(); input.menus[0].items = Array.from({ length: 12 }, (_, index) => action(`item-${index}`));
  assert.equal(validateState(input).menus[0].items.length, 12);
  input.menus[0].items.push(action('overflow'));
  assert.throws(() => validateState(input), /12/);
  let nested = action('leaf');
  for (let depth = 0; depth < 4; depth++) nested = { ...action(`group-${depth}`, 'group', ''), children: [nested] };
  assert.doesNotThrow(() => validateAction(nested));
  nested = { ...action('too-deep', 'group', ''), children: [nested] };
  assert.throws(() => validateAction(nested), /nested/);
});

test('Windows action targets are allowlisted and paths reject embedded NULs', () => {
  assert.equal(validateAction(action('volume', 'system', 'mute')).target, 'mute');
  assert.throws(() => validateAction(action('bad', 'system', 'shutdown /s')), /Unsupported Windows/);
  for (const target of ['control-panel', 'recycle-bin', 'search', 'run', 'task-view', 'clipboard', 'emoji', 'dictation', 'notifications', 'sound-settings', 'bluetooth', 'media-prev', 'media-next', 'calculator', 'notepad'])
    assert.equal(validateAction(action(target, 'system', target)).target, target);
  assert.throws(() => validateAction(action('bad', 'app', 'C:\\bad\0.exe')), /target/);
});

test('preferences are validated without coercion', () => {
  for (const patch of [{ version: 3 }, { triggerButton: 3 }, { theme: 'unknown' }, { enabled: 'true' }, { hoverDelay: 149 }, { hoverDelay: 2001 }, { activationMode: 'instant' }]) {
    assert.throws(() => validateState({ ...configuration(), ...patch }));
  }
  assert.throws(() => validateState({ ...configuration(), padding: 'x'.repeat(1024 * 1024) }), /oversized/);
});

test('argument parsing preserves quoted paths, empty args and escaped quotes', () => {
  assert.deepEqual(parseArguments('--project "D:\\Робота\\Scene 1.aep" --name="Orbit test" ""'), ['--project', 'D:\\Робота\\Scene 1.aep', '--name=Orbit test', '']);
  assert.deepEqual(parseArguments(String.raw`--label "Say \"hello\""`), ['--label', 'Say "hello"']);
  assert.deepEqual(parseArguments('$(anything) & text; next'), ['$(anything)', '&', 'text;', 'next']);
  assert.throws(() => parseArguments('"unfinished'), /лапки/);
});

test('edge-positioned wheel remains centered inside clamped monitor bounds', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(wheelGeometry({ x: 1910, y: 1030 }, area), { bounds: { x: 1320, y: 440, width: 600, height: 600 }, center: { x: 300, y: 300 } });
  assert.deepEqual(wheelGeometry({ x: 2, y: 2 }, area).bounds, { x: 0, y: 0, width: 600, height: 600 });
});

test('wheel placement handles negative monitor coordinates and small work areas', () => {
  assert.deepEqual(wheelGeometry({ x: -1900, y: -50 }, { x: -1920, y: -100, width: 1920, height: 1080 }).bounds, { x: -1920, y: -100, width: 600, height: 600 });
  assert.deepEqual(wheelGeometry({ x: 100, y: 100 }, { x: 0, y: 0, width: 480, height: 360 }), { bounds: { x: 0, y: 0, width: 480, height: 360 }, center: { x: 240, y: 180 } });
});

test('group open mode defaults to hover and accepts click', () => {
  assert.equal(validateState(configuration()).groupOpenMode, 'hover');
  assert.equal(validateState({ ...configuration(), groupOpenMode: 'click' }).groupOpenMode, 'click');
  assert.throws(() => validateState({ ...configuration(), groupOpenMode: 'release' }), /group open mode/);
});

test('start with Windows defaults on and keeps an explicit opt-out', () => {
  assert.equal(validateState(configuration()).launchAtLogin, true);
  assert.equal(validateState({ ...configuration(), launchAtLogin: false }).launchAtLogin, false);
  assert.throws(() => validateState({ ...configuration(), launchAtLogin: 'yes' }), /start-with-Windows/);
});

test('outside-click cancellation migrates old preferences and retains explicit opt-out', () => {
  assert.equal(validateState(configuration()).closeOnOutsideClick, true);
  assert.equal(validateState({ ...configuration(), closeOnOutsideClick: false }).closeOnOutsideClick, false);
  for (const value of [null, 'true', 1]) assert.throws(() => validateState({ ...configuration(), closeOnOutsideClick: value }), /outside-click/);
});

test('outside-click geometry includes the center, gaps and whole functional circle', () => {
  const bounds = { x: 100, y: 200, width: 600, height: 600 };
  const center = { x: 400, y: 500 }, radius = 207 / 480 * 520;
  assert.equal(pointIsOutsideWheel(center, bounds), false);
  assert.equal(pointIsOutsideWheel({ x: center.x + 70, y: center.y + 70 }, bounds), false);
  assert.equal(pointIsOutsideWheel({ x: center.x + radius, y: center.y }, bounds), false);
  assert.equal(pointIsOutsideWheel({ x: center.x + radius + .5, y: center.y }, bounds), true);
  assert.equal(pointIsOutsideWheel({ x: 101, y: 201 }, bounds), true);
  assert.equal(pointIsOutsideWheel({ x: 1200, y: 900 }, bounds), true);
});

test('outside-click geometry works in DIP on negative monitors and smaller overlays', () => {
  const bounds = { x: -1600, y: -200, width: 480, height: 360 };
  const center = { x: -1360, y: -20 }, radius = 207 / 480 * 300;
  assert.equal(pointIsOutsideWheel({ x: center.x, y: center.y - radius + .1 }, bounds), false);
  assert.equal(pointIsOutsideWheel({ x: center.x, y: center.y - radius - .1 }, bounds), true);
  assert.equal(pointIsOutsideWheel({ x: NaN, y: 0 }, bounds), false);
  assert.equal(pointIsOutsideWheel(center, { ...bounds, width: 0 }), false);
});

test('global-click filtering respects visibility, opt-out and action selection', () => {
  const bounds = { x: 0, y: 0, width: 600, height: 600 };
  const outside = { type: 'click', x: 1000, y: 1000, button: 'left' };
  for (const button of ['left', 'right', 'middle']) assert.equal(shouldCloseWheelOnClick({ ...outside, button }, true, true, bounds), true);
  assert.equal(shouldCloseWheelOnClick(outside, false, true, bounds), false);
  assert.equal(shouldCloseWheelOnClick(outside, true, false, bounds), false);
  assert.equal(shouldCloseWheelOnClick({ ...outside, type: 'down', button: 4 }, true, true, bounds), false);
  assert.equal(shouldCloseWheelOnClick({ ...outside, x: 300, y: 150 }, true, true, bounds), false);
  assert.equal(shouldCloseWheelOnClick({ ...outside, x: 300, y: 300 }, true, true, bounds), false);
});

test('wheel size migrates old settings and survives serialization without changing other user preferences', () => {
  assert.equal(validateState(configuration()).wheelSize, 520);
  for (const wheelSize of [312, 313, 520, 780]) {
    const original = { ...configuration(), wheelSize, closeOnOutsideClick: false, activationMode: 'hover', hoverDelay: 750 };
    const restored = validateState(JSON.parse(JSON.stringify(validateState(original))));
    assert.equal(restored.wheelSize, wheelSize);
    assert.equal(restored.closeOnOutsideClick, false);
    assert.equal(restored.hoverDelay, 750);
    assert.equal(restored.activationMode, 'hover');
    assert.deepEqual(restored.menus, original.menus);
  }
  for (const wheelSize of [311, 781, 520.5, '520', null, NaN, Infinity]) assert.throws(() => validateState({ ...configuration(), wheelSize }), /Wheel size/);
});

test('wheel windows retain the default minimum and grow or clip around larger circles', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(wheelGeometry({ x: 2, y: 2 }, area, 312).bounds, { x: 0, y: 0, width: 600, height: 600 });
  assert.deepEqual(wheelGeometry({ x: 1910, y: 1030 }, area, 780), { bounds: { x: 1060, y: 180, width: 860, height: 860 }, center: { x: 430, y: 430 } });
  const clipped = wheelGeometry({ x: -1800, y: -50 }, { x: -1920, y: -100, width: 720, height: 500 }, 780);
  assert.deepEqual(clipped, { bounds: { x: -1920, y: -100, width: 720, height: 500 }, center: { x: 360, y: 250 } });
  assert.equal(wheelMountSize(clipped.bounds, 780), 440);
  assert.equal(wheelMountSize({ width: 600, height: 600 }, 312), 312);
});

test('outside-click cancellation matches the applied circle size when preferences change mid-session', () => {
  const settings = validateState({ ...configuration(), wheelSize: 780 });
  const { bounds, center } = wheelGeometry({ x: 600, y: 500 }, { x: 0, y: 0, width: 1920, height: 1040 }, settings.wheelSize);
  const appliedSize = wheelMountSize(bounds, settings.wheelSize);
  settings.wheelSize = 312;
  const click = { type: 'click', button: 'left', x: bounds.x + center.x + 300, y: bounds.y + center.y };
  assert.equal(shouldCloseWheelOnClick(click, true, true, bounds, appliedSize), false);
  assert.equal(shouldCloseWheelOnClick(click, true, true, bounds, settings.wheelSize), true);
  const radius = 207 / 480 * appliedSize;
  assert.equal(pointIsOutsideWheel({ x: bounds.x + center.x + radius - .1, y: click.y }, bounds, appliedSize), false);
  assert.equal(pointIsOutsideWheel({ x: bounds.x + center.x + radius + .1, y: click.y }, bounds, appliedSize), true);
});

test('dropped Explorer paths become folder, app or script actions and other files are ignored', () => {
  assert.deepEqual(droppedAction('C:\\Projects\\Client.v2', true), { kind: 'folder', name: 'Client.v2', target: 'C:\\Projects\\Client.v2' });
  assert.deepEqual(droppedAction('C:\\', true), { kind: 'folder', name: 'C:', target: 'C:\\' });
  assert.deepEqual(droppedAction('C:\\Tools\\Blender.EXE', false), { kind: 'app', name: 'Blender', target: 'C:\\Tools\\Blender.EXE' });
  assert.equal(droppedAction('C:\\Users\\Me\\Desktop\\Figma.lnk', false).kind, 'app');
  assert.deepEqual(droppedAction('D:\\Scripts\\render.ps1', false), { kind: 'script', name: 'render', target: 'D:\\Scripts\\render.ps1' });
  for (const file of ['C:\\Docs\\notes.txt', 'C:\\Media\\clip.mp4', 'C:\\Tools\\README']) assert.equal(droppedAction(file, false), null);
});

test('only real programs in front are offered to the wheel "+" slot', () => {
  assert.equal(foregroundCandidate('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Orbit\\Orbit2.exe'), true);
  assert.equal(foregroundCandidate('C:\\Orbit\\Orbit2.exe', 'c:\\orbit\\orbit2.exe'), false);
  for (const shell of ['C:\\Windows\\explorer.exe', 'C:\\Windows\\System32\\ApplicationFrameHost.exe', 'C:\\Windows\\SystemApps\\SearchHost.exe'])
    assert.equal(foregroundCandidate(shell, 'C:\\Orbit\\Orbit2.exe'), false);
  for (const value of ['', null, 'chrome.exe', 'C:\\Docs\\file.txt', '\\\\server\\share\\app.exe']) assert.equal(foregroundCandidate(value, 'C:\\Orbit\\Orbit2.exe'), false);
});

test('wheel "+" slot defaults on, first-run hint defaults off for existing settings', () => {
  const settings = validateState(configuration());
  assert.equal(settings.wheelAddSlot, true);
  assert.equal(settings.introPending, false);
  assert.equal(validateState({ ...configuration(), wheelAddSlot: false, introPending: true }).wheelAddSlot, false);
  assert.throws(() => validateState({ ...configuration(), introPending: 1 }), /introduction/);
});
