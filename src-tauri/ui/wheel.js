import { invoke, listen, getState } from "./api.js";
import { sectorAt, shortcutIndex } from "./wheel-geometry.js";
import { renderWheel } from "./wheel-renderer.js";

const svg = document.querySelector("#wheel"), imageLayer = document.querySelector("#wheel-images");
const content = document.querySelector("#wheel-content"), status = document.querySelector("#wheel-status");
const systemTheme = window.matchMedia("(prefers-color-scheme: light)");
const systemMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const subscriptions = [];
let settings = null, wheel = null, session = -1, closedThrough = -1, stack = [], selected = null, selectedAt = null;
let pointer = null, origin = null, keyboard = false, busy = false, hot = null, openedAt = 0, frame = 0, disposed = false, switching = false, revision = -1;
let releaseConsumed = false;
function level() {
  const menus = settings?.menus || [], menuIndex = Math.max(0, menus.findIndex((m) => m.id === settings.activeMenuId));
  let items = menus[menuIndex]?.items || [], title = "Orbit";
  const kept = [];
  for (const id of stack) {
    const group = items.find((item) => item.id === id && item.kind === "group");
    if (!group) break;
    kept.push(id); items = group.children; title = group.name;
  }
  stack = kept;
  const addSlot = Boolean(settings?.wheelAddSlot && items.length && items.length < 12);
  return { items, title, addSlot, count: items.length + Number(addSlot), menuIndex, menuCount: menus.length };
}
function theme() {
  document.documentElement.dataset.theme = settings?.theme === "light" || (settings?.theme === "system" && systemTheme.matches) ? "light" : "dark";
  document.documentElement.dataset.reducedMotion = String(Boolean(settings?.reducedMotion));
}
function dimensions() {
  return { width: window.innerWidth, height: window.innerHeight, size: Math.max(120, Math.min(wheel?.size || 520, window.innerWidth - 30, window.innerHeight - 60)) };
}
function draw() {
  if (!wheel || content.hidden) return;
  const elapsed = Math.min(1, (performance.now() - openedAt) / 140);
  const eased = settings.reducedMotion || systemMotion.matches ? 1 : 1 - Math.pow(1 - elapsed, 3);
  renderWheel(svg, imageLayer, { ...level(), ...dimensions(), selected, hot, keyboard, back: stack.length > 0, foreground: wheel.foreground, wheelAddSlot: settings.wheelAddSlot, appearance: .96 + .04 * eased }, draw);
  content.setAttribute("aria-busy", String(busy));
  updateProgress();
}
function waitForSelection() {
  if (selectedAt === null || busy || keyboard) return null;
  const item = level().items[selected];
  if (!item) return null;
  if (item.kind === "group") return settings.groupOpenMode === "hover" ? 300 : null;
  return settings.activationMode === "hover" && wheel.trigger === "mouse" ? settings.hoverDelay : null;
}
function updateProgress() {
  const path = svg.querySelector(".hold-progress"), wait = waitForSelection();
  if (!path) return;
  const progress = wait === null ? 0 : Math.min(1, (performance.now() - selectedAt) / wait);
  path.setAttribute("visibility", progress > 0 && progress < 1 ? "visible" : "hidden");
  path.setAttribute("stroke-dasharray", `${progress} 1`);
}
function animate() {
  if (!wheel) return;
  const wait = waitForSelection();
  if (wait !== null && performance.now() - selectedAt >= wait) { selectedAt = null; void commit(); }
  if (!settings.reducedMotion && !systemMotion.matches && performance.now() - openedAt < 150) draw();
  else updateProgress();
  frame = requestAnimationFrame(animate);
}
function error(message) { status.textContent = String(message); status.hidden = false; }
async function command(name, args = {}) {
  const actionSession = session;
  try { return await invoke(name, { session: actionSession, ...args }); }
  catch (failure) { if (wheel && session === actionSession) error(failure); return undefined; }
}
function syncNavigation() { void command("wheel_navigate", { stack: [...stack], selected }); }
function select(index, fromKeyboard = false) {
  if (index === selected) return;
  selected = index; selectedAt = index !== null && !fromKeyboard ? performance.now() : null; keyboard = fromKeyboard;
  draw(); syncNavigation();
}
function localAt(point) {
  const { width, height, size } = dimensions();
  return [(point[0] - width / 2) * 480 / size, (point[1] - height / 2) * 480 / size];
}
function move(point, force = false) {
  if (!wheel || busy) return;
  if (!force && pointer && point[0] === pointer[0] && point[1] === pointer[1]) return;
  pointer = point;
  if (origin && Math.hypot(point[0] - origin[0], point[1] - origin[1]) < 12) return;
  origin = null;
  const local = localAt(point);
  const index = sectorAt(...local, level().count, 88, 225);
  hot = index; select(index);
}
function back() {
  if (!wheel || busy || !stack.length) return;
  stack.pop(); selected = null; hot = null; selectedAt = null; origin = pointer && [...pointer]; keyboard = false;
  draw(); syncNavigation();
}
async function commit() {
  if (!wheel || busy || switching || selected === null) return;
  const current = level(), item = current.items[selected], actionSession = session;
  selectedAt = null;
  if (item?.kind === "group") {
    stack.push(item.id); selected = null; hot = null; origin = pointer && [...pointer]; keyboard = false;
    draw(); syncNavigation(); return;
  }
  busy = true; draw();
  if (item) await command("wheel_launch", { id: item.id });
  else if (current.addSlot) {
    if (wheel.foreground) {
      const id = await command("wheel_add_foreground", { groupPath: [...stack] });
      if (id && session === actionSession && wheel) {
        const snapshot = await command("get_state");
        if (session === actionSession && wheel) {
          if (snapshot) receiveState(snapshot);
          selected = level().items.findIndex((action) => action.id === id);
          if (selected < 0) selected = null;
          selectedAt = null; syncNavigation();
        }
      }
    } else await command("wheel_open_add_dialog", { groupPath: [...stack] });
  }
  if (session === actionSession && wheel) { busy = false; draw(); }
}
function clear(closedSession) {
  if (typeof closedSession === "number") closedThrough = Math.max(closedThrough, closedSession);
  if (typeof closedSession === "number" && closedSession < session) return;
  cancelAnimationFrame(frame); wheel = null; selected = null; selectedAt = null; stack = []; pointer = null; origin = null; hot = null; busy = false;
  releaseConsumed = false;
  content.hidden = true; content.classList.remove("is-visible"); svg.replaceChildren(); imageLayer.replaceChildren(); status.textContent = ""; status.hidden = true;
}
async function open(payload) {
  const next = payload.wheel;
  if (!next?.visible || next.session <= closedThrough || next.session < session) return;
  if (wheel && next.session === session) { receiveState(payload); return; }
  cancelAnimationFrame(frame);
  session = next.session; wheel = next; settings = payload.settings;
  stack = [...(next.stack || [])]; selected = next.selected; selectedAt = null; keyboard = next.trigger !== "mouse";
  pointer = null; origin = null; hot = null; busy = false; switching = false;
  releaseConsumed = false;
  openedAt = performance.now(); status.hidden = true; status.textContent = "";
  theme(); content.classList.remove("is-visible"); content.hidden = false; draw();
  // Start each session at transparent. Never transform/resample the PNG image layer.
  content.getBoundingClientRect(); content.classList.add("is-visible");
  const paintedSession = session;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (wheel && session === paintedSession) void command("wheel_painted");
  }));
  frame = requestAnimationFrame(animate);
  if (next.released) release({ session, x: next.releasePoint?.[0], y: next.releasePoint?.[1] });
}
function receiveState(snapshot) {
  if (snapshot.revision !== undefined && snapshot.revision < revision) return;
  if (snapshot.revision !== undefined) revision = snapshot.revision;
  const next = snapshot.wheel;
  if (!next || next.session < session || next.session <= closedThrough) return;
  if (!next.visible) { clear(next.session); return; }
  if (!wheel || next.session > session) { void open(snapshot); return; }
  const oldMenu = settings.activeMenuId;
  settings = snapshot.settings || settings; wheel = { ...wheel, ...next };
  if (oldMenu !== settings.activeMenuId) { stack = []; selected = null; hot = null; selectedAt = null; origin = pointer && [...pointer]; }
  const current = level(); if (selected !== null && selected >= current.count) { selected = null; selectedAt = null; }
  theme(); draw();
  // A trigger release can arrive between subscribing to open and subscribing to release.
  // The retained native snapshot recovers it; the marker prevents replay after later changes.
  if (next.released) release({ session: next.session, x: next.releasePoint?.[0], y: next.releasePoint?.[1] });
}
function release(payload) {
  if (!wheel || payload.session !== session || releaseConsumed) return;
  releaseConsumed = true;
  if (busy || wheel.trigger !== "mouse" || settings.activationMode !== "release") return;
  if (Number.isFinite(payload.x) && Number.isFinite(payload.y)) {
    const scale = wheel.scale || window.devicePixelRatio || 1;
    move([(payload.x - wheel.bounds.x) / scale, (payload.y - wheel.bounds.y) / scale], true);
  }
  const item = level().items[selected];
  if (item && item.kind !== "group") void commit();
  else if (!stack.length && !(selected !== null && selected >= level().items.length)) void command("wheel_close");
}

svg?.addEventListener("pointermove", (event) => move([event.clientX, event.clientY]));
svg?.addEventListener("pointerdown", (event) => {
  if (!wheel || busy) return;
  const local = localAt([event.clientX, event.clientY]);
  if (Math.hypot(...local) > 207 && settings.closeOnOutsideClick) void command("wheel_close");
});
svg?.addEventListener("pointerup", (event) => {
  if (!wheel || busy || event.button !== 0) return;
  pointer = [event.clientX, event.clientY];
  const local = localAt(pointer), current = level();
  if (Math.hypot(...local) <= 74.4 && stack.length) { back(); return; }
  const index = sectorAt(...local, current.count, 88, 225);
  if (index !== null) { select(index); void commit(); }
  else if (!current.items.length && settings.wheelAddSlot) {
    const { width, height, size } = dimensions();
    if (Math.abs(pointer[0] - width / 2) <= size / 2 && pointer[1] > height / 2 + size * .22 && pointer[1] <= height / 2 + size / 2) void command("wheel_open_add_dialog", { groupPath: [...stack] });
  }
});
svg?.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("wheel", async (event) => {
  event.preventDefault();
  if (!wheel || busy || switching || event.deltaY === 0 || settings.menus.length < 2) return;
  switching = true; const actionSession = session;
  try {
    const snapshot = await command("wheel_switch_menu", { direction: event.deltaY > 0 ? 1 : -1 });
    if (snapshot && wheel && session === actionSession) { stack = []; selected = null; hot = null; selectedAt = null; origin = pointer && [...pointer]; keyboard = false; receiveState(snapshot); }
  } finally { if (session === actionSession) switching = false; }
}, { passive: false });
document.addEventListener("keydown", (event) => {
  if (!wheel) return;
  if (["Escape", "Backspace", "Enter", " ", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key) || shortcutIndex(event) >= 0) event.preventDefault();
  if (event.key === "Escape") { void command("wheel_close"); return; }
  if (busy || switching) return;
  if (event.key === "Backspace") { back(); return; }
  if (event.key === "Enter" || event.key === " ") {
    if (document.activeElement?.classList.contains("hub")) back();
    else if (document.activeElement?.classList.contains("empty-add") && settings.wheelAddSlot) void command("wheel_open_add_dialog", { groupPath: [...stack] });
    else void commit();
    return;
  }
  const current = level();
  const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
  if (direction && current.count) { select(((selected ?? -1) + direction + current.count) % current.count, true); return; }
  const digit = shortcutIndex(event);
  if (!event.repeat && digit >= 0 && digit < current.items.length) { select(digit, true); void commit(); }
});
window.addEventListener("resize", draw);
systemTheme.addEventListener("change", () => { theme(); draw(); });
systemMotion.addEventListener("change", draw);
window.addEventListener("pagehide", () => {
  disposed = true; cancelAnimationFrame(frame);
  for (const unsubscribe of subscriptions) unsubscribe();
}, { once: true });
async function subscribe(name, callback) {
  const unsubscribe = await listen(name, callback);
  if (disposed) unsubscribe(); else subscriptions.push(unsubscribe);
}
if (svg) {
  (async () => {
    // Subscribe first: startup may open a session before the prewarmed page finishes loading.
    await subscribe("wheel:open", (payload) => { void open(payload); });
    await subscribe("wheel:shown", (payload) => {
      if (!wheel || payload.session !== session) return;
      openedAt = performance.now();
      content.classList.remove("is-visible"); content.getBoundingClientRect(); content.classList.add("is-visible");
      draw();
    });
    await subscribe("wheel:close", (payload) => clear(payload?.session));
    await subscribe("wheel:release", release);
    await subscribe("state:changed", receiveState);
    receiveState(await getState());
    document.fonts.ready.then(draw);
  })().catch(error);
}
