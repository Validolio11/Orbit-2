const fsp = require('node:fs/promises');
const path = require('node:path');
const { writeDurable } = require('./settings-file.cjs');

// Local launch statistics for the Overview page. Nothing leaves the computer.
const MAX_ACTIONS = 2000, MAX_DAYS = 90;
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const empty = () => ({ version: 1, actions: {}, days: {} });

function sanitize(value) {
  const result = empty();
  if (!value || typeof value !== 'object') return result;
  for (const [id, entry] of Object.entries(value.actions || {}).slice(0, MAX_ACTIONS)) {
    if (typeof id !== 'string' || id.length > 100 || !entry || !Number.isSafeInteger(entry.count) || entry.count < 0) continue;
    result.actions[id] = { count: entry.count, last: typeof entry.last === 'string' && !Number.isNaN(Date.parse(entry.last)) ? entry.last : null };
  }
  for (const [day, count] of Object.entries(value.days || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isSafeInteger(count) && count >= 0) result.days[day] = count;
  return result;
}

function prune(data) {
  const ids = Object.keys(data.actions);
  if (ids.length > MAX_ACTIONS) {
    ids.sort((a, b) => String(data.actions[a].last).localeCompare(String(data.actions[b].last)));
    for (const id of ids.slice(0, ids.length - MAX_ACTIONS)) delete data.actions[id];
  }
  const days = Object.keys(data.days).sort();
  for (const day of days.slice(0, Math.max(0, days.length - MAX_DAYS))) delete data.days[day];
}

function createUsage({ file, onChange = () => {}, now = () => new Date() }) {
  let data = empty(), loaded = null, timer = null, writing = Promise.resolve();
  const load = () => loaded ??= fsp.readFile(file, 'utf8').then(text => { data = sanitize(JSON.parse(text)); }, () => { data = empty(); });
  const flush = () => {
    clearTimeout(timer); timer = null;
    const text = JSON.stringify(data);
    writing = writing.then(() => fsp.mkdir(path.dirname(file), { recursive: true })).then(() => writeDurable(file, text)).catch(error => console.warn('Orbit 2: usage not saved.', error.message));
    return writing;
  };
  return {
    async record(id) {
      await load();
      const date = now(), entry = data.actions[id] || { count: 0, last: null };
      data.actions[id] = { count: entry.count + 1, last: date.toISOString() };
      data.days[dayKey(date)] = (data.days[dayKey(date)] || 0) + 1;
      prune(data);
      clearTimeout(timer); timer = setTimeout(flush, 1500);
      onChange(structuredClone(data));
    },
    async get() { await load(); return structuredClone(data); },
    async reset() { await load(); data = empty(); onChange(structuredClone(data)); await flush(); return structuredClone(data); },
    async dispose() { if (timer) await flush(); else await writing; },
  };
}

module.exports = { createUsage, sanitize, dayKey };
