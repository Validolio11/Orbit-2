import { invoke } from "./api.js";
import { slotAngle, sectorOutline, roundedSector, hubPolygon, labelWidth, SHORTCUT_KEYS } from "./wheel-geometry.js";
import { ICONS } from "./wheel-icons.js";

const NS = "http://www.w3.org/2000/svg";
const kindNames = { app: "Застосунок", folder: "Папка", script: "Скрипт", system: "Windows", group: "Група" };
const systemIcons = { explorer: "folder", "task-manager": "tasks", settings: "settings", "control-panel": "sliders", "recycle-bin": "trash", search: "search", run: "run", "task-view": "windows", desktop: "desktop", lock: "lock", screenshot: "screenshot", clipboard: "clipboard", emoji: "emoji", dictation: "mic", notifications: "bell", mute: "volumeMute", "volume-down": "volumeDown", "volume-up": "volumeUp", "sound-settings": "volume", bluetooth: "bluetooth", "media-prev": "trackPrev", "media-play": "playPause", "media-next": "trackNext", calculator: "calculator", notepad: "notepad" };
const aliases = { globe: "browser", files: "folder", activity: "tasks" };
const glyphDocuments = new Map();
const iconCache = new Map();
const measure = document.createElement("canvas").getContext("2d");
function svgNode(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
function glyph(parent, name, x, y, size, className = "") {
  if (!glyphDocuments.has(name)) {
    const parsed = new DOMParser().parseFromString(Object.hasOwn(ICONS, name) ? ICONS[name] : ICONS.app, "image/svg+xml").documentElement;
    glyphDocuments.set(name, parsed);
  }
  const node = glyphDocuments.get(name).cloneNode(true);
  // The native icon painter tints white paths and strokes together. Match that for inline SVG.
  for (const stroke of node.querySelectorAll('[stroke="white"]')) stroke.setAttribute("stroke", "currentColor");
  node.setAttribute("x", x); node.setAttribute("y", y);
  node.setAttribute("width", size); node.setAttribute("height", size);
  if (className) node.setAttribute("class", className);
  node.setAttribute("aria-hidden", "true");
  parent.append(node);
  return node;
}
function textWidth(text, size, weight = 500) {
  measure.font = `${weight} ${size}px Geist`;
  return measure.measureText(text).width;
}
function ellipsis(text, width, size, weight = 500) {
  if (textWidth(text, size, weight) <= width) return text;
  const chars = Array.from(text);
  while (chars.length && textWidth(chars.join("") + "…", size, weight) > width) chars.pop();
  return chars.join("") + "…";
}
function labelLines(label, width, size) {
  const words = label.split(/\s+/u).filter(Boolean);
  if (words.some((word) => textWidth(word, size) > width)) return [ellipsis(label, width, size)];
  const lines = [""];
  for (const [wordIndex, word] of words.entries()) {
    const i = lines.length - 1;
    const candidate = lines[i] ? `${lines[i]} ${word}` : word;
    if (textWidth(candidate, size) <= width || !lines[i]) lines[i] = candidate;
    else if (lines.length === 1) lines.push(word);
    else { lines[1] = ellipsis(`${lines[1]} ${words.slice(wordIndex).join(" ")}`, width, size); break; }
  }
  return lines;
}
function outlinePath(points) { return points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ") + " Z"; }
export function iconName(item) {
  if (Object.hasOwn(ICONS, item.icon)) return item.icon;
  if (Object.hasOwn(aliases, item.icon)) return aliases[item.icon];
  if (item.kind === "system") return Object.hasOwn(systemIcons, item.target) ? systemIcons[item.target] : "system";
  if (/browser|браузер|chrome|edge|вебпошук/iu.test(`${item.icon} ${item.name}`)) return "browser";
  return item.kind;
}
export function requestIcon(target, physicalPx, onReady) {
  const key = `${physicalPx}:${target}`;
  let entry = iconCache.get(key);
  if (!entry) {
    entry = { url: null, pending: true, listeners: new Set() };
    iconCache.set(key, entry);
    invoke("item_icon", { target, physicalPx }).then((url) => {
      entry.url = url; entry.pending = false;
      const listeners = [...entry.listeners]; entry.listeners.clear();
      if (url) for (const ready of listeners) ready();
    }).catch(() => { entry.pending = false; entry.listeners.clear(); });
    // The native cache has the same bound; settled misses also stay cached.
    if (iconCache.size > 400) for (const [old, value] of iconCache) {
      if (!value.pending && old !== key) { iconCache.delete(old); break; }
    }
  }
  if (entry.pending) entry.listeners.add(onReady);
  return entry.url;
}

// A 64-sided hub reads as a circle; the old hexagon fallback is only used by the geometry helper itself.
const ROUND = 64;

/** Reusable SVG renderer. Coordinates are CSS pixels; PNGs live in an untransformed HTML layer. */
export function renderWheel(svg, imageLayer, view, onIconReady = () => {}) {
  const { items, selected, hot, keyboard, back, title, foreground, addSlot, width, height, size, menuIndex, menuCount, appearance = 1 } = view;
  const count = items.length + Number(addSlot), scale = size / 480;
  const center = [width / 2, height / 2];
  const at = ([x, y], pop = 1) => [center[0] + x * scale * pop, center[1] + y * scale * pop];
  const rimAt = ([x, y], pop = 1) => at([x * appearance, y * appearance], pop);
  const scene = svgNode("g", { class: "wheel-scene" });
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  imageLayer.replaceChildren();
  const polygon = (points, className) => svgNode("path", { d: outlinePath(points), class: className });
  scene.append(polygon(hubPolygon([0, 0], 98, ROUND).map((p) => at(p)), "hub-halo"));
  const showLabels = count <= 8;
  // One place for every sector: just inside the icon, towards the hub. 102 keeps it clear of a two-line label and of the hub edge (92).
  const keyRadius = 102;
  const baseLabel = 12 * Math.min(1.2, Math.max(.75, scale));
  let labelScale = 1;
  for (let index = 0; index < items.length; index++) {
    const room = Math.max(30, Math.min(84, labelWidth(slotAngle(index, count), count)) * scale);
    for (const word of items[index].name.split(/\s+/u)) labelScale = Math.min(labelScale, room / Math.max(1, textWidth(word, baseLabel)));
  }
  const labelSize = baseLabel * Math.max(.82, labelScale);
  const addItem = foreground && !items.some((item) => item.target === foreground.target) ? { ...foreground, kind: "app", icon: "app" } : null;
  const dpr = window.devicePixelRatio || 1;
  for (let index = 0; index < count; index++) {
    const isAdd = index === items.length, item = isAdd ? addItem : items[index];
    const isSelected = index === selected, pop = isSelected || index === hot ? 1.035 : 1;
    const group = svgNode("g", { class: `sector${isAdd ? " is-add" : ""}${isSelected ? " is-selected" : ""}${index === hot ? " is-hot" : ""}${isSelected && keyboard ? " is-keyboard" : ""}`, "data-index": index, role: "menuitem", tabindex: isSelected ? 0 : -1, "aria-label": isAdd ? (addItem ? `Додати ${addItem.name}` : "Додати дію") : item.name });
    const rails = sectorOutline(index, count, 92, 207, 5, 28);
    const rounded = roundedSector(rails.outer, rails.inner, 11);
    const points = [...rounded.outer, ...rounded.inner.slice(1, -1).reverse()].map((p) => rimAt(p, pop));
    group.append(polygon(points, "sector-surface"));
    if (isSelected) {
      const outer = rounded.outer.map(([x, y]) => { const length = Math.hypot(x, y); return rimAt([x * (1 - 9 / length), y * (1 - 9 / length)], pop); });
      group.append(svgNode("polyline", { class: "hold-progress", points: outer.map((p) => p.join(",")).join(" "), pathLength: 1, "stroke-width": 3 * Math.max(.8, scale), "stroke-dasharray": "0 1", visibility: "hidden" }));
    }
    const angle = slotAngle(index, count);
    const slot = at([Math.cos(angle) * 150, Math.sin(angle) * 150], pop);
    const iconSize = (showLabels ? 25 : 30) * Math.max(.8, scale);
    const physicalPx = Math.max(8, Math.min(256, Math.round(iconSize * dpr)));
    const exactSize = physicalPx / dpr;
    const iconX = Math.round((slot[0] - exactSize / 2) * dpr) / dpr;
    const iconY = Math.round((slot[1] - (showLabels ? 8 * scale : 0) - exactSize / 2) * dpr) / dpr;
    const url = item?.kind === "app" && item.target ? requestIcon(item.target, physicalPx, onIconReady) : null;
    if (url) {
      const image = document.createElement("img");
      image.src = url; image.alt = ""; image.draggable = false;
      Object.assign(image.style, { left: `${iconX}px`, top: `${iconY}px`, width: `${exactSize}px`, height: `${exactSize}px` });
      imageLayer.append(image);
    } else if (item) {
      
      group.classList.add(`kind-${item.kind}`);
      group.append(svgNode("rect", { x: iconX, y: iconY, width: exactSize, height: exactSize, rx: exactSize * .28, class: "kind-holder" }));
      glyph(group, iconName(item), iconX + exactSize * .17, iconY + exactSize * .17, exactSize * .66, "kind-icon");
    } else glyph(group, "plus", iconX, iconY, exactSize);
    if (isAdd && addItem) {
      const x = iconX + exactSize - 2 * scale, y = iconY + exactSize - 2 * scale;
      if (url) {
        // Keep the badge above the bitmap without putting the bitmap in an SVG transform.
        const badge = svgNode("svg", { viewBox: "0 0 14 14", class: "bitmap-badge" });
        Object.assign(badge.style, { left: `${x - 7 * scale}px`, top: `${y - 7 * scale}px`, width: `${14 * scale}px`, height: `${14 * scale}px` });
        badge.append(svgNode("circle", { cx: 7, cy: 7, r: 7, class: "add-pip" }));
        glyph(badge, "plus", 2.5, 2.5, 9, "pip-glyph");
        imageLayer.append(badge);
      } else {
        group.append(svgNode("circle", { cx: x, cy: y, r: 7 * scale, class: "add-pip" }));
        glyph(group, "plus", x - 4.5 * scale, y - 4.5 * scale, 9 * scale, "pip-glyph");
      }
    }
    if (!isAdd && index < SHORTCUT_KEYS.length) { const [kx, ky] = at([Math.cos(angle) * keyRadius, Math.sin(angle) * keyRadius], pop); group.setAttribute("aria-keyshortcuts", SHORTCUT_KEYS[index]); group.append(svgNode("text", { x: kx, y: ky, "dominant-baseline": "middle", "font-size": 11, class: "shortcut", "aria-hidden": "true" }, SHORTCUT_KEYS[index])); }
    if (item?.kind === "group") {
      const x = iconX + exactSize + 2 * scale, y = iconY - scale, radius = 7.5 * Math.max(.8, scale);
      group.append(svgNode("circle", { cx: x, cy: y, r: radius, class: "group-pip" }));
      glyph(group, "chevron", x - radius * .6, y - radius * .6, radius * 1.2, "pip-glyph");
    }
    if (showLabels) {
      const label = isAdd ? (addItem?.name || "Додати") : item.name;
      const maxWidth = Math.max(30, Math.min(84, labelWidth(angle, count)) * scale);
      const labelNode = svgNode("text", { class: "sector-label", "font-size": labelSize });
      labelLines(label, maxWidth, labelSize).forEach((line, lineIndex) => labelNode.append(svgNode("tspan", { x: slot[0], y: iconY + exactSize + 5 * scale + labelSize + lineIndex * labelSize * 1.15 }, line)));
      group.append(labelNode);
    }
    scene.append(group);
  }
  const hub = svgNode("g", { class: "hub", "data-back": back, ...(back ? { role: "menuitem", tabindex: 0, "aria-label": "Назад" } : { role: "presentation" }) });
  hub.append(polygon(hubPolygon([0, 0], 74.4 * 1.04, ROUND).map((p) => at(p)), "hub-surface"));
  const hubIconSize = (back ? 24 : 30) * Math.min(1.3, Math.max(.6, scale));
  const hubIcon = at([0, -18]);
  glyph(hub, back ? "back" : "orbit-base", hubIcon[0] - hubIconSize / 2, hubIcon[1] - hubIconSize / 2, hubIconSize);
  if (!back) glyph(hub, "orbit-accent", hubIcon[0] - hubIconSize / 2, hubIcon[1] - hubIconSize / 2, hubIconSize, "brand-accent");
  const focused = items[selected];
  const titleSize = 16 * Math.min(1.2, Math.max(.7, scale));
  hub.append(svgNode("text", { x: center[0], y: center[1] + 4 * scale + titleSize, "font-size": titleSize, class: "hub-title" }, ellipsis(focused?.name || title, 74.4 * scale * 1.7, titleSize, 600)));
  hub.append(svgNode("text", { x: center[0], y: center[1] + 32 * scale, "dominant-baseline": "middle", "font-size": 12 * Math.min(1.2, Math.max(.7, scale)), class: "hub-detail" }, focused ? kindNames[focused.kind] : back ? "Назад" : `${items.length} дій`));
  if (menuCount > 1) {
    const spacing = Math.min(8 * scale, 74.4 * scale * 1.4 / (menuCount - 1));
    for (let index = 0; index < menuCount; index++) hub.append(svgNode("circle", { cx: center[0] + (index - (menuCount - 1) / 2) * spacing, cy: center[1] + 49 * scale, r: Math.min(2 * scale, spacing * .3), class: `menu-dot${index === menuIndex ? " is-current" : ""}` }));
  }
  scene.append(hub);
  if (!items.length) {
    const empty = svgNode("g", { class: "empty-add", ...(view.wheelAddSlot ? { role: "menuitem", tabindex: 0, "aria-label": "Додайте першу дію" } : { role: "presentation" }) });
    // This lower-wheel target is deliberately separate from the hub, as in the overlay.
    empty.append(svgNode("rect", { x: center[0] - size / 2, y: center[1] + size * .22, width: size, height: size * .28, fill: "transparent" }));
    empty.append(svgNode("text", { x: center[0], y: center[1] + size * .3, "font-size": 12, class: "empty-label" }, "Додайте першу дію"));
    scene.append(empty);
  }
  svg.replaceChildren(scene);
}

