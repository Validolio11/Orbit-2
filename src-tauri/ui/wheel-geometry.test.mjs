import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_SPAN, sectorAt, slotAngle, sectorOutline, labelWidth, hubPolygon,
  roundedSector, along, createGeometry, localPoint, hitTest,
} from "./wheel-geometry.js";

const fixture = JSON.parse(await readFile(new URL("./wheel-geometry.fixture.json", import.meta.url), "utf8"));
// Rust uses f32 trigonometry; JS uses f64. This is < 1/4000 of a design pixel.
const tolerance = 0.00025;
function close(actual, expected, path = "value") {
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, `${path}.length`);
    expected.forEach((value, index) => close(actual[index], value, `${path}[${index}]`));
  } else {
    assert.ok(Math.abs(actual - expected) <= tolerance,
      `${path}: ${actual} differs from Rust ${expected}`);
  }
}

test("angles, straight sector chords and label room match the Rust-generated fixture", () => {
  close(MAX_SPAN, fixture.maxSpan);
  for (const sector of fixture.sectors) {
    const { index, count } = sector;
    const angle = slotAngle(index, count);
    close(angle, sector.angle, `angle ${count}/${index}`);
    close(labelWidth(angle, count), sector.labelWidth, `label ${count}/${index}`);
    const outline = sectorOutline(index, count, fixture.inner, fixture.outer, fixture.gap, fixture.segments);
    close(outline.outer, sector.outline.outer, `outer ${count}/${index}`);
    close(outline.inner, sector.outline.inner, `inner ${count}/${index}`);
  }
});

test("radial hit tests match Rust, including empty wheels and exact radius boundaries", () => {
  for (const probe of fixture.probes) {
    assert.equal(sectorAt(...probe.point, probe.count, fixture.inner, fixture.outer), probe.expected,
      `${probe.count} sectors at ${probe.point}`);
  }
});

test("neighbouring radial edges maintain the same six-unit gutter at both radii", () => {
  for (const count of [6, 8, 9, 12]) {
    for (let index = 0; index < count; index++) {
      const a = sectorOutline(index, count);
      const b = sectorOutline((index + 1) % count, count);
      close(Math.hypot(a.outer.at(-1)[0] - b.outer[0][0], a.outer.at(-1)[1] - b.outer[0][1]), 6);
      close(Math.hypot(a.inner.at(-1)[0] - b.inner[0][0], a.inner.at(-1)[1] - b.inner[0][1]), 6);
    }
  }
});

test("hub corners align with sector seams and retain the legacy small-count fallback", () => {
  for (const count of [0, 1, 2, 3, 5, 6, 8, 9, 12]) {
    const center = [31, 27];
    const hub = hubPolygon(center, 77.376, count);
    assert.equal(hub.length, count < 3 ? 6 : count);
    for (const point of hub) close(Math.hypot(point[0] - center[0], point[1] - center[1]), 77.376);
    if (count >= 3) {
      const seam = -Math.PI / 2 + Math.PI / count;
      close(hub[0], [center[0] + Math.cos(seam) * 77.376, center[1] + Math.sin(seam) * 77.376]);
    }
  }
});

test("rounded tiles preserve straight chords, finite points and joined radial midpoints", () => {
  for (const count of [1, 2, 3, 6, 8, 12]) {
    const original = sectorOutline(0, count);
    const rounded = roundedSector(original.outer, original.inner, 7);
    assert.equal(rounded.outer.length, 58);
    assert.equal(rounded.inner.length, 58);
    close(rounded.outer[0], rounded.inner[0]);
    close(rounded.outer.at(-1), rounded.inner.at(-1));
    for (const rail of [rounded.outer, rounded.inner]) assert.ok(rail.flat().every(Number.isFinite));
    // The long centre run lies on the original straight chord, with rounding only at its ends.
    const [a, b] = original.outer;
    for (const point of rounded.outer.slice(9, 49)) {
      close((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]), 0);
    }
  }
  close(along([[0, 0], [3, 0], [3, 4]], 5), [3, 2]);
  close(along([[0, 0], [3, 0]], 99), [3, 0]);
});

test("logical sizing and center/item/add hit classifications preserve wheel.rs", () => {
  const g = createGeometry({ x: 40, y: 20, width: 720, height: 720 }, 5, true);
  assert.deepEqual(g, { center: [400, 380], scale: 1.5, count: 6 });
  close(localPoint(g, [400, 155]), [0, -150]);
  assert.deepEqual(hitTest(g, g.center, 5), { type: "center" });
  assert.deepEqual(hitTest(g, [400, 155], 5), { type: "item", index: 0 });
  const a = slotAngle(5, 6);
  assert.deepEqual(hitTest(g, [400 + 225 * Math.cos(a), 380 + 225 * Math.sin(a)], 5), { type: "add" });
  assert.deepEqual(hitTest(g, [400, 0], 5), { type: "nothing" });
  assert.equal(createGeometry({ x: 0, y: 0, width: 480, height: 480 }, 0, true).count, 0);
});

test("sector shortcuts: digits then QWE, by physical key, never with modifiers", async () => {
  const { shortcutIndex, SHORTCUT_KEYS } = await import("./wheel-geometry.js");
  assert.equal(SHORTCUT_KEYS.slice(0, 12).join(""), "123456789QWE");
  assert.equal(shortcutIndex({ code: "Digit1", key: "1" }), 0);
  assert.equal(shortcutIndex({ code: "Numpad9", key: "9" }), 8);
  assert.equal(shortcutIndex({ code: "KeyQ", key: "й" }), 9);
  assert.equal(shortcutIndex({ code: "KeyW", key: "ц" }), 10);
  assert.equal(shortcutIndex({ code: "KeyE", key: "у" }), 11);
  assert.equal(shortcutIndex({ key: "3" }), 2);
  assert.equal(shortcutIndex({ code: "KeyQ", key: "q", ctrlKey: true }), -1);
  assert.equal(shortcutIndex({ code: "Space", key: " " }), -1);
  assert.equal(shortcutIndex({ code: "NumpadAdd", key: "+" }), -1);
});
