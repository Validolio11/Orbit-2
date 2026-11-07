const SYSTEM_ACTIONS = new Set(['explorer', 'task-manager', 'screenshot', 'mute', 'volume-up', 'volume-down', 'desktop', 'settings', 'lock', 'media-play',
  'control-panel', 'recycle-bin', 'search', 'run', 'task-view', 'clipboard', 'emoji', 'dictation', 'notifications', 'sound-settings', 'bluetooth',
  'media-prev', 'media-next', 'calculator', 'notepad', 'close-window', 'minimize-window', 'maximize-window', 'desktop-next', 'desktop-prev']);
const ACTION_KINDS = new Set(['app', 'folder', 'script', 'system', 'keys', 'text', 'group']);
const ACCENTS = ['blue', 'violet', 'green', 'amber', 'rose', 'mono'];
// Global shortcuts that open the wheel; '' turns the keyboard shortcut off.
// Each menu can have its own shortcut that opens the wheel straight on that menu.
const MENU_HOTKEYS = Array.from({ length: 9 }, (_, index) => `Control+Alt+${index + 1}`);
const HOTKEYS = ['Control+Space', 'Control+Shift+Space', 'Control+Alt+Space', 'Alt+Shift+Space', 'Control+`', ''];
const { validatePackagedTarget } = require('./app-catalog.cjs');
const { parseShortcut } = require('./shortcuts.cjs');

function string(value, name, maximum = 4096) {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) throw new Error(`Invalid ${name}.`);
  return value;
}

function validateAction(value, depth = 0, ids = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid action.');
  if (depth > 4) throw new Error('Groups can have at most four nested levels.');
  const id = string(value.id, 'action ID', 100);
  if (!id || ids.has(id)) throw new Error('Action IDs must be unique and nonempty.');
  ids.add(id);
  if (!ACTION_KINDS.has(value.kind)) throw new Error('Unsupported action kind.');
  const result = { id, name: string(value.name, 'action name', 100).trim(), kind: value.kind,
    target: string(value.target ?? '', 'target'), args: string(value.args ?? '', 'arguments'), icon: string(value.icon ?? '', 'icon', 100), children: [] };
  if (!result.name) throw new Error('An action needs a name.');
  if (/^app-id:/i.test(result.target)) {
    if (value.kind !== 'app') throw new Error('Ідентифікатор застосунку Windows можна використовувати лише для застосунків.');
    validatePackagedTarget(result.target, result.args);
  }
  if (value.kind === 'system' && !SYSTEM_ACTIONS.has(result.target)) throw new Error('Unsupported Windows action.');
  if (value.kind === 'keys') { result.target = parseShortcut(result.target).text; result.args = ''; }
  if (value.kind === 'text') {
    if (!result.target) throw new Error('Додайте текст, який потрібно вставити.');
    result.args = '';
  }
  if (value.kind === 'group') {
    // A group either opens a nested wheel or, as a sequence, runs all of its actions in order.
    result.target = result.target === 'sequence' ? 'sequence' : '';
    if (!Array.isArray(value.children) || value.children.length > 12) throw new Error('A group can contain up to 12 actions.');
    result.children = value.children.map(child => validateAction(child, depth + 1, ids));
  }
  return result;
}

function validateState(value) {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 1024 * 1024) throw new Error('Invalid or oversized configuration.');
  // Version 1 is Orbit's format; Orbit 2 reads it unchanged and adds its own preferences with defaults.
  if (value.version !== 1 && value.version !== 2) throw new Error('Unsupported configuration version.');
  if (value.accent !== undefined && !ACCENTS.includes(value.accent)) throw new Error('Invalid accent color.');
  if (value.hotkey !== undefined && !HOTKEYS.includes(value.hotkey)) throw new Error('Invalid keyboard shortcut.');
  for (const key of ['wheelLabels', 'contextMenus', 'autoBackup', 'gameMode']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`Invalid ${key} preference.`);
  if (!['dark', 'light', 'system'].includes(value.theme)) throw new Error('Invalid theme.');
  if (![4, 5].includes(value.triggerButton)) throw new Error('Choose mouse button 4 or 5.');
  if (!['release', 'hover', 'click'].includes(value.activationMode)) throw new Error('Invalid activation mode.');
  if (value.groupOpenMode !== undefined && !['hover', 'click'].includes(value.groupOpenMode)) throw new Error('Invalid group open mode.');
  if (!Number.isInteger(value.hoverDelay) || value.hoverDelay < 150 || value.hoverDelay > 2000) throw new Error('Hover delay must be between 150 and 2000 ms.');
  if (typeof value.enabled !== 'boolean' || typeof value.reducedMotion !== 'boolean') throw new Error('Invalid preference values.');
  if (value.closeOnOutsideClick !== undefined && typeof value.closeOnOutsideClick !== 'boolean') throw new Error('Invalid outside-click preference.');
  if (value.launchAtLogin !== undefined && typeof value.launchAtLogin !== 'boolean') throw new Error('Invalid start-with-Windows preference.');
  if (value.wheelAddSlot !== undefined && typeof value.wheelAddSlot !== 'boolean') throw new Error('Invalid wheel add-slot preference.');
  if (value.introPending !== undefined && typeof value.introPending !== 'boolean') throw new Error('Invalid introduction preference.');
  if (value.wheelSize !== undefined && (!Number.isInteger(value.wheelSize) || value.wheelSize < 312 || value.wheelSize > 780)) throw new Error('Wheel size must be an integer between 312 and 780 DIP.');
  if (!Array.isArray(value.menus) || !value.menus.length || value.menus.length > 20) throw new Error('Create between 1 and 20 menus.');
  const ids = new Set(), menuHotkeys = new Set();
  const menus = value.menus.map(menu => {
    if (!menu || typeof menu !== 'object') throw new Error('Invalid menu.');
    const id = string(menu.id, 'menu ID', 100);
    if (!id || ids.has(id)) throw new Error('Menu IDs must be unique.');
    ids.add(id);
    if (!Array.isArray(menu.items) || menu.items.length > 12) throw new Error('Each wheel can have up to 12 actions.');
    const name = string(menu.name, 'menu name', 100).trim();
    if (!name) throw new Error('A menu needs a name.');
    const apps = validateMenuApps(menu.apps);
    const hotkey = menu.hotkey ?? '';
    if (hotkey && (!MENU_HOTKEYS.includes(hotkey) || menuHotkeys.has(hotkey))) throw new Error('Menu shortcuts must be distinct Ctrl+Alt+1…9 keys.');
    if (hotkey) menuHotkeys.add(hotkey);
    return { id, name, icon: string(menu.icon ?? 'orbit', 'menu icon', 100), ...(apps.length ? { apps } : {}), ...(hotkey ? { hotkey } : {}), items: menu.items.map(item => validateAction(item, 0, ids)) };
  });
  if (!menus.some(menu => menu.id === value.activeMenuId)) throw new Error('The active menu does not exist.');
  return { version: 2, accent: value.accent ?? 'blue', hotkey: value.hotkey ?? 'Control+Space', wheelLabels: value.wheelLabels ?? true,
    contextMenus: value.contextMenus ?? true, autoBackup: value.autoBackup ?? true, gameMode: value.gameMode ?? true, theme: value.theme, triggerButton: value.triggerButton, activationMode: value.activationMode, groupOpenMode: value.groupOpenMode ?? 'hover',
    hoverDelay: value.hoverDelay, enabled: value.enabled, reducedMotion: value.reducedMotion, closeOnOutsideClick: value.closeOnOutsideClick ?? true, launchAtLogin: value.launchAtLogin ?? true,
    wheelAddSlot: value.wheelAddSlot ?? true, introPending: value.introPending ?? false, wheelSize: value.wheelSize ?? 520, menus, activeMenuId: value.activeMenuId };
}

// A menu can be linked to programs by their executable file names; the wheel then opens that menu over them.
function programName(value) {
  if (typeof value !== 'string') return '';
  return value.split(/[\\/]/).pop().trim().toLowerCase();
}
function validateMenuApps(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) throw new Error('A menu can be linked to up to 30 programs.');
  const names = value.map(name => {
    const result = programName(string(name, 'program name', 260));
    if (!/^[^<>:"|?*\x00-\x1f]+\.exe$/i.test(result)) throw new Error('Linked programs must be .exe file names.');
    return result;
  });
  return [...new Set(names)];
}
function menuForProgram(state, exePath) {
  const name = programName(exePath);
  if (!state || state.contextMenus === false || !name) return null;
  return state.menus.find(menu => menu.apps?.includes(name)) || null;
}

function parseArguments(value) {
  const args = []; let current = '', quoted = false, started = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\') {
      let slashes = 1;
      while (value[index + 1] === '\\') { slashes++; index++; }
      if (value[index + 1] === '"') {
        current += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2) { current += '"'; index++; }
        else { quoted = !quoted; index++; }
      } else current += '\\'.repeat(slashes);
      started = true;
    }
    else if (char === '"') {
      if (quoted && value[index + 1] === '"') { current += '"'; index++; }
      else quoted = !quoted;
      started = true;
    }
    else if (/\s/.test(char) && !quoted) { if (started) { args.push(current); current = ''; started = false; } }
    else { current += char; started = true; }
  }
  if (quoted) throw new Error('Закрийте лапки в аргументах.');
  if (started) args.push(current);
  return args;
}

function wheelGeometry(point, area, wheelSize = 520) {
  const side = Math.max(600, wheelSize + 80);
  const width = Math.min(side, area.width), height = Math.min(side, area.height);
  const x = Math.round(Math.max(area.x, Math.min(point.x - width / 2, area.x + area.width - width)));
  const y = Math.round(Math.max(area.y, Math.min(point.y - height / 2, area.y + area.height - height)));
  return { bounds: { x, y, width, height }, center: { x: width / 2, y: height / 2 } };
}

function wheelMountSize(bounds, wheelSize = 520) {
  return Math.max(0, Math.min(wheelSize, bounds.width - 30, bounds.height - 60));
}

function pointIsOutsideWheel(point, bounds, wheelSize = 520) {
  if (![point?.x, point?.y, bounds?.x, bounds?.y, bounds?.width, bounds?.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return false;
  const mountSize = wheelMountSize(bounds, wheelSize);
  const radius = 207 / 480 * mountSize;
  const x = point.x - bounds.x - bounds.width / 2;
  const y = point.y - bounds.y - bounds.height / 2;
  return Math.hypot(x, y) > radius;
}

function shouldCloseWheelOnClick(event, visible, closeOnOutsideClick, bounds, wheelSize = 520) {
  return visible === true && closeOnOutsideClick === true && event?.type === 'click' && ['left', 'right', 'middle'].includes(event.button) && pointIsOutsideWheel(event, bounds, wheelSize);
}

// Turns a path dragged in from Explorer into an action, or null when Orbit cannot launch it.
function droppedAction(filePath, isDirectory) {
  const base = filePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || filePath;
  if (isDirectory) return { kind: 'folder', name: base, target: filePath };
  const extension = (/\.[^.\\/]+$/.exec(base)?.[0] || '').toLowerCase();
  const name = base.slice(0, base.length - extension.length) || base;
  if (['.exe', '.lnk'].includes(extension)) return { kind: 'app', name, target: filePath };
  if (['.ps1', '.py', '.js', '.cjs'].includes(extension)) return { kind: 'script', name, target: filePath };
  return null;
}

// Windows shell and Orbit's own processes are never offered as "add the program you are in".
const SHELL_PROCESSES = new Set(['explorer.exe', 'applicationframehost.exe', 'searchhost.exe', 'searchapp.exe', 'shellexperiencehost.exe',
  'startmenuexperiencehost.exe', 'textinputhost.exe', 'lockapp.exe', 'systemsettings.exe', 'orbit2.input.exe', 'orbit.input.exe']);
function foregroundCandidate(exePath, ownExe) {
  if (typeof exePath !== 'string' || !/^[a-z]:\\.+\.exe$/i.test(exePath) || exePath.length > 1024) return false;
  if (typeof ownExe === 'string' && exePath.toLowerCase() === ownExe.toLowerCase()) return false;
  return !SHELL_PROCESSES.has(exePath.split('\\').pop().toLowerCase());
}

module.exports = { ACCENTS, HOTKEYS, MENU_HOTKEYS, programName, menuForProgram, foregroundCandidate, droppedAction, validateAction, validateState, parseArguments, wheelGeometry, wheelMountSize, pointIsOutsideWheel, shouldCloseWheelOnClick };
