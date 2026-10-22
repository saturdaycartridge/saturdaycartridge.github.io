import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Helicopter } from "./helicopter.js";
import { blinkClock } from "./rotortrail.js";
import { webglAvailable } from "./fetch.js";

// The studio of the pack's captures (Assets/_HelicopterTools/Editor/HelicopterPackScenes.cs): a slate
// floor against a backdrop of the same slate, a warm sun with soft shadows, a procedural sky for ambient
// light and softboxes that only show up in reflections. Colours are the captures' own.
const GROUND = "#4d5e80";
const BACKDROP = "#516488";
const DEG = Math.PI / 180;

// Builder.Capture views: azimuth (0 = nose on, 90 = left side) and elevation, with the same 32° lens. The
// captures fill 1.18 of the frame; the page frames a little tighter.
export const VIEWS = {
  front34: { az: 35, el: 11, fill: 1.04 },
  side: { az: 90, el: 3, fill: 1.04 },
  rear34: { az: 148, el: 13, fill: 1.04 },
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

/** Sky gradient plus softboxes, rendered once into a PMREM environment map. */
function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color("#3f6bcc") },
        uHorizon: { value: new THREE.Color("#7393d6") },
        uGround: { value: new THREE.Color("#2c3858") },
      },
      vertexShader: "varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; varying vec3 vDir;
        void main() {
          float y = normalize(vDir).y;
          vec3 c = y > 0.0 ? mix(uHorizon, uTop, pow(y, 0.45)) : mix(uHorizon, uGround, pow(-y, 0.25));
          gl_FragColor = vec4(c * 1.3, 1.0);
        }`,
    }),
  );
  env.add(sky);
  // Stage(): softboxes for a single aircraft, s = 2.5, around a probe 3 m up (the cube camera sits at 0)
  const s = 2.5;
  const box = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.5, 5.5, 5.5), side: THREE.DoubleSide });
  const boxes = [
    [[0, 9, 0], [90, 0], [34, 2.6]],
    [[0, 8.5, 7], [60, 0], [34, 2]],
    [[0, 8.5, -7], [120, 0], [34, 2]],
    [[-17, 4.5, 0], [0, -90], [18, 3]],
    [[17, 4.5, 0], [0, 90], [18, 3]],
  ];
  for (const [p, r, size] of boxes) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(size[0] * s, size[1] * s), box);
    q.position.set(p[0] * s, p[1] * s - 3, p[2] * s);
    q.rotation.set(r[0] * DEG, r[1] * DEG, 0, "YXZ");
    env.add(q);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02, 0.1, 200).texture;
  pmrem.dispose();
  return tex;
}

class Hangar3D {
  constructor(root, fleet, hooks) {
    this.root = root;
    this.fleet = fleet;
    this.hooks = hooks;
    this.stage = root.querySelector("[data-stage]");
    this.canvas = root.querySelector(".stage-canvas");
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.15; // the captures' post exposure (+0.2 EV)
    r.setClearColor(BACKDROP);
    this.renderer = r;

    const scene = new THREE.Scene();
    scene.environment = studioEnvironment(r);
    scene.environmentIntensity = 0.34;
    this.scene = scene;

    // Unity's sun: Euler(46, -38, 0), colour (1, .97, .92), intensity 2.1 (x pi: three.js lights are physical)
    const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1, 0.94, 0.86, THREE.SRGBColorSpace), 2.1 * Math.PI);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.intensity = 0.75;
    sun.shadow.radius = 3;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.02;
    this.sunDir = new THREE.Vector3(-0.427, 0.719, -0.547).normalize();
    scene.add(sun, sun.target);
    this.sun = sun;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1, metalness: 0, envMapIntensity: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.2, 2000);
    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      enablePan: false,
      enableZoom: false,
      rotateSpeed: 0.7,
      autoRotateSpeed: -0.8,
    });
    this.orbitLimits();
    // vertical swipes keep scrolling the page on touch screens
    this.canvas.style.touchAction = "pan-y";
    this.controls.addEventListener("start", () => {
      this.userTurned = performance.now();
      this.tween = null;
      this.hooks.onUserTurn?.();
    });

    this.cache = new Map();
    this.state = { id: null, view: "front34", lod: 1, wire: false, power: 0 };
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
    if (this.heli) this.scene.remove(this.heli.root);
    this.heli = heli;
    heli.power = this.power ?? 0;
    this.scene.add(heli.root);
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

  /** Bounds of the aircraft (rotors included), for framing and the shadow camera. */
  measure() {
    const box = new THREE.Box3();
    this.heli.root.updateMatrixWorld(true);
    this.heli.root.traverse((o) => {
      if (o.isMesh && o.visible && o.userData.lod >= 0) box.expandByObject(o);
    });
    this.bounds = box;
    const size = box.getSize(new THREE.Vector3());
    const reach = Math.max(size.x, size.z) * 0.6 + 2;
    const cam = this.sun.shadow.camera;
    Object.assign(cam, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 80 });
    cam.updateProjectionMatrix();
    const center = box.getCenter(new THREE.Vector3());
    this.sun.target.position.set(center.x, 0, center.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 40);
  }

  // --- camera ----------------------------------------------------------------------------------------

  /** Builder.Orbit: look at the bounds from az/el and back off until every corner fits within `fill`. */
  orbitPose(view) {
    const b = this.bounds;
    const a = view.az * DEG;
    const e = view.el * DEG;
    // Unity's x runs the other way (left-handed): its -sin(az) is +sin(az) here
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
    const target = b.getCenter(new THREE.Vector3());
    const cam = new THREE.PerspectiveCamera(32, this.camera.aspect);
    cam.position.copy(target);
    cam.lookAt(target.clone().sub(dir));
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    const tv = Math.tan(16 * DEG) * view.fill;
    const th = tv * this.camera.aspect;
    let d = 0;
    const c = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(inv);
      const z = -c.z;
      d = Math.max(d, z + Math.abs(c.x) / th, z + Math.abs(c.y) / tv);
    }
    return { target, position: target.clone().addScaledVector(dir, d), fov: 32, near: 0.2 };
  }

  cockpitPose() {
    const eye = new THREE.Vector3(...(this.heli.spec.eye ?? [0, 2, 2]));
    // a hair in front of the eye: orbiting that point turns the head
    return { target: eye.clone().add(new THREE.Vector3(0, -0.012, 0.05)), position: eye, fov: 68, near: 0.02 };
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
    this.controls.autoRotate = false;
    this.userTurned = performance.now();
    if (cockpit) {
      // stay in the seat: a limited head turn around the view straight ahead (camera offset is -Z, azimuth pi)
      Object.assign(this.controls, {
        minPolarAngle: 0.95,
        maxPolarAngle: 2.1,
        minAzimuthAngle: Math.PI - 1.9,
        maxAzimuthAngle: -Math.PI + 1.9,
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

  /** Turn the camera round the aircraft from the keyboard. */
  nudge(deg) {
    if (!this.heli) return;
    const off = this.camera.position.clone().sub(this.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), deg * DEG);
    this.tween = null;
    this.camera.position.copy(this.controls.target).add(off);
    this.userTurned = performance.now();
    this.controls.update();
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.heli && this.state.view !== "cockpit" && !this.userTurned) this.setView(this.state.view, true);
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.visible) return;
    blinkClock.value = now / 1000;

    // spool the rotors toward the requested power
    const target = this.state.power;
    this.power ??= 0;
    const rate = 0.5 * dt;
    this.power += THREE.MathUtils.clamp(target - this.power, -rate, rate);

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 0.9);
      const k = THREE.MathUtils.smootherstep(tw.t, 0, 1);
      // swing round the target rather than cutting across it
      const from = tw.from.position.clone().sub(tw.from.target);
      const to = tw.to.position.clone().sub(tw.to.target);
      const a = new THREE.Spherical().setFromVector3(from);
      const b = new THREE.Spherical().setFromVector3(to);
      let dTheta = b.theta - a.theta;
      dTheta -= Math.round(dTheta / (2 * Math.PI)) * 2 * Math.PI;
      const s = new THREE.Spherical(
        THREE.MathUtils.lerp(a.radius, b.radius, k),
        THREE.MathUtils.lerp(a.phi, b.phi, k),
        a.theta + dTheta * k,
      );
      this.controls.target.lerpVectors(tw.from.target, tw.to.target, k);
      this.camera.position.setFromSpherical(s).add(this.controls.target);
      this.camera.fov = THREE.MathUtils.lerp(tw.from.fov, tw.to.fov, k);
      this.camera.updateProjectionMatrix();
      if (tw.t >= 1) this.tween = null;
    }

    // drift slowly round the aircraft until someone takes hold of it
    const idle = !this.userTurned || now - this.userTurned > 8000;
    this.controls.autoRotate = idle && !this.reduced && !this.tween && this.state.view !== "cockpit";
    this.controls.update(dt);
    if (this.heli) {
      this.heli.power = this.power;
      this.heli.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
