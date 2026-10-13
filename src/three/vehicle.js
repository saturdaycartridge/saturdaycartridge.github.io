import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { fetchBuffer } from "./fetch.js";
import { SLOTS } from "./materials.js";
import { glowTexture, poolTexture, blobTexture } from "./glow.js";

const BASE = "/models/everyday-cars/";
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const sources = new Map();

function source(url) {
  if (!sources.has(url)) {
    sources.set(
      url,
      fetchBuffer(url)
        .then((buf) => loader.parseAsync(buf, ""))
        .then((gltf) => gltf.scene),
    );
  }
  return sources.get(url);
}

// lamp slot -> lamp kind, and what each kind looks like when it glows
const LAMP_SLOTS = {
  Light_Head: "head",
  Light_Tail: "tail",
  Light_Indicator_L: "left",
  Light_Indicator_R: "right",
  Light_Reverse: "reverse",
};
const LAMP_ON = {
  head: "Light_Head_On",
  tail: "Light_Tail_On",
  left: "Light_Indicator_On",
  right: "Light_Indicator_On",
  reverse: "Light_Reverse_On",
};
const GLOW_COLOR = {
  head: "#fff1d0",
  tail: "#ff2410",
  left: "#ff9418",
  right: "#ff9418",
  reverse: "#f4f6ff",
};

function lodOf(o) {
  for (let n = o; n; n = n.parent) {
    if (n.name === "SteeringWheel") return 0;
    const m = /_LOD(\d)/.exec(n.name);
    if (m) return +m[1];
  }
  return 0;
}

const _cam = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * One vehicle from the pack: its LODs, wheel pivots, paint and lamp states, mirroring what the Unity
 * prefabs expose (VehicleLights, VehicleWheels). Forward is -Z, as in the exported glTF.
 */
export class Vehicle {
  static async load(spec, mats, opts = {}) {
    const scene = await source(BASE + spec.id + (opts.lite ? ".lite" : "") + ".glb.gz");
    return new Vehicle(spec, scene.clone(true), mats, opts);
  }

  constructor(spec, model, mats, opts = {}) {
    const { lite = false, paint = spec.paint, shadows = true, glows = true, blob = false, pools = false } = opts;
    this.spec = spec;
    this.mats = mats;
    this.lite = lite;
    this.paint = paint;
    this.root = new THREE.Group();
    this.root.name = spec.id;
    this.model = model;
    this.root.add(model);

    this.meshes = [];
    this.wheels = [];
    this.frontWheels = [];
    model.traverse((o) => {
      if (o.isMesh) {
        o.userData.slot = o.material.name;
        o.userData.lod = lodOf(o);
        o.castShadow = shadows;
        this.meshes.push(o);
      } else if (/^Wheel_[FR][LR]$/.test(o.name)) {
        o.rotation.order = "YXZ";
        this.wheels.push(o);
        if (o.name[6] === "F") this.frontWheels.push(o);
      }
    });

    this.lamp = { head: false, tail: false, brake: false, reverse: false, left: false, right: false };
    this.blink = true;
    this.blinkClock = 0;
    this.glowGain = 1;
    this.spin = 0;
    this.lod = -1;
    this.wireOn = false;
    this.applyMaterials();
    this.setLOD(lite ? 1 : 0);
    if (glows) this.buildGlows();
    if (pools) this.buildPools();
    if (blob) this.buildBlob();
  }

  get bestLOD() {
    return this.lite ? 1 : 0;
  }

  lampOn(kind) {
    const l = this.lamp;
    switch (kind) {
      case "head":
        return l.head;
      case "tail":
        return l.tail || l.brake || l.head;
      case "left":
        return l.left && this.blink;
      case "right":
        return l.right && this.blink;
      case "reverse":
        return l.reverse;
    }
    return false;
  }

  materialFor(slot) {
    if (slot === "Paint") return this.mats.paint(this.paint);
    const kind = LAMP_SLOTS[slot];
    if (kind) return this.mats.get(this.lampOn(kind) ? LAMP_ON[kind] : slot);
    return this.mats.get(SLOTS[slot] ?? slot);
  }

  applyMaterials() {
    for (const m of this.meshes) m.material = this.materialFor(m.userData.slot);
  }

  setPaint(name) {
    if (name === this.paint) return;
    this.paint = name;
    const mat = this.mats.paint(name);
    for (const m of this.meshes) if (m.userData.slot === "Paint") m.material = mat;
    if (this.wireMat) this.tintWire();
  }

  setLamps(state) {
    let changed = false;
    for (const k in state) {
      if (this.lamp[k] !== state[k]) {
        this.lamp[k] = state[k];
        changed = true;
        if (k === "left" || k === "right") {
          this.blink = true;
          this.blinkClock = 0;
        }
      }
    }
    if (changed) this.applyLamps();
  }

  applyLamps() {
    for (const m of this.meshes) if (LAMP_SLOTS[m.userData.slot]) m.material = this.materialFor(m.userData.slot);
  }

  setLOD(n) {
    n = Math.max(n, this.bestLOD);
    if (n === this.lod) return;
    this.lod = n;
    for (const m of this.meshes) m.visible = m.userData.lod === n;
    this.syncWire();
  }

  /** Distance the vehicle rolled since last frame, in metres. */
  roll(distance) {
    this.spin -= distance / this.spec.wheelRadius;
    for (const w of this.wheels) w.rotation.x = this.spin;
  }

  steer(angle) {
    for (const w of this.frontWheels) w.rotation.y = angle;
  }

  update(dt, camera) {
    if (this.lamp.left || this.lamp.right) {
      this.blinkClock += dt;
      const phase = (this.blinkClock * 1.5) % 1 < 0.5;
      if (phase !== this.blink) {
        this.blink = phase;
        this.applyLamps();
      }
    }
    if (this.glows && camera) this.updateGlows(camera);
    if (this.pools) {
      const o = this.lamp.head ? this.glowGain : 0;
      this.pools.visible = o > 0.02;
      this.pools.material.opacity = 0.55 * o;
    }
  }

  // --- lamp glows -------------------------------------------------------------------------------

  /** Finds each lamp cluster (by side and end of the car) and puts a soft billboard on it. */
  buildGlows() {
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const clusters = new Map();
    const v = new THREE.Vector3();
    for (const mesh of this.meshes) {
      const kind = LAMP_SLOTS[mesh.userData.slot];
      if (!kind || mesh.userData.lod !== this.bestLOD) continue;
      const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        const key = `${kind}${v.x < 0 ? "L" : "R"}${v.z < 0 ? "F" : "B"}`;
        let c = clusters.get(key);
        if (!c) clusters.set(key, (c = { kind, box: new THREE.Box3(), front: v.z < 0 }));
        c.box.expandByPoint(v);
      }
    }
    this.glows = [];
    const group = new THREE.Group();
    for (const c of clusters.values()) {
      const size = c.box.getSize(new THREE.Vector3());
      const center = c.box.getCenter(new THREE.Vector3());
      const dir = new THREE.Vector3(0, 0, c.front ? -1 : 1);
      center.addScaledVector(dir, 0.12);
      const mat = this.mats.configure(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color: GLOW_COLOR[c.kind],
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0,
        }),
      );
      const s = new THREE.Sprite(mat);
      const r = Math.max(0.32, Math.max(size.x, size.y) * (c.kind === "head" ? 2.6 : 2.1));
      s.scale.set(r, r, 1);
      s.position.copy(center);
      s.visible = false;
      s.renderOrder = 5;
      group.add(s);
      this.glows.push({ kind: c.kind, sprite: s, dir });
    }
    this.root.add(group);
  }

  updateGlows(camera) {
    camera.getWorldPosition(_cam);
    for (const g of this.glows) {
      let level = this.lampOn(g.kind) ? 1 : 0;
      if (g.kind === "tail" && level) level = this.lamp.brake ? 1 : 0.5;
      level *= this.glowGain;
      if (level > 0.01) {
        g.sprite.getWorldPosition(_p);
        _d.copy(g.dir).transformDirection(this.root.matrixWorld);
        const facing = THREE.MathUtils.smoothstep(_d.dot(_cam.sub(_p).normalize()), -0.15, 0.55);
        level *= facing;
      }
      g.sprite.material.opacity = level;
      g.sprite.visible = level > 0.01;
    }
  }

  /** Headlight light pool on the ground ahead. */
  buildPools() {
    const len = this.spec.length;
    const mat = this.mats.configure(
      new THREE.MeshBasicMaterial({
        map: poolTexture(),
        color: "#ffe9bf",
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    );
    const w = this.spec.width * 2.4;
    const l = 16;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, 0.03, -len / 2 - l / 2 + 0.6);
    plane.visible = false;
    plane.renderOrder = 3;
    this.pools = plane;
    this.root.add(plane);
  }

  buildBlob() {
    const mat = this.mats.configure(
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.6 }),
    );
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(this.spec.width * 1.5, this.spec.length * 1.12), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.02;
    plane.renderOrder = 1;
    this.blob = plane;
    this.root.add(plane);
  }

  // --- wireframe ---------------------------------------------------------------------------------

  /** Loads the quad edges written by tools/export_vehicles.py and hangs them on the matching nodes. */
  loadWire() {
    this.wirePromise ??= (async () => {
      const buf = await fetchBuffer(BASE + this.spec.id + ".wire.bin.gz");
      const dv = new DataView(buf);
      const headLen = dv.getUint32(4, true);
      const parts = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headLen)));
      const base = 8 + headLen;
      this.wireMat = this.mats.configure(
        new THREE.LineBasicMaterial({ color: "#1b2233", transparent: true, opacity: 0.6, depthWrite: false }),
      );
      this.tintWire();
      const nodes = { root: this.model };
      for (const w of this.wheels) nodes[w.name] = w;
      this.wire = [];
      for (const p of parts) {
        if (p.lod < this.bestLOD) continue;
        const q = new Uint16Array(buf, base + p.positions, p.vertices * 3);
        const pos = new Float32Array(q.length);
        for (let i = 0; i < q.length; i++) pos[i] = p.min[i % 3] + q[i] * p.scale[i % 3];
        const Index = p.wide ? Uint32Array : Uint16Array;
        const idx = new Index(buf, base + p.indices, p.edges * 2).slice();
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        const lines = new THREE.LineSegments(geo, this.wireMat);
        lines.userData.lod = p.lod;
        lines.renderOrder = 2;
        lines.frustumCulled = false;
        (nodes[p.node] ?? this.model).add(lines);
        this.wire.push(lines);
      }
      this.syncWire();
    })();
    return this.wirePromise;
  }

  setWire(on) {
    this.wireOn = on;
    if (on) this.loadWire();
    this.syncWire();
  }

  syncWire() {
    if (!this.wire) return;
    for (const w of this.wire) w.visible = this.wireOn && w.userData.lod === this.lod;
  }

  /** Dark lines on light paint, light lines on dark paint. */
  tintWire() {
    const c = new THREE.Color(this.mats.paint(this.paint).color);
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    this.wireMat.color.set(lum < 0.08 ? "#e9edf6" : "#1b2233");
  }
}
