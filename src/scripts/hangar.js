// The helicopter page's hangar. Where WebGL 2 works it is a showroom like the Everyday Cars one: three.js
// loads with the page, src/three/hangar3d.js takes over once the first aircraft is in, and the controls sit on
// the canvas (aircraft, power, LOD, wireframe, views and the pilot's seat, time of day). Otherwise it is a
// flip-book of Unity captures: pick an aircraft, drag (or arrow keys) to walk round it through its captured
// views and spin its rotors up (the hover capture); two stacked frames crossfade so a change never flashes.
// Works without the micro.js extras.
import { countTo, scramble } from "./micro.js";
import { webglAvailable } from "../three/fetch.js";

const VIEWS = ["front34", "side", "rear34"];
const VIEW_NAMES = { front34: "front three-quarter view", side: "side view", rear34: "rear three-quarter view", hover: "rotors spinning" };
const STEP_PX = 70;

const src = (id, view, w) => `/assets/img/helicopters/${id}-${view}-${w}.webp`;
const srcset = (id, view) => `${src(id, view, 720)} 720w, ${src(id, view, 1280)} 1280w`;
const sizeText = (h) => `${h.length.toFixed(2)} × ${h.width.toFixed(2)} × ${h.height.toFixed(2)} m`;
const fmt = (n) => n.toLocaleString("en-GB");

export function startHangar(root, fleet) {
  const byId = Object.fromEntries(fleet.map((h) => [h.id, h]));
  const ids = fleet.map((h) => h.id);
  const canvas = root.querySelector(".showroom-canvas");
  const stage = root.querySelector("[data-stage]");
  const frames = [...stage.querySelectorAll(".frame")];
  const spinBox = root.querySelector("[data-spin]");
  const picks = [...root.querySelectorAll("[data-pick]")];
  const viewButtons = [...root.querySelectorAll("[data-view]")];
  const lodButtons = [...root.querySelectorAll("[data-lod]")];
  const moodButtons = [...root.querySelectorAll("[data-mood]")];
  const wireButton = root.querySelector("[data-wire]");
  const power = root.querySelector("[data-power]");
  const powerOut = root.querySelector("[data-power-out]");
  const statusEl = root.querySelector("[data-status]");
  const readout = root.querySelector("[data-readout]");
  const r = (k) => root.querySelector(`[data-r="${k}"]`);
  const state = { id: root.dataset.aircraft || fleet[0].id, view: "front34", spin: false, token: 0, lod: 1, wire: false };
  const gl = webglAvailable();
  let front = 0;
  let viewer = null;

  const press = (buttons, on) => buttons.forEach((b) => b.setAttribute("aria-pressed", String(on(b))));

  // --- captures (no WebGL) ---------------------------------------------------------------------------

  const preload = (id) => {
    if (viewer) return;
    for (const v of [...VIEWS, "hover"]) {
      const i = new Image();
      i.decoding = "async";
      i.srcset = srcset(id, v);
      i.sizes = frames[0].sizes;
    }
  };

  async function draw() {
    if (viewer) return;
    const view = state.spin ? "hover" : state.view;
    root.toggleAttribute("data-spinning", state.spin);
    const token = ++state.token;
    const back = frames[1 - front];
    back.srcset = srcset(state.id, view);
    back.src = src(state.id, view, 1280);
    try {
      await back.decode();
    } catch {
      /* show it anyway */
    }
    if (token !== state.token) return;
    back.classList.add("is-shown");
    frames[front].classList.remove("is-shown");
    front = 1 - front;
    const h = byId[state.id];
    stage.setAttribute("aria-label", `${h.title}, ${VIEW_NAMES[view]}. Drag or use the left and right arrow keys to turn it.`);
  }

  function setView(name) {
    state.view = name;
    if (!viewer && state.spin) {
      state.spin = false;
      spinBox.checked = false;
    }
    press(viewButtons, (b) => b.dataset.view === state.view);
    if (viewer) viewer.setView(name);
    else draw();
  }

  const stepView = (dir) => {
    const i = Math.max(0, VIEWS.indexOf(state.view));
    setView(VIEWS[(i + dir + VIEWS.length) % VIEWS.length]);
  };

  // --- shared ----------------------------------------------------------------------------------------

  function sync() {
    const h = byId[state.id];
    for (const b of lodButtons) {
      const t = b.querySelector(".tris");
      if (t) t.textContent = fmt(h.tris[+b.dataset.lod]);
    }
    if (readout) {
      const f = h.faces?.[state.lod];
      readout.innerHTML =
        `<strong>${h.title}</strong> <span>${sizeText(h)}</span><span>LOD${state.lod}: ${fmt(h.tris[state.lod])} triangles</span>` +
        (f ? `<span>${fmt(f[0])} quads, ${fmt(f[1])} triangle faces</span>` : "");
    }
  }

  function pick(id) {
    if (!byId[id] || id === state.id) return;
    state.id = id;
    root.dataset.aircraft = id;
    press(picks, (b) => b.dataset.pick === id);
    const h = byId[id];
    r("cls").textContent = h.cls;
    scramble(r("title"), h.title, 420);
    r("line").textContent = h.line;
    r("size").textContent = sizeText(h);
    countTo(r("t0"), h.tris[0], 700);
    countTo(r("t1"), h.tris[1], 700);
    countTo(r("t2"), h.tris[2], 700);
    sync();
    if (viewer) viewer.select(id);
    else draw();
  }

  // initial counters remember what they show, so the first change counts from the real value
  ["t0", "t1", "t2"].forEach((k, i) => (r(k).dataset.shown = byId[state.id].tris[i]));

  picks.forEach((b) => {
    b.addEventListener("click", () => pick(b.dataset.pick));
    b.addEventListener("pointerenter", () => preload(b.dataset.pick), { once: true });
  });
  // the pilot's seat button toggles back out to the front view
  viewButtons.forEach((b) =>
    b.addEventListener("click", () => setView(b.dataset.view === "cockpit" && state.view === "cockpit" ? "front34" : b.dataset.view)),
  );
  spinBox.addEventListener("change", () => {
    state.spin = spinBox.checked;
    draw();
  });

  // Drag to turn: every STEP_PX of travel moves one view round
  let dragX = null;
  stage.addEventListener("pointerdown", (e) => {
    dragX = e.clientX;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (dragX === null) return;
    const dx = e.clientX - dragX;
    if (Math.abs(dx) < STEP_PX) return;
    dragX = e.clientX;
    stage.classList.add("was-dragged");
    stepView(dx < 0 ? 1 : -1);
  });
  const end = () => (dragX = null);
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    stage.classList.add("was-dragged");
    stepView(e.key === "ArrowRight" ? 1 : -1);
  });

  // Links elsewhere on the page (paint schemes, the specs table) load an aircraft and bring the hangar into view
  document.querySelectorAll("[data-jump]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      pick(el.dataset.jump);
      root.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      (viewer ? canvas : stage).focus({ preventScroll: true });
    }),
  );

  if (!gl) {
    preload(state.id);
    return;
  }

  // --- showroom (WebGL 2) ----------------------------------------------------------------------------

  function setLOD(n) {
    state.lod = n;
    press(lodButtons, (b) => +b.dataset.lod === n);
    sync();
    viewer?.setLOD(n);
  }

  function setWire(on) {
    state.wire = on;
    wireButton.setAttribute("aria-pressed", String(on));
    viewer?.setWire(on);
  }

  function setMood(name) {
    press(moodButtons, (b) => b.dataset.mood === name);
    viewer?.applyMood(name);
  }

  function setPower(v) {
    power.value = String(v);
    powerOut.textContent = `${v}%`;
    power.setAttribute("aria-valuetext", v ? `${v} percent power` : "Rotors stopped");
    power.style.setProperty("--p", `${v}%`);
    viewer?.setPower(v / 100);
  }

  let statusTimer;
  function status(s) {
    clearTimeout(statusTimer);
    if (s.loading) {
      // only say so when it takes a moment
      statusTimer = setTimeout(() => {
        statusEl.textContent = `Loading ${s.what}…`;
        root.classList.add("is-loading");
      }, 180);
    } else {
      statusEl.textContent = s.error ? "Could not load this one. Try again in a moment." : "";
      root.classList.remove("is-loading");
    }
  }

  lodButtons.forEach((b) => b.addEventListener("click", () => setLOD(+b.dataset.lod)));
  moodButtons.forEach((b) => b.addEventListener("click", () => setMood(b.dataset.mood)));
  wireButton.addEventListener("click", () => setWire(!state.wire));
  power.addEventListener("input", () => setPower(+power.value));
  canvas.addEventListener("keydown", (e) => {
    if (!viewer || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = ids.indexOf(state.id);
    const keys = {
      ArrowRight: () => pick(ids[(i + 1) % ids.length]),
      ArrowLeft: () => pick(ids[(i + ids.length - 1) % ids.length]),
      1: () => setLOD(0),
      2: () => setLOD(1),
      3: () => setLOD(2),
      w: () => setWire(!state.wire),
      c: () => setView(state.view === "cockpit" ? "front34" : "cockpit"),
    };
    const fn = keys[e.key];
    if (!fn) return;
    e.preventDefault();
    fn();
  });

  async function goLive() {
    let mod;
    try {
      mod = await import("../three/hangar3d.js");
    } catch (err) {
      console.error(err);
      return;
    }
    let live = false;
    const v = mod.startHangar3D(root, fleet, {
      onStatus: (s) => live && status(s),
      onUserTurn() {
        if (state.view === "cockpit") return;
        state.view = "orbit";
        press(viewButtons, () => false);
      },
    });
    if (!v) return;
    if (import.meta.env.DEV) window.__hangar3d = v;
    v.setView(state.view === "orbit" ? "front34" : state.view);
    v.setLOD(state.lod);
    v.setPower(+power.value / 100);
    // keep the captures up until the aircraft on show is in (the roster may change meanwhile)
    while (v.heli?.spec.id !== state.id) {
      if (!(await v.select(state.id)) && v.state.id === state.id) return; // it did not load: stay with the captures
    }
    live = true;
    viewer = v;
    root.classList.add("hangar-live");
    root.toggleAttribute("data-spinning", false);
    root.querySelectorAll("[data-live]").forEach((el) => (el.hidden = false));
    root.querySelectorAll("[data-fallback]").forEach((el) => (el.hidden = true));
    if (state.spin) setPower(100);
    press(viewButtons, (b) => b.dataset.view === state.view);
    sync();
  }

  // The hangar opens the page, so this normally starts at once; pointing at it or tabbing in starts it too
  // (some embedded browsers never report intersections).
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    io.disconnect();
    goLive();
  };
  const io = new IntersectionObserver(([e]) => e.isIntersecting && start(), { rootMargin: "600px 0px" });
  io.observe(root);
  root.addEventListener("pointerenter", start, { once: true });
  root.addEventListener("focusin", start, { once: true });
  sync();
}
