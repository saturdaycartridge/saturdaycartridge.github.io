import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Helicopter } from "./helicopter.js";
import { blinkClock } from "./rotortrail.js";
import { webglAvailable } from "./fetch.js";

// The helicopter showroom, built like the Everyday Cars one (showroom.js) and lit the same way: the aircraft
// on a slowly turning pale disc in a plain studio whose backdrop doubles as fog, time-of-day moods, LOD and
// wireframe. The paint comes from the pack's own shaders (rotortrail.js).
const DEG = Math.PI / 180;

// showroom.js MOODS. bg doubles as fog so the floor fades into the backdrop; lamps sets the light halos.
const MOODS = {
  morning: { bg: "#dcdfe5", key: "#ffe0c0", keyI: 2.4, hemi: 1.15, env: 0.75, lamps: 0.3, dir: [-5, 3.2, 5] },
  noon: { bg: "#e4e3dd", key: "#ffffff", keyI: 2.9, hemi: 1.35, env: 1, lamps: 0.25, dir: [-2.5, 9, 3] },
  dusk: { bg: "#a98593", key: "#ff9258", keyI: 2.1, hemi: 0.75, env: 0.55, lamps: 0.75, dir: [6, 2.2, -4] },
  night: { bg: "#1b2233", key: "#9cadff", keyI: 0.45, hemi: 0.3, env: 0.14, lamps: 1, dir: [3, 7, 2] },
};

// Builder.Capture views: azimuth (0 = nose on, 90 = left side) and elevation, with the same 32° lens,
// measured from the aircraft wherever the turntable has got to.
export const VIEWS = {
  front34: { az: 35, el: 11 },
  side: { az: 90, el: 3 },
  rear34: { az: 148, el: 13 },
};

export function startHangar3D(root, fleet, hooks = {}) {
  if (!webglAvailable()) return null;
  try {
    return new Hangar3D(root, fleet, hooks);
  } catch (err) {
    console.error(err);
    return null;
  }
}

const moodValues = (m) => ({
  ...m,
  bg: new THREE.Color(m.bg),
  key: new THREE.Color(m.key),
  dir: new THREE.Vector3(...m.dir).normalize(),
});

class Hangar3D {
  constructor(root, fleet, hooks) {
    this.root = root;
    this.fleet = fleet;
    this.hooks = hooks;
    this.canvas = root.querySelector(".showroom-canvas");
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    this.renderer = r;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.fog = new THREE.Fog("#e4e3dd", 40, 120);
    this.scene = scene;

    this.hemi = new THREE.HemisphereLight("#ffffff", "#5c6380", 1.2);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight("#ffffff", 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 5;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    this.sun = sun;

    this.floorMat = new THREE.MeshStandardMaterial({ roughness: 1 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(300, 64), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // the turntable: the car showroom's disc, sized to each aircraft
    this.turntable = new THREE.Group();
    scene.add(this.turntable);
    this.disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 0.08, 96),
      new THREE.MeshStandardMaterial({ color: "#edf0f6", roughness: 0.55 }),
    );
    this.disc.position.y = 0.04;
    this.disc.receiveShadow = true;
    this.turntable.add(this.disc);
    this.holder = new THREE.Group();
    this.holder.position.y = 0.08;
    this.turntable.add(this.holder);

    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.2, 2000);
    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, enableZoom: false });
    this.orbitLimits();
    // vertical swipes keep scrolling the page on touch screens
    this.canvas.style.touchAction = "pan-y";
    this.controls.addEventListener("start", () => {
      this.userTurned = performance.now();
      this.tween = null;
      this.hooks.onUserTurn?.();
    });

    this.cache = new Map();
    this.state = { id: null, view: "front34", lod: 1, wire: false, power: 0, mood: "noon" };
    this.mood = moodValues(MOODS.noon);
    this.applyMood("noon", true);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(this.canvas);
    this.visible = true;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  orbitLimits() {
    Object.assign(this.controls, {
      minPolarAngle: 0.2,
      maxPolarAngle: 1.53,
      minAzimuthAngle: -Infinity,
      maxAzimuthAngle: Infinity,
      rotateSpeed: 0.7,
    });
  }

  status(s) {
    this.hooks.onStatus?.(s);
  }

  // --- aircraft --------------------------------------------------------------------------------------

  /** Shows an aircraft, loading it the first time. Resolves to false if it could not be loaded. */
  select(id) {
    if (id === this.state.id && this.selecting) return this.selecting;
    const spec = this.fleet.find((h) => h.id === id);
    if (!spec) return Promise.resolve(false);
    this.state.id = id;
    const job = (this.selecting = this.show(spec).finally(() => {
      if (this.selecting === job) this.selecting = null;
    }));
    return job;
  }

  async show(spec) {
    const token = (this.loading = Symbol());
    let heli = this.cache.get(spec.id);
    if (!heli) {
      this.status({ loading: true, what: spec.title });
      try {
        heli = await Helicopter.load(spec);
      } catch (err) {
        console.error(err);
        if (token === this.loading) this.status({ loading: false, error: true });
        return false;
      }
      this.cache.set(spec.id, heli);
    }
    if (token !== this.loading) return false;
    this.status({ loading: false });
    if (this.heli) this.holder.remove(this.heli.root);
    this.heli = heli;
    heli.power = this.power ?? 0;
    this.holder.add(heli.root);
    // the lite file has LOD1 and LOD2; LOD0 comes on request
    this.applyLOD();
    heli.setWire(this.state.wire);
    heli.setPilotVisible(this.state.view !== "cockpit");
    this.measure();
    this.setView(this.state.view, !this.framed);
    this.framed = true;
    return true;
  }

  async applyLOD() {
    const h = this.heli;
    if (!h) return;
    const want = this.state.lod;
    if (want === 0 && !h.hasLOD0) {
      this.status({ loading: true, what: "LOD0" });
      h.setLOD(Math.max(h.lod, 1));
      try {
        await h.loadLOD0();
      } catch (err) {
        console.error(err);
        this.status({ loading: false, error: true });
        return;
      }
      this.status({ loading: false });
      if (this.heli !== h || this.state.lod !== 0) return;
    }
    h.setLOD(want);
    this.hooks.onLOD?.(h.lod);
  }

  setLOD(n) {
    this.state.lod = n;
    return this.applyLOD();
  }

  setWire(on) {
    this.state.wire = on;
    this.heli?.setWire(on);
  }

  setPower(p) {
    this.state.power = THREE.MathUtils.clamp(p, 0, 1);
    if (this.reduced) this.power = this.state.power;
  }

  applyMood(name, instant = false) {
    const target = MOODS[name];
    if (!target) return;
    this.state.mood = name;
    const m = this.mood;
    this.moodFrom = { ...m, bg: m.bg.clone(), key: m.key.clone(), dir: m.dir.clone() };
    this.moodTo = moodValues(target);
    this.moodT = instant || this.reduced ? 1 : 0;
    if (this.moodT === 1) Object.assign(this.mood, this.moodTo);
    this.root.dataset.mood = name;
  }

  /** Aircraft bounds in turntable space (rotors included, blur discs not) for framing; the disc; the shadow camera. */
  measure() {
    const box = new THREE.Box3();
    const saved = this.turntable.rotation.y;
    this.turntable.rotation.y = 0;
    this.turntable.updateMatrixWorld(true);
    this.heli.root.traverse((o) => {
      if (o.isMesh && o.visible && o.userData.lod >= 0) box.expandByObject(o);
    });
    this.turntable.rotation.y = saved;
    this.turntable.updateMatrixWorld(true);
    const radius = Math.max(4, this.heli.spec.length * 0.6);
    this.disc.scale.set(radius, 1, radius);
    this.bounds = box;
    const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(radius * 2, 0, radius * 2));
    const reach = Math.max(size.x, size.z) * 0.6 + 2;
    Object.assign(this.sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 90 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  // --- camera ----------------------------------------------------------------------------------------

  /** Builder.Orbit: look at the bounds from az/el and back off until every corner fits the frame. */
  orbitPose(view) {
    const b = this.bounds;
    const turn = this.turntable.rotation.y;
    const a = view.az * DEG + turn;
    const e = view.el * DEG;
    // Unity's x runs the other way (left-handed): its -sin(az) is +sin(az) here
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
    const center = b.getCenter(new THREE.Vector3());
    // aim a little low: the overlaid controls take the top and bottom of the screen
    const target = new THREE.Vector3(0, center.y * 0.75, 0);
    const cam = new THREE.PerspectiveCamera(32, this.camera.aspect);
    cam.position.copy(target);
    cam.lookAt(target.clone().sub(dir));
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    const fill = this.portrait ? 1.3 : 1.12;
    const tv = Math.tan(16 * DEG) * fill;
    const th = tv * this.camera.aspect;
    let d = 0;
    const c = new THREE.Vector3();
    const rot = new THREE.Matrix4().makeRotationY(turn);
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(rot).applyMatrix4(inv);
      d = Math.max(d, -c.z + Math.abs(c.x) / th, -c.z + Math.abs(c.y) / tv);
    }
    // the car showroom fogs from about 1.4x to 4x its camera distance; keep the same proportions
    this.scene.fog.near = d * 1.4;
    this.scene.fog.far = d * 4;
    return { target, position: target.clone().addScaledVector(dir, d), fov: 32, near: 0.2 };
  }

  cockpitPose() {
    this.holder.updateMatrixWorld(true);
    const eye = new THREE.Vector3(...(this.heli.spec.eye ?? [0, 2, 2]));
    const ahead = eye.clone().add(new THREE.Vector3(0, -0.012, 0.05));
    return { target: this.holder.localToWorld(ahead), position: this.holder.localToWorld(eye.clone()), fov: 68, near: 0.02 };
  }

  setView(name, instant = false) {
    if (!this.heli) {
      this.state.view = name;
      return;
    }
    const was = this.state.view;
    this.state.view = name;
    const cockpit = name === "cockpit";
    const pose = cockpit ? this.cockpitPose() : this.orbitPose(VIEWS[name] ?? VIEWS.front34);
    this.heli.setPilotVisible(!cockpit);
    this.userTurned = performance.now();
    if (cockpit) {
      // stay in the seat: a limited head turn around the view straight ahead
      const ahead = pose.target.clone().sub(pose.position);
      const az = Math.atan2(-ahead.x, -ahead.z);
      Object.assign(this.controls, {
        minPolarAngle: 0.95,
        maxPolarAngle: 2.1,
        minAzimuthAngle: az - 1.9,
        maxAzimuthAngle: az + 1.9,
        rotateSpeed: 0.35,
      });
    } else this.orbitLimits();
    if (instant || this.reduced || cockpit !== (was === "cockpit")) {
      // switching between cockpit and orbit cuts rather than flying through the canopy
      this.tween = null;
      this.applyPose(pose);
      return;
    }
    this.tween = {
      t: 0,
      from: { target: this.controls.target.clone(), position: this.camera.position.clone(), fov: this.camera.fov },
      to: pose,
    };
    this.camera.near = pose.near;
    this.camera.updateProjectionMatrix();
  }

  applyPose(p) {
    this.controls.target.copy(p.target);
    this.camera.position.copy(p.position);
    this.camera.fov = p.fov;
    this.camera.near = p.near;
    this.camera.updateProjectionMatrix();
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
    if (this.heli && this.state.view !== "cockpit") this.setView(this.state.view, true);
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.visible) return;
    blinkClock.value = now / 1000;

    if (this.moodT < 1) {
      this.moodT = Math.min(1, this.moodT + dt / 0.7);
      const t = THREE.MathUtils.smoothstep(this.moodT, 0, 1);
      const a = this.moodFrom;
      const b = this.moodTo;
      const m = this.mood;
      m.bg.copy(a.bg).lerp(b.bg, t);
      m.key.copy(a.key).lerp(b.key, t);
      m.dir.copy(a.dir).lerp(b.dir, t).normalize();
      for (const k of ["keyI", "hemi", "env", "lamps"]) m[k] = THREE.MathUtils.lerp(a[k], b[k], t);
    }
    const m = this.mood;
    this.renderer.setClearColor(m.bg);
    this.scene.fog.color.copy(m.bg);
    this.floorMat.color.copy(m.bg).multiplyScalar(0.92);
    this.sun.color.copy(m.key);
    this.sun.intensity = m.keyI;
    this.sun.position.copy(m.dir).multiplyScalar(40);
    this.hemi.intensity = m.hemi;
    this.scene.environmentIntensity = m.env;

    // spool the rotors toward the requested power
    this.power ??= 0;
    const rate = 0.5 * dt;
    this.power += THREE.MathUtils.clamp(this.state.power - this.power, -rate, rate);

    // turn slowly until someone takes hold of it (not while sitting in the cockpit)
    const cockpit = this.state.view === "cockpit";
    const idle = !this.userTurned || now - this.userTurned > 6000;
    if (idle && !this.reduced && !cockpit && !this.tween) this.turntable.rotation.y += dt * 0.12;

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 0.9);
      const k = THREE.MathUtils.smootherstep(tw.t, 0, 1);
      // swing round the target rather than cutting across it
      const a = new THREE.Spherical().setFromVector3(tw.from.position.clone().sub(tw.from.target));
      const b = new THREE.Spherical().setFromVector3(tw.to.position.clone().sub(tw.to.target));
      let dTheta = b.theta - a.theta;
      dTheta -= Math.round(dTheta / (2 * Math.PI)) * 2 * Math.PI;
      const s = new THREE.Spherical(THREE.MathUtils.lerp(a.radius, b.radius, k), THREE.MathUtils.lerp(a.phi, b.phi, k), a.theta + dTheta * k);
      this.controls.target.lerpVectors(tw.from.target, tw.to.target, k);
      this.camera.position.setFromSpherical(s).add(this.controls.target);
      this.camera.fov = THREE.MathUtils.lerp(tw.from.fov, tw.to.fov, k);
      this.camera.updateProjectionMatrix();
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update(dt);
    if (this.heli) {
      this.heli.power = this.power;
      this.heli.glowGain = m.lamps;
      this.heli.update(dt, this.camera);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
