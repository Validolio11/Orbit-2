const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

// Orbit 2 lives next to the original Orbit. On the first start it brings over Orbit's menus,
// and it can close a running Orbit so the side button does not open two wheels.
function legacyPaths({ appData, localAppData }) {
  return {
    settings: path.join(appData, 'Orbit', 'settings.json'),
    executable: localAppData ? path.join(localAppData, 'Programs', 'Orbit', 'Orbit.exe') : null,
  };
}

// Returns Orbit's validated configuration, or null when there is nothing usable to import.
async function readLegacyState(paths, validate) {
  for (const file of [paths.settings, paths.settings + '.bak']) {
    try { return validate(JSON.parse(await fsp.readFile(file, 'utf8'))); } catch { }
  }
  return null;
}

function isLegacyRunning() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  const tasklist = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tasklist.exe');
  return new Promise(resolve => execFile(tasklist, ['/FI', 'IMAGENAME eq Orbit.exe', '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: 5000 },
    (error, stdout) => resolve(!error && /"Orbit\.exe"/i.test(String(stdout || '')))));
}

// Names of the HKCU Run values (from `reg query` output) that start this Orbit.exe at sign-in.
function legacyRunValues(regOutput, executable) {
  const wanted = String(executable || '').toLowerCase();
  if (!wanted) return [];
  return String(regOutput || '').split(/\r?\n/)
    .map(line => /^\s{4}(.+?)\s{4}REG_(?:EXPAND_)?SZ\s{4}(.*)$/.exec(line))
    .filter(match => match && match[2].toLowerCase().includes(wanted))
    .map(match => match[1]);
}

module.exports = { legacyPaths, readLegacyState, isLegacyRunning, legacyRunValues };
