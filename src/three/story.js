import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createCartridge } from "./cartridge.js";
import { RoadWorld } from "./roadworld.js";
import { Workshop } from "./workshop.js";
import { PAINTS } from "./materials.js";
import { webglAvailable } from "./fetch.js";
import vehicles from "../data/everyday-cars.json";

// The home page story. One sticky canvas, scrubbed by scroll, measured in screens (viewport heights):
// the cartridge, a dive through its label into the world inside, four beats across a Saturday, and a
// pull back out to the shelf of cartridges.
const TIMELINE = {
  hero: [0, 0.9],
  dive: [0.9, 2.1],
  topology: [2.1, 3.5],
  lod: [3.5, 4.9],
  paint: [4.9, 6.3],
  lights: [6.3, 7.7],
  exit: [7.7, 9.0],
  library: [9.0, 9.8],
};
export const STORY_SCREENS = 9.8;

// when each overlay is on screen, in screens
const PANELS = {
  hero: [-1, 0.72],
  topology: [2.5, 3.5],
  lod: [3.85, 4.9],
  paint: [5.2, 6.3],
  lights: [6.7, 7.75],
  library: [8.75, 99],
};

// hour of the day inside the cartridge, keyed by screens
const HOURS = [
  [0, 6.13],
  [0.9, 6.13],
  [2.1, 6.9],
  [3.3, 8.5],
  [3.7, 9.8],
  [4.7, 12.4],
  [5.1, 14.2],
  [6.1, 17.2],
  [6.75, 20.7],
  [8.45, 21.6],
  [9.4, 24 + 6.6],
];

const SPACING = 0.125; // between cartridges on the shelf, metres
const BG = "#8f99b6";

const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  outBack: (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2),
};
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const span = (s, a, b) => clamp01((s - a) / (b - a));
const lerp = THREE.MathUtils.lerp;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

function keyed(keys, s) {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, va] = keys[i];
    const [b, vb] = keys[i + 1];
    if (s <= b) return lerp(va, vb, ease.inOut(span(s, a, b)));
  }
  return keys[keys.length - 1][1];
}

const fmtInt = (n) => n.toLocaleString("en-GB");
const paintOrder = (() => {
  const i = PAINTS.findIndex((p) => p.name === "Yellow");
  return [...PAINTS.slice(i), ...PAINTS.slice(0, i)];
})();

export function startStory(section) {
  if (!webglAvailable()) return null;
  try {
    const story = new Story(section);
    if (import.meta.env.DEV) window.__story = story;
    return story;
  } catch (err) {
    console.error(err);
    section.classList.remove("story-live");
    return null;
  }
}

class Story {
  constructor(section) {
    this.section = section;
    section.classList.add("story-live");
    this.stageEl = section.querySelector(".stage");
    this.canvas = section.querySelector(".stage-canvas");
    this.clock = section.querySelector(".stage-clock time");
    this.clockWrap = section.querySelector(".stage-clock");
    this.panels = Object.fromEntries([...section.querySelectorAll("[data-beat]")].map((el) => [el.dataset.beat, el]));
    this.readouts = Object.fromEntries([...section.querySelectorAll("[data-readout]")].map((el) => [el.dataset.readout, el]));
    this.shelf = [...section.querySelectorAll(".shelf-item")];
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.low = matchMedia("(pointer: coarse), (max-width: 760px)").matches;
    // ?og renders a still of the hero for the social preview image (tools/render-og.sh)
    this.still = new URLSearchParams(location.search).has("og");
    if (this.still) document.documentElement.classList.add("og");

    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, stencil: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, this.low ? 1.6 : 2));
    renderer.autoClear = false;
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.004, 30);
    this.portal = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

    this.buildStage();
    this.road = new RoadWorld({ specs: vehicles, stencilRef: 1, portal: this.portal, quality: this.low ? "low" : "high" });
    this.workshops = [
      new Workshop({ stencilRef: 2, portal: this.portal, kind: "kit" }),
      new Workshop({ stencilRef: 3, portal: this.portal, kind: "sculpt" }),
    ];

    this.s = 0; // smoothed progress, screens
    this.target = 0;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.hoverCaption = -1;
    this.clockText = "";
    this.state = {};
    this.started = performance.now();
    this.power = 0; // 0 until the world inside has loaded, then runs to 1
    this.visible = true;

    this.layout();
    this.bind();
    this.road
      .load(() => {
        this.heroReady = performance.now();
      })
      .catch((err) => console.error("Models failed to load", err));
    this.lastFrame = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  buildStage() {
    const stage = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    stage.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    stage.environmentIntensity = 0.55;
    stage.add(new THREE.HemisphereLight("#ffffff", "#8f99b6", 1.5));
    const key = new THREE.DirectionalLight("#fff4e6", 2.6);
    key.position.set(-0.32, 0.62, 0.55);
    key.target.position.set(SPACING, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const c = key.shadow.camera;
    c.left = -0.3;
    c.right = 0.45;
    c.top = 0.35;
    c.bottom = -0.25;
    c.near = 0.1;
    c.far = 2;
    key.shadow.radius = 8;
    key.shadow.bias = -0.0003;
    stage.add(key, key.target);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ color: "#1b2233", opacity: 0.3 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    stage.add(floor);

    this.carts = [
      createCartridge({ stencilRef: 1, print: true }),
      createCartridge({ body: "#8b9099", accent: "#6c717b", bezel: "#a9adb5", stencilRef: 2, tape: "UNREAL ENGINE", mould: "NOT FOR RESALE", mouldInk: "#767b85" }),
      createCartridge({ body: "#8b9099", accent: "#6c717b", bezel: "#a9adb5", stencilRef: 3, tape: "HIGH DETAIL", mould: "NOT FOR RESALE", mouldInk: "#767b85" }),
    ];
    this.carts.forEach((c, i) => {
      c.home = new THREE.Vector3(i * SPACING, 0, 0);
      c.group.position.copy(c.home);
      stage.add(c.group);
    });
    this.stage = stage;

    // the printed label sits in its own pass so it can cover the world drawn through the window
    this.overlay = new THREE.Scene();
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.add(this.carts[0].print);
    this.overlay.add(holder);
    this.printHolder = holder;

  }

  bind() {
    const onScroll = () => {
      const r = this.section.getBoundingClientRect();
      this.target = Math.max(0, -r.top / window.innerHeight);
    };
    this.onScroll = onScroll;
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    new ResizeObserver(() => {
      this.layout();
      onScroll();
    }).observe(this.stageEl);
    addEventListener("pointermove", (e) => {
      this.pointer.tx = (e.clientX / innerWidth) * 2 - 1;
      this.pointer.ty = (e.clientY / innerHeight) * 2 - 1;
      this.pick(e);
    });
    this.canvas.addEventListener("click", (e) => {
      const i = this.pick(e);
      if (i < 0) return;
      if (this.s < 0.75 && i === 0) this.scrollTo(2.6);
      else if (this.libraryOn) {
        const link = this.shelf[i]?.querySelector("a");
        if (link) location.href = link.href;
        else this.carts[i].jiggle = 1;
      }
    });
    this.shelf.forEach((el, i) => {
      el.addEventListener("pointerenter", () => (this.hoverCaption = i));
      el.addEventListener("pointerleave", () => (this.hoverCaption = -1));
      el.addEventListener("focusin", () => (this.hoverCaption = i));
      el.addEventListener("focusout", () => (this.hoverCaption = -1));
    });
    new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(this.section);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.lastFrame = performance.now();
    });
    // keyboard users tabbing into an overlay that is not on screen get scrolled to it
    this.section.addEventListener("focusin", (e) => {
      const beat = e.target.closest("[data-beat]");
      if (!beat) return;
      const [a, b] = PANELS[beat.dataset.beat];
      const s = this.s;
      if (s < a || s > b) this.scrollTo(beat.dataset.beat === "library" ? TIMELINE.library[0] + 0.2 : Math.max(0, a + 0.3));
    });
  }

  /** Which cartridge is under the pointer, if any (only while cartridges are on screen). */
  pick(e) {
    const r = this.canvas.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    let hit = -1;
    if (inside && (this.libraryOn || this.s < 0.75) && !this.inside) {
      this.ndc ??= new THREE.Vector2();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.ray ??= new THREE.Raycaster();
      this.ray.setFromCamera(this.ndc, this.camera);
      this.carts.forEach((c, i) => {
        if (!c.group.visible || hit >= 0) return;
        c.box ??= new THREE.Box3();
        c.box.setFromObject(c.inner);
        if (this.ray.ray.intersectsBox(c.box)) hit = i;
      });
    }
    this.hoverPick = hit;
    this.canvas.style.cursor = hit >= 0 ? "pointer" : "";
    return hit;
  }

  get hover() {
    return this.hoverCaption >= 0 ? this.hoverCaption : (this.hoverPick ?? -1);
  }

  scrollTo(screens) {
    const top = this.section.getBoundingClientRect().top + scrollY;
    scrollTo({ top: top + screens * innerHeight, behavior: this.reduced ? "auto" : "smooth" });
  }

  layout() {
    const w = this.stageEl.clientWidth;
    const h = this.stageEl.clientHeight;
    this.renderer.setSize(w, h, false);
    this.w = w;
    this.h = h;
    this.aspect = w / h;
    this.portrait = this.aspect < 0.95;
    this.camera.aspect = this.aspect;

    // measure the window with the cartridge at rest (layout can run during its drop-in)
    const A = this.carts[0];
    const y = A.group.position.y;
    const rz = A.group.rotation.z;
    A.group.position.y = 0;
    A.group.rotation.z = 0;
    this.wc = A.windowCenter(new THREE.Vector3());
    A.group.position.y = y;
    A.group.rotation.z = rz;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(15));
    const fullH = 0.1375;
    // hero: cartridge on the right with the title on the left, or above the text on tall screens
    this.heroDist = this.portrait ? fullH / (2 * tanHalf * 0.4) : fullH / (2 * tanHalf * 0.64);
    this.heroOffset = this.portrait ? [0, 0.34] : [Math.min(0.46, 0.3 + (this.aspect - 1.2) * 0.12), 0.03];
    this.eyeY = this.wc.y - 0.004;

    // shelf: fit three cartridges across with room for captions underneath
    const rowW = SPACING * 2 + 0.11;
    const fitW = (rowW * 1.18) / (2 * tanHalf * this.aspect);
    const fitH = (fullH * (this.portrait ? 3.4 : 2.6)) / (2 * tanHalf);
    this.libDist = Math.max(fitW, fitH);
    this.libCenter = new THREE.Vector3(SPACING, this.wc.y, 0);

    // the world behind the Everyday Cars label sits on the line of sight through it: straight ahead
    // from the hero camera, and turned toward the shelf camera once we pull back out
    const libEye = this.libraryPose(newPose()).eye;
    this.roadHero = behind(this.wc, this.heroPose(newPose()).eye, 30, 1.4);
    this.roadHero.pos.y = this.eyeY - 1.25;
    this.roadLib = behind(this.wc, libEye, 30 * (this.libDist / 0.8), 1.4);
    this.roadLib.pos.y = libEye.y - 1.25;
    this.road.scene.fog.near = 90;
    this.road.scene.fog.far = 820;

    // the further back the shelf camera, the smaller each window looks; push the workshops back to
    // match so they fill their windows the same way on every screen
    const k = this.libDist / 0.8;
    this.workshops.forEach((ws, i) => {
      const c = this.wc.clone();
      c.x += (i + 1) * SPACING;
      const at = behind(c, libEye, 150 * k, 0);
      ws.root.position.set(at.pos.x, libEye.y - 2.5, at.pos.z);
      ws.root.rotation.y = at.rotY;
      ws.scene.fog.near = 130 * k;
      ws.scene.fog.far = 300 * k;
    });
    this.applyCamera(true);
  }

  // --- camera ------------------------------------------------------------------------------------

  heroPose(out) {
    out.eye.set(this.wc.x, this.eyeY, this.wc.z + this.heroDist);
    out.look.set(0, 0, -1);
    out.fov = 30;
    out.offset[0] = this.heroOffset[0];
    out.offset[1] = this.heroOffset[1];
    return out;
  }

  libraryPose(out) {
    out.eye.set(this.libCenter.x, this.libCenter.y, this.wc.z + this.libDist);
    out.look.set(0, 0, -1);
    out.fov = 30;
    out.offset[0] = 0;
    out.offset[1] = this.portrait ? -0.05 : -0.14;
    return out;
  }

  /** Poses inside the world are relative to the hero car (forward is -Z). */
  carPose(name, t, out) {
    const H = this.road.heroPosition(this._h ??= new THREE.Vector3());
    const P = {
      topology: [[6.7, 1.2, -0.2], [6.2, 1.25, -0.7], [0, 0.6, -0.15], 32, [0.24, 0.12]],
      lod: [[5.8, 1.8, 3.6], [8.8, 3.5, 9.0], [0, 0.55, 0], 30, [0.22, 0.06]],
      paint: [[4.4, 1.0, -6.6], [1.8, 0.9, -7.4], [0, 0.62, -0.5], 30, [0.24, 0.08]],
      lights: [[-1.4, 2.3, 10.5], [-0.9, 2.0, 9.0], [0.3, 0.8, -14], 42, [0, 0]],
    }[name];
    const [a, b, look, fov, offset] = P;
    const k = this.reduced ? 0.5 : t;
    out.eye.set(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)).add(H);
    out.look.set(look[0], look[1], look[2]).add(H).sub(out.eye).normalize();
    out.fov = fov;
    out.offset[0] = this.portrait ? 0 : offset[0];
    out.offset[1] = this.portrait ? (name === "lights" ? 0.1 : 0.24) : offset[1];
    if (this.portrait) {
      // pull back on tall screens so the car fits the width
      const back = { topology: 2.6, lod: 1.7, paint: 2.1, lights: 1.2 }[name];
      out.eye.sub(H).multiplyScalar(back).add(H);
      out.eye.y = lerp(out.eye.y, H.y + b[1], 0.3);
      out.look.copy(H).add(this._v1.set(look[0], look[1], look[2])).sub(out.eye).normalize();
    }
    return out;
  }

  /** Door pose: just in front of the window, where it covers the whole screen. */
  doorPose(out) {
    out.eye.set(this.wc.x, this.eyeY, this.wc.z + 0.01);
    out.look.set(0, 0, -1);
    out.fov = 30;
    out.offset[0] = out.offset[1] = 0;
    return out;
  }

  pose(s, out) {
    const T = TIMELINE;
    const a = (this._pa ??= newPose());
    const b = (this._pb ??= newPose());
    if (this.reduced) s = this.snap(s);

    if (s < T.dive[0]) return this.heroPose(out);
    if (s < 1.6) {
      // approach the label: distance shrinks geometrically so the last centimetres don't crawl
      const t = ease.inOut(span(s, T.dive[0], 1.6));
      this.heroPose(a);
      this.doorPose(b);
      blend(a, b, t, out);
      const d = Math.exp(lerp(Math.log(this.heroDist), Math.log(0.01), t));
      out.eye.z = this.wc.z + d;
      return out;
    }
    if (s < 2.5) {
      // through the label and into the world
      const t = ease.inOut(span(s, 1.6, 2.5));
      this.doorPose(a);
      this.carPose("topology", 0, b);
      const H = this.road.heroPosition(this._h ??= new THREE.Vector3());
      const mid = this._v2.set(H.x + 1.5, H.y + 2.4, H.z + 16);
      quadratic(a.eye, mid, b.eye, t, out.eye);
      out.look.copy(a.look).lerp(b.look, ease.inOut(span(t, 0.35, 1))).normalize();
      out.fov = lerp(a.fov, b.fov, t);
      out.offset[0] = out.offset[1] = 0;
      return out;
    }
    const beat = (name, from, prev, start, settle, end) => {
      const t = span(s, settle, end);
      if (s < settle && prev) {
        this.carPose(prev, 1, a);
        this.carPose(name, 0, b);
        return blend(a, b, ease.inOut(span(s, start, settle)), out);
      }
      return this.carPose(name, t, out);
    };
    if (s < T.topology[1]) return beat("topology", 0, null, 2.5, 2.5, T.topology[1]);
    if (s < T.lod[1]) return beat("lod", 0, "topology", T.lod[0], T.lod[0] + 0.4, T.lod[1]);
    if (s < T.paint[1]) return beat("paint", 0, "lod", T.paint[0], T.paint[0] + 0.4, T.paint[1]);
    if (s < T.lights[1]) return beat("lights", 0, "paint", T.lights[0], T.lights[0] + 0.45, T.lights[1]);
    if (s < 8.45) {
      // back down the road toward the label, still facing the way we drove
      const t = ease.inOut(span(s, T.exit[0], 8.45));
      this.carPose("lights", 1, a);
      this.doorPose(b);
      const mid = this._v2.set(this.wc.x + 0.6, this.eyeY + 1.6, this.wc.z - 9);
      quadratic(a.eye, mid, b.eye, t, out.eye);
      out.look.copy(a.look).lerp(b.look, ease.out(t)).normalize();
      out.fov = lerp(a.fov, b.fov, t);
      out.offset[0] = out.offset[1] = 0;
      return out;
    }
    // out through the label and back to the shelf
    const t = ease.inOut(span(s, 8.45, T.exit[1]));
    this.doorPose(a);
    this.libraryPose(b);
    blend(a, b, t, out);
    const d = Math.exp(lerp(Math.log(0.01), Math.log(this.libDist), t));
    out.eye.z = this.wc.z + d;
    return out;
  }

  /** Reduced motion: hold each beat's pose instead of flying between them. */
  snap(s) {
    const T = TIMELINE;
    if (s < 1.6) return 0;
    if (s < T.lod[0]) return 3.0;
    if (s < T.paint[0]) return 4.4;
    if (s < T.lights[0]) return 5.8;
    if (s < 8.2) return 7.2;
    return T.library[0];
  }

  applyCamera(force = false) {
    const p = (this._pose ??= newPose());
    this.pose(this.s, p);
    const cam = this.camera;
    // a little parallax from the pointer while looking at cartridges
    const still = (1 - span(this.s, 0.6, 1.1)) + span(this.s, 8.9, 9.2);
    if (!this.reduced && still > 0) {
      const m = (this.s < 5 ? this.heroDist : this.libDist) * 0.09 * Math.min(1, still);
      p.eye.x += this.pointer.x * m;
      p.eye.y -= this.pointer.y * m * 0.5;
    }
    cam.position.copy(p.eye);
    cam.lookAt(this._v3.copy(p.eye).add(p.look));
    if (force || cam.fov !== p.fov || this.offX !== p.offset[0] || this.offY !== p.offset[1]) {
      cam.fov = p.fov;
      this.offX = p.offset[0];
      this.offY = p.offset[1];
      cam.setViewOffset(this.w, this.h, (-p.offset[0] * this.w) / 2, (p.offset[1] * this.h) / 2, this.w, this.h);
    }
    cam.updateMatrixWorld();
  }

  /** True once the label window covers the whole screen (or the camera has passed through it). */
  isInside() {
    const cam = this.camera;
    if (cam.position.z < this.wc.z) return true;
    const pts = this.carts[0].windowCorners((this._corners ??= []));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      const v = this._v4.copy(p).project(cam);
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    return minX < -1.02 && maxX > 1.02 && minY < -1.02 && maxY > 1.02;
  }

  // --- per-frame ---------------------------------------------------------------------------------

  loop(now) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.visible) return;

    this.s = this.reduced ? this.target : damp(this.s, this.target, 7, dt);
    if (Math.abs(this.s - this.target) < 0.0005) this.s = this.target;
    this.pointer.x = damp(this.pointer.x, this.pointer.tx, 4, dt);
    this.pointer.y = damp(this.pointer.y, this.pointer.ty, 4, dt);

    this.intro(now);
    this.applyCamera();
    this.updateWorld(dt, now);
    this.updateOverlays();
    this.render();
  }

  intro(now) {
    const A = this.carts[0];
    const t = this.reduced || this.still ? 1 : clamp01((now - this.started) / 950);
    this.dropY = 0.05 * (1 - ease.outBack(t)) * (t < 1 ? 1 : 0);
    this.dropRot = (1 - ease.out(t)) * 0.05;
    if (this.heroReady && t >= 1 && !this.poweredAt) {
      this.poweredAt = now;
      this.section.classList.add("is-on");
    }
    this.power = this.poweredAt ? (this.reduced || this.still ? 1 : clamp01((now - this.poweredAt) / 2600)) : 0;
    const print = this.carts[0].print;
    print.material.opacity = 1 - THREE.MathUtils.smoothstep(this.power, 0.05, 0.45);
    print.visible = print.material.opacity > 0.001;
    // the printed label can't wait forever on a slow connection
    if (!this.poweredAt && now - this.started > 9000) this.section.classList.add("is-on");
  }

  updateWorld(dt, now) {
    const s = this.reduced ? this.snap(this.s) : this.s;
    const road = this.road;
    const motion = this.reduced ? 0 : 1;
    let hours = keyed(HOURS, s);
    if (!this.reduced) hours = lerp(5.6, hours, ease.out(this.power));
    road.setTime(hours);
    road.updateEnvironment(this.renderer);
    road.update(dt, this.camera, motion);
    this.hours = hours;

    // the road world turns to face the shelf camera as we pull back out
    const turn = ease.inOut(span(s, 8.45, 9.0));
    road.root.position.lerpVectors(this.roadHero.pos, this.roadLib.pos, turn);
    road.root.rotation.y = lerp(this.roadHero.rotY, this.roadLib.rotY, turn);

    // the shelf assembles while we pull out of the world
    const lib = span(s, 8.3, 9.0);
    this.libraryOn = lib > 0;
    const pickable = this.libraryOn || s < 0.75;
    this.carts.forEach((c, i) => {
      // hover lifts a cartridge off the shelf; a click on one still in the workshop jiggles it
      c.lift = damp(c.lift ?? 0, pickable && this.hover === i ? 0.009 : 0, 12, dt);
      c.jiggle = Math.max(0, (c.jiggle ?? 0) - dt * 1.6);
      const wob = this.reduced ? 0 : Math.sin(c.jiggle * 38) * c.jiggle * 0.12;
      if (!i) {
        c.group.position.y = (this.dropY ?? 0) + c.lift;
        c.group.rotation.z = (this.dropRot ?? 0) + wob;
        return;
      }
      const t = ease.out(span(lib, 0.15 * (i - 1), 0.75 + 0.15 * (i - 1)));
      c.group.position.set(c.home.x + (1 - t) * 0.5, c.home.y + c.lift, c.home.z);
      c.group.rotation.z = wob;
      c.group.visible = t > 0;
    });
    for (const ws of this.workshops) ws.update(dt, motion);

    const hero = road.hero;
    if (!hero) return;
    const T = TIMELINE;
    const H = road.heroPosition(this._h ??= new THREE.Vector3());

    // topology: clay sweeps front to back with the quad edges drawn on it
    const clayOn = s > 2.3 && s < T.topology[1];
    const sweepT = span(s, 2.65, 3.25);
    const front = H.z - hero.spec.length / 2 - 0.2;
    const back = H.z + hero.spec.length / 2 + 0.2;
    road.sweep.uClay.value = clayOn ? 1 : 0;
    road.sweep.uSweep.value = clayOn ? lerp(front, back, ease.inOut(sweepT)) : -1e5;
    road.wirePlane.constant = clayOn ? road.sweep.uSweep.value : 1e5;

    // levels of detail step down as the camera backs away
    let lod = 0;
    if (s >= T.lod[0] && s < T.lod[1]) lod = s < 4.05 ? 0 : s < 4.45 ? 1 : 2;
    hero.setLOD(lod);
    hero.setWire(clayOn || (s >= T.lod[0] - 0.1 && s < T.lod[1]));

    // paint: every colour in the pack, one after another
    let paint = "Yellow";
    let paintIndex = 0;
    if (s >= T.paint[0] && s < T.paint[1] + 0.3) {
      paintIndex = Math.min(16, Math.max(0, Math.floor(span(s, T.paint[0] + 0.45, T.paint[1] - 0.05) * 17)));
      paint = paintOrder[paintIndex].name;
    }
    hero.setPaint(paint);

    // lights: on with the dusk, then the brakes, then an indicator
    const dark = road.night > 0.45;
    const inLights = s >= T.lights[0];
    hero.setLamps({
      head: dark,
      brake: inLights && s > 7.0 && s < 7.3,
      left: inLights && s >= 7.3 && s < 7.9,
    });
    hero.steer(inLights && s >= 7.3 && s < 7.9 ? 0.06 : 0);

    this.updateReadouts({ lod, paint, paintIndex, hero });
  }

  updateReadouts({ lod, paintIndex, hero }) {
    const spec = hero.spec;
    const st = this.state;
    if (st.lod !== lod) {
      st.lod = lod;
      if (this.readouts.lod) {
        this.readouts.lod.textContent = `LOD${lod}: ${fmtInt(spec.tris[lod])} triangles, ${["full detail", "mid distance", "far away"][lod]}`;
      }
    }
    if (st.paint !== paintIndex) {
      st.paint = paintIndex;
      if (this.readouts.paint) this.readouts.paint.textContent = `Paint_${paintOrder[paintIndex].name}, colour ${paintIndex + 1} of 17`;
    }
    const l = hero.lamp;
    const lamps = [l.head && "headlights", (l.head || l.brake) && (l.brake ? "brake lights" : "tail lights"), l.left && "left indicator"].filter(Boolean);
    const lampText = lamps.length ? `On: ${lamps.join(", ")}` : "All lamps off";
    if (st.lamps !== lampText) {
      st.lamps = lampText;
      if (this.readouts.lights) this.readouts.lights.textContent = lampText;
    }
  }

  updateOverlays() {
    const s = this.s;
    for (const [name, el] of Object.entries(this.panels)) {
      const [a, b] = PANELS[name];
      const o = THREE.MathUtils.smoothstep(s, a, a + 0.18) * (1 - THREE.MathUtils.smoothstep(s, b - 0.18, b));
      if (el._o !== o) {
        el._o = o;
        el.style.setProperty("--o", o.toFixed(3));
        el.classList.toggle("is-shown", o > 0.5);
      }
    }
    const clockOn = s > 1.9 && s < 8.3;
    this.clockWrap.classList.toggle("is-shown", clockOn);
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    const text = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    if (text !== this.clockText) {
      this.clockText = text;
      this.clock.textContent = text;
      this.clock.dateTime = text;
    }

    // captions follow their cartridges
    if (this.libraryOn || this.shelfPlaced) {
      this.shelfPlaced = this.libraryOn;
      const v = this._v4;
      this.carts.forEach((c, i) => {
        const el = this.shelf[i];
        if (!el) return;
        v.copy(c.group.position).project(this.camera);
        const x = (v.x * 0.5 + 0.5) * this.w;
        const y = (-v.y * 0.5 + 0.5) * this.h;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      });
      const px = (SPACING / (2 * Math.tan(THREE.MathUtils.degToRad(15)) * this.libDist * this.aspect)) * this.w;
      this.section.style.setProperty("--slot", `${Math.round(px)}px`);
    }
  }

  setNearFar(near, far) {
    const cam = this.camera;
    if (cam.near === near && cam.far === far) return;
    cam.near = near;
    cam.far = far;
    cam.updateProjectionMatrix();
  }

  render() {
    const r = this.renderer;
    const inside = this.isInside();
    this.inside = inside;
    r.setRenderTarget(null);
    r.setClearColor(BG, 1);
    r.state.buffers.stencil.setClear(inside ? 1 : 0);
    r.clear(true, true, true);

    if (inside) {
      this.portal.constant = 1e5;
      this.setNearFar(0.05, 3000);
      r.render(this.road.scene, this.camera);
      return;
    }

    this.portal.constant = this.wc.z;
    this.setNearFar(0.004, 30);
    r.render(this.stage, this.camera);
    this.setNearFar(0.2, 3000);
    r.clearDepth();
    r.render(this.road.scene, this.camera);
    if (this.libraryOn) {
      for (const ws of this.workshops) {
        r.clearDepth();
        r.render(ws.scene, this.camera);
      }
    }
    if (this.carts[0].print.visible) {
      this.printHolder.matrix.copy(this.carts[0].inner.matrixWorld);
      this.printHolder.updateMatrixWorld(true);
      this.setNearFar(0.004, 30);
      r.render(this.overlay, this.camera);
    }
  }

  _v1 = new THREE.Vector3();
  _v2 = new THREE.Vector3();
  _v3 = new THREE.Vector3();
  _v4 = new THREE.Vector3();
}

/** Where to put a world so it sits `depth` metres down the line of sight from `eye` through `win`. */
function behind(win, eye, depth, right) {
  const yaw = Math.atan2(eye.x - win.x, eye.z - win.z);
  const pos = new THREE.Vector3(
    win.x - Math.sin(yaw) * depth + Math.cos(yaw) * right,
    0,
    win.z - Math.cos(yaw) * depth - Math.sin(yaw) * right,
  );
  return { pos, rotY: yaw };
}

function newPose() {
  return { eye: new THREE.Vector3(), look: new THREE.Vector3(0, 0, -1), fov: 30, offset: [0, 0] };
}

function blend(a, b, t, out) {
  out.eye.lerpVectors(a.eye, b.eye, t);
  out.look.lerpVectors(a.look, b.look, t).normalize();
  out.fov = lerp(a.fov, b.fov, t);
  out.offset[0] = lerp(a.offset[0], b.offset[0], t);
  out.offset[1] = lerp(a.offset[1], b.offset[1], t);
  return out;
}

function quadratic(p0, p1, p2, t, out) {
  const u = 1 - t;
  return out.set(
    u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
  );
}
