import * as THREE from "three";

// Mirrors Assets/_PackTools/Editor/PackMaterials.cs and PackConfig.Paints, so the web models wear the same
// colours as the pack. smooth is Unity smoothness (roughness = 1 - smooth); e is emission intensity.
const LIBRARY = {
  Glass: { color: "#10161A", smooth: 0.96, alpha: 0.45 },
  Glass_Clear: { color: "#DCE6EA", smooth: 0.97, alpha: 0.14 },
  Plastic_Black: { color: "#1B1B1D", smooth: 0.35 },
  Black_Gloss: { color: "#0A0A0B", smooth: 0.88 },
  Rubber: { color: "#141415", smooth: 0.18 },
  Chrome: { color: "#E4E6E8", metal: 1, smooth: 0.93 },
  Rim_Silver: { color: "#BFC3C8", metal: 1, smooth: 0.78 },
  Rim_Black: { color: "#141416", metal: 0.6, smooth: 0.8 },
  Rim_Gunmetal: { color: "#4B4F55", metal: 1, smooth: 0.74 },
  Interior_Dark: { color: "#1A1A1C", smooth: 0.25 },
  Interior_Trim: { color: "#2A2B2E", smooth: 0.3 },
  Interior_Seat: { color: "#242426", smooth: 0.42 },
  Interior_Seat_Tan: { color: "#9A7650", smooth: 0.42 },
  Interior_Seat_Red: { color: "#7A1A18", smooth: 0.42 },
  Light_Head: { color: "#F4F1E6", smooth: 0.85, emission: "#FFF6DC", e: 0.35 },
  Light_Head_On: { color: "#FFFDF4", smooth: 0.85, emission: "#FFF2CC", e: 6 },
  Light_Tail: { color: "#7A0606", smooth: 0.88, emission: "#FF1A0A", e: 0.25 },
  Light_Tail_On: { color: "#B00A08", smooth: 0.88, emission: "#FF1A0A", e: 5 },
  Light_Indicator_L: { color: "#E0720A", smooth: 0.88, emission: "#FF8A00", e: 0.2 },
  Light_Indicator_R: { color: "#E0720A", smooth: 0.88, emission: "#FF8A00", e: 0.2 },
  Light_Indicator_On: { color: "#FF9A1A", smooth: 0.88, emission: "#FF8A00", e: 5 },
  Light_Reverse: { color: "#D9DBDD", smooth: 0.88, emission: "#FFFFFF", e: 0.1 },
  Light_Reverse_On: { color: "#FFFFFF", smooth: 0.88, emission: "#FFFFFF", e: 4 },
  Plate: { color: "#E2E2DE", smooth: 0.45 },
  Brake_Disc: { color: "#8A8C90", metal: 1, smooth: 0.62 },
  Caliper: { color: "#B3140F", smooth: 0.65 },
  Caliper_Yellow: { color: "#E0B000", smooth: 0.65 },
};

export { PAINTS } from "../data/paints.js";
import { PAINTS } from "../data/paints.js";

// FBX material slot -> library material (PackConfig.MaterialMap)
export const SLOTS = {
  Glass: "Glass",
  Lens: "Glass_Clear",
  Plastic_Black: "Plastic_Black",
  Black_Gloss: "Black_Gloss",
  Rubber: "Rubber",
  Chrome: "Chrome",
  Rim: "Rim_Silver",
  Rim_Dark: "Rim_Gunmetal",
  Interior_Dark: "Interior_Dark",
  Interior_Trim: "Interior_Trim",
  Interior_Seat: "Interior_Seat",
  Plate: "Plate",
  Brake_Disc: "Brake_Disc",
  Caliper: "Caliper",
};

/**
 * One set of materials per render context. The home page's road world lives behind a stencil portal,
 * so every material it uses needs the same stencil test and clipping planes: `configure` applies them.
 */
export class MaterialSet {
  /**
   * stencilRef/planes: portal setup (see above).
   * sweep: { uSweep, uClay } uniforms. Surfaces at world z below uSweep turn to matte clay with a bright
   *   scan line at the boundary, scaled by uClay; used to reveal topology on the home page.
   * offset: push surfaces back in depth so wireframe lines drawn on them win the depth test.
   */
  constructor({ stencilRef = 0, planes = null, sweep = null, offset = false } = {}) {
    this.stencilRef = stencilRef;
    this.planes = planes;
    this.sweep = sweep;
    this.offset = offset;
    this.cache = new Map();
    this.all = new Set();
  }

  configure(m) {
    if (this.stencilRef) {
      m.stencilWrite = true;
      m.stencilRef = this.stencilRef;
      m.stencilFunc = THREE.EqualStencilFunc;
      m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp;
    }
    if (this.planes) m.clippingPlanes = this.planes;
    this.all.add(m);
    return m;
  }

  /** Surface materials (not lines or sprites) also get the sweep and depth offset. */
  surface(m) {
    if (this.offset) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = 1;
      m.polygonOffsetUnits = 1;
    }
    if (this.sweep) addSweep(m, this.sweep);
    return this.configure(m);
  }

  get(name) {
    let m = this.cache.get(name);
    if (m) return m;
    const d = LIBRARY[name];
    if (!d) {
      console.warn(`No library material for slot ${name}`);
      m = new THREE.MeshStandardMaterial({ name, color: "#777", roughness: 0.5 });
      this.cache.set(name, this.surface(m));
      return m;
    }
    m = new THREE.MeshStandardMaterial({
      name,
      color: d.color,
      metalness: d.metal ?? 0,
      roughness: 1 - d.smooth,
    });
    if (d.alpha !== undefined) {
      m.transparent = true;
      m.opacity = d.alpha;
      m.depthWrite = false;
    }
    if (d.emission) {
      m.emissive = new THREE.Color(d.emission);
      m.emissiveIntensity = d.e;
    }
    this.cache.set(name, this.surface(m));
    return m;
  }

  paint(name) {
    const key = "Paint_" + name;
    let m = this.cache.get(key);
    if (m) return m;
    const p = PAINTS.find((x) => x.name === name) ?? PAINTS[0];
    m = new THREE.MeshPhysicalMaterial({
      name: key,
      color: p.hex,
      metalness: p.metal,
      roughness: 1 - p.smooth,
      clearcoat: p.coat,
      clearcoatRoughness: 0.06,
    });
    this.cache.set(key, this.surface(m));
    return m;
  }

  /** Flat matte stand-in used while showing topology. */
  clay() {
    let m = this.cache.get("_clay");
    if (m) return m;
    m = new THREE.MeshStandardMaterial({ name: "_clay", color: "#d9dce4", roughness: 0.9, metalness: 0 });
    this.cache.set("_clay", this.surface(m));
    return m;
  }
}

export const CLAY = new THREE.Color("#d6d9e1");

function addSweep(m, sweep) {
  m.customProgramCacheKey = () => "sweep";
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSweep = sweep.uSweep;
    shader.uniforms.uClay = sweep.uClay;
    shader.uniforms.uClayColor = { value: CLAY };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vSweepZ;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvSweepZ = (modelMatrix * vec4(transformed, 1.0)).z;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vSweepZ;\nuniform float uSweep;\nuniform float uClay;\nuniform vec3 uClayColor;",
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float clayK = uClay * step(vSweepZ, uSweep);
        float scan = uClay * (1.0 - smoothstep(0.0, 0.05, abs(vSweepZ - uSweep)));
        diffuseColor.rgb = mix(diffuseColor.rgb, uClayColor, clayK);
        diffuseColor.a = mix(diffuseColor.a, 1.0, clayK);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, clayK);",
      )
      .replace(
        "#include <metalnessmap_fragment>",
        "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, clayK);",
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance = totalEmissiveRadiance * (1.0 - clayK) + vec3(1.0, 0.79, 0.29) * scan * 3.0;",
      )
      .replace(
        "#include <lights_physical_fragment>",
        "#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - clayK;\n#endif",
      );
  };
}
