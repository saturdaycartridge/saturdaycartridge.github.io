import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MaterialSet } from "./materials.js";
import { Vehicle } from "./vehicle.js";
import { webglAvailable } from "./fetch.js";
import vehicles from "../data/everyday-cars.json";

// Studio moods for the time-of-day buttons. bg doubles as fog so the floor fades into the backdrop.
const MOODS = {
  morning: { bg: "#dcdfe5", key: "#ffe0c0", keyI: 2.4, hemi: 1.15, env: 0.75, lamps: 0.3, dir: [-5, 3.2, 5] },
  noon: { bg: "#e4e3dd", key: "#ffffff", keyI: 2.9, hemi: 1.35, env: 1, lamps: 0.25, dir: [-2.5, 9, 3] },
  dusk: { bg: "#a98593", key: "#ff9258", keyI: 2.1, hemi: 0.75, env: 0.55, lamps: 0.75, dir: [6, 2.2, -4] },
  night: { bg: "#1b2233", key: "#9cadff", keyI: 0.45, hemi: 0.3, env: 0.14, lamps: 1, dir: [3, 7, 2] },
};

const fmt = (n) => n.toLocaleString("en-GB");

export function startShowroom(root) {
  if (!webglAvailable()) return null;
  try {
    return new Showroom(root);
  } catch (err) {
    console.error(err);
    return null;
  }
}

class Showroom {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector(".showroom-canvas");
    this.readout = root.querySelector("[data-readout]");
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.classList.add("showroom-live");

    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    this.renderer = r;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.fog = new THREE.Fog("#8f99b6", 16, 46);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    this.camera.position.set(6.5, 2.4, -6.5);
    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      enablePan: false,
      enableZoom: false,
      minPolarAngle: 0.25,
      maxPolarAngle: 1.5,
      rotateSpeed: 0.7,
    });
    // vertical swipes keep scrolling the page on touch screens
    this.canvas.style.touchAction = "pan-y";
    this.controls.addEventListener("start", () => (this.userTurned = performance.now()));

    this.hemi = new THREE.HemisphereLight("#ffffff", "#5c6380", 1.2);
    scene.add(this.hemi);
    const key = new THREE.DirectionalLight("#ffffff", 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 40 });
    key.shadow.radius = 5;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    this.key = key;

    this.floorMat = new THREE.MeshStandardMaterial({ color: "#8f99b6", roughness: 1 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    this.turntable = new THREE.Group();
    scene.add(this.turntable);
    this.disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 0.08, 72),
      new THREE.MeshStandardMaterial({ color: "#edf0f6", roughness: 0.55 }),
    );
    this.disc.position.y = 0.04;
    this.disc.receiveShadow = true;
    this.turntable.add(this.disc);
    this.carHolder = new THREE.Group();
    this.carHolder.position.y = 0.08;
    this.turntable.add(this.carHolder);

    this.mats = new MaterialSet({ offset: true });
    this.state = {
      vehicle: root.dataset.vehicle || "Hatchback",
      paint: null,
      lod: 0,
      wire: false,
      trailer: true,
      mood: "noon",
      lamps: { head: false, brake: false, reverse: false, left: false, right: false },
    };
    this.mood = { ...MOODS.noon, bg: new THREE.Color(MOODS.noon.bg), key: new THREE.Color(MOODS.noon.key) };
    this.moodFrom = null;

    this.bindUI();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(this.canvas);
    this.visible = true;
    this.applyMood("noon", true);
    this.select(this.state.vehicle);
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // --- UI ----------------------------------------------------------------------------------------

  bindUI() {
    const root = this.root;
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !root.contains(b)) return;
      if (b.dataset.vehicle) this.select(b.dataset.vehicle);
      else if (b.dataset.paint) this.setPaint(b.dataset.paint);
      else if (b.dataset.lod) this.setLOD(+b.dataset.lod);
      else if (b.dataset.mood) this.applyMood(b.dataset.mood);
      else if (b.dataset.toggle) this.toggle(b.dataset.toggle);
    });
    // the line-up table further down the page can load a vehicle too
    document.addEventListener("click", (e) => {
      const a = e.target.closest("[data-show-vehicle]");
      if (!a) return;
      e.preventDefault();
      this.select(a.dataset.showVehicle);
      root.scrollIntoView({ behavior: this.reduced ? "auto" : "smooth" });
    });
    root.addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea")) return;
      const ids = vehicles.map((v) => v.id);
      const i = ids.indexOf(this.state.vehicle);
      const keys = {
        ArrowRight: () => this.select(ids[(i + 1) % ids.length]),
        ArrowLeft: () => this.select(ids[(i + ids.length - 1) % ids.length]),
        1: () => this.setLOD(0),
        2: () => this.setLOD(1),
        3: () => this.setLOD(2),
        w: () => this.toggle("wire"),
        l: () => this.toggle("head"),
      };
      const fn = keys[e.key];
      if (fn && (e.target === this.canvas || e.key.length === 1)) {
        e.preventDefault();
        fn();
      }
    });
  }

  syncUI() {
    const s = this.state;
    const spec = this.spec;
    for (const b of this.root.querySelectorAll("[data-vehicle]")) b.setAttribute("aria-pressed", String(b.dataset.vehicle === s.vehicle));
    for (const b of this.root.querySelectorAll("[data-paint]")) b.setAttribute("aria-pressed", String(b.dataset.paint === s.paint));
    for (const b of this.root.querySelectorAll("[data-lod]")) {
      b.setAttribute("aria-pressed", String(+b.dataset.lod === s.lod));
      const t = b.querySelector(".tris");
      if (t && spec) t.textContent = fmt(spec.tris[+b.dataset.lod]);
    }
    for (const b of this.root.querySelectorAll("[data-mood]")) b.setAttribute("aria-pressed", String(b.dataset.mood === s.mood));
    for (const b of this.root.querySelectorAll("[data-toggle]")) {
      const k = b.dataset.toggle;
      const on = k === "wire" ? s.wire : k === "trailer" ? s.trailer : k === "hazard" ? s.lamps.left && s.lamps.right : s.lamps[k];
      b.setAttribute("aria-pressed", String(!!on));
      if (k === "trailer") b.hidden = s.vehicle !== "SemiTruck";
    }
    const paintName = this.root.querySelector("[data-paint-name]");
    if (paintName) paintName.textContent = (s.paint ?? "").replace("_", " ");
    if (spec && this.readout) {
      const [q, t] = spec.faces[s.lod];
      this.readout.innerHTML =
        `<strong>${spec.title}</strong> <span>${spec.length.toFixed(2)} × ${spec.width.toFixed(2)} × ${spec.height.toFixed(2)} m</span>` +
        `<span>LOD${s.lod}: ${fmt(spec.tris[s.lod])} triangles</span><span>${fmt(q)} quads, ${fmt(t)} triangle faces</span>`;
    }
  }

  // --- state -------------------------------------------------------------------------------------

  async select(id) {
    const spec = vehicles.find((v) => v.id === id);
    if (!spec) return;
    this.state.vehicle = id;
    this.spec = spec;
    this.state.paint = spec.paint;
    this.syncUI();
    const token = (this.loading = Symbol());
    this.root.classList.add("is-loading");
    let car;
    try {
      car = await Vehicle.load(spec, this.mats, { paint: spec.paint, pools: true });
    } catch (err) {
      console.error(err);
      this.root.classList.remove("is-loading");
      return;
    }
    if (token !== this.loading) return;
    let trailer = null;
    if (id === "SemiTruck") {
      const ts = vehicles.find((v) => v.id === "SemiTrailer");
      trailer = await Vehicle.load(ts, this.mats, { paint: "White" });
      trailer.root.position.z = -spec.hitch + ts.kingpin;
      if (token !== this.loading) return;
    }
    this.root.classList.remove("is-loading");
    if (this.car) this.carHolder.remove(this.car.root);
    this.car = car;
    this.trailer = trailer;
    if (trailer) car.root.add(trailer.root);
    car.root.traverse((o) => o.isMesh && (o.receiveShadow = true));
    this.carHolder.add(car.root);
    this.applyState();
    this.frame();
  }

  applyState() {
    const s = this.state;
    for (const v of [this.car, this.trailer]) {
      if (!v) continue;
      v.setLOD(s.lod);
      v.setWire(s.wire);
      v.setLamps(v === this.trailer ? { tail: s.lamps.head, brake: s.lamps.brake, left: s.lamps.left, right: s.lamps.right } : s.lamps);
    }
    this.car?.setPaint(s.paint);
    if (this.trailer) this.trailer.root.visible = s.trailer;
    this.syncUI();
  }

  setPaint(name) {
    this.state.paint = name;
    this.car?.setPaint(name);
    this.syncUI();
  }

  setLOD(n) {
    this.state.lod = n;
    this.applyState();
  }

  toggle(k) {
    const s = this.state;
    if (k === "wire") s.wire = !s.wire;
    else if (k === "trailer") {
      s.trailer = !s.trailer;
      this.frame();
    } else if (k === "hazard") {
      const on = !(s.lamps.left && s.lamps.right);
      s.lamps.left = s.lamps.right = on;
    } else {
      s.lamps[k] = !s.lamps[k];
      if (k === "left" && s.lamps.left) s.lamps.right = false;
      if (k === "right" && s.lamps.right) s.lamps.left = false;
    }
    this.applyState();
  }

  applyMood(name, instant = false) {
    const target = MOODS[name];
    if (!target) return;
    this.state.mood = name;
    this.moodFrom = { ...this.mood, bg: this.mood.bg.clone(), key: this.mood.key.clone(), dir: [...this.mood.dir] };
    this.moodTo = { ...target, bg: new THREE.Color(target.bg), key: new THREE.Color(target.key) };
    this.moodT = instant || this.reduced ? 1 : 0;
    this.root.dataset.mood = name;
    this.syncUI();
  }

  /** Fit the camera to the vehicle (and trailer) on the turntable. */
  frame() {
    // the semi truck and its trailer together run from z = -3.7 to 14.8; centre that on the turntable
    const rig = this.trailer && this.state.trailer;
    const len = rig ? 18.5 : this.spec.length;
    const radius = Math.max(3.0, len * 0.6);
    this.disc.scale.set(radius, 1, radius);
    this.carHolder.position.z = rig ? -5.5 : 0;
    const h = this.spec.height;
    this.controls.target.set(0, h * 0.42, 0);
    const dist = Math.max(9.6, len * 1.75 + h * 1.4) * (this.portrait ? 1.3 : 1);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (!this.framed) dir.set(0.72, 0.28, -0.64).normalize();
    this.framed = true;
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.update();
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.portrait = w / h < 0.95;
    this.camera.updateProjectionMatrix();
    if (this.spec) this.frame();
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.visible) return;

    if (this.moodT < 1) {
      this.moodT = Math.min(1, this.moodT + dt / 0.7);
      const t = THREE.MathUtils.smoothstep(this.moodT, 0, 1);
      const a = this.moodFrom;
      const b = this.moodTo;
      const m = this.mood;
      m.bg.copy(a.bg).lerp(b.bg, t);
      m.key.copy(a.key).lerp(b.key, t);
      for (const k of ["keyI", "hemi", "env", "lamps"]) m[k] = THREE.MathUtils.lerp(a[k], b[k], t);
      m.dir = a.dir.map((v, i) => THREE.MathUtils.lerp(v, b.dir[i], t));
    }
    const m = this.mood;
    this.renderer.setClearColor(m.bg);
    this.scene.fog.color.copy(m.bg);
    this.floorMat.color.copy(m.bg).multiplyScalar(0.92);
    this.key.color.copy(m.key);
    this.key.intensity = m.keyI;
    this.key.position.set(...m.dir);
    this.hemi.intensity = m.hemi;
    this.scene.environmentIntensity = m.env;

    // turn slowly until someone takes hold of it
    const idle = !this.userTurned || now - this.userTurned > 6000;
    if (idle && !this.reduced) this.turntable.rotation.y += dt * 0.18;
    this.controls.update();
    for (const v of [this.car, this.trailer]) {
      if (!v) continue;
      v.glowGain = m.lamps;
      v.update(dt, this.camera);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
