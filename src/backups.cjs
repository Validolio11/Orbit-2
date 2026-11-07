const fsp = require('node:fs/promises');
const path = require('node:path');

// Daily copies of settings.json, so a menu that was deleted or broken by mistake can be brought back.
const NAME = /^settings-(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2})(\d{2}))?\.json$/;
const pad = value => String(value).padStart(2, '0');
const day = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function createBackups({ dir, keep = 20, now = () => new Date() }) {
  async function write(name, text) {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, name), text, { encoding: 'utf8', mode: 0o600 });
    await prune();
    return name;
  }
  async function names() {
    const entries = await fsp.readdir(dir).catch(() => []);
    // A daily copy is taken before the day's changes, so it sorts before that day's manual copies.
    const key = name => { const match = NAME.exec(name); return `${match[1]}${match[2]}${match[3]}${match[4] ? match[4] + match[5] + match[6] : '000000'}`; };
    return entries.filter(name => NAME.test(name)).sort((a, b) => key(b).localeCompare(key(a)));
  }
  async function prune() {
    for (const name of (await names()).slice(keep)) await fsp.unlink(path.join(dir, name)).catch(() => {});
  }
  return {
    // The first save of each day keeps the configuration as it was before that day's changes.
    async daily(text) {
      const name = `settings-${day(now())}.json`;
      if (await fsp.access(path.join(dir, name)).then(() => true, () => false)) return null;
      return write(name, text);
    },
    async manual(text) {
      const date = now();
      return write(`settings-${day(date)}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`, text);
    },
    async list() {
      const result = [];
      for (const name of await names()) {
        const match = NAME.exec(name), file = path.join(dir, name);
        const stat = await fsp.stat(file).catch(() => null);
        if (!stat) continue;
        let menus = 0, actions = 0;
        try {
          const value = JSON.parse(await fsp.readFile(file, 'utf8'));
          const count = items => items.reduce((sum, item) => sum + 1 + (item.kind === 'group' ? count(item.children || []) : 0), 0);
          menus = value.menus.length; actions = value.menus.reduce((sum, menu) => sum + count(menu.items), 0);
        } catch { continue; }
        result.push({ name, date: `${match[1]}-${match[2]}-${match[3]}${match[4] ? ` ${match[4]}:${match[5]}` : ''}`, manual: !!match[4], size: stat.size, menus, actions });
      }
      return result;
    },
    async read(name) {
      if (typeof name !== 'string' || !NAME.test(name)) throw new Error('Невідома резервна копія.');
      return fsp.readFile(path.join(dir, name), 'utf8');
    },
  };
}

module.exports = { createBackups };
