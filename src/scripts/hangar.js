// The helicopter page's hangar viewer. Starts as a flip-book of Unity captures: pick an aircraft, drag (or
// arrow keys) to walk round it through its captured views, and spin its rotors up (the hover capture).
// Two stacked frames crossfade so a change never flashes. Where WebGL 2 works, three.js loads as the
// hangar comes near the screen and the real-time viewer (src/three/hangar3d.js) takes over once the first
// aircraft is in: orbit, power, LODs, wireframe and the pilot's seat. The roster and readout serve both.
// Works without the micro.js extras.
import { countTo, scramble } from "./micro.js";
import { webglAvailable } from "../three/fetch.js";

const VIEWS = ["front34", "side", "rear34"];
const VIEW_NAMES = {
  front34: "front three-quarter view",
  side: "side view",
  rear34: "rear three-quarter view",
  hover: "rotors spinning",
  cockpit: "from the pilot's seat",
  orbit: "3D view",
};
const STEP_PX = 70;

const src = (id, view, w) => `/assets/img/helicopters/${id}-${view}-${w}.webp`;
const srcset = (id, view) => `${src(id, view, 720)} 720w, ${src(id, view, 1280)} 1280w`;
const sizeText = (h) => `${h.length.toFixed(2)} × ${h.width.toFixed(2)} × ${h.height.toFixed(2)} m`;
const fmt = (n) => n.toLocaleString("en-GB");

export function startHangar(root, fleet) {
  const byId = Object.fromEntries(fleet.map((h) => [h.id, h]));
  const stage = root.querySelector("[data-stage]");
  const frames = [...stage.querySelectorAll(".frame")];
  const spinBox = root.querySelector("[data-spin]");
  const picks = [...root.querySelectorAll("[data-pick]")];
  const viewButtons = [...root.querySelectorAll("[data-view]")];
  const lodButtons = [...root.querySelectorAll("[data-lod]")];
  const wireButton = root.querySelector("[data-wire]");
  const power = root.querySelector("[data-power]");
  const powerOut = root.querySelector("[data-power-out]");
  const statusEl = root.querySelector("[data-status]");
  const r = (k) => root.querySelector(`[data-r="${k}"]`);
  const state = { id: root.dataset.aircraft || fleet[0].id, view: "front34", spin: false, token: 0, lod: 1, wire: false };
  let front = 0;
  let viewer = null;

  const preload = (id) => {
    if (viewer) return;
    for (const v of [...VIEWS, "hover"]) {
      const i = new Image();
      i.decoding = "async";
      i.srcset = srcset(id, v);
      i.sizes = frames[0].sizes;
    }
  };

  function label() {
    const h = byId[state.id];
    if (viewer) {
      const how = state.view === "cockpit" ? "Drag to look around." : "Drag or use the left and right arrow keys to turn it.";
      stage.setAttribute("aria-label", `${h.title} in 3D, ${VIEW_NAMES[state.view]}. ${how}`);
      return;
    }
    const view = state.spin ? "hover" : state.view;
    stage.setAttribute("aria-label", `${h.title}, ${VIEW_NAMES[view]}. Drag or use the left and right arrow keys to turn it.`);
  }

  async function draw() {
    if (viewer) return label();
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
    label();
  }

  function pressViews() {
    viewButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
  }

  function setView(name) {
    state.view = name;
    if (!viewer && state.spin) {
      state.spin = false;
      spinBox.checked = false;
    }
    pressViews();
    if (viewer) viewer.setView(name);
    draw();
  }

  const stepView = (dir) => {
    const i = Math.max(0, VIEWS.indexOf(state.view));
    setView(VIEWS[(i + dir + VIEWS.length) % VIEWS.length]);
  };

  function showFaces() {
    const f = byId[state.id].faces?.[state.lod];
    const el = r("faces");
    if (el) el.textContent = f ? `LOD${state.lod} topology: ${fmt(f[0])} quads, ${fmt(f[1])} triangles` : "";
    root.querySelectorAll("[data-lod-row]").forEach((row) => row.classList.toggle("is-on", !!viewer && +row.dataset.lodRow === state.lod));
  }

  function pick(id) {
    if (!byId[id] || id === state.id) return;
    state.id = id;
    root.dataset.aircraft = id;
    picks.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pick === id)));
    const h = byId[id];
    r("cls").textContent = h.cls;
    scramble(r("title"), h.title, 420);
    r("line").textContent = h.line;
    r("size").textContent = sizeText(h);
    countTo(r("t0"), h.tris[0], 700);
    countTo(r("t1"), h.tris[1], 700);
    countTo(r("t2"), h.tris[2], 700);
    showFaces();
    if (viewer) viewer.select(id).then(label);
    else draw();
  }

  // initial counters remember what they show, so the first change counts from the real value
  ["t0", "t1", "t2"].forEach((k, i) => (r(k).dataset.shown = byId[state.id].tris[i]));

  picks.forEach((b) => {
    b.addEventListener("click", () => pick(b.dataset.pick));
    b.addEventListener("pointerenter", () => preload(b.dataset.pick), { once: true });
  });
  viewButtons.forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  spinBox.addEventListener("change", () => {
    state.spin = spinBox.checked;
    draw();
  });

  // Drag to turn: every STEP_PX of travel moves one view round (the 3D view has its own orbit controls)
  let dragX = null;
  stage.addEventListener("pointerdown", (e) => {
    if (viewer) return;
    dragX = e.clientX;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (dragX === null || viewer) return;
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
    if (viewer) {
      const keys = {
        ArrowLeft: () => viewer.nudge(-15),
        ArrowRight: () => viewer.nudge(15),
        1: () => setLOD(0),
        2: () => setLOD(1),
        3: () => setLOD(2),
        w: () => setWire(!state.wire),
        c: () => setView(state.view === "cockpit" ? "front34" : "cockpit"),
      };
      const fn = keys[e.key];
      if (!fn || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      stage.classList.add("was-dragged");
      fn();
      return;
    }
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
      stage.focus({ preventScroll: true });
    }),
  );

  preload(state.id);

  // --- real-time viewer ------------------------------------------------------------------------------

  function setLOD(n) {
    state.lod = n;
    lodButtons.forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.lod === n)));
    showFaces();
    viewer?.setLOD(n);
  }

  function setWire(on) {
    state.wire = on;
    wireButton.setAttribute("aria-pressed", String(on));
    viewer?.setWire(on);
  }

  function setPower(v) {
    power.value = String(v);
    powerOut.textContent = `${v}%`;
    power.setAttribute("aria-valuetext", v ? `${v} percent power` : "Rotors stopped");
    power.style.setProperty("--p", `${v}%`);
    root.toggleAttribute("data-spinning", v > 0);
    viewer?.setPower(v / 100);
  }

  let statusTimer;
  function status(s) {
    clearTimeout(statusTimer);
    if (s.loading) {
      // only say so when it takes a moment
      statusTimer = setTimeout(() => {
        statusEl.textContent = `Loading ${s.what}…`;
        stage.classList.add("is-loading");
      }, 180);
    } else {
      statusEl.textContent = s.error ? "Could not load this one. Try again in a moment." : "";
      stage.classList.remove("is-loading");
    }
  }

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
        stage.classList.add("was-dragged");
        if (state.view === "cockpit") return;
        state.view = "orbit";
        pressViews();
      },
      onLOD: showFaces,
    });
    if (!v) return;
    if (import.meta.env.DEV) window.__hangar3d = v;
    v.setView(state.view === "orbit" ? "front34" : state.view);
    v.setLOD(state.lod);
    if (state.spin) setPower(100);
    v.setPower(+power.value / 100);
    // keep the captures up until the aircraft on show is in (the roster may change meanwhile)
    while (v.heli?.spec.id !== state.id) {
      if (!(await v.select(state.id)) && v.state.id === state.id) return; // it did not load: stay with the captures
    }
    live = true;
    viewer = v;
    root.classList.add("hangar-live");
    root.querySelectorAll("[data-live]").forEach((el) => (el.hidden = false));
    root.querySelectorAll("[data-fallback]").forEach((el) => (el.hidden = true));
    root.toggleAttribute("data-spinning", +power.value > 0);
    stage.setAttribute("role", "group");
    stage.setAttribute("aria-roledescription", "3D viewer");
    pressViews();
    showFaces();
    label();
  }

  if (webglAvailable()) {
    lodButtons.forEach((b) => b.addEventListener("click", () => setLOD(+b.dataset.lod)));
    wireButton.addEventListener("click", () => setWire(!state.wire));
    power.addEventListener("input", () => setPower(+power.value));
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      io.disconnect();
      goLive();
    };
    const io = new IntersectionObserver(([e]) => e.isIntersecting && start(), { rootMargin: "600px 0px" });
    io.observe(root);
    // pointing at or tabbing into the hangar starts it too
    root.addEventListener("pointerenter", start, { once: true });
    root.addEventListener("focusin", start, { once: true });
  }
}
