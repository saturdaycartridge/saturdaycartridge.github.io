// The helicopter page's hangar viewer: pick an aircraft, drag (or arrow keys) to walk round it through
// its captured views, and spin its rotors up (the hover capture, with the rotor blur discs showing).
// Two stacked frames crossfade so a change never flashes. Works without the micro.js extras.
import { countTo, scramble } from "./micro.js";

const VIEWS = ["front34", "side", "rear34"];
const VIEW_NAMES = { front34: "front three-quarter view", side: "side view", rear34: "rear three-quarter view", hover: "rotors spinning" };
const STEP_PX = 70;

const src = (id, view, w) => `/assets/img/helicopters/${id}-${view}-${w}.webp`;
const srcset = (id, view) => `${src(id, view, 720)} 720w, ${src(id, view, 1280)} 1280w`;
const sizeText = (h) => `${h.length.toFixed(2)} × ${h.width.toFixed(2)} × ${h.height.toFixed(2)} m`;

export function startHangar(root, fleet) {
  const byId = Object.fromEntries(fleet.map((h) => [h.id, h]));
  const stage = root.querySelector("[data-stage]");
  const frames = [...stage.querySelectorAll(".frame")];
  const spinBox = root.querySelector("[data-spin]");
  const picks = [...root.querySelectorAll("[data-pick]")];
  const viewButtons = [...root.querySelectorAll("[data-view]")];
  const r = (k) => root.querySelector(`[data-r="${k}"]`);
  const state = { id: root.dataset.aircraft || fleet[0].id, view: 0, spin: false, token: 0 };
  let front = 0;

  const preload = (id) => {
    for (const v of [...VIEWS, "hover"]) {
      const i = new Image();
      i.decoding = "async";
      i.srcset = srcset(id, v);
      i.sizes = frames[0].sizes;
    }
  };

  async function draw() {
    const view = state.spin ? "hover" : VIEWS[state.view];
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

  function setView(i) {
    state.view = (i + VIEWS.length) % VIEWS.length;
    if (state.spin) {
      state.spin = false;
      spinBox.checked = false;
    }
    viewButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === VIEWS[state.view])));
    draw();
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
    draw();
  }

  // initial counters remember what they show, so the first change counts from the real value
  ["t0", "t1", "t2"].forEach((k, i) => (r(k).dataset.shown = byId[state.id].tris[i]));

  picks.forEach((b) => {
    b.addEventListener("click", () => pick(b.dataset.pick));
    b.addEventListener("pointerenter", () => preload(b.dataset.pick), { once: true });
  });
  viewButtons.forEach((b) => b.addEventListener("click", () => setView(VIEWS.indexOf(b.dataset.view))));
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
    setView(state.view + (dx < 0 ? 1 : -1));
  });
  const end = () => (dragX = null);
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    stage.classList.add("was-dragged");
    setView(state.view + (e.key === "ArrowRight" ? 1 : -1));
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
}
