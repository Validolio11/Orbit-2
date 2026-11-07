// Electron's patched fs treats .asar archives as folders, so update files are handled with original-fs.
const fsp = process.versions.electron ? require('original-fs').promises : require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const { createHash, randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');

const PRODUCT = 'com.creationsoft.orbit2';
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const ASSET_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);

class UpdateError extends Error { }

function parseVersion(value) {
  if (typeof value !== 'string') throw new UpdateError('Неправильний номер версії.');
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) throw new UpdateError('Неправильний номер версії.');
  const numbers = match.slice(1, 4).map(Number);
  const pre = match[4]?.split('.') || [];
  if (numbers.some(number => !Number.isSafeInteger(number)) || pre.some(part => !part || /^0\d+$/.test(part)) || match[5]?.split('.').some(part => !part)) throw new UpdateError('Неправильний номер версії.');
  return { numbers, pre };
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let index = 0; index < 3; index++) if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index++) {
    const x = a.pre[index], y = b.pre[index];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return x.length === y.length ? x > y ? 1 : -1 : x.length > y.length ? 1 : -1;
    return nx !== ny ? nx ? -1 : 1 : x > y ? 1 : -1;
  }
  return 0;
}

function validateRepo(repo) {
  if (typeof repo !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) throw new UpdateError('Неправильне джерело оновлень.');
  return repo;
}

function secureURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new UpdateError('Неправильне посилання оновлення.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw new UpdateError('Оновлення потребує захищеного посилання GitHub.');
  return url;
}

function isAllowedURL(value, repo, kind, redirect = false) {
  try {
    const url = secureURL(value);
    if (redirect && kind === 'asset' && ASSET_HOSTS.has(url.hostname)) return true;
    if (kind === 'api') return url.hostname === 'api.github.com' && url.pathname.toLowerCase() === `/repos/${repo}/releases/latest`.toLowerCase() && !url.search;
    return url.hostname === 'github.com' && url.pathname.toLowerCase().startsWith(`/${repo}/releases/download/`.toLowerCase());
  } catch { return false; }
}

function selectRelease(release, currentVersion, repo) {
  if (!release || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') throw new UpdateError('GitHub повернув несумісний реліз.');
  const version = release.tag_name.replace(/^v/, '');
  const parsed = parseVersion(version);
  if (parsed.pre.length) throw new UpdateError('Тестові версії не встановлюються автоматично.');
  if (compareVersions(version, currentVersion) <= 0) return null;
  const name = `Orbit2-${version}-win32-x64.zip`;
  const matching = Array.isArray(release.assets) ? release.assets.filter(asset => asset.name === name) : [];
  if (matching.length !== 1) throw new UpdateError('Для цієї версії ще немає сумісного Windows-пакета Orbit 2.');
  const asset = matching[0];
  const expectedURL = `https://github.com/${repo}/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(name)}`;
  if (asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_DOWNLOAD_BYTES || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest || '') || asset.browser_download_url !== expectedURL) throw new UpdateError('Пакет оновлення не пройшов перевірку метаданих.');
  return Object.freeze({ version, name, size: asset.size, sha256: asset.digest.slice(7).toLowerCase(), url: expectedURL, releaseUrl: `https://github.com/${repo}/releases/tag/${encodeURIComponent(release.tag_name)}` });
}

function requestHTTPS(url, { signal, headers } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { signal, headers }, response => resolve({ statusCode: response.statusCode, headers: response.headers, body: response }));
    request.setTimeout(30000, () => request.destroy(new Error('Update connection timed out.')));
    request.once('error', reject);
  });
}

function responseStream(response) {
  if (Buffer.isBuffer(response.body) || typeof response.body === 'string') return Readable.from([response.body]);
  if (response.body?.[Symbol.asyncIterator]) return response.body;
  throw new UpdateError('Неправильна відповідь сервера оновлень.');
}

function inside(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === '' || relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function validatePaths(installDir, updatesDir, helperPath) {
  for (const value of [installDir, updatesDir, helperPath]) if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new UpdateError('Шлях оновлення має бути абсолютним.');
  const install = path.resolve(installDir), updates = path.resolve(updatesDir), helper = path.resolve(helperPath);
  if (install === path.parse(install).root || inside(updates, install)) throw new UpdateError('Каталог оновлень має бути поза папкою Orbit 2.');
  return { install, updates, helper };
}

async function readSmallJSON(file) {
  const data = await fsp.readFile(file);
  if (data.length > 16384) throw new UpdateError('Неправильний службовий файл оновлення.');
  return JSON.parse(data.toString('utf8').replace(/^\uFEFF/, ''));
}

async function validatePrepared(stage, version) {
  const marker = await readSmallJSON(path.join(stage, 'orbit-release.json'));
  if (marker.product !== PRODUCT || marker.version !== version || marker.platform !== 'win32' || marker.arch !== 'x64') throw new UpdateError('Пакет не відповідає версії Orbit для Windows x64.');
  for (const relative of ['Orbit2.exe', 'resources/app.asar', 'resources/app.asar.unpacked/native/Orbit2.Input.exe', 'resources/app.asar.unpacked/native/Update.ps1']) {
    if (!(await fsp.stat(path.join(stage, relative))).isFile()) throw new UpdateError('Пакет Orbit 2 неповний.');
  }
}

function createUpdater(options) {
  const { version, repo = 'Validolio11/Orbit-2', onStatus = () => {}, beforeInstall = async () => {}, onInstallReady, isolated = false,
    parentPid = process.pid, getNativePid = () => 0, request = requestHTTPS, launch = spawn } = options;
  parseVersion(version); validateRepo(repo);
  const paths = validatePaths(options.installDir, options.updatesDir, options.helperPath);
  const powershell = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let status = { phase: 'idle', currentVersion: version }, selected = null, prepared = null, busy = false, disposed = false, activeAbort = null, activeHelper = null, committed = false;
  const snapshot = () => ({ ...status });
  function publish(phase, extra = {}) { status = { phase, currentVersion: version, ...extra }; try { onStatus(snapshot()); } catch { } return snapshot(); }
  function failure(error) { return publish('error', { version: selected?.version, releaseUrl: selected?.releaseUrl, message: error instanceof UpdateError ? error.message : 'Не вдалося завершити оновлення. Поточна версія Orbit збережена.' }); }

  async function removeOwnedDirectory(candidate, parent, leaf) {
    const same = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
    const expected = path.resolve(parent, leaf);
    if (!same(path.resolve(candidate), expected)) return;
    const stat = await fsp.lstat(expected).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) return;
    const realParent = await fsp.realpath(parent), realTarget = await fsp.realpath(expected);
    if (!same(path.dirname(realTarget), realParent) || !same(path.basename(realTarget), leaf)) return;
    // The exact UUID child and its resolved parent are checked before recursive deletion.
    await fsp.rm(expected, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  }

  async function discardPrepared() {
    if (!prepared || committed) return;
    const previous = prepared;
    prepared = null;
    if (!/^[0-9a-f]{32}$/.test(previous.id) || await fsp.lstat(previous.backup).catch(() => null)) return;
    await removeOwnedDirectory(previous.stage, path.dirname(paths.install), `.Orbit2-update-stage-${previous.id}`).catch(() => {});
    await removeOwnedDirectory(previous.workDir, paths.updates, previous.id).catch(() => {});
  }

  async function fetchResponse(initial, kind, signal) {
    let url = initial;
    for (let count = 0; count <= 5; count++) {
      if (!isAllowedURL(url, repo, kind, count > 0)) throw new UpdateError('Сервер повернув неприпустиме посилання оновлення.');
      const response = await request(url, { signal, headers: { 'User-Agent': `Orbit2/${version}`, Accept: kind === 'api' ? 'application/vnd.github+json' : 'application/octet-stream', 'X-GitHub-Api-Version': '2026-03-10' } });
      if (![301, 302, 303, 307, 308].includes(response.statusCode)) return response;
      response.body?.destroy?.();
      const location = response.headers?.location;
      if (typeof location !== 'string') throw new UpdateError('Неправильне перенаправлення GitHub.');
      url = new URL(location, url).href;
    }
    throw new UpdateError('Забагато перенаправлень під час оновлення.');
  }

  async function operation(task, timeout) {
    if (disposed || busy) return snapshot();
    busy = true; activeAbort = new AbortController();
    const signal = activeAbort.signal;
    const timer = setTimeout(() => activeAbort?.abort(), timeout);
    try { return await task(signal); }
    catch (error) { if (disposed) return snapshot(); console.error('Orbit update failed:', error); await discardPrepared(); return failure(error); }
    finally { clearTimeout(timer); activeAbort = null; busy = false; }
  }

  function runHelper(args) {
    const child = launch(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', prepared.helper, ...args], { cwd: path.dirname(prepared.helper), windowsHide: true, stdio: 'ignore' });
    activeHelper = child;
    return child;
  }

  async function childResult(child, timeout, resultFile) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new UpdateError('Перевірка пакета тривала надто довго.')); }, timeout);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new UpdateError('Пакет оновлення не пройшов безпечну перевірку.')); });
    });
    const result = await readSmallJSON(resultFile);
    if (result.ok !== true) throw new UpdateError('Пакет оновлення не пройшов безпечну перевірку.');
  }

  async function copyHelper(workDir) {
    const contents = await fsp.readFile(paths.helper);
    if (!contents.length || contents.length > 256 * 1024) throw new UpdateError('Модуль встановлення оновлення недоступний.');
    const destination = path.join(workDir, 'Update.ps1');
    await fsp.writeFile(destination, contents, { mode: 0o600 });
    return destination;
  }

  // Removes leftovers of earlier updates: each finished or abandoned transaction keeps a full
  // downloaded archive, and failed preparations can leave an unpacked stage beside the app.
  // A committed install without a result may still need recovery, so it is kept.
  async function cleanup() {
    if (busy || committed || disposed) return;
    const parent = path.dirname(paths.install);
    const exists = file => fsp.access(file).then(() => true, () => false);
    const kept = new Set(prepared ? [prepared.id] : []);
    for (const entry of await fsp.readdir(paths.updates, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !/^[0-9a-f]{32}$/.test(entry.name) || kept.has(entry.name)) continue;
      const work = path.join(paths.updates, entry.name);
      if (await exists(path.join(work, 'commit.json')) && !await exists(path.join(work, 'result.json'))) { kept.add(entry.name); continue; }
      await removeOwnedDirectory(work, paths.updates, entry.name).catch(() => {});
    }
    for (const entry of await fsp.readdir(parent, { withFileTypes: true }).catch(() => [])) {
      const match = /^\.Orbit2-update-stage-([0-9a-f]{32})$/.exec(entry.name);
      if (!entry.isDirectory() || !match || kept.has(match[1])) continue;
      await removeOwnedDirectory(path.join(parent, entry.name), parent, entry.name).catch(() => {});
    }
  }

  async function reportFailedInstall() {
    for (const entry of await fsp.readdir(paths.updates, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !/^[0-9a-f]{32}$/.test(entry.name)) continue;
      const result = await readSmallJSON(path.join(paths.updates, entry.name, 'result.json')).catch(() => null);
      if (!result || result.ok !== false) continue;
      const journal = await readSmallJSON(path.join(paths.updates, entry.name, 'journal.json')).catch(() => ({}));
      const target = typeof journal.version === 'string' ? ` до ${journal.version}` : '';
      return publish('error', { message: result.rolledBack === false && typeof result.error === 'string' && result.error.includes('recovery')
        ? `Оновлення${target} не встановилося, а відновити попередню версію не вдалося. Перевстановіть Orbit 2 з GitHub.`
        : `Оновлення${target} не встановилося, Orbit 2 працює на попередній версії. Спробуйте ще раз.` });
    }
    return null;
  }

  return {
    getStatus: snapshot,
    cleanup,
    reportFailedInstall,
    async check() {
      if (committed) return snapshot();
      return operation(async signal => {
        publish('checking'); await discardPrepared(); selected = null;
        const response = await fetchResponse(`https://api.github.com/repos/${repo}/releases/latest`, 'api', signal);
        if (response.statusCode === 404) { response.body?.destroy?.(); return publish('up-to-date', { message: 'Нових релізів ще не опубліковано.' }); }
        if (response.statusCode === 403 || response.statusCode === 429) { response.body?.destroy?.(); throw new UpdateError('GitHub тимчасово обмежив перевірки. Спробуйте пізніше.'); }
        if (response.statusCode !== 200) { response.body?.destroy?.(); throw new UpdateError('GitHub зараз недоступний. Спробуйте пізніше.'); }
        const chunks = []; let size = 0;
        for await (const chunk of responseStream(response)) {
          const bytes = Buffer.from(chunk); size += bytes.length;
          if (size > 1024 * 1024) { response.body?.destroy?.(); throw new UpdateError('Відповідь GitHub перевищує допустимий розмір.'); }
          chunks.push(bytes);
        }
        let release;
        try { release = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new UpdateError('GitHub повернув неправильні дані релізу.'); }
        selected = selectRelease(release, version, repo);
        return selected ? publish('available', { version: selected.version, releaseUrl: selected.releaseUrl }) : publish('up-to-date');
      }, 20000);
    },
    async download() {
      if (status.phase === 'ready') return snapshot();
      return operation(async signal => {
        if (!selected) throw new UpdateError('Спочатку перевірте наявність оновлень.');
        await discardPrepared();
        const id = randomBytes(16).toString('hex');
        const workDir = path.join(paths.updates, id);
        const parent = path.dirname(paths.install);
        prepared = { id, workDir, archive: path.join(workDir, selected.name), stage: path.join(parent, `.Orbit2-update-stage-${id}`), backup: path.join(parent, `.Orbit2-update-backup-${id}`), version: selected.version, sha256: selected.sha256 };
        await fsp.mkdir(workDir, { recursive: true });
        prepared.helper = await copyHelper(workDir);
        publish('downloading', { version: selected.version, releaseUrl: selected.releaseUrl, progress: 0 });
        const response = await fetchResponse(selected.url, 'asset', signal);
        if (response.statusCode !== 200) { response.body?.destroy?.(); throw new UpdateError('Не вдалося завантажити пакет з GitHub.'); }
        const part = prepared.archive + '.part', hash = createHash('sha256');
        let received = 0, progress = -1, handle;
        try {
          handle = await fsp.open(part, 'wx');
          for await (const chunk of responseStream(response)) {
            if (signal.aborted) throw new UpdateError('Завантаження скасовано.');
            const bytes = Buffer.from(chunk); received += bytes.length;
            if (received > selected.size || received > MAX_DOWNLOAD_BYTES) { response.body?.destroy?.(); throw new UpdateError('Розмір пакета не відповідає релізу.'); }
            hash.update(bytes);
            let offset = 0;
            while (offset < bytes.length) { const written = await handle.write(bytes, offset, bytes.length - offset); if (!written.bytesWritten) throw new Error('Short update write.'); offset += written.bytesWritten; }
            const next = Math.floor(received / selected.size * 100);
            if (next !== progress) { progress = next; publish('downloading', { version: selected.version, releaseUrl: selected.releaseUrl, progress }); }
          }
          await handle.close(); handle = null;
          if (received !== selected.size || hash.digest('hex') !== selected.sha256) throw new UpdateError('Контрольна сума пакета не збігається. Оновлення не встановлено.');
          await fsp.rename(part, prepared.archive);
        } finally { await handle?.close(); await fsp.unlink(part).catch(() => {}); }
        publish('downloading', { version: selected.version, releaseUrl: selected.releaseUrl, progress: 100, message: 'Перевіряємо та готуємо пакет…' });
        const child = runHelper(['-Mode', 'Prepare', '-InstallDir', paths.install, '-StagePath', prepared.stage, '-BackupPath', prepared.backup, '-ArchivePath', prepared.archive, '-WorkDir', workDir, '-ExpectedVersion', selected.version, '-ExpectedSha256', selected.sha256]);
        try { await childResult(child, 120000, path.join(workDir, 'prepared.json')); }
        finally { if (activeHelper === child) activeHelper = null; }
        await validatePrepared(prepared.stage, selected.version);
        return publish('ready', { version: selected.version, releaseUrl: selected.releaseUrl, progress: 100 });
      }, 20 * 60 * 1000);
    },
    async install() {
      return operation(async () => {
        if (isolated) throw new UpdateError('Встановлення оновлень недоступне в тестовому режимі.');
        if (!prepared || status.phase !== 'ready' || typeof onInstallReady !== 'function') throw new UpdateError('Спочатку завантажте та підготуйте оновлення.');
        await validatePrepared(prepared.stage, prepared.version);
        publish('installing', { version: prepared.version, releaseUrl: selected?.releaseUrl });
        for (const name of ['ready.json', 'commit.json', 'abort.json', 'result.json']) await fsp.unlink(path.join(prepared.workDir, name)).catch(() => {});
        prepared.helper = await copyHelper(prepared.workDir);
        const nativePid = getNativePid() || 0;
        if (!Number.isSafeInteger(parentPid) || parentPid <= 0 || !Number.isSafeInteger(nativePid) || nativePid < 0) throw new UpdateError('Неправильний стан процесу Orbit 2.');
        const child = runHelper(['-Mode', 'Install', '-InstallDir', paths.install, '-StagePath', prepared.stage, '-BackupPath', prepared.backup, '-ArchivePath', prepared.archive, '-WorkDir', prepared.workDir, '-ExpectedVersion', prepared.version, '-ExpectedSha256', prepared.sha256, '-ParentPid', String(parentPid), '-NativePid', String(nativePid), '-Detach']);
        // The launcher exits once it has started the independent installer, which then reports readiness itself.
        let launchFailed = false;
        child.once('error', () => { launchFailed = true; }); child.once('exit', code => { if (code !== 0) launchFailed = true; });
        try {
          const deadline = Date.now() + 15000;
          let ready = false;
          while (!ready && Date.now() < deadline && !disposed) {
            if (launchFailed) throw new UpdateError('Модуль встановлення не запустився. Orbit 2 залишився відкритим.');
            try { const value = await readSmallJSON(path.join(prepared.workDir, 'ready.json')); ready = value.token === prepared.id && Number.isSafeInteger(value.pid) && value.pid > 0; } catch { }
            if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (!ready || disposed) throw new UpdateError('Модуль встановлення не підтвердив готовність.');
          await beforeInstall();
          await fsp.writeFile(path.join(prepared.workDir, 'commit.json'), JSON.stringify({ token: prepared.id, parentPid }));
          committed = true;
          await onInstallReady();
          child.unref?.();
          return snapshot();
        } catch (error) {
          committed = false;
          await fsp.writeFile(path.join(prepared.workDir, 'abort.json'), JSON.stringify({ token: prepared.id })).catch(() => {});
          await fsp.unlink(path.join(prepared.workDir, 'commit.json')).catch(() => {});
          child.kill(); if (activeHelper === child) activeHelper = null;
          throw error;
        }
      }, 60000);
    },
    dispose() {
      disposed = true; activeAbort?.abort();
      if (!committed) activeHelper?.kill();
    },
  };
}

module.exports = { createUpdater, compareVersions, parseVersion, selectRelease, isAllowedURL, validatePaths, validatePrepared, PRODUCT };
