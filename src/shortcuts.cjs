// Keyboard shortcuts for "keys" actions: a readable text form ("Ctrl+Shift+T") that maps to Windows virtual-key codes.
// The renderer builds the same names from KeyboardEvent.code (src/renderer/shortcut.mjs); tests keep the two in step.
const MODIFIERS = { Ctrl: 0x11, Shift: 0x10, Alt: 0x12, Win: 0x5B };
const MODIFIER_ORDER = ['Ctrl', 'Shift', 'Alt', 'Win'];
const KEYS = {
  Enter: 0x0D, Esc: 0x1B, Tab: 0x09, Space: 0x20, Backspace: 0x08, Delete: 0x2E, Insert: 0x2D, Home: 0x24, End: 0x23,
  PageUp: 0x21, PageDown: 0x22, Up: 0x26, Down: 0x28, Left: 0x25, Right: 0x27, PrintScreen: 0x2C, Pause: 0x13, Menu: 0x5D,
  '-': 0xBD, '=': 0xBB, '[': 0xDB, ']': 0xDD, ';': 0xBA, "'": 0xDE, ',': 0xBC, '.': 0xBE, '/': 0xBF, '\\': 0xDC, '`': 0xC0,
  Num0: 0x60, Num1: 0x61, Num2: 0x62, Num3: 0x63, Num4: 0x64, Num5: 0x65, Num6: 0x66, Num7: 0x67, Num8: 0x68, Num9: 0x69,
  'Num*': 0x6A, 'Num+': 0x6B, 'Num-': 0x6D, 'Num.': 0x6E, 'Num/': 0x6F,
  VolumeMute: 0xAD, VolumeDown: 0xAE, VolumeUp: 0xAF, MediaNext: 0xB0, MediaPrev: 0xB1, MediaStop: 0xB2, MediaPlay: 0xB3,
};
for (let code = 0x41; code <= 0x5A; code++) KEYS[String.fromCharCode(code)] = code;
for (let digit = 0; digit <= 9; digit++) KEYS[String(digit)] = 0x30 + digit;
for (let index = 1; index <= 24; index++) KEYS['F' + index] = 0x6F + index;

// "Ctrl+Num+" -> ["Ctrl", "Num+"]: an empty piece means the "+" belonged to the key before it.
function splitShortcut(text) {
  const parts = [];
  for (const piece of text.split('+')) {
    if (!piece && parts.length) parts[parts.length - 1] += '+';
    else parts.push(piece);
  }
  return parts.map(part => part.trim()).filter(Boolean);
}

// Returns { text, keys } with modifiers first, or throws when the shortcut cannot be sent.
function parseShortcut(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) throw new Error('Вкажіть комбінацію клавіш.');
  const modifiers = new Set();
  let key = null;
  for (const raw of splitShortcut(value.trim())) {
    const lower = raw.toLowerCase();
    const modifier = MODIFIER_ORDER.find(name => name.toLowerCase() === lower) || (lower === 'control' ? 'Ctrl' : lower === 'windows' || lower === 'meta' ? 'Win' : null);
    if (modifier) { modifiers.add(modifier); continue; }
    const keyName = Object.keys(KEYS).find(candidate => candidate.toLowerCase() === lower);
    if (!keyName || key) throw new Error(`Клавіша «${raw}» не підтримується.`);
    key = keyName;
  }
  if (!key && !modifiers.size) throw new Error('Вкажіть комбінацію клавіш.');
  const names = [...MODIFIER_ORDER.filter(name => modifiers.has(name)), ...(key ? [key] : [])];
  return { text: names.join('+'), keys: names.map(name => MODIFIERS[name] ?? KEYS[name]) };
}

module.exports = { parseShortcut, KEY_NAMES: Object.keys(KEYS), MODIFIER_ORDER };
