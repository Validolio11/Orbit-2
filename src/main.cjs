const { app, BrowserWindow, ipcMain, dialog, shell, screen, Tray, Menu, nativeImage, nativeTheme, globalShortcut, clipboard } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync, execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { writeDurable, readWithBackup } = require('./settings-file.cjs');
const { findRedirectedCopy } = require('./redirect-check.cjs');

const SMOKE = process.argv.includes('--smoke-test');
const E2E = process.argv.includes('--e2e');
const ISOLATED = SMOKE || E2E;
// Windows starts Orbit 2 with this flag at sign-in; it then waits in the tray without opening its window.
const HIDDEN = process.argv.includes('--hidden');
// Task Scheduler starts Orbit with --elevated-task when "start as administrator" is on (native/AdminTask.cs).
const ELEVATED_TASK = process.argv.includes('--elevated-task');
// --quit closes a running Orbit, including an elevated one that installers cannot stop themselves.
const QUIT = process.argv.includes('--quit');
// Popular programs added to a brand-new wheel when they are installed.
const FIRST_RUN_APPS = ['Google Chrome', 'Microsoft Edge', 'Firefox', 'Telegram', 'Visual Studio Code', 'Figma', 'Spotify', 'Discord', 'Notion', 'Slack',
  'Microsoft Word', 'Microsoft Excel', 'Zoom', 'Steam', 'Blender', 'OBS Studio'];
let firstRun = false, stateRecoveryFile = null, stateRecoveredFromBackup = false, redirectedAppData = null, migratedFromLegacy = false;
// The menu the open wheel shows: the active one, or the menu linked to the program in front.
let wheelMenuId = null, wheelMenuForced = false, registeredHotkey = '', registeredMenuHotkeys = [], usageSnapshot = null, trayTimer = null;
// Keyboard shortcuts step aside while a fullscreen game (game mode) or an excluded program is in front.
let hotkeysPaused = false, focusInfo = { fullscreen: false, excluded: false };
// The program that was in front when the wheel opened; the wheel's "+" adds it.
let wheelForeground = null;
const NATIVE = app.isPackaged && __dirname.includes('app.asar')
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'Orbit2.Input.exe')
  : path.join(__dirname, '..', 'native', 'Orbit2.Input.exe');
const PAGE = path.join(__dirname, 'renderer', 'index.html');
const APP_ICON = path.join(__dirname, '..', 'assets', 'orbit.ico');
const { menuForProgram, foregroundCandidate, droppedAction, validateAction, validateState, parseArguments, wheelGeometry, wheelMountSize, shouldCloseWheelOnClick } = require('./core.cjs');
const { parseShortcut } = require('./shortcuts.cjs');
const { createUsage } = require('./usage.cjs');
const { createBackups } = require('./backups.cjs');
const { legacyPaths, readLegacyState, isLegacyRunning } = require('./legacy.cjs');
const { createAppCatalog, validatePackagedTarget, isLocalAppPath } = require('./app-catalog.cjs');
const { createUpdater } = require('./updater.cjs');
const UPDATE_REPOSITORY = 'Validolio11/Orbit-2';
const UPDATE_REPOSITORY_URL = 'https://github.com/' + UPDATE_REPOSITORY;
let iconWorkers = 0;
const waitingIcons = [];

async function readHighResolutionIcon(target) {
  // Shell extraction runs in short-lived native processes rather than blocking Electron.
  if (iconWorkers < 2) iconWorkers++;
  else await new Promise(resolve => waitingIcons.push(resolve));
  try {
    return await new Promise(resolve => {
      const child = spawn(NATIVE, [`--icon=${target}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let chunks = [], bytes = 0, settled = false;
      const finish = image => { if (settled) return; settled = true; clearTimeout(timer); resolve(image); };
      const timer = setTimeout(() => { child.kill(); finish(null); }, 4000);
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1500 * 1024) { child.kill(); chunks = []; finish(null); }
        else chunks.push(chunk);
      });
      child.once('error', () => finish(null));
      child.once('close', code => {
        if (settled || code !== 0) { finish(null); return; }
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.width > 512 || value.height < 1 || value.height > 512 || typeof value.pixels !== 'string') { finish(null); return; }
          const bitmap = Buffer.from(value.pixels, 'base64');
          if (bitmap.length !== value.width * value.height * 4) { finish(null); return; }
          const image = nativeImage.createFromBitmap(bitmap, { width: value.width, height: value.height, scaleFactor: 1 });
          finish(image.isEmpty() ? null : image);
        } catch { finish(null); }
      });
    });
  } finally {
    const next = waitingIcons.shift();
    if (next) next();
    else iconWorkers--;
  }
}

const appCatalog = createAppCatalog({ cachePath: () => path.join(app.getPath('userData'), 'app-catalog.json'), loadIcon: async target => {
  if (process.platform === 'win32' && /^app-id:/.test(target)) {
    let appId;
    try { appId = validatePackagedTarget(target); } catch { return null; }
    return (await readHighResolutionIcon('shell:AppsFolder\\' + appId))?.toDataURL() || null;
  }
  if (!isLocalAppPath(target)) return null;
  if (!(await fsp.stat(target).catch(() => null))?.isFile()) return null;
  let iconTarget = target;
  if (/\.lnk$/i.test(target)) {
    try { const shortcut = shell.readShortcutLink(target); if (isLocalAppPath(shortcut.target) && (await fsp.stat(shortcut.target).catch(() => null))?.isFile()) iconTarget = shortcut.target; } catch { }
  }
  const image = await app.getFileIcon(iconTarget, { size: 'large' });
  if (image.isEmpty()) return null;
  const representation = image.getScaleFactors().reduce((best, factor) => {
    const buffer = image.toPNG({ scaleFactor: factor });
    return !best || buffer.readUInt32BE(16) > best.readUInt32BE(16) ? buffer : best;
  }, null) || image.toPNG();
  // Electron's Windows icon API can stop at 48 px. Ask the Shell for its original
  // 256 px frame when necessary; never enlarge a smaller bitmap to invent detail.
  if (process.platform === 'win32' && representation.readUInt32BE(16) < 128) {
    const shellIcon = await readHighResolutionIcon(iconTarget);
    if (shellIcon && shellIcon.getSize().width > representation.readUInt32BE(16)) return shellIcon.toDataURL();
  }
  return 'data:image/png;base64,' + representation.toString('base64');
} });
let mainWindow, overlayWindow, tray, state, statePath, quitting = false, hookProcess = null;
let overlayReady, wheelVisible = false, wheelSession = 0, pendingMouseOpen = false, pendingMouseRelease = null, configQueue = Promise.resolve();
let appliedWheelSize = 520;
let updater, usage, backups;
let runtime = { hookReady: false, outsideWatcherReady: false, hookError: null, shortcutRegistered: false, hotkey: '', migratedFromLegacy: false, legacyRunning: false, hotkeysPaused: false,
  adminStart: { available: false, enabled: false, elevated: false } };

function adobeExecutable(product, executable) {
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    const adobe = path.join(root, 'Adobe');
    let children = [];
    try { children = fs.readdirSync(adobe, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith(product)).map(entry => entry.name).sort().reverse(); } catch { }
    for (const child of children) {
      for (const suffix of [executable, path.join('Support Files', executable), path.join('Support Files', 'Contents', 'Windows', executable)]) {
        const candidate = path.join(adobe, child, suffix);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return '';
}

function defaultState() {
  const action = (id, name, kind, target, icon, children = []) => ({ id, name, kind, target, args: '', icon, children });
  // Only installed Adobe apps are offered, so a fresh wheel never starts with broken actions.
  const adobe = [
    action('illustrator', 'Illustrator', 'app', adobeExecutable('Adobe Illustrator', 'Illustrator.exe'), 'illustrator'),
    action('after-effects', 'After Effects', 'app', adobeExecutable('Adobe After Effects', 'AfterFX.exe'), 'after-effects'),
    action('photoshop', 'Photoshop', 'app', adobeExecutable('Adobe Photoshop', 'Photoshop.exe'), 'photoshop'),
  ].filter(item => item.target);
  const keys = (id, name, shortcut, icon) => action(id, name, 'keys', shortcut, icon);
  return { version: 2, accent: 'blue', hotkey: 'Control+Space', wheelLabels: true, contextMenus: true, autoBackup: true, gameMode: true,
    theme: 'dark', triggerButton: 4, activationMode: 'hover', groupOpenMode: 'hover', hoverDelay: 350, enabled: true, reducedMotion: false, closeOnOutsideClick: true, launchAtLogin: true,
    wheelAddSlot: true, introPending: true, wheelSize: 520,
    activeMenuId: 'main', menus: [{ id: 'main', name: 'Головне меню', icon: 'orbit', apps: [], items: [
      ...(adobe.length ? [action('adobe', 'Adobe', 'group', '', 'adobe', adobe)] : []),
      action('documents', 'Документи', 'folder', app.getPath('documents'), 'folder'),
      action('browser', 'Вебпошук', 'app', 'https://www.google.com', 'globe'),
      action('explorer', 'Провідник', 'system', 'explorer', 'files'),
      action('screenshot', 'Знімок екрана', 'system', 'screenshot', 'screenshot'),
      action('shortcuts', 'Редагування', 'group', '', 'keyboard', [
        keys('copy', 'Копіювати', 'Ctrl+C', 'copy'), keys('paste', 'Вставити', 'Ctrl+V', 'clipboard'), keys('undo', 'Скасувати', 'Ctrl+Z', 'undo'),
        keys('redo', 'Повторити', 'Ctrl+Y', 'redo'), keys('select-all', 'Виділити все', 'Ctrl+A', 'select'), keys('save', 'Зберегти', 'Ctrl+S', 'save'),
      ]),
      action('system', 'Система', 'group', '', 'windows', [
        action('task-manager', 'Диспетчер завдань', 'system', 'task-manager', 'activity'),
        action('mute', 'Вимкнути звук', 'system', 'mute', 'volume'),
        action('settings', 'Параметри Windows', 'system', 'settings', 'settings'),
        action('desktop-next', 'Наступний робочий стіл', 'system', 'desktop-next', ''),
        action('lock', 'Заблокувати', 'system', 'lock', 'lock'),
      ]),
    ] }] };
}

async function loadState() {
  try {
    const { value, source } = await readWithBackup(statePath, text => validateState(JSON.parse(text)));
    if (source === 'backup') {
      // The damaged main file is moved aside so the next save cannot copy it over the good backup.
      const damaged = `${statePath}.bad-${Date.now()}`;
      await fsp.rename(statePath, damaged).catch(() => {});
      console.warn('Orbit 2: settings restored from settings.json.bak.');
      stateRecoveryFile = damaged; stateRecoveredFromBackup = true;
    }
    return value;
  }
  catch (error) {
    if (error.code === 'ENOENT') {
      firstRun = true;
      // A first start next to the original Orbit brings its menus over instead of starting empty.
      if (!ISOLATED) {
        const legacy = await readLegacyState(legacyPaths({ appData: app.getPath('appData'), localAppData: process.env.LOCALAPPDATA }), validateState).catch(() => null);
        if (legacy) { migratedFromLegacy = true; return { ...legacy, introPending: true }; }
      }
      return defaultState();
    }
    // The broken file is moved aside so the next save cannot overwrite the user's menus.
    const backup = `${statePath}.bad-${Date.now()}`;
    await fsp.rename(statePath, backup).catch(() => {});
    console.warn('Orbit 2: configuration could not be loaded; using defaults.', error.message);
    stateRecoveryFile = backup;
    return defaultState();
  }
}

// Started by a packaged app (such as a Claude Desktop session), Orbit would save into that app's private
// copy of AppData, and the Orbit that Windows starts at sign-in would never see those menus. Explorer
// launches programs outside that virtualization, so Orbit restarts through it. A recent marker in the
// redirected folder means that restart did not help, and Orbit runs on with a warning instead of looping.
async function leaveRedirectedAppData() {
  const copy = await findRedirectedCopy(app.getPath('userData'), { appData: app.getPath('appData'), localAppData: process.env.LOCALAPPDATA }).catch(() => null);
  if (!copy) return false;
  const marker = path.join(app.getPath('userData'), 'redirected-restart');
  const lastRestart = await fsp.stat(marker).then(stat => stat.mtimeMs, () => 0);
  if (Date.now() - lastRestart < 60000) { console.warn(`Orbit: AppData is still redirected to ${copy}.`); redirectedAppData = copy; return false; }
  await fsp.writeFile(marker, '').catch(() => {});
  console.warn(`Orbit: AppData is redirected to ${copy}; restarting through Explorer.`);
  app.releaseSingleInstanceLock();
  spawn(path.join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe'), [process.execPath], { detached: true, stdio: 'ignore' }).unref();
  quitting = true; app.exit(0);
  return true;
}

function sendAll(channel, value) {
  for (const window of [mainWindow, overlayWindow]) if (window && !window.isDestroyed()) window.webContents.send(channel, value);
}
function updateRuntime(patch) { runtime = { ...runtime, ...patch }; sendAll('orbit:runtime-changed', runtime); }

// Keeps the Apps list version current after in-app updates of an installer-made copy.
function updateUninstallEntry() {
  if (!app.isPackaged || ISOLATED) return;
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Orbit 2';
  const reg = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'reg.exe');
  execFile(reg, ['query', key, '/v', 'InstallLocation'], { windowsHide: true }, (error, stdout) => {
    const location = /InstallLocation\s+REG_SZ\s+(.+)/.exec(stdout || '')?.[1]?.trim();
    if (error || !location || path.resolve(location).toLowerCase() !== path.dirname(process.execPath).toLowerCase()) return;
    execFile(reg, ['add', key, '/v', 'DisplayVersion', '/t', 'REG_SZ', '/d', app.getVersion(), '/f'], { windowsHide: true }, () => {});
  });
}

// A short history of starts tells whether Windows actually launched Orbit at sign-in.
async function logStartup() {
  const file = path.join(app.getPath('userData'), 'startup.log');
  const lines = (await fsp.readFile(file, 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean).slice(-49);
  const loginItem = app.isPackaged ? app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }).openAtLogin : false;
  lines.push(`${new Date().toISOString()} ${app.getVersion()} ${HIDDEN ? 'autostart' : 'manual'} login-item=${loginItem}${ELEVATED_TASK ? ' admin-task' : ''}`);
  await fsp.writeFile(file, lines.join('\n') + '\n', 'utf8');
}

function applyLoginItem() {
  if (!app.isPackaged || ISOLATED) return;
  try { app.setLoginItemSettings({ openAtLogin: state.launchAtLogin !== false, path: process.execPath, args: ['--hidden'] }); } catch (error) { console.error(error); }
}

// "Start as administrator" (native/AdminTask.cs): a Task Scheduler task starts Orbit elevated without a UAC prompt,
// so the side button also reaches programs that run as administrator. Every normal start, including the sign-in
// entry, hands over to that task before taking the single-instance lock and keeps --hidden or --quit.
function handOverToAdminTask() {
  if (process.platform !== 'win32' || !app.isPackaged || ISOLATED || ELEVATED_TASK || !fs.existsSync(NATIVE)) return false;
  const mode = QUIT ? '--quit' : HIDDEN ? '--hidden' : '--show';
  return spawnSync(NATIVE, [`--admin-task=start:${mode}`], { windowsHide: true, timeout: 15000 }).status === 0;
}

// Creating or removing the task waits for the user's UAC answer, so only the status query has a time limit.
function runAdminTask(command, timeout = 0) {
  return new Promise(resolve => {
    execFile(NATIVE, [`--admin-task=${command}`], { windowsHide: true, timeout }, (error, stdout, stderr) =>
      resolve({ code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

async function refreshAdminStart() {
  if (!app.isPackaged || ISOLATED || !fs.existsSync(NATIVE)) return;
  const result = await runAdminTask('status', 15000);
  try {
    const status = JSON.parse(result.stdout.trim());
    updateRuntime({ adminStart: { available: status.available === true, enabled: status.enabled === true, elevated: status.elevated === true } });
  } catch { console.warn('Orbit 2: could not read the administrator start status.', result.stderr.trim()); }
}

// Restarts Orbit with the new rights: elevated through the task, or unelevated through Explorer.
async function restartWithRights(elevated) {
  closeWheel(); await configQueue; await stopHook();
  app.releaseSingleInstanceLock();
  const started = elevated
    ? (await runAdminTask('start:--show', 15000)).code === 0
    : await startProcess(path.join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe'), [process.execPath], { detached: true }).then(() => true, () => false);
  if (started) { app.quit(); return true; }
  app.requestSingleInstanceLock(); startHook();
  return false;
}

async function setAdminStart(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Invalid administrator start preference.');
  await refreshAdminStart();
  if (!runtime.adminStart.available) return { ok: false, error: 'Запуск з правами адміністратора доступний у встановленому Orbit для облікового запису адміністратора.' };
  const result = await runAdminTask(enabled ? 'register' : 'remove');
  if (result.code === 4) return { ok: false, canceled: true };
  await refreshAdminStart();
  if (result.code !== 0 || runtime.adminStart.enabled !== enabled) {
    return { ok: false, error: `Windows не ${enabled ? 'створив' : 'видалив'} завдання запуску Orbit.${result.stderr.trim() ? ' ' + result.stderr.trim() : ''}` };
  }
  if (enabled !== runtime.adminStart.elevated && !(await restartWithRights(enabled))) {
    return { ok: false, error: 'Налаштування збережено, але Orbit не вдалося перезапустити. Закрийте Orbit і відкрийте його знову.' };
  }
  return { ok: true };
}

async function persistState(value) {
  const next = validateState(value);
  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  // The day's first save keeps the configuration as it was before that day's changes.
  if (next.autoBackup !== false && state) await backups.daily(JSON.stringify(state, null, 2)).catch(error => console.warn('Orbit 2: daily backup failed.', error.message));
  await writeDurable(statePath, JSON.stringify(next, null, 2));
  const hookChanged = state.triggerButton !== next.triggerButton || state.enabled !== next.enabled || state.gameMode !== next.gameMode || (state.excludedApps || []).join('|') !== (next.excludedApps || []).join('|');
  const menuKeys = value => value.menus.map(menu => `${menu.id}=${menu.hotkey || ''}`).join();
  const hotkeyChanged = state.hotkey !== next.hotkey || menuKeys(state) !== menuKeys(next);
  const previousGameMode = state.gameMode;
  state = next;
  if (hotkeyChanged) registerHotkey();
  else if (state.gameMode !== previousGameMode) updateHotkeyPause();
  nativeTheme.themeSource = state.theme;
  if (!state.enabled) closeWheel();
  applyLoginItem();
  sendAll('orbit:state-changed', state);
  if (hookChanged && !ISOLATED) { await stopHook(); startHook(); }
  updateTray();
  return state;
}

function saveState(value) {
  const result = configQueue.then(() => persistState(typeof value === 'function' ? value(state) : value));
  configQueue = result.catch(() => {});
  return result;
}

// A patch is merged into the state that is current when its turn in the queue comes,
// so it cannot undo a save that was queued just before it.
function patchState(patch) { return saveState(current => ({ ...current, ...patch })); }

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && wheelVisible) { event.preventDefault(); closeWheel(); }
  });
}

function createWindows() {
  const area = screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({ width: Math.min(1260, area.width), height: Math.min(860, area.height),
    minWidth: Math.min(1050, area.width), minHeight: Math.min(720, area.height), show: false, frame: false,
    title: 'Orbit 2', icon: APP_ICON, backgroundColor: state.theme === 'light' ? '#fafafa' : '#09090b',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  overlayWindow = new BrowserWindow({ width: 600, height: 600, show: false, frame: false, transparent: true,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, icon: APP_ICON, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  secureWindow(mainWindow); secureWindow(overlayWindow);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.on('close', event => { if (!quitting && !ISOLATED) { event.preventDefault(); mainWindow.hide(); } });
  overlayWindow.on('close', event => { if (!quitting) { event.preventDefault(); closeWheel(); } });
  overlayReady = overlayWindow.loadFile(PAGE, { query: { overlay: '1' } });
  const mainReady = mainWindow.loadFile(PAGE);
  mainReady.then(() => { if (!SMOKE && !HIDDEN && !quitting) mainWindow.show(); }).catch(reportStartupError);
  overlayReady.catch(reportStartupError);
  return Promise.all([mainReady, overlayReady]);
}

function reportStartupError(error) {
  console.error('Orbit 2 startup error:', error);
  if (!ISOLATED) dialog.showErrorBox('Orbit 2', `Не вдалося відкрити інтерфейс: ${error.message}`);
}

async function resolveForeground(exePath, session) {
  if (session !== wheelSession || !foregroundCandidate(exePath, process.execPath)) return;
  const match = await appCatalog.findExecutable(exePath).catch(() => null);
  if (session !== wheelSession) return;
  // Store apps cannot be started from their WindowsApps executable, only through their catalog entry.
  if (!match && /\\WindowsApps\\/i.test(exePath)) return;
  const base = path.basename(exePath, path.extname(exePath));
  wheelForeground = match || { name: base.charAt(0).toUpperCase() + base.slice(1), target: exePath, args: '' };
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('orbit:wheel-foreground', wheelForeground);
}

function wheelGroup(menu, groupPath) {
  let items = menu.items;
  for (const id of groupPath) {
    const group = items.find(item => item.id === id && item.kind === 'group');
    if (!group) throw new Error('Групу не знайдено.');
    items = group.children;
  }
  return items;
}

async function addWheelAction(groupPath, menuId) {
  if (!Array.isArray(groupPath) || groupPath.length > 20 || !groupPath.every(id => typeof id === 'string')) throw new Error('Invalid group path.');
  if (!wheelForeground) throw new Error('Не вдалося визначити програму.');
  const next = structuredClone(state);
  const items = wheelGroup(next.menus.find(menu => menu.id === menuId) || next.menus.find(menu => menu.id === next.activeMenuId), groupPath);
  if (items.length >= 12) throw new Error('У цьому колесі вже 12 дій.');
  const action = { id: randomUUID(), name: wheelForeground.name, kind: 'app', target: wheelForeground.target, args: wheelForeground.args || '', icon: 'app', children: [] };
  items.push(action);
  await saveState(next);
  return { ok: true, id: action.id, name: action.name };
}

// Folders offered as tiles: Explorer's Quick Access (pinned and frequent), standard folders and drives.
let quickAccessRequest = null;
function readQuickAccess() {
  if (quickAccessRequest) return quickAccessRequest;
  // Quick Access lists pinned and frequent folders; "This PC" gives drives with their Explorer labels.
  const script = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false;$shell=New-Object -ComObject Shell.Application;" +
    "@{quick=@($shell.Namespace('shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}').Items()|Where-Object {$_.IsFolder -and $_.Path -match '^[A-Za-z]:\\\\'}|Select-Object -First 24|ForEach-Object {@{name=$_.Name;path=$_.Path}});" +
    "drives=@($shell.Namespace('shell:MyComputerFolder').Items()|Where-Object {$_.Path -match '^[A-Za-z]:\\\\$'}|ForEach-Object {@{name=$_.Name;path=$_.Path}})}|ConvertTo-Json -Compress -Depth 4";
  const powershell = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  quickAccessRequest = new Promise(resolve => {
    let output = '', settled = false;
    const finish = rows => { if (settled) return; settled = true; clearTimeout(timer); resolve(rows); };
    const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const empty = { quick: [], drives: [] };
    const timer = setTimeout(() => { child.kill(); finish(empty); }, 5000);
    const rows = value => (Array.isArray(value) ? value : value ? [value] : []).filter(row => row && typeof row.name === 'string' && typeof row.path === 'string' && path.isAbsolute(row.path));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 65536) { child.kill(); finish(empty); } });
    child.once('error', () => finish(empty));
    child.once('close', () => {
      try { const result = JSON.parse(output.trim() || '{}'); finish({ quick: rows(result.quick), drives: rows(result.drives) }); }
      catch { finish(empty); }
    });
  });
  // Quick Access changes as the user works, so the answer is reused only briefly.
  quickAccessRequest.finally(() => setTimeout(() => { quickAccessRequest = null; }, 30000));
  return quickAccessRequest;
}

async function listFolders() {
  const known = [], drives = [], quick = [], seen = new Set();
  const add = (list, group, name, folderPath, icon) => {
    const key = path.resolve(folderPath).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key); list.push({ group, name: name.slice(0, 100), path: folderPath, icon });
  };
  // A disconnected network drive can stall for seconds; such folders are dropped instead of blocking Orbit.
  const reachable = folderPath => Promise.race([fsp.access(folderPath).then(() => true, () => false), new Promise(resolve => setTimeout(() => resolve(false), 1500))]);
  const shellFolders = process.platform === 'win32' && !ISOLATED ? await readQuickAccess() : { quick: [], drives: [] };
  // Standard folders keep Orbit's Ukrainian names even when Explorer reports English ones.
  for (const [key, name, icon] of [['desktop', 'Робочий стіл', 'desktop'], ['documents', 'Документи', 'folder'], ['downloads', 'Завантаження', 'import'], ['pictures', 'Зображення', 'image'], ['videos', 'Відео', 'film'], ['music', 'Музика', 'music'], ['home', 'Особиста папка', 'home']]) {
    try { add(known, 'known', name, app.getPath(key), icon); } catch { }
  }
  if (process.env.OneDrive) add(known, 'known', 'OneDrive', process.env.OneDrive, 'cloud');
  for (const row of shellFolders.drives) add(drives, 'drive', row.name, row.path, 'drive');
  if (process.platform === 'win32' && !drives.length) for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') add(drives, 'drive', `Диск ${letter}:`, `${letter}:\\`, 'drive');
  for (const row of shellFolders.quick) add(quick, 'quick', row.name, row.path, 'folder');
  const all = [...quick, ...known, ...drives];
  const present = await Promise.all(all.map(folder => reachable(folder.path)));
  return all.filter((_, index) => present[index]);
}

// Scripts offered as tiles: a shallow, bounded scan of the usual places and of folders that already hold script actions.
const SCRIPT_EXTENSIONS = new Set(['.ps1', '.py', '.js', '.cjs']);
const SKIPPED_FOLDERS = new Set(['node_modules', '.git', 'appdata', '$recycle.bin', 'windows', 'program files', 'program files (x86)', '__pycache__', '.venv', 'venv']);
async function listScripts() {
  // Folders of existing script actions come first so a large Documents tree cannot use up the budget;
  // network paths are skipped so opening the tab never contacts another machine.
  const roots = new Set();
  const walkActions = items => items.forEach(item => { if (item.kind === 'script' && /^[A-Za-z]:[\\/]/.test(item.target)) roots.add(path.dirname(item.target)); if (item.kind === 'group') walkActions(item.children); });
  state.menus.forEach(menu => walkActions(menu.items));
  for (const key of ['desktop', 'documents', 'downloads']) { try { roots.add(app.getPath(key)); } catch { } }
  const found = new Map();
  let visited = 0;
  async function walk(folder, depth) {
    if (visited++ > 600 || found.size >= 400) return;
    const entries = await fsp.readdir(folder, { withFileTypes: true }).catch(() => []);
    // The scripts of one folder are read together; subfolders are still walked one by one to keep the budget.
    const scripts = entries.filter(entry => entry.isFile() && SCRIPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
    const stats = await Promise.all(scripts.map(entry => fsp.stat(path.join(folder, entry.name)).catch(() => null)));
    scripts.forEach((entry, index) => {
      const full = path.join(folder, entry.name), extension = path.extname(entry.name).toLowerCase();
      if (stats[index] && found.size < 400) found.set(full.toLowerCase(), { name: path.basename(entry.name, extension), path: full, extension, folder: path.basename(folder), modified: stats[index].mtimeMs });
    });
    for (const entry of entries) {
      if (entry.isDirectory() && depth < 2 && !entry.name.startsWith('.') && !SKIPPED_FOLDERS.has(entry.name.toLowerCase())) await walk(path.join(folder, entry.name), depth + 1);
    }
  }
  for (const root of roots) await walk(root, 0);
  const scripts = [...found.values()].sort((left, right) => right.modified - left.modified).slice(0, 60).map(({ modified, ...script }) => script);
  return { scripts, python: !!pythonLauncherPath() };
}

// py.exe is what Orbit uses to run .py scripts; it lives in Windows or on PATH.
function pythonLauncherPath() {
  const candidates = [path.join(process.env.WINDIR || 'C:\\Windows', 'py.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Launcher', 'py.exe'),
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(folder => path.join(folder, 'py.exe'))];
  return candidates.find(candidate => path.isAbsolute(candidate) && (() => { try { return fs.statSync(candidate).isFile(); } catch { return false; } })()) || null;
}

async function seedFirstRunApps() {
  const snapshot = JSON.stringify(state);
  const found = await appCatalog.findNamed(FIRST_RUN_APPS).catch(() => []);
  if (!found.length || JSON.stringify(state) !== snapshot || migratedFromLegacy) return;
  const next = structuredClone(state), items = next.menus[0].items;
  // Leave one free slot so the wheel's "+" stays available.
  for (const entry of found.slice(0, Math.max(0, 11 - items.length)).reverse()) {
    items.unshift({ id: randomUUID(), name: entry.name, kind: 'app', target: entry.target, args: entry.args || '', icon: 'app', children: [] });
  }
  if (JSON.stringify(state) === snapshot) await saveState(next).catch(() => {});
}

async function showWheel(physicalPoint, trigger = 'preview', foregroundPath = '', forcedMenuId = null) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return { ok: false, error: 'Wheel unavailable.' };
  const session = ++wheelSession;
  wheelForeground = null;
  const forced = forcedMenuId && state.menus.some(menu => menu.id === forcedMenuId) ? forcedMenuId : null;
  const context = trigger === 'preview' || forced ? null : menuForProgram(state, foregroundPath);
  wheelMenuId = forced || context?.id || state.activeMenuId;
  wheelMenuForced = !!forced;
  if (trigger !== 'preview' && state.introPending) patchState({ introPending: false }).catch(() => {});
  pendingMouseOpen = trigger === 'mouse';
  pendingMouseRelease = null;
  const point = physicalPoint ? screen.screenToDipPoint(physicalPoint) : screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(point).workArea;
  const requestedWheelSize = state.wheelSize ?? 520;
  const { bounds } = wheelGeometry(point, area, requestedWheelSize);
  await overlayReady;
  if (session !== wheelSession || quitting) return { ok: false };
  overlayWindow.setBounds(bounds);
  const appliedBounds = overlayWindow.getBounds();
  const center = { x: appliedBounds.width / 2, y: appliedBounds.height / 2 };
  appliedWheelSize = wheelMountSize(appliedBounds, requestedWheelSize);
  wheelVisible = true;
  overlayWindow.webContents.send('orbit:wheel-open', { center, trigger, size: appliedWheelSize, menuId: wheelMenuId, context: !!context });
  if (trigger === 'mouse') overlayWindow.showInactive();
  else overlayWindow.show();
  // A window pinned on top (e.g. PowerToys Always On Top) and activated later sits above the
  // hidden wheel; raise the wheel to the top of the always-on-top windows on every open.
  overlayWindow.moveTop();
  pendingMouseOpen = false;
  if (pendingMouseRelease) { overlayWindow.webContents.send('orbit:trigger-release', pendingMouseRelease); pendingMouseRelease = null; }
  if (!ISOLATED) globalShortcut.register('Escape', closeWheel);
  return { ok: true };
}

function closeWheel() {
  wheelSession++;
  wheelVisible = false;
  pendingMouseOpen = false;
  pendingMouseRelease = null;
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  sendAll('orbit:wheel-closed', {});
  if (!ISOLATED) globalShortcut.unregister('Escape');
  return { ok: true };
}

function startHook() {
  if (quitting || ISOLATED || hookProcess) return;
  if (!fs.existsSync(NATIVE)) { updateRuntime({ hookReady: false, hookError: 'Модуль миші не зібрано. Виконайте npm run native.' }); return; }
  const child = spawn(NATIVE, [`--button=${state.enabled ? state.triggerButton : 0}`, `--parent-pid=${process.pid}`, `--game-mode=${state.gameMode !== false ? 1 : 0}`, ...(state.excludedApps?.length ? [`--exclude=${state.excludedApps.join('|')}`] : [])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  hookProcess = child;
  let buffer = '', errorText = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (hookProcess !== child) continue;
      if (event.type === 'ready') updateRuntime({ hookReady: state.enabled && event.button === state.triggerButton, outsideWatcherReady: true, hookError: null });
      else if (event.type === 'down' && state.enabled) {
        showWheel({ x: event.x, y: event.y }, 'mouse', event.foreground).catch(error => updateRuntime({ hookError: error.message }));
        resolveForeground(event.foreground, wheelSession).catch(() => {});
      }
      else if (event.type === 'foreground' && wheelVisible) {
        // The keyboard-opened wheel learns the program in front only now; switch to its linked menu.
        const context = wheelMenuForced ? null : menuForProgram(state, event.path);
        if (context && context.id !== wheelMenuId) { wheelMenuId = context.id; overlayWindow.webContents.send('orbit:wheel-menu', { menuId: context.id, context: true }); }
        resolveForeground(event.path, wheelSession).catch(() => {});
      }
      else if (event.type === 'click' && wheelVisible && state.closeOnOutsideClick && overlayWindow && !overlayWindow.isDestroyed()) {
        if (Number.isFinite(event.x) && Number.isFinite(event.y)) {
          const point = screen.screenToDipPoint({ x: event.x, y: event.y });
          if (shouldCloseWheelOnClick({ ...event, ...point }, wheelVisible, state.closeOnOutsideClick, overlayWindow.getBounds(), appliedWheelSize)) closeWheel();
        }
      }
      else if (event.type === 'focus') {
        focusInfo = { fullscreen: event.fullscreen === true, excluded: event.excluded === true };
        updateHotkeyPause();
      }
      else if (event.type === 'up') {
        if (pendingMouseOpen) pendingMouseRelease = { button: event.button };
        else if (wheelVisible) overlayWindow.webContents.send('orbit:trigger-release', { button: event.button });
      }
    }
    if (buffer.length > 65536) buffer = '';
  });
  child.stderr.on('data', chunk => { errorText = (errorText + chunk).slice(-2000); });
  child.on('error', error => { if (hookProcess === child) { hookProcess = null; updateRuntime({ hookReady: false, outsideWatcherReady: false, hookError: error.message }); } });
  child.on('exit', code => {
    if (hookProcess === child) { hookProcess = null; updateRuntime({ hookReady: false, outsideWatcherReady: false, hookError: quitting ? null : errorText.trim() || `Модуль миші завершив роботу (${code}).` }); }
  });
}

async function stopHook() {
  const child = hookProcess;
  hookProcess = null;
  focusInfo = { fullscreen: false, excluded: false };
  updateHotkeyPause();
  updateRuntime({ hookReady: false, outsideWatcherReady: false, hookError: null });
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => {
    const timeout = setTimeout(() => { child.kill(); resolve(); }, 1500);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    try { child.stdin.end('quit\n'); } catch { child.kill(); }
  });
}

function startProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore', ...options });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

const SYSTEM_PROGRAMS = {
  explorer: [['explorer.exe']], 'recycle-bin': [['explorer.exe'], 'shell:RecycleBinFolder'],
  'task-manager': [['System32', 'Taskmgr.exe']], 'control-panel': [['System32', 'control.exe']],
  calculator: [['System32', 'calc.exe']], notepad: [['System32', 'notepad.exe']],
};
const SYSTEM_SETTINGS = { settings: 'ms-settings:', 'sound-settings': 'ms-settings:sound', bluetooth: 'ms-settings:bluetooth' };

function nativeAction(target) { return runNative(`--action=${target}`); }
function runNative(argument) {
  return new Promise((resolve, reject) => {
    const child = spawn(NATIVE, [argument], { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Windows не виконав дію (${code}).`)));
  });
}

async function executeAction(input, nested = false) {
  let action, executing = false;
  try {
    action = validateAction(input);
    if (action.kind === 'group' && action.target !== 'sequence') return { ok: false, error: 'Відкрийте групу в колесі.' };
    closeWheel();
    if (ISOLATED) return { ok: false, error: 'Actions are disabled during isolated tests.' };
    executing = true;
    // A sequence runs its actions one after another; nested plain groups are skipped.
    if (action.kind === 'group') {
      const steps = action.children.filter(child => child.kind !== 'group' || child.target === 'sequence');
      if (!steps.length) throw new Error('Додайте дії в послідовність.');
      for (const [index, step] of steps.entries()) {
        if (index) await new Promise(resolve => setTimeout(resolve, 350));
        const result = await executeAction(step, true);
        if (!result.ok) return result;
      }
      if (!nested) usage?.record(action.id).catch(() => {});
      return { ok: true };
    }
    if (!action.target.trim()) throw new Error('Спочатку виберіть шлях до застосунку або файлу в налаштуваннях дії.');
    if (action.kind === 'system') {
      const windows = process.env.WINDIR || 'C:\\Windows';
      const program = SYSTEM_PROGRAMS[action.target];
      if (program) await startProcess(path.join(windows, ...program[0]), program.slice(1));
      else if (SYSTEM_SETTINGS[action.target]) await shell.openExternal(SYSTEM_SETTINGS[action.target]);
      // Keyboard shortcuts go through the native helper after the wheel has released focus.
      else { await new Promise(resolve => setTimeout(resolve, 100)); await nativeAction(action.target); }
    } else if (action.kind === 'keys') {
      const { keys } = parseShortcut(action.target);
      // The keys go to the program in front once the wheel has released focus.
      await new Promise(resolve => setTimeout(resolve, 120));
      await runNative(`--keys=${keys.join(',')}`);
    } else if (action.kind === 'text') {
      await pasteText(action.target);
    } else if (action.kind === 'app' && action.target.startsWith('app-id:')) {
      const appId = validatePackagedTarget(action.target, action.args);
      await startProcess(path.join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe'), ['shell:AppsFolder\\' + appId]);
    } else if (action.kind === 'app' && /^https?:\/\//i.test(action.target)) {
      const url = new URL(action.target);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Непідтримуваний протокол.');
      await shell.openExternal(url.href);
    } else {
      if (!path.isAbsolute(action.target)) throw new Error('Виберіть повний шлях до файлу.');
      const stat = await fsp.stat(action.target).catch(() => { throw new Error('Файл або папку не знайдено. Оновіть шлях до дії.'); });
      const extension = path.extname(action.target).toLowerCase();
      const args = parseArguments(action.args);
      if (action.kind === 'folder') {
        if (!stat.isDirectory()) throw new Error('Вибраний шлях не є папкою.');
        const error = await shell.openPath(action.target); if (error) throw new Error(error);
      } else if (action.kind === 'script') {
        if (!stat.isFile()) throw new Error('Виберіть файл скрипту.');
        if (extension === '.ps1') await startProcess(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-File', action.target, ...args], { cwd: path.dirname(action.target) });
        else if (extension === '.py') {
          const python = pythonLauncherPath();
          if (!python) throw new Error('Не знайдено Python Launcher (py.exe). Встановіть Python з python.org.');
          await startProcess(python, [action.target, ...args], { cwd: path.dirname(action.target) });
        }
        else if (extension === '.js' || extension === '.cjs') await startProcess(process.execPath, [action.target, ...args], { cwd: path.dirname(action.target), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
        else throw new Error('Підтримуються скрипти .ps1, .py, .js та .cjs.');
      } else if (extension === '.exe') await startProcess(action.target, args, { cwd: path.dirname(action.target) });
      else if (extension === '.lnk') {
        if (args.length) throw new Error('Додайте аргументи у властивостях ярлика або виберіть .exe.');
        const error = await shell.openPath(action.target); if (error) throw new Error(error);
      } else throw new Error('Для застосунку виберіть файл .exe або .lnk.');
    }
    if (!nested) usage?.record(action.id).catch(() => {});
    return { ok: true };
  } catch (error) {
    if (executing) {
      showMain('menus');
      sendAll('orbit:action-error', { error: error.message, actionId: action.id });
    }
    return { ok: false, error: error.message };
  }
}

// Text snippets are pasted through the clipboard; plain-text clipboard contents are put back afterwards.
async function pasteText(text) {
  const formats = clipboard.availableFormats();
  const previous = formats.length && formats.every(format => format.startsWith('text/')) ? clipboard.readText() : null;
  clipboard.writeText(text);
  await new Promise(resolve => setTimeout(resolve, 120));
  await runNative('--keys=17,86');
  if (previous !== null) setTimeout(() => { if (clipboard.readText() === text) clipboard.writeText(previous); }, 900);
}

function onHotkey(menuId = null) {
  if (wheelVisible) { closeWheel(); return; }
  // Ask the hook which program is in front before the keyboard-opened wheel takes focus.
  try { hookProcess?.stdin.write('foreground\n'); } catch { }
  showWheel(undefined, 'keyboard', '', menuId).catch(console.error);
}

function updateHotkeyPause() {
  const paused = (state.gameMode !== false && focusInfo.fullscreen) || focusInfo.excluded;
  if (paused === hotkeysPaused) return;
  hotkeysPaused = paused;
  registerHotkey();
}

function registerHotkey() {
  if (ISOLATED) return;
  const wanted = state.hotkey ?? 'Control+Space';
  if (registeredHotkey) { globalShortcut.unregister(registeredHotkey); registeredHotkey = ''; }
  for (const key of registeredMenuHotkeys) globalShortcut.unregister(key);
  registeredMenuHotkeys = [];
  // Released shortcuts reach the game; the last registration result stays on screen meanwhile.
  if (hotkeysPaused) { updateRuntime({ hotkeysPaused: true, hotkey: wanted }); return; }
  let registered = false;
  if (wanted) { try { registered = globalShortcut.register(wanted, onHotkey); } catch { registered = false; } }
  if (registered) registeredHotkey = wanted;
  const failed = [];
  for (const menu of state.menus) {
    if (!menu.hotkey) continue;
    let ok = false;
    try { ok = globalShortcut.register(menu.hotkey, () => onHotkey(menu.id)); } catch { ok = false; }
    if (ok) registeredMenuHotkeys.push(menu.hotkey); else failed.push(menu.hotkey);
  }
  updateRuntime({ shortcutRegistered: registered, hotkey: wanted, menuHotkeysFailed: failed, hotkeysPaused: false });
}

async function refreshLegacy() {
  if (ISOLATED || process.platform !== 'win32') return;
  updateRuntime({ legacyRunning: await isLegacyRunning() });
}

async function quitLegacy() {
  const { executable } = legacyPaths({ appData: app.getPath('appData'), localAppData: process.env.LOCALAPPDATA });
  if (!executable || !fs.existsSync(executable)) return { ok: false, error: 'Не знайдено встановлений Orbit. Закрийте його через іконку біля годинника.' };
  await startProcess(executable, ['--quit'], { detached: true }).catch(() => {});
  for (let attempt = 0; attempt < 20 && await isLegacyRunning(); attempt++) await new Promise(resolve => setTimeout(resolve, 500));
  await refreshLegacy();
  return runtime.legacyRunning ? { ok: false, error: 'Orbit не закрився. Закрийте його через іконку біля годинника.' } : { ok: true };
}

function requireSender(event) {
  if (![mainWindow, overlayWindow].some(window => window && !window.isDestroyed() && window.webContents === event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted IPC sender.');
}

function registerIPC() {
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => { requireSender(event); return fn(...args); });
  handle('orbit:get-state', () => state);
  handle('orbit:get-runtime', () => runtime);
  handle('orbit:get-update-status', () => updater.getStatus());
  const updateAction = (channel, fn) => ipcMain.handle(channel, (event) => {
    requireSender(event);
    if (event.sender !== mainWindow.webContents) throw new Error('Updates require the main Orbit window.');
    return fn();
  });
  updateAction('orbit:check-updates', () => updater.check());
  updateAction('orbit:download-update', () => updater.download());
  updateAction('orbit:install-update', () => updater.install());
  updateAction('orbit:open-update-repository', () => shell.openExternal(UPDATE_REPOSITORY_URL));
  ipcMain.handle('orbit:set-admin-start', (event, enabled) => {
    requireSender(event);
    if (event.sender !== mainWindow.webContents) throw new Error('Administrator start requires the main Orbit window.');
    return setAdminStart(enabled);
  });
  handle('orbit:save-state', saveState);
  handle('orbit:show-wheel', () => showWheel());
  handle('orbit:close-wheel', closeWheel);
  handle('orbit:execute-action', executeAction);
  handle('orbit:search-apps', (query = '', refresh = false, options = {}) => appCatalog.searchApps(query, refresh, options && typeof options === 'object' ? { limit: options.limit ?? 30, icons: options.icons ?? true } : {}));
  handle('orbit:get-app-icon', target => appCatalog.getAppIcon(target));
  handle('orbit:minimize', () => mainWindow.minimize());
  handle('orbit:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  handle('orbit:close-window', () => mainWindow.close());
  handle('orbit:add-wheel-action', (groupPath, menuId) => addWheelAction(groupPath, typeof menuId === 'string' ? menuId : null));
  handle('orbit:get-usage', () => usage.get());
  handle('orbit:reset-usage', () => usage.reset());
  handle('orbit:list-backups', () => backups.list());
  handle('orbit:create-backup', async () => { await configQueue; return backups.manual(JSON.stringify(state, null, 2)); });
  handle('orbit:restore-backup', async name => {
    const text = await backups.read(name);
    // The configuration being replaced is kept too, so a restore can itself be undone.
    await backups.manual(JSON.stringify(state, null, 2));
    return saveState(JSON.parse(text));
  });
  handle('orbit:quit-legacy', quitLegacy);
  handle('orbit:export-menu', async menuId => {
    const menu = state.menus.find(item => item.id === menuId);
    if (!menu) throw new Error('Меню не знайдено.');
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Поділитися меню', defaultPath: `${menu.name.replace(/[<>:"/\\|?*]+/g, '_')}.orbit-menu.json`, filters: [{ name: 'Меню Orbit 2', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const { hotkey, ...shared } = menu;
    await fsp.writeFile(result.filePath, JSON.stringify({ orbitMenu: 1, menu: shared }, null, 2), 'utf8');
    return { ok: true };
  });
  handle('orbit:import-menu', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Імпортувати меню', properties: ['openFile'], filters: [{ name: 'Меню Orbit 2', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    if ((await fsp.stat(result.filePaths[0])).size > 1024 * 1024) throw new Error('Файл меню завеликий.');
    let data;
    try { data = JSON.parse(await fsp.readFile(result.filePaths[0], 'utf8')); } catch { throw new Error('Файл меню пошкоджений.'); }
    const source = data && data.orbitMenu === 1 && data.menu && typeof data.menu === 'object' ? data.menu : null;
    if (!source) throw new Error('Це не файл меню Orbit 2.');
    if (state.menus.length >= 20) throw new Error('Можна створити до 20 меню.');
    // Fresh IDs keep an imported menu from clashing with existing actions; validation still checks every action.
    const renew = items => (Array.isArray(items) ? items : []).map(item => ({ ...(item && typeof item === 'object' ? item : {}), id: randomUUID(), children: renew(item?.children) }));
    let name = String(source.name || 'Меню').slice(0, 88);
    if (state.menus.some(menu => menu.name === name)) name += ' (імпорт)';
    const taken = new Set(state.menus.flatMap(menu => menu.apps || []));
    const menu = { id: randomUUID(), name, icon: 'orbit', apps: (Array.isArray(source.apps) ? source.apps : []).filter(appName => !taken.has(appName)), items: renew(source.items) };
    const next = await saveState(current => ({ ...current, menus: [...current.menus, menu], activeMenuId: menu.id }));
    return { state: next, name };
  });
  handle('orbit:pick-program', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Виберіть програму', properties: ['openFile'], filters: [{ name: 'Програми Windows', extensions: ['exe', 'lnk'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    let file = result.filePaths[0];
    if (/\.lnk$/i.test(file)) { try { file = shell.readShortcutLink(file).target || file; } catch { } }
    return /\.exe$/i.test(file) ? path.basename(file).toLowerCase() : null;
  });
  handle('orbit:list-folders', listFolders);
  handle('orbit:list-scripts', listScripts);
  handle('orbit:open-add-dialog', (groupPath, menuId) => {
    if (!Array.isArray(groupPath) || !groupPath.every(id => typeof id === 'string')) throw new Error('Invalid group path.');
    closeWheel(); showMain({ page: 'menus', groupPath, add: true, menuId: typeof menuId === 'string' ? menuId : null });
  });
  handle('orbit:inspect-dropped', async paths => {
    if (!Array.isArray(paths) || paths.length > 50) throw new Error('Invalid dropped files.');
    const actions = [];
    for (const value of paths) {
      if (typeof value !== 'string' || !path.isAbsolute(value)) continue;
      const stat = await fsp.stat(value).catch(() => null);
      const action = stat && droppedAction(value, stat.isDirectory());
      if (action) actions.push(action);
    }
    return actions;
  });
  handle('orbit:pick-target', async kind => {
    if (!['app', 'folder', 'script'].includes(kind)) throw new Error('Invalid picker kind.');
    const result = await dialog.showOpenDialog(mainWindow, { title: kind === 'folder' ? 'Виберіть папку' : 'Виберіть файл',
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
      filters: kind === 'folder' ? [] : [{ name: kind === 'app' ? 'Застосунки Windows' : 'Скрипти', extensions: kind === 'app' ? ['exe', 'lnk'] : ['ps1', 'py', 'js', 'cjs'] }] });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handle('orbit:export-state', async () => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, { title: 'Експортувати налаштування Orbit 2', defaultPath: 'orbit2-settings.json', filters: [{ name: 'Orbit JSON', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fsp.writeFile(result.filePath, JSON.stringify(state, null, 2), 'utf8'); return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  handle('orbit:import-state', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Імпортувати налаштування Orbit або Orbit 2', properties: ['openFile'], filters: [{ name: 'Orbit JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const stat = await fsp.stat(result.filePaths[0]);
    if (stat.size > 1024 * 1024) throw new Error('Файл налаштувань завеликий.');
    return saveState(JSON.parse(await fsp.readFile(result.filePaths[0], 'utf8')));
  });
}

function showMain(page) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
  if (page) mainWindow.webContents.send('orbit:navigate', page);
}

// The most launched actions, runnable straight from the tray.
function frequentTrayItems() {
  const counts = usageSnapshot?.actions || {}, actions = [];
  const walk = items => items.forEach(item => {
    if (item.kind !== 'group' || item.target === 'sequence') actions.push(item);
    else walk(item.children);
  });
  state.menus.forEach(menu => walk(menu.items));
  const frequent = actions.filter(item => counts[item.id]?.count).sort((a, b) => counts[b.id].count - counts[a.id].count).slice(0, 8);
  return frequent.length ? [{ label: 'Часті дії', submenu: frequent.map(item => ({ label: item.name.replace(/&/g, '&&'), click: () => executeAction(item).catch(console.error) })) }] : [];
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(`Orbit 2 · ${state.enabled ? 'Увімкнено' : 'Призупинено'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Відкрити Orbit 2', click: () => showMain() },
    { label: 'Огляд і статистика', click: () => showMain('overview') },
    { label: 'Показати колесо', click: () => showWheel().catch(console.error) },
    { label: 'Додати дію…', click: () => showMain({ page: 'menus', groupPath: [], add: true }) },
    ...frequentTrayItems(),
    ...(state.menus.length > 1 ? [{ label: 'Меню на колесі', submenu: state.menus.map(menu => ({ label: menu.name, type: 'radio', checked: menu.id === state.activeMenuId,
      click: () => patchState({ activeMenuId: menu.id }).catch(error => { console.error(error); updateTray(); }) })) }] : []),
    { label: 'Увімкнено', type: 'checkbox', checked: state.enabled, click: item => patchState({ enabled: item.checked }).catch(error => { console.error(error); updateTray(); }) },
    { type: 'separator' }, { label: 'Вийти з Orbit 2', click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(APP_ICON));
  tray.on('click', () => showMain());
  updateTray();
}

async function smokeTest() {
  const iconLoaded = !nativeImage.createFromPath(APP_ICON).isEmpty();
  await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.getElementById('app')?.textContent.trim()) resolve(true);
      else if (Date.now() > deadline) reject(new Error('Renderer did not render the main interface.'));
      else setTimeout(check, 50);
    };
    check();
  })`);
  const probe = await mainWindow.webContents.executeJavaScript('({ title: document.title, bridge: typeof window.orbit?.getState === "function", body: document.body.innerText.slice(0, 160) })');
  const overlay = await overlayWindow.webContents.executeJavaScript('({ overlay: new URLSearchParams(location.search).get("overlay"), bridge: typeof window.orbit?.onWheelOpen === "function" })');
  const native = await new Promise((resolve, reject) => {
    const child = spawn(NATIVE, ['--self-test'], { windowsHide: true }); let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(JSON.parse(output.trim())) : reject(new Error('Native self-test failed.')));
  });
  const result = { ok: probe.bridge && overlay.bridge && native.ok && iconLoaded, main: probe, overlay, native, iconLoaded, menus: state.menus.length, actions: state.menus[0].items.length };
  console.log('ORBIT_SMOKE ' + JSON.stringify(result));
  if (!result.ok) throw new Error('Orbit 2 smoke-test validation failed.');
}

app.setName('Orbit 2');
if (process.platform === 'win32') app.setAppUserModelId('com.creationsoft.orbit2');
if (!ISOLATED) app.setPath('userData', path.join(app.getPath('appData'), 'Orbit 2'));
if (!ISOLATED && (handOverToAdminTask() || !app.requestSingleInstanceLock() || QUIT)) app.quit();
else {
  if (ISOLATED) app.setPath('userData', path.join(os.tmpdir(), `orbit2-${SMOKE ? 'smoke' : 'e2e'}-${process.pid}`));
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--quit')) app.quit();
    else if (!argv.includes('--hidden')) showMain();
  });
  app.on('activate', () => showMain());
  app.on('window-all-closed', () => { if (quitting || ISOLATED) app.quit(); });
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true; closeWheel(); globalShortcut.unregisterAll();
    appCatalog.dispose();
    Promise.all([configQueue, stopHook(), updater?.dispose(), usage?.dispose()]).finally(() => { if (tray) { tray.destroy(); tray = null; } app.quit(); });
  });
  app.whenReady().then(async () => {
    if (app.isPackaged && !ISOLATED && await leaveRedirectedAppData()) return;
    statePath = path.join(app.getPath('userData'), 'settings.json');
    backups = createBackups({ dir: path.join(app.getPath('userData'), 'backups') });
    usage = createUsage({ file: path.join(app.getPath('userData'), 'usage.json'), onChange: value => {
      usageSnapshot = value; sendAll('orbit:usage-changed', value);
      clearTimeout(trayTimer); trayTimer = setTimeout(updateTray, 500);
    } });
    usage.get().then(value => { usageSnapshot = value; updateTray(); }).catch(() => {});
    state = await loadState(); nativeTheme.themeSource = state.theme;
    if (migratedFromLegacy) { runtime.migratedFromLegacy = true; await saveState(state).catch(error => console.warn('Orbit 2: imported menus not saved.', error.message)); }
    applyLoginItem(); updateUninstallEntry();
    updater = createUpdater({
      version: app.getVersion(), repo: UPDATE_REPOSITORY,
      installDir: path.dirname(process.execPath),
      updatesDir: path.join(app.getPath('userData'), 'updates'),
      helperPath: path.join(path.dirname(NATIVE), 'Update.ps1'),
      isolated: ISOLATED || !app.isPackaged,
      getNativePid: () => hookProcess?.pid,
      onStatus: status => sendAll('orbit:update-status', status),
      beforeInstall: async () => { closeWheel(); await configQueue; await stopHook(); },
      onInstallReady: () => app.quit(),
    });
    registerIPC(); await createWindows();
    refreshAdminStart().catch(() => {});
    if (stateRecoveryFile && !ISOLATED) dialog.showMessageBox(mainWindow, stateRecoveredFromBackup
      ? { type: 'info', title: 'Orbit 2', message: 'Налаштування Orbit 2 відновлено з резервної копії.', detail: `Основний файл був пошкоджений, тож останні зміни перед цим могли не зберегтися. Пошкоджений файл збережено як:\n${stateRecoveryFile}` }
      : { type: 'warning', title: 'Orbit 2', message: 'Не вдалося прочитати налаштування Orbit 2.', detail: `Меню скинуто до початкових. Попередній файл збережено як:\n${stateRecoveryFile}` }).catch(() => {});
    if (redirectedAppData) dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Orbit 2', message: 'Зміни в цьому вікні Orbit 2 можуть не зберегтися.',
      detail: `Orbit запущено з іншої програми, і Windows записує його налаштування в її окрему копію:\n${redirectedAppData}\n\nЗакрийте Orbit і запустіть його з меню «Пуск».` }).catch(() => {});
    if (!ISOLATED) logStartup().catch(() => {});
    // An install that failed after Orbit closed is reported once, before cleanup removes its files.
    if (app.isPackaged && !ISOLATED) updater.reportFailedInstall().catch(error => console.warn('Orbit 2: could not read the last update result.', error));
    if (SMOKE) { await smokeTest(); app.quit(); return; }
    appCatalog.warm();
    if (E2E) { globalThis.__orbitE2E = { resolveForeground: exePath => resolveForeground(exePath, wheelSession), showWheel: (point, foreground = '', menuId = null) => showWheel(point, 'mouse', foreground, menuId), recordUsage: id => usage.record(id) }; return; }
    createTray();
    if (firstRun) seedFirstRunApps().catch(() => {});
    registerHotkey();
    startHook();
    refreshLegacy().catch(() => {});
    // Wait until a just-finished update helper has exited before removing its files.
    if (app.isPackaged) setTimeout(() => updater.cleanup().catch(() => {}), 30000);
  }).catch(async error => { console.error(error); quitting = true; appCatalog.dispose(); await stopHook(); globalShortcut.unregisterAll(); if (tray) tray.destroy(); app.exit(1); });
}
