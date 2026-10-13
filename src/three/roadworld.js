import * as THREE from "three";
import { MaterialSet } from "./materials.js";
import { Vehicle } from "./vehicle.js";
import { DayState, createSky } from "./sky.js";
import { glowTexture, poolTexture } from "./glow.js";

// The world inside the Everyday Cars cartridge: a country road on a Saturday. It runs on a treadmill:
// the hero car stays at the local origin facing -Z and the ground, props and traffic slide past it.
// Units are metres.

const SPEED = 22; // hero car, m/s
const ROAD_X = -5.25; // road centreline, relative to the hero car (which drives in the right-hand lane)
const Z_MIN = -460;
const Z_MAX = 140;
const SPAN = Z_MAX - Z_MIN;

const wrapZ = (z) => ((((z - Z_MIN) % SPAN) + SPAN) % SPAN) + Z_MIN;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// lanes relative to the hero; dir -1 drives toward -Z with us, +1 is oncoming
const LANES = [
  { x: ROAD_X + 1.75, dir: -1, speed: 27 },
  { x: ROAD_X + 5.25, dir: -1, speed: SPEED },
  { x: ROAD_X - 1.75, dir: 1, speed: 25 },
  { x: ROAD_X - 5.25, dir: 1, speed: 19 },
];

// [vehicle id, paint, lane, z]
const TRAFFIC = [
  ["Coupe", "Red", 0, -38],
  ["Minivan", "Sand", 0, -190],
  ["Wagon", "Green", 0, 95],
  ["SUV", "Graphite", 1, -62],
  ["Van", "White", 1, -260],
  ["Supercar", "Lime", 2, -120],
  ["Crossover", "Orange", 2, -330],
  ["Sedan", "Navy", 2, 40],
  ["SemiTruck", "Red", 3, -60],
  ["Pickup", "Silver", 3, -240],
  ["SportsGT", "Blue", 3, 70],
  ["Truck", "Black", 3, -400],
];

export class RoadWorld {
  constructor({ specs, stencilRef = 1, portal, quality = "high" }) {
    this.specs = specs;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.portal = portal;
    this.mats = new MaterialSet({ stencilRef, planes: [portal] });
    this.sweep = { uSweep: { value: -1e5 }, uClay: { value: 0 } };
    this.wirePlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e5);
    this.heroMats = new MaterialSet({ stencilRef, planes: [portal], sweep: this.sweep, offset: true });
    this.day = new DayState();
    this.distance = 0;
    this.traffic = [];
    this.night = 0;

    this.buildLights();
    this.buildSky();
    this.buildGround();
    this.buildHills();
    this.buildTrees();
    this.buildStreetlights();
  }

  /** Loads the hero car first (it is what the camera looks at), then the traffic. */
  async load(onHero) {
    const heroSpec = this.specs.find((s) => s.id === "Hatchback");
    this.hero = await Vehicle.load(heroSpec, this.heroMats, { paint: "Yellow", pools: true });
    this.hero.root.traverse((o) => o.isMesh && (o.receiveShadow = true));
    this.root.add(this.hero.root);
    this.sun.target = this.hero.root;
    onHero?.();
    this.hero.loadWire().then(() => {
      this.hero.wireMat.clippingPlanes = [this.portal, this.wirePlane];
    });

    const byId = Object.fromEntries(this.specs.map((s) => [s.id, s]));
    await Promise.all(
      TRAFFIC.map(async ([id, paint, lane, z]) => {
        const v = await Vehicle.load(byId[id], this.mats, { lite: true, paint, shadows: false, blob: true, pools: true });
        const L = LANES[lane];
        v.root.rotation.y = L.dir > 0 ? Math.PI : 0;
        const car = { v, lane: L, z, rel: L.dir < 0 ? SPEED - L.speed : SPEED + L.speed };
        if (id === "SemiTruck") {
          const t = await Vehicle.load(byId.SemiTrailer, this.mats, { lite: true, paint: "White", shadows: false, blob: true });
          t.root.position.z = byId.SemiTruck.hitch * -1 - byId.SemiTrailer.kingpin * -1;
          v.root.add(t.root);
          car.trailer = t;
        }
        this.root.add(v.root);
        this.traffic.push(car);
      }),
    );
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight("#ffffff", "#444444", 1);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight("#ffffff", 2);
    sun.castShadow = true;
    const size = this.quality === "low" ? 1024 : 2048;
    sun.shadow.mapSize.set(size, size);
    const c = sun.shadow.camera;
    c.left = -11;
    c.right = 11;
    c.top = 11;
    c.bottom = -11;
    c.near = 1;
    c.far = 140;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.sun = sun;
    this.root.add(sun);
    this.scene.fog = new THREE.Fog("#ffffff", 60, 520);
    this.moonDir = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
  }

  buildSky() {
    this.sky = createSky();
    const m = this.sky.material;
    m.stencilWrite = true;
    m.stencilRef = this.mats.stencilRef;
    m.stencilFunc = THREE.EqualStencilFunc;
    m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp;
    this.scene.add(this.sky.mesh);

    // a copy for reflections: paint picks up the sunrise and the dusk
    this.envSky = createSky();
    this.envScene = new THREE.Scene();
    this.envScene.add(this.envSky.mesh);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(900, 24),
      new THREE.MeshBasicMaterial({ color: "#6e7666", side: THREE.DoubleSide }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2;
    this.envFloor = floor;
    this.envScene.add(floor);
    this.envHours = -99;
  }

  buildGround() {
    const uniforms = {
      uOffset: { value: 0 },
      uAsphalt: { value: new THREE.Color("#585e70") },
      uShoulder: { value: new THREE.Color("#9a9a95") },
      uLine: { value: new THREE.Color("#eef0f4") },
      uCentre: { value: new THREE.Color("#ffc94a") },
      uGrassA: { value: new THREE.Color("#8fae7c") },
      uGrassB: { value: new THREE.Color("#a7bd88") },
      uField: { value: new THREE.Color("#cdbb84") },
    };
    this.groundUniforms = uniforms;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vGround;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGround = vec2(position.x, -position.y);");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          /* glsl */ `#include <common>
          varying vec2 vGround;
          uniform float uOffset;
          uniform vec3 uAsphalt, uShoulder, uLine, uCentre, uGrassA, uGrassB, uField;
          float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float gnoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(gh(i), gh(i + vec2(1, 0)), u.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), u.x), u.y);
          }
          float band(float x, float c, float w) {
            float d = abs(x - c) - w;
            return 1.0 - smoothstep(-fwidth(x), fwidth(x), d);
          }`,
        )
        .replace(
          "#include <color_fragment>",
          /* glsl */ `#include <color_fragment>
          {
            float x = vGround.x - (${ROAD_X.toFixed(2)});
            float u = vGround.y - uOffset;
            float ax = abs(x);
            float n = gnoise(vec2(x * 0.018, u * 0.012)) * 0.7 + gnoise(vec2(x * 0.08, u * 0.05)) * 0.3;
            vec3 col = mix(uGrassA, uGrassB, smoothstep(0.42, 0.62, n));
            float plot = gnoise(vec2(floor(x / 38.0), floor(u / 70.0)) * 3.1);
            col = mix(col, uField, step(0.72, plot) * step(16.0, ax) * 0.85);
            float shoulder = 1.0 - smoothstep(9.0 - fwidth(ax), 9.0, ax);
            col = mix(col, uShoulder, shoulder);
            float road = 1.0 - smoothstep(7.4 - fwidth(ax), 7.4, ax);
            col = mix(col, uAsphalt * (0.94 + 0.08 * gnoise(vec2(x * 2.0, u * 0.6))), road);
            float edge = band(ax, 7.0, 0.09);
            float dash = band(ax, 3.5, 0.07) * step(fract(u / 12.0), 0.42);
            float centre = band(ax, 0.16, 0.06);
            col = mix(col, uLine, max(edge, dash));
            col = mix(col, uCentre, centre);
            diffuseColor.rgb = col;
          }`,
        );
    };
    this.mats.configure(mat);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 1, 1), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.ground = ground;
    this.root.add(ground);
  }

  buildHills() {
    const r = rng(7);
    const ring = (radius, minH, maxH, segments, color) => {
      const pos = [];
      const col = [];
      const c = new THREE.Color(color);
      // the road runs out through a gap in the hills (straight ahead, -Z), where the sun comes up
      const heights = Array.from({ length: segments }, (_, i) => {
        const a = Math.abs(((i / segments) * Math.PI * 2 + Math.PI) % (Math.PI * 2) - Math.PI);
        const gap = 0.12 + 0.88 * THREE.MathUtils.smoothstep(a, 0.12, 0.7);
        return (minH + r() * (maxH - minH)) * gap;
      });
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const h0 = heights[i];
        const h1 = heights[(i + 1) % segments];
        const p = (a, rr, h) => [Math.sin(a) * rr, h, -Math.cos(a) * rr];
        const base0 = p(a0, radius, -2);
        const base1 = p(a1, radius, -2);
        const top0 = p(a0, radius + 30, h0);
        const top1 = p(a1, radius + 30, h1);
        const back0 = p(a0, radius + 90, h0 * 0.6);
        const back1 = p(a1, radius + 90, h1 * 0.6);
        pos.push(...base0, ...top0, ...base1, ...base1, ...top0, ...top1);
        pos.push(...top0, ...back0, ...top1, ...top1, ...back0, ...back1);
        for (let k = 0; k < 12; k++) {
          const shade = 0.92 + r() * 0.12;
          col.push(c.r * shade, c.g * shade, c.b * shade);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      const m = this.mats.configure(
        new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide }),
      );
      return new THREE.Mesh(g, m);
    };
    this.hills = new THREE.Group();
    this.hills.add(ring(330, 14, 46, 46, "#7f9a78"));
    this.hills.add(ring(520, 40, 120, 38, "#7d8fa0"));
    this.root.add(this.hills);
  }

  buildTrees() {
    const r = rng(42);
    const count = this.quality === "low" ? 110 : 190;
    const canopyGeo = new THREE.IcosahedronGeometry(1, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 1, 5);
    trunkGeo.translate(0, 0.5, 0);
    const canopyMat = this.mats.configure(new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }));
    const trunkMat = this.mats.configure(new THREE.MeshStandardMaterial({ color: "#6b5a4c", roughness: 1 }));
    this.canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, count);
    this.trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    this.canopies.castShadow = this.trunks.castShadow = true;
    const greens = ["#6f9468", "#7fa36f", "#5f8661", "#8fae72", "#6a8f7a"].map((c) => new THREE.Color(c));
    this.treeData = [];
    for (let i = 0; i < count; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const x = ROAD_X + side * (13 + Math.pow(r(), 1.6) * 150);
      const h = 2.2 + r() * 3.4;
      const w = h * (0.45 + r() * 0.2);
      this.treeData.push({ x, z0: Z_MIN + r() * SPAN, h, w, rot: r() * 6.28 });
      this.canopies.setColorAt(i, greens[Math.floor(r() * greens.length)]);
    }
    this.canopies.instanceColor.needsUpdate = true;
    this.canopies.frustumCulled = this.trunks.frustumCulled = false;
    this.root.add(this.canopies, this.trunks);
  }

  buildStreetlights() {
    const spacing = 50;
    const perSide = Math.round(SPAN / spacing);
    const count = perSide * 2;
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.11, 8, 6);
    poleGeo.translate(0, 4, 0);
    const armGeo = new THREE.BoxGeometry(2.4, 0.12, 0.12);
    armGeo.translate(-1.2, 7.9, 0);
    const headGeo = new THREE.BoxGeometry(0.8, 0.14, 0.34);
    headGeo.translate(-2.3, 7.8, 0);
    const metal = this.mats.configure(new THREE.MeshStandardMaterial({ color: "#7c8292", roughness: 0.5, metalness: 0.4 }));
    this.lampMat = this.mats.configure(
      new THREE.MeshStandardMaterial({ color: "#d9dbe2", emissive: "#ffd79a", emissiveIntensity: 0, roughness: 0.4 }),
    );
    this.poles = new THREE.InstancedMesh(poleGeo, metal, count);
    this.arms = new THREE.InstancedMesh(armGeo, metal, count);
    this.heads = new THREE.InstancedMesh(headGeo, this.lampMat, count);
    for (const m of [this.poles, this.arms, this.heads]) {
      m.frustumCulled = false;
      m.castShadow = true;
    }
    this.poleData = [];
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      this.poleData.push({ x: ROAD_X + side * 8.6, z0: Z_MIN + Math.floor(i / 2) * spacing + (side > 0 ? 0 : spacing / 2), side });
    }
    // glows and road pools, switched on after dusk
    const glowMat = this.mats.configure(
      new THREE.PointsMaterial({
        map: glowTexture(),
        color: "#ffcf8a",
        size: 2.4,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      }),
    );
    this.poleGlowGeo = new THREE.BufferGeometry();
    this.poleGlowGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    this.poleGlows = new THREE.Points(this.poleGlowGeo, glowMat);
    this.poleGlows.frustumCulled = false;
    this.poleGlows.renderOrder = 5;
    const poolMat = this.mats.configure(
      new THREE.MeshBasicMaterial({
        map: poolTexture(),
        color: "#ffd9a0",
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    );
    const poolGeo = new THREE.CircleGeometry(6.5, 24);
    poolGeo.rotateX(-Math.PI / 2);
    poolGeo.translate(0, 0.04, 0);
    // the pool texture is a gradient; use a plain radial falloff via the glow map instead
    poolMat.map = glowTexture();
    this.poolMat = poolMat;
    this.pools = new THREE.InstancedMesh(poolGeo, poolMat, count);
    this.pools.frustumCulled = false;
    this.pools.renderOrder = 3;
    this.root.add(this.poles, this.arms, this.heads, this.poleGlows, this.pools);
  }

  /** World-space position of the hero car, for camera framing. */
  heroPosition(target = new THREE.Vector3()) {
    return this.root.localToWorld(target.set(0, 0, 0));
  }

  setTime(hours) {
    const day = this.day.set(hours);
    this.sky.update(day);
    const night = day.night;
    this.night = night;

    // sun by day, a cool moon after dark
    const up = day.sunDir.y;
    if (up > -0.02) {
      this.sun.color.copy(day.sun);
      this.sun.intensity = day.sunI;
      this.sun.position.copy(day.sunDir).multiplyScalar(80);
    } else {
      this.sun.color.set("#9fb0ff");
      this.sun.intensity = 0.45 * night;
      this.sun.position.copy(this.moonDir).multiplyScalar(80);
    }
    this.hemi.color.copy(day.sky);
    this.hemi.groundColor.copy(day.ground);
    this.hemi.intensity = day.hemi * 1.6;
    this.scene.fog.color.copy(day.horizon);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.9, 0.12, night);

    const lamps = THREE.MathUtils.smoothstep(night, 0.35, 0.75);
    this.lampMat.emissiveIntensity = lamps * 4;
    this.poleGlows.material.opacity = lamps;
    this.poolMat.opacity = lamps * 0.32;
    for (const car of this.traffic) {
      car.v.setLamps({ head: lamps > 0.2 });
      car.v.glowGain = THREE.MathUtils.lerp(0.25, 1, lamps);
      if (car.trailer) {
        car.trailer.setLamps({ tail: lamps > 0.2 });
        car.trailer.glowGain = car.v.glowGain;
      }
    }
    if (this.hero) this.hero.glowGain = THREE.MathUtils.lerp(0.3, 1, lamps);
    return lamps;
  }

  /** Regenerates the reflection map when the light has changed enough to notice. */
  updateEnvironment(renderer, force = false) {
    if (!force && Math.abs(this.day.hours - this.envHours) < 0.35) return;
    this.envHours = this.day.hours;
    this.envSky.update(this.day);
    this.envFloor.material.color.copy(this.day.ground).multiplyScalar(1.4);
    this.pmrem ??= new THREE.PMREMGenerator(renderer);
    const rt = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 2000);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
  }

  /** Advance the treadmill. `motion` scales movement (0 freezes traffic for reduced motion). */
  update(dt, camera, motion = 1) {
    const step = SPEED * dt * motion;
    this.distance += step;
    this.groundUniforms.uOffset.value = this.distance;
    this.sky.mesh.position.copy(camera.position);
    this.sky.mesh.updateMatrixWorld();

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    this.treeData.forEach((t, i) => {
      const z = wrapZ(t.z0 + this.distance);
      q.setFromAxisAngle(yAxis, t.rot);
      m.compose(p.set(t.x, t.h * 0.42 + t.w * 0.7, z), q, s.set(t.w, t.w * 1.25, t.w));
      this.canopies.setMatrixAt(i, m);
      m.compose(p.set(t.x, 0, z), q, s.set(1, t.h * 0.55, 1));
      this.trunks.setMatrixAt(i, m);
    });
    this.canopies.instanceMatrix.needsUpdate = this.trunks.instanceMatrix.needsUpdate = true;

    const glowPos = this.poleGlowGeo.attributes.position;
    this.poleData.forEach((d, i) => {
      const z = wrapZ(d.z0 + this.distance);
      q.setFromAxisAngle(yAxis, d.side > 0 ? 0 : Math.PI);
      m.compose(p.set(d.x, 0, z), q, s.set(1, 1, 1));
      this.poles.setMatrixAt(i, m);
      this.arms.setMatrixAt(i, m);
      this.heads.setMatrixAt(i, m);
      const hx = d.x - d.side * 2.3;
      glowPos.setXYZ(i, hx, 7.55, z);
      m.compose(p.set(hx, 0, z), q.identity(), s.set(1, 1, 1));
      this.pools.setMatrixAt(i, m);
    });
    glowPos.needsUpdate = true;
    for (const im of [this.poles, this.arms, this.heads, this.pools]) im.instanceMatrix.needsUpdate = true;

    const cam = camera.position;
    for (const car of this.traffic) {
      car.z = wrapZ(car.z + car.rel * dt * motion);
      car.v.root.position.set(car.lane.x, 0, car.z);
      car.v.roll(car.lane.speed * dt * motion);
      car.trailer?.roll(car.lane.speed * dt * motion);
      car.v.root.updateMatrixWorld();
      const far = car.v.root.getWorldPosition(p).distanceTo(cam) > 70;
      car.v.setLOD(far ? 2 : 1);
      car.trailer?.setLOD(far ? 2 : 1);
      car.v.update(dt, camera);
      car.trailer?.update(dt, camera);
    }
    if (this.hero) {
      this.hero.roll(step);
      this.hero.update(dt, camera);
    }
  }
}

export const ROAD = { SPEED, ROAD_X };
