import * as THREE from "three";

// three.js ports of the Helicopter Pack's URP shaders (Assets/RotorTrail - Helicopter Pack/Shaders), fed
// with the per-material values that tools/pack_helicopters.mjs stores in each glTF material's extras
// (material.userData.rt). Colours there are linear, like the pack's materials.json.
//   Paint       RotorTrailInput.hlsl RT_Paint: mottle, streaks, camouflage, belly band, panel lines, rivets,
//               grime and exhaust soot, drawn in the airframe coordinates of each part (the _airframe attribute)
//   Surface     RT_Surface: two colours broken up by noise along the facet's dominant axis
//   Instrument, Display   Surface with the pack's static dial and screen artwork (UV0)
//   Glass       RotorTrailForwardPass.hlsl: clear facing the viewer, more opaque at grazing angles,
//               reflections at full strength (premultiplied blend)
//   Emissive    RotorTrailEmissive.shader: HDR colour, optionally blinking with a per-object phase

const NOISE = /* glsl */ `
float rtHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rtNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rtHash(i), rtHash(i + vec2(1.0, 0.0)), f.x), mix(rtHash(i + vec2(0.0, 1.0)), rtHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float rtFbm(vec2 p) { return rtNoise(p) * 0.55 + rtNoise(p * 2.31 + 17.1) * 0.28 + rtNoise(p * 5.17 + 3.7) * 0.17; }
`;

const PAINT = /* glsl */ `
uniform vec3 uColor2;
uniform vec3 uCamoA;
uniform vec3 uCamoB;
uniform vec3 uBelly;
uniform vec3 uSootCenter;
uniform float uPanelX;
uniform float uPanelZ;
uniform float uLineDark;
uniform float uGrime;
uniform float uSootRadius;
uniform float uCamo;
uniform float uCamoScale;
uniform float uBellyZ;
uniform float uBellyX;
uniform float uBellySlope;
uniform float uBellyMix;
uniform float uRivets;
uniform float uStreaks;
uniform float uRough;

void rtPaint(vec3 lp, vec3 base, out vec3 color, out float roughness) {
  vec3 p = vec3(lp.x, abs(lp.y), lp.z);
  vec2 panel = vec2(max(uPanelX, 0.01), max(uPanelZ, 0.01));
  vec2 g = p.xz / panel;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  vec2 aa = fwidth(g);
  vec2 d = min(f, 1.0 - f);
  vec2 lw = 0.011 / panel;
  vec2 ln = 1.0 - clamp((d - lw) / max(aa, 1e-4), 0.0, 1.0);
  float seam = step(0.4, rtHash(vec2(cell.x, 3.7)));
  float lines = max(ln.x * step(0.25, rtHash(vec2(cell.y, cell.x * 0.1 + 1.3))), ln.y * seam);
  lines *= clamp(1.4 - max(aa.x, aa.y) * 5.0, 0.0, 1.0);

  float rivets = 0.0;
  if (uRivets > 0.0) {
    vec2 inP = f * panel;
    vec2 toE = panel - inP;
    float col = min(abs(inP.x - 0.025), abs(toE.x - 0.025));
    float row = min(abs(inP.y - 0.025), abs(toE.y - 0.025));
    float alongZ = abs(fract(p.z / 0.07) - 0.5) * 0.07;
    float alongX = abs(fract(p.x / 0.07) - 0.5) * 0.07;
    float r = min(seam > 0.5 ? length(vec2(col, alongZ)) : 1.0, length(vec2(row, alongX)));
    float px = max(fwidth(p.x), fwidth(p.z));
    rivets = (1.0 - clamp((r - 0.0045) / max(px, 1e-5), 0.0, 1.0)) * clamp(2.0 - px * 250.0, 0.0, 1.0) * uRivets;
  }

  float mottle = rtFbm(vec2(p.x * 1.1 + p.y * 0.6, p.z * 1.4));
  vec3 c = mix(base, uColor2, mottle * 0.7);
  if (uStreaks != 0.0) {
    float st = clamp((rtFbm(vec2(p.x * 9.0 + p.y * 7.0, p.z * 0.45)) - 0.42) * 2.2, 0.0, 1.0);
    c = uStreaks > 0.0 ? c * (1.0 - st * uStreaks) : mix(c, uColor2 * 1.25, st * -uStreaks);
  }

  vec2 cq = vec2(p.x + p.y * 0.9, p.z * 1.15 + p.y * 0.45) / max(uCamoScale, 0.05);
  float ca = smoothstep(0.515, 0.54, rtFbm(cq + 3.7));
  float cb = smoothstep(0.535, 0.56, rtFbm(cq * 1.31 + vec2(11.3, 5.9))) * (1.0 - ca);
  c = mix(c, uCamoA * (0.92 + 0.16 * mottle), ca * uCamo);
  c = mix(c, uCamoB * (0.92 + 0.16 * mottle), cb * uCamo);

  float bellyLine = uBellyZ + max(0.0, uBellyX - p.x) * uBellySlope;
  c = mix(c, uBelly, clamp((bellyLine - p.z) / 0.07, 0.0, 1.0) * uBellyMix);

  c *= 1.0 - lines * uLineDark;
  c *= 1.0 - rivets * 0.22;
  c *= 1.0 - clamp(1.0 - (p.z - 0.7) / 1.3, 0.0, 1.0) * uGrime * 0.3;

  vec3 sd = p - uSootCenter;
  float soot = clamp(1.0 - length(sd * vec3(0.45, 1.3, 1.6)) / max(uSootRadius, 0.01), 0.0, 1.0) * step(sd.x, 0.6) * step(0.001, uSootRadius);
  c = mix(c, vec3(0.018, 0.016, 0.014), soot * 0.9);

  color = c;
  roughness = clamp(uRough + (mottle - 0.5) * 0.18 + lines * 0.1 + soot * 0.25, 0.0, 1.0);
}
`;

const SURFACE = /* glsl */ `
uniform vec3 uColor2;
uniform float uNoiseScale;
uniform float uNoiseAmount;
uniform float uRough;

void rtSurface(vec3 lp, vec3 base, out vec3 color, out float roughness) {
  vec3 n = cross(dFdx(lp), dFdy(lp));
  n /= max(length(n), 1e-12);
  vec2 q = abs(n.z) > 0.6 ? lp.xy : (abs(n.x) > abs(n.y) ? lp.yz : lp.xz);
  float s = max(uNoiseScale, 0.01);
  float nz = rtFbm(q / s);
  float t = clamp(0.5 + (nz - 0.5) * uNoiseAmount * 2.0, 0.0, 1.0);
  vec3 c = mix(base, uColor2, t);
  c *= 1.0 + (rtNoise(q / (s * 0.23)) - 0.5) * uNoiseAmount * 0.35;
  color = c;
  roughness = clamp(uRough + (nz - 0.5) * 0.1, 0.0, 1.0);
}
`;

const linear = (v, scale = 1) => new THREE.Color().setRGB(v[0] * scale, v[1] * scale, v[2] * scale, THREE.LinearSRGBColorSpace);

/** Hooks the airframe attribute into a standard material's vertex shader. */
function airframeVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute vec3 _airframe;\nvarying vec3 vAirframe;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAirframe = _airframe * 0.001;");
}

function paintMaterial(name, rt) {
  const m = new THREE.MeshStandardMaterial({ name, color: linear(rt.BaseColor), metalness: rt.Metallic ?? 0 });
  const u = {
    uColor2: { value: linear(rt.Color2) },
    uCamoA: { value: linear(rt.CamoA) },
    uCamoB: { value: linear(rt.CamoB) },
    uBelly: { value: linear(rt.Belly) },
    uSootCenter: { value: new THREE.Vector3(...rt.SootCenter) },
    uRough: { value: rt.Roughness },
  };
  for (const k of ["PanelX", "PanelZ", "LineDark", "Grime", "SootRadius", "Camo", "CamoScale", "BellyZ", "BellyX", "BellySlope", "BellyMix", "Rivets", "Streaks"])
    u["u" + k] = { value: rt[k] ?? 0 };
  m.customProgramCacheKey = () => "rt-paint";
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    airframeVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vAirframe;\n" + NOISE + PAINT)
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\nvec3 rtColor; float rtRough;\nrtPaint(vAirframe, diffuseColor.rgb, rtColor, rtRough);\ndiffuseColor.rgb = rtColor;",
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = rtRough;");
  };
  return m;
}

function surfaceMaterial(name, rt, art) {
  const m = new THREE.MeshStandardMaterial({ name, color: linear(rt.Color), metalness: rt.Metallic ?? 0 });
  const u = {
    uColor2: { value: linear(rt.Color2) },
    uNoiseScale: { value: rt.NoiseScale ?? 0.4 },
    uNoiseAmount: { value: rt.NoiseAmount ?? 0.15 },
    uRough: { value: rt.Roughness ?? 0.6 },
  };
  if (art) {
    // HelicopterPackBuilder.PackMaterial: instruments and displays are Surface materials with the static
    // artwork as base and emission map
    m.map = art.texture;
    m.emissiveMap = art.texture;
    m.emissive = art.emissive;
    m.color.set(art.base);
    u.uColor2.value.set(art.base);
    u.uNoiseAmount.value = 0;
    u.uRough.value = art.rough;
  }
  m.customProgramCacheKey = () => "rt-surface";
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    airframeVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vAirframe;\n" + NOISE + SURFACE)
      .replace(
        "#include <color_fragment>",
        // URP: albedo = RT_Surface(colour) * base map
        `#include <color_fragment>
        vec3 rtColor; float rtRough;
        rtSurface(vAirframe, diffuse, rtColor, rtRough);
        diffuseColor.rgb = rtColor;
        #ifdef USE_MAP
        diffuseColor.rgb *= texture2D(map, vMapUv).rgb;
        #endif`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = rtRough;");
  };
  return m;
}

function glassMaterial(name, rt) {
  const m = new THREE.MeshStandardMaterial({
    name,
    color: linear(rt.Color),
    roughness: rt.Roughness ?? 0.04,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const u = { uOpacity: { value: rt.Opacity ?? 0.35 }, uEdgeOpacity: { value: rt.EdgeOpacity ?? 0.9 } };
  m.customProgramCacheKey = () => "rt-glass";
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uOpacity;\nuniform float uEdgeOpacity;")
      .replace(
        "#include <normal_fragment_maps>",
        "#include <normal_fragment_maps>\nfloat rtFresnel = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);\ndiffuseColor.a = mix(uOpacity, uEdgeOpacity, rtFresnel);",
      );
  };
  return m;
}

/** Shared clock for blinking lights. */
export const blinkClock = { value: 0 };

function emissiveMaterial(name, rt) {
  const m = new THREE.MeshBasicMaterial({ name, color: linear(rt.Color) });
  const u = {
    uTime: blinkClock,
    uLevel: { value: [rt.Base ?? 0.05, rt.Intensity ?? 5, rt.DayFactor ?? 1] },
    uBlink: { value: [rt.BlinkHz ?? 0, rt.Duty ?? 0.5, rt.Soft ?? 0, rt.PhaseRandom ?? 1] },
  };
  m.customProgramCacheKey = () => "rt-emissive";
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uLevel = { value: new THREE.Vector3(...u.uLevel.value) };
    shader.uniforms.uBlink = { value: new THREE.Vector4(...u.uBlink.value) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vOrigin;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vOrigin;\nuniform float uTime;\nuniform vec3 uLevel;\nuniform vec4 uBlink;\nfloat rtHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float phase = fract(uTime * uBlink.x + rtHash(vOrigin.xz + vOrigin.y) * uBlink.w);
        float pulse = uBlink.z > 0.5 ? clamp(1.0 - abs(phase - uBlink.y * 0.5) / max(uBlink.y * 0.5, 1e-3), 0.0, 1.0) : step(phase, uBlink.y);
        float on = uBlink.x > 0.001 ? pulse : 1.0;
        diffuseColor.rgb *= uLevel.x + uLevel.y * on * uLevel.z;`,
      );
  };
  return m;
}

// --- static cockpit artwork (HelicopterPackBuilder.Dial / .Display), 512 x 256, v up ----------------

function artTexture(key, pixel) {
  const w = 512;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = 1 - (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const [r, gg, b] = pixel((x + 0.5) / w, v);
      const i = (y * w + x) * 4;
      img.data[i] = r * 255;
      img.data[i + 1] = gg * 255;
      img.data[i + 2] = b * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.name = key;
  return t;
}

function dial(u, v) {
  const px = (u - 0.5) * 2;
  const py = (v - 0.5) * 2;
  const r = Math.hypot(px, py);
  const a = Math.atan2(px, py);
  const tick = r > 0.72 && r < 0.9 && Math.abs(Math.sin(a * 30)) < 0.14;
  const needle = Math.abs(px * 0.8 + py * 0.6) < 0.028 && px > 0 && r < 0.7;
  return needle ? [0.95, 0.52, 0.15] : tick || r < 0.06 ? [0.82, 0.85, 0.77] : [0.025, 0.03, 0.035];
}

function display(u, v) {
  if (u < 0.04 || u > 0.96 || v < 0.06 || v > 0.94) return [0.02, 0.025, 0.03];
  const mark = (Math.abs(v - 0.5) < 0.012 && Math.abs(u - 0.5) < 0.28) || (Math.abs(u - 0.5) < 0.008 && Math.abs(v - 0.5) < 0.1);
  const ticks = (u < 0.16 || u > 0.84) && (v * 16) % 1 < 0.1;
  return mark ? [1, 0.65, 0.12] : ticks ? [0.55, 1, 0.65] : v > 0.5 ? [0.04, 0.2, 0.36] : [0.2, 0.12, 0.055];
}

let dialTex;
let displayTex;

/**
 * Materials for one aircraft, by glTF material name. The lite and LOD0 files share them.
 */
export class RotorTrailMaterials {
  constructor() {
    this.cache = new Map();
  }

  /** Replacement for a material that GLTFLoader built from the file. */
  get(src) {
    let m = this.cache.get(src.name);
    if (m) return m;
    const rt = src.userData?.rt;
    if (!rt) {
      console.warn(`No RotorTrail values for ${src.name}`);
      m = new THREE.MeshStandardMaterial({ name: src.name, color: "#808080", roughness: 0.6 });
    } else if (rt.kind === "Paint") m = paintMaterial(src.name, rt);
    else if (rt.kind === "Glass") m = glassMaterial(src.name, rt);
    else if (rt.kind === "Emissive") m = emissiveMaterial(src.name, rt);
    else if (rt.kind === "Instrument") {
      dialTex ??= artTexture("StaticInstrument", dial);
      m = surfaceMaterial(src.name, { Color: [1, 1, 1], Color2: [1, 1, 1] }, {
        texture: dialTex,
        base: linear([1, 1, 1]),
        rough: 0.3,
        emissive: new THREE.Color(...(rt.Glow ?? [0.9, 0.95, 1])).multiplyScalar(0.35),
      });
    } else if (rt.kind === "Display") {
      displayTex ??= artTexture("StaticDisplay", display);
      // Unity's Color(.06, .06, .06) is a gamma-space colour
      const base = new THREE.Color().setRGB(0.06, 0.06, 0.06, THREE.SRGBColorSpace);
      m = surfaceMaterial(src.name, { Color: [0, 0, 0], Color2: [0, 0, 0] }, {
        texture: displayTex,
        base,
        rough: 0.12,
        emissive: new THREE.Color(1, 1, 1).multiplyScalar((rt.Bright ?? 1.6) * 0.55),
      });
    } else m = surfaceMaterial(src.name, rt);
    m.userData.kind = rt?.kind ?? "Surface";
    m.userData.rt = rt;
    m.polygonOffset = m.userData.kind !== "Glass";
    m.polygonOffsetFactor = 1;
    m.polygonOffsetUnits = 1;
    this.cache.set(src.name, m);
    return m;
  }
}

// --- rotor blur disc (RotorTrailRotorDisc.shader) ----------------------------------------------------

const DISC_GEO = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2);

/** A unit disc in the XZ plane; scale it to the rotor radius. */
export function rotorDisc({ color, blades, rate }) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: color.clone() },
      uLight: { value: new THREE.Color(1.6, 1.65, 1.75) },
      uSpin: { value: 0 },
      uTime: blinkClock,
      uRate: { value: rate },
      uBlades: { value: blades },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uLight;
      uniform float uSpin;
      uniform float uTime;
      uniform float uRate;
      uniform float uBlades;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        float a = atan(vUv.y, vUv.x);
        float streak = pow(0.5 + 0.5 * cos(a * uBlades - uTime * uRate), 5.0);
        float band = smoothstep(0.07, 0.2, r) * (1.0 - smoothstep(0.985, 1.0, r));
        float tip = smoothstep(0.86, 0.97, r) * (1.0 - smoothstep(0.975, 1.0, r));
        float alpha = clamp(uSpin * band * (0.09 + 0.2 * streak + 0.3 * tip), 0.0, 1.0);
        gl_FragColor = vec4(uColor * uLight, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(DISC_GEO, mat);
  mesh.renderOrder = 10;
  mesh.visible = false;
  return mesh;
}
