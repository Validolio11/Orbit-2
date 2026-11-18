// Wheel coordinates use the same 480 × 480 design space as src/ui/wheel.rs.
// Keep these functions independent of the DOM so editor previews can reuse them.
// A sector never exceeds its slot, so few actions still close into a full ring (no empty arcs).
export const MAX_SPAN = 2 * Math.PI;

export function sectorAt(x, y, count, inner, outer) {
  const radius = Math.hypot(x, y);
  if (count <= 0 || radius < inner || radius > outer) return null;
  const step = 360 / count;
  const angle = (Math.atan2(y, x) * 180 / Math.PI + 90 + step / 2 + 360) % 360;
  return Math.floor(angle / step) % count;
}

export function slotAngle(index, count) {
  return (-90 + index * 360 / count) * Math.PI / 180;
}

// The radial edges are offset by gap/2 on each side, keeping gutters parallel.
// A single segment deliberately makes straight outer and inner chords (Facet).
export function sectorOutline(index, count, inner = 92, outer = 207, gap = 6, segments = 1) {
  if (count <= 0) return { outer: [], inner: [] };
  segments = Math.max(1, Math.floor(segments));
  const step = 2 * Math.PI / count;
  const middle = -Math.PI / 2 + index * step;
  const span = Math.min(step, MAX_SPAN);
  const a = middle - span / 2;
  const b = middle + span / 2;
  const gutter = step > MAX_SPAN ? 0 : gap;
  const io = Math.asin(gutter / (2 * inner));
  const oo = Math.asin(gutter / (2 * outer));
  const arc = (radius, from, to) => Array.from({ length: segments + 1 }, (_, i) => {
    const angle = from + (to - from) * i / segments;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  return { outer: arc(outer, a + oo, b - oo), inner: arc(inner, a + io, b - io) };
}

export function labelWidth(angle, count) {
  if (count < 3) return 104;
  const x = 150 * Math.cos(angle);
  const y = 150 * Math.sin(angle);
  const half = Math.min(Math.PI / count, MAX_SPAN / 2);
  const start = angle - half;
  const end = angle + half;
  const fits = (width) => [-width / 2, width / 2].every((dx) =>
    [0, 28].every((dy) => {
      const px = x + dx;
      const py = y + dy;
      return Math.cos(start) * py - Math.sin(start) * px >= 3 &&
        px * Math.sin(end) - py * Math.cos(end) >= 3;
    }));
  let low = 0;
  let high = 84;
  for (let i = 0; i < 12; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}

// One/two sectors cannot form a polygon: retain the original six-sided fallback.
export function hubPolygon(center, radius, count) {
  const n = count < 3 ? 6 : count;
  return Array.from({ length: n }, (_, i) => {
    const a = (-90 + (i + 0.5) * 360 / n) * Math.PI / 180;
    return [center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius];
  });
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const multiply = (a, value) => [a[0] * value, a[1] * value];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const normalize = (v) => {
  const length = Math.hypot(...v);
  return length > 0 ? multiply(v, 1 / length) : [0, 0];
};

export function along(points, distanceAlong) {
  let left = distanceAlong;
  for (let i = 1; i < points.length; i++) {
    const step = distance(points[i], points[i - 1]);
    if (left <= step && step > 0) {
      return add(points[i - 1], multiply(subtract(points[i], points[i - 1]), left / step));
    }
    left -= step;
  }
  return points.at(-1) ?? [0, 0];
}

// Port of rounded_sector: matched rails preserve the four small rounded corners
// without replacing the long straight tile edges with circular sector arcs.
export function roundedSector(outer, inner, radius = 7) {
  if (outer.length < 2 || inner.length < 2) return { outer: [], inner: [] };
  const length = (points) => points.slice(1).reduce((sum, p, i) => sum + distance(p, points[i]), 0);
  const lo = outer[0];
  const li = inner[0];
  const ro = outer.at(-1);
  const ri = inner.at(-1);
  const outerLength = length(outer);
  const innerLength = length(inner);
  const r = Math.max(0, Math.min(radius, distance(lo, li) * 0.3, innerLength * 0.3));
  const downLeft = normalize(subtract(li, lo));
  const downRight = normalize(subtract(ri, ro));
  const corner = (rail, a, c, b) => {
    for (let j = 0; j <= 7; j++) {
      const t = j / 7;
      const u = 1 - t;
      rail.push(add(add(multiply(a, u * u), multiply(c, 2 * u * t)), multiply(b, t * t)));
    }
  };
  const rail = (arc, len, left, right, sign) => {
    const result = [add(li, multiply(subtract(lo, li), 0.5))];
    corner(result, add(left, multiply(downLeft, r * sign)), left, along(arc, r));
    for (let j = 0; j < 40; j++) result.push(along(arc, r + (len - 2 * r) * j / 39));
    corner(result, along(arc, len - r), right, add(right, multiply(downRight, r * sign)));
    result.push(add(ri, multiply(subtract(ro, ri), 0.5)));
    return result;
  };
  return { outer: rail(outer, outerLength, lo, ro, 1), inner: rail(inner, innerLength, li, ri, -1) };
}

export function createGeometry(rect, items, addSlot) {
  return {
    center: [rect.x + rect.width / 2, rect.y + rect.height / 2],
    scale: rect.width / 480,
    count: items + Number(addSlot && items > 0),
  };
}

export function localPoint(geometry, point) {
  return multiply(subtract(point, geometry.center), 1 / geometry.scale);
}

export function hitTest(geometry, point, items, inner = 88, outer = 225) {
  const local = localPoint(geometry, point);
  if (Math.hypot(...local) <= 74.4) return { type: "center" };
  const index = sectorAt(...local, geometry.count, inner, outer);
  if (index === null) return { type: "nothing" };
  return index < items ? { type: "item", index } : { type: "add" };
}

// Keys that launch sectors 1..12: digits first, then QWE. Matched by physical key so any keyboard layout works.
export const SHORTCUT_KEYS = "123456789QWERTYUIOP".split("");
export function shortcutIndex(event) {
  if (event.ctrlKey || event.altKey || event.metaKey) return -1;
  const physical = /^(?:Digit|Numpad|Key)(.)$/u.exec(event.code || "");
  if (physical) return SHORTCUT_KEYS.indexOf(physical[1]);
  return /^[1-9]$/u.test(event.key) ? Number(event.key) - 1 : -1;
}
