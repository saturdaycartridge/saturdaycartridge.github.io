import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { fetchBuffer } from "./fetch.js";
import { RotorTrailMaterials, rotorDisc } from "./rotortrail.js";
import { glowTexture } from "./glow.js";

const BASE = "/models/helicopters/";
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const parse = (url) => fetchBuffer(url).then((buf) => loader.parseAsync(buf, "")).then((gltf) => gltf.scene);

function lodOf(o) {
  for (let n = o; n; n = n.parent) {
    const m = /_LOD(\d)$/.exec(n.name);
    if (m) return +m[1];
  }
  return -1;
}

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
// HelicopterRotors.discFade: power where the blur discs start to show, and where they are fully shown
const DISC_FADE = [0.25, 0.8];
const DEG = Math.PI / 180;

/**
 * One aircraft from the pack, mirroring the Unity prefab: an LOD group, the HelicopterRotors component
 * (power 0..1, main and tail RPM, blur discs) and the RotorTrail materials. glTF axes: +Y up, nose +Z,
 * port side +X.
 */
export class Helicopter {
  static async load(spec) {
    const scene = await parse(`${BASE}${spec.id}.lite.glb.gz`);
    return new Helicopter(spec, scene);
  }

  constructor(spec, model) {
    this.spec = spec;
    this.root = new THREE.Group();
    this.root.name = spec.id;
    this.model = model;
    this.root.add(model);
    this.mats = new RotorTrailMaterials();
    this.meshes = [];
    this.lod = -1;
    this.wireOn = false;
    this.wire = [];
    this.power = 0;
    this.adopt(model);

    // HelicopterPackBuilder: tail rotor turns about local X at 1200 RPM, except the tandem HeavyLift whose
    // rear rotor turns about up at the main rotor's 300 RPM, the other way round
    this.mainRotor = model.getObjectByName("MainRotor");
    this.tailRotor = model.getObjectByName("TailRotor");
    this.tandem = spec.id === "HeavyLift";
    model.updateMatrixWorld(true);
    this.mainAxis = this.localAxis(this.mainRotor, UP);
    this.tailAxis = this.tandem ? this.localAxis(this.tailRotor, UP) : X.clone();
    // Unity is left-handed: a rotation of a degrees there is -a degrees here about the same physical axis
    // (the tail axis, Unity's local +X, is -X here, which flips the sign back)
    this.mainRate = 300 * 6 * DEG * (spec.clockwise ? -1 : 1);
    this.tailRate = (this.tandem ? -300 : 1200) * 6 * DEG;
    this.buildDiscs();
    this.glowGain = 0;
    this.buildGlows();
    this.setLOD(1);
  }

  localAxis(node, worldDir) {
    if (!node) return worldDir.clone();
    const q = node.getWorldQuaternion(new THREE.Quaternion()).invert();
    return worldDir.clone().applyQuaternion(q).normalize();
  }

  /** Swap in the RotorTrail materials and index the meshes of a freshly loaded tree. */
  adopt(tree) {
    tree.traverse((o) => {
      if (!o.isMesh) return;
      o.material = this.mats.get(o.material);
      o.userData.lod = lodOf(o);
      o.castShadow = o.material.userData.kind !== "Glass";
      o.receiveShadow = true;
      this.meshes.push(o);
    });
  }

  get hasLOD0() {
    return !!this.lod0Ready;
  }

  /** Fetches LOD0 and hangs each part under the node of the same name in the lite tree. */
  loadLOD0() {
    this.lod0Promise ??= parse(`${BASE}${this.spec.id}.lod0.glb.gz`).then((scene) => {
      const parts = [];
      scene.traverse((o) => {
        if (/_LOD0$/.test(o.name) && o.parent) parts.push(o);
      });
      for (const part of parts) {
        const parent = part.parent === scene ? this.model : this.model.getObjectByName(part.parent.name);
        (parent ?? this.model).add(part);
      }
      this.adopt({ traverse: (fn) => parts.forEach((p) => p.traverse(fn)) });
      this.lod0Ready = true;
      const lod = this.lod;
      this.lod = -1;
      this.setLOD(lod);
    });
    return this.lod0Promise;
  }

  setLOD(n) {
    // LOD0 is shown once loaded (loadLOD0 calls back here)
    if (n === 0 && !this.lod0Ready) {
      this.loadLOD0();
      n = Math.max(this.lod, 1);
    }
    if (n === this.lod) return;
    this.lod = n;
    for (const m of this.meshes) m.visible = m.userData.lod === n;
    this.syncWire();
  }

  /** Hide the pilot's own body while looking out through his eyes. */
  setPilotVisible(on) {
    const pilot = this.model.getObjectByName("Pilot");
    if (pilot) pilot.visible = on;
  }

  // --- rotors --------------------------------------------------------------------------------------

  /** Meshes of one LOD under a rotor; `part` filters by the rotor's child they hang from (Blade1, Hub...). */
  bladesOf(rotor, lod, part = () => true) {
    const out = [];
    rotor?.traverse((o) => {
      if (!o.isMesh || o.userData.lod !== lod) return;
      let top = o;
      while (top.parent && top.parent !== rotor) top = top.parent;
      o.userData.rotorPart = top.name;
      if (part(top.name)) out.push(o);
    });
    return out;
  }

  /** HelicopterPackBuilder.AddDisc: a disc across the swept blades, perpendicular to the rotor axis. */
  addDisc(parent, blades, axisWorld, opts) {
    if (!blades.length) return null;
    const box = new THREE.Box3();
    const centers = [];
    for (const b of blades) {
      const bb = new THREE.Box3().setFromObject(b);
      box.union(bb);
      centers.push(bb.getCenter(new THREE.Vector3()));
    }
    const center = box.getCenter(new THREE.Vector3());
    if (blades.length > 1) center.y = centers.reduce((s, c) => s + c.y, 0) / centers.length;
    let radius = 0;
    const c = new THREE.Vector3();
    for (const b of blades) {
      const bb = new THREE.Box3().setFromObject(b);
      for (let i = 0; i < 8; i++) {
        c.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).sub(center);
        radius = Math.max(radius, c.projectOnPlane(axisWorld).length());
      }
    }
    const disc = rotorDisc(opts);
    const world = new THREE.Matrix4().compose(
      center,
      new THREE.Quaternion().setFromUnitVectors(UP, axisWorld.clone().normalize()),
      new THREE.Vector3(radius * 0.985, radius * 0.985, radius * 0.985),
    );
    parent.updateMatrixWorld(true);
    disc.applyMatrix4(new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(world));
    parent.add(disc);
    return disc;
  }

  buildDiscs() {
    this.root.updateMatrixWorld(true);
    const lod = 1;
    const blade = this.mats.cache.get(`${this.spec.id}_Blade`);
    const color = blade?.color ?? new THREE.Color(0.1, 0.1, 0.1);
    const main = this.bladesOf(this.mainRotor, lod, (name) => /^Blade/.test(name));
    const tail = this.bladesOf(this.tailRotor, lod);
    this.discs = [];
    const toWorld = (node, axis) => axis.clone().transformDirection(node.matrixWorld);
    const count = new Set(main.map((m) => m.userData.rotorPart)).size;
    const d1 = this.addDisc(this.model, main, toWorld(this.mainRotor, this.mainAxis), { color, blades: count, rate: 9 });
    if (d1) this.discs.push(d1);
    if (tail.length && this.tailRotor.parent) {
      const blades = this.tandem ? count : 4;
      const d2 = this.addDisc(this.tailRotor.parent, tail, toWorld(this.tailRotor, this.tailAxis), { color, blades, rate: this.tandem ? 9 : 14 });
      if (d2) this.discs.push(d2);
    }
  }

  /**
   * Soft halos on the navigation lights (emissive parts bright enough to light up), shown by mood. One light
   * mesh can hold several lamps (both wingtips, say), so its vertices are grouped into lamps first.
   */
  buildGlows() {
    this.glows = [];
    const v = new THREE.Vector3();
    const size = new THREE.Vector3();
    for (const mesh of this.meshes) {
      const rt = mesh.material.userData.rt;
      if (mesh.userData.lod !== 1 || rt?.kind !== "Emissive" || (rt.Intensity ?? 0) < 1) continue;
      // hang the halos on the part, not the LOD mesh, so they stay whichever LOD is showing
      let anchor = mesh.parent;
      while (anchor.parent && /_LOD\d$/.test(anchor.name)) anchor = anchor.parent;
      const lamps = [];
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        let lamp = lamps.find((l) => l.seed.distanceTo(v) < 0.35);
        if (!lamp) lamps.push((lamp = { seed: v.clone(), box: new THREE.Box3() }));
        lamp.box.expandByPoint(v);
      }
      const color = new THREE.Color().setRGB(...rt.Color, THREE.LinearSRGBColorSpace);
      for (const lamp of lamps) {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }),
        );
        const r = THREE.MathUtils.clamp(lamp.box.getSize(size).length() * 3, 0.4, 0.9);
        sprite.scale.set(r, r, 1);
        sprite.position.copy(anchor.worldToLocal(lamp.box.getCenter(new THREE.Vector3())));
        sprite.renderOrder = 6;
        sprite.visible = false;
        anchor.add(sprite);
        this.glows.push(sprite);
      }
    }
  }

  update(dt) {
    const step = dt * this.power;
    this.mainRotor?.rotateOnAxis(this.mainAxis, this.mainRate * step);
    this.tailRotor?.rotateOnAxis(this.tailAxis, this.tailRate * step);
    const t = THREE.MathUtils.clamp((this.power - DISC_FADE[0]) / (DISC_FADE[1] - DISC_FADE[0]), 0, 1);
    const spin = t * t * (3 - 2 * t);
    for (const d of this.discs) {
      d.material.uniforms.uSpin.value = spin;
      d.visible = spin > 0.001;
    }
    for (const g of this.glows) {
      g.material.opacity = this.glowGain;
      g.visible = this.glowGain > 0.01;
    }
  }

  // --- wireframe -----------------------------------------------------------------------------------

  /** Loads the quad edges written by tools/export_helicopters.py (WIR2) and hangs them on their nodes. */
  loadWire(part) {
    this.wireParts ??= {};
    this.wireParts[part] ??= (async () => {
      const buf = await fetchBuffer(`${BASE}${this.spec.id}.${part}.wire.bin.gz`);
      const bytes = new Uint8Array(buf);
      const headLen = new DataView(buf).getUint32(4, true);
      const parts = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headLen)));
      const base = 8 + headLen;
      if (!this.wireMat) {
        // dark lines on light paint, light lines on dark paint
        const paint = this.mats.cache.get(`${this.spec.id}_Paint`)?.color ?? new THREE.Color(0.5, 0.5, 0.5);
        const lum = 0.2126 * paint.r + 0.7152 * paint.g + 0.0722 * paint.b;
        this.wireMat = new THREE.LineBasicMaterial({ color: lum < 0.12 ? "#e9edf6" : "#11141b", transparent: true, opacity: 0.55, depthWrite: false });
      }
      for (const p of parts) {
        let at = base + p.positions;
        const next = () => {
          let v = 0;
          let shift = 0;
          let b;
          do {
            b = bytes[at++];
            v += (b & 0x7f) * 2 ** shift;
            shift += 7;
          } while (b & 0x80);
          return v;
        };
        const unzig = (v) => (v % 2 ? -(v + 1) / 2 : v / 2);
        const pos = new Float32Array(p.vertices * 3);
        const q = [0, 0, 0];
        for (let i = 0; i < p.vertices; i++)
          for (let k = 0; k < 3; k++) {
            q[k] += unzig(next());
            pos[i * 3 + k] = p.min[k] + q[k] * p.scale[k];
          }
        at = base + p.indices;
        const idx = new (p.vertices > 65535 ? Uint32Array : Uint16Array)(p.edges * 2);
        let a = 0;
        for (let i = 0; i < p.edges; i++) {
          a += next();
          idx[i * 2] = a;
          idx[i * 2 + 1] = a + unzig(next());
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        const lines = new THREE.LineSegments(geo, this.wireMat);
        lines.userData.lod = p.lod;
        lines.renderOrder = 2;
        const parent = p.node ? this.model.getObjectByName(p.node) : this.model;
        (parent ?? this.model).add(lines);
        this.wire.push(lines);
      }
      this.syncWire();
    })();
    return this.wireParts[part];
  }

  setWire(on) {
    this.wireOn = on;
    if (on) return this.loadWire(this.lod === 0 ? "lod0" : "lite").then(() => this.syncWire());
    this.syncWire();
    return Promise.resolve();
  }

  syncWire() {
    if (this.wireOn) this.loadWire(this.lod === 0 ? "lod0" : "lite");
    for (const w of this.wire) w.visible = this.wireOn && w.userData.lod === this.lod;
  }
}
