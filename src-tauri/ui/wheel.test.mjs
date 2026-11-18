// Exercise the real controller without starting a browser or native application.
import test from "node:test";
import assert from "node:assert/strict";

class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.attributes = new Map();
    this.style = {}; this.dataset = {}; this.hidden = false; this.textContent = "";
    this.listeners = new Map();
    this.classList = {
      contains: (name) => (this.attributes.get("class") || "").split(/\s+/u).includes(name),
      add: (...names) => this.setAttribute("class", [...new Set([...(this.attributes.get("class") || "").split(/\s+/u).filter(Boolean), ...names])].join(" ")),
      remove: (...names) => this.setAttribute("class", (this.attributes.get("class") || "").split(/\s+/u).filter((name) => !names.includes(name)).join(" ")),
    };
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  cloneNode() { const copy = new Element(this.tagName); copy.attributes = new Map(this.attributes); return copy; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  querySelectorAll() { return []; }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith(".") && child.classList.contains(selector.slice(1))) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
  getBoundingClientRect() { return { x: 0, y: 0, width: 600, height: 600 }; }
}

test("wheel controller preserves sessions, activation and physical icon placement without a GUI", async (t) => {
  const nodes = Object.fromEntries(["wheel", "wheel-images", "wheel-content", "wheel-status"].map((id) => [id, new Element(id === "wheel" ? "svg" : "div")]));
  nodes["wheel-content"].hidden = true;
  const nativeEvents = new Map(), windowEvents = new Map(), keys = new Map(), frames = new Map(), calls = [];
  let now = 0, frameId = 0, currentSession = 0;
  const action = (id, kind = "app", children = []) => ({ id, kind, name: id, target: `C:\\${id}.exe`, icon: kind, children });
  const settings = {
    theme: "dark", reducedMotion: false, wheelSize: 520, wheelAddSlot: true,
    activationMode: "release", groupOpenMode: "hover", hoverDelay: 150,
    closeOnOutsideClick: true, activeMenuId: "one",
    menus: [{ id: "one", name: "One", items: [action("first"), action("group", "group", [action("nested")])] }, { id: "two", name: "Two", items: [action("second")] }],
  };
  let snapshot = { revision: 0, settings: structuredClone(settings), wheel: { session: 0, visible: false } };
  const send = (name, payload) => nativeEvents.get(name)?.({ payload });
  const idle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  const tick = async (elapsed = 16) => {
    now += elapsed;
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(now);
    await idle();
  };
  const open = async (overrides = {}) => {
    currentSession += 2;
    snapshot = {
      revision: snapshot.revision + 1, settings: { ...structuredClone(settings), ...overrides.settings },
      wheel: { session: currentSession, visible: true, trigger: "mouse", stack: [], selected: null, foreground: null, released: false, scale: 1.25, size: 520, bounds: { x: -600, y: 20, width: 750, height: 750 }, ...overrides.wheel },
    };
    send("wheel:open", snapshot); await idle();
  };
  const key = async (value, repeat = false) => { keys.get("keydown")({ key: value, repeat, preventDefault() {} }); await idle(); };
  const pointer = async (x, y, type = "pointermove") => { nodes.wheel.listeners.get(type)({ clientX: x, clientY: y, button: 0 }); await idle(); };
  const count = (name) => calls.filter((call) => call.command === name).length;
  const latest = (name) => calls.findLast((call) => call.command === name);

  globalThis.performance = { now: () => now };
  globalThis.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.DOMParser = class { parseFromString() { return { documentElement: new Element("svg") }; } };
  globalThis.document = {
    documentElement: new Element("html"), activeElement: null, fonts: { ready: Promise.resolve() },
    querySelector: (selector) => nodes[selector.slice(1)],
    createElementNS: (_, tag) => new Element(tag),
    createElement: (tag) => tag === "canvas" ? { getContext: () => ({ measureText: (text) => ({ width: text.length * 6 }) }) } : new Element(tag),
    addEventListener: (name, callback) => keys.set(name, callback),
  };
  globalThis.window = {
    innerWidth: 600, innerHeight: 600, devicePixelRatio: 1.25,
    addEventListener: (name, callback) => windowEvents.set(name, callback),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    __TAURI__: {
      event: { listen: async (name, callback) => { nativeEvents.set(name, callback); return () => nativeEvents.delete(name); } },
      core: { invoke: async (command, args = {}) => {
        calls.push({ command, args: structuredClone(args) });
        if (command === "get_state") return structuredClone(snapshot);
        if (command === "item_icon") return "data:image/png;base64,fixture";
        if (command === "wheel_add_foreground") {
          let items = snapshot.settings.menus.find((menu) => menu.id === snapshot.settings.activeMenuId).items;
          for (const id of args.groupPath) items = items.find((item) => item.id === id).children;
          items.push(action("added")); snapshot.revision++;
          return "added";
        }
        if (command === "wheel_switch_menu") {
          snapshot.settings.activeMenuId = snapshot.settings.activeMenuId === "one" ? "two" : "one";
          snapshot.revision++;
          return structuredClone(snapshot);
        }
        return undefined;
      } },
    },
  };
  await import("./wheel.js"); await idle();

  await t.test("subscribes before initial recovery and acknowledges after two frames", async () => {
    assert.equal(nodes["wheel-content"].hidden, true);
    assert.ok(nativeEvents.has("wheel:release"));
    await open();
    assert.equal(count("wheel_painted"), 0);
    await tick(); assert.equal(count("wheel_painted"), 0);
    await tick(); assert.equal(count("wheel_painted"), 1);
    assert.equal(latest("wheel_painted").args.session, currentSession);
    const image = nodes["wheel-images"].children.find((node) => node.tagName === "img");
    assert.ok(image, "native PNG icon rendered in independent HTML layer");
    for (const property of ["left", "top", "width", "height"]) {
      const physical = Number.parseFloat(image.style[property]) * window.devicePixelRatio;
      assert.ok(Math.abs(physical - Math.round(physical)) < 1e-8, `${property} must align with physical pixels`);
    }
    assert.equal(Number.parseFloat(image.style.width) * 1.25, latest("item_icon").args.physicalPx);
  });

  await t.test("release uses physical screen coordinates on a negative-origin monitor", async () => {
    const launched = count("wheel_launch");
    send("wheel:release", { session: currentSession, x: -225, y: 192 }); await idle();
    assert.equal(count("wheel_launch"), launched + 1);
    assert.equal(latest("wheel_launch").args.id, "first");
  });

  await t.test("close clears content and stale events cannot resurrect or activate it", async () => {
    const old = structuredClone(snapshot), launched = count("wheel_launch");
    send("wheel:close", { session: currentSession + 1 });
    assert.equal(nodes["wheel-content"].hidden, true);
    assert.equal(nodes.wheel.children.length, 0);
    send("wheel:open", old);
    send("wheel:release", { session: old.wheel.session, x: -225, y: 192 });
    await tick(); assert.equal(count("wheel_launch"), launched);
    assert.equal(nodes["wheel-content"].hidden, true);
  });

  await t.test("digits activate actions and never the add slot", async () => {
    await open({ wheel: { trigger: "keyboard" } });
    const launched = count("wheel_launch");
    await key("3"); assert.equal(count("wheel_launch"), launched);
    await key("1", true); assert.equal(count("wheel_launch"), launched);
    await key("1"); assert.equal(latest("wheel_launch").args.id, "first");
  });

  await t.test("groups, back and menu scrolling synchronize native navigation", async () => {
    await open({ wheel: { trigger: "keyboard" } });
    await key("2"); assert.deepEqual(latest("wheel_navigate").args.stack, ["group"]);
    await key("Backspace"); assert.deepEqual(latest("wheel_navigate").args.stack, []);
    await windowEvents.get("wheel")({ deltaY: 100, preventDefault() {} }); await idle();
    assert.equal(latest("wheel_switch_menu").args.direction, 1);
    await key("1"); assert.equal(latest("wheel_launch").args.id, "second");
  });

  await t.test("mouse hover fires only after its delay; keyboard-triggered hover does not launch", async () => {
    await open({ settings: { activationMode: "hover" } });
    const launched = count("wheel_launch");
    await pointer(300, 138); await tick(149);
    assert.equal(count("wheel_launch"), launched);
    await tick(1); assert.equal(count("wheel_launch"), launched + 1);
    await open({ settings: { activationMode: "hover" }, wheel: { trigger: "keyboard" } });
    await pointer(300, 138); await tick(400);
    assert.equal(count("wheel_launch"), launched + 1);
  });

  await t.test("group hover has its own 300ms timer and ignores small movements after entry", async () => {
    await open({ settings: { activationMode: "click" } });
    // Three slots: group is lower right, independent of the action activation mode.
    await pointer(441, 381); const navigations = count("wheel_navigate");
    await tick(299); assert.equal(latest("wheel_navigate").args.stack.length, 0);
    await tick(1); assert.deepEqual(latest("wheel_navigate").args.stack, ["group"]);
    await pointer(444, 382); assert.equal(count("wheel_navigate"), navigations + 1);
  });

  await t.test("plus never activates on hover or side-button release", async () => {
    await open({ settings: { activationMode: "hover" } });
    const adds = count("wheel_open_add_dialog");
    await pointer(159, 381); await tick(500);
    assert.equal(count("wheel_open_add_dialog"), adds);
    await open();
    send("wheel:release", { session: currentSession, x: -401, y: 496 }); await idle();
    assert.equal(count("wheel_open_add_dialog"), adds);
    await pointer(159, 381, "pointerup");
    assert.equal(count("wheel_open_add_dialog"), adds + 1);
  });

  await t.test("foreground plus adds to the nested level and keeps the new action selected", async () => {
    await open({ wheel: { trigger: "keyboard", foreground: { name: "Foreground", target: "C:\\foreground.exe", args: "" } } });
    await key("2");
    await key("ArrowRight"); await key("ArrowRight"); await key("Enter");
    assert.deepEqual(latest("wheel_add_foreground").args.groupPath, ["group"]);
    assert.equal(latest("wheel_navigate").args.selected, 1);
    assert.equal(nodes["wheel-content"].hidden, false);
    assert.ok(nodes["wheel-images"].children.some((node) => node.classList.contains("bitmap-badge")), "foreground add badge is above the PNG layer");
  });

  await t.test("empty wheels route their lower add target to the editor", async () => {
    const menus = [{ id: "one", name: "Empty", items: [] }];
    await open({ settings: { menus } });
    const adds = count("wheel_open_add_dialog");
    await pointer(300, 450, "pointerup");
    assert.equal(count("wheel_open_add_dialog"), adds + 1);
    assert.deepEqual(latest("wheel_open_add_dialog").args.groupPath, []);
  });

  await t.test("recovery uses stored releasePoint and rapid reopening cancels the old paint acknowledgement", async () => {
    await open({ wheel: { released: true, releasePoint: [-225, 192] } });
    assert.equal(latest("wheel_launch").args.session, currentSession);
    const stale = currentSession;
    await open();
    const painted = count("wheel_painted"); await tick(); await tick();
    assert.equal(count("wheel_painted"), painted + 1);
    assert.notEqual(latest("wheel_painted").args.session, stale);
    send("wheel:close", { session: stale + 1 });
    assert.equal(nodes["wheel-content"].hidden, false, "old close cannot hide new wheel");
    await key("Escape"); assert.equal(latest("wheel_close").args.session, currentSession);
  });

  await t.test("same-session snapshots recover a release missed while subscribing and consume it once", async () => {
    await open();
    const launched = count("wheel_launch");
    snapshot.wheel.released = true; snapshot.wheel.releasePoint = [-225, 192];
    send("state:changed", structuredClone(snapshot)); await idle();
    assert.equal(count("wheel_launch"), launched + 1);
    send("wheel:release", { session: currentSession, x: -225, y: 192 }); await idle();
    send("state:changed", structuredClone(snapshot)); await idle();
    assert.equal(count("wheel_launch"), launched + 1, "event and retained snapshot represent one side-button release");
  });

  await t.test("shared renderer icon requests notify both preview and list consumers", async () => {
    const { requestIcon, iconName } = await import("./wheel-renderer.js");
    let previewReady = 0, listReady = 0;
    const before = count("item_icon");
    assert.equal(requestIcon("C:\\shared-consumer.exe", 28, () => previewReady++), null);
    assert.equal(requestIcon("C:\\shared-consumer.exe", 28, () => listReady++), null);
    await idle();
    assert.equal(count("item_icon"), before + 1);
    assert.equal(previewReady, 1); assert.equal(listReady, 1);
    assert.equal(requestIcon("C:\\shared-consumer.exe", 28, () => assert.fail("cached icon should return immediately")), "data:image/png;base64,fixture");
    for (const name of ["__proto__", "constructor", "toString"]) assert.equal(iconName({ kind: "system", icon: name, target: name, name: "Windows" }), "system");
  });

  windowEvents.get("pagehide")();
});
