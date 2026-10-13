import * as THREE from "three";

// One Saturday, keyed by hour. Colours lean on the brand periwinkle so the world sits with the stage.
// top/horizon: sky gradient, sun: sun light colour, ground: hemisphere fill from below.
const KEYS = [
  { h: 0, top: "#0b1128", horizon: "#1d2650", sun: "#8fa0ff", sunI: 0, hemi: 0.18, sky: "#33406e", ground: "#141a2c", night: 1 },
  { h: 4.8, top: "#111a3a", horizon: "#2a3463", sun: "#8fa0ff", sunI: 0, hemi: 0.2, sky: "#3a4778", ground: "#161c30", night: 1 },
  { h: 5.6, top: "#2c3a72", horizon: "#b98aa6", sun: "#ff9a6a", sunI: 0.1, hemi: 0.35, sky: "#6672a6", ground: "#2a2a3a", night: 0.75 },
  { h: 6.2, top: "#5a73b6", horizon: "#ffb98a", sun: "#ffad72", sunI: 1.3, hemi: 0.6, sky: "#9aa6d4", ground: "#5d5864", night: 0.3 },
  { h: 7.2, top: "#7192d2", horizon: "#ffd9b0", sun: "#ffd2a0", sunI: 2.2, hemi: 0.8, sky: "#b7c3e6", ground: "#77786f", night: 0 },
  { h: 9.5, top: "#6f97de", horizon: "#e6ecf6", sun: "#fff1dc", sunI: 2.8, hemi: 0.95, sky: "#c3d0f0", ground: "#7e8478", night: 0 },
  { h: 13, top: "#6a93dc", horizon: "#e2eaf6", sun: "#fff8ee", sunI: 3.0, hemi: 1.0, sky: "#c8d4f2", ground: "#81877a", night: 0 },
  { h: 16.5, top: "#6f8fd4", horizon: "#f1e3cf", sun: "#ffe6c4", sunI: 2.7, hemi: 0.9, sky: "#c4cdea", ground: "#7d7f72", night: 0 },
  { h: 18.6, top: "#5867aa", horizon: "#ffa36a", sun: "#ff9a52", sunI: 1.8, hemi: 0.65, sky: "#a59cc4", ground: "#5f5258", night: 0.1 },
  { h: 19.5, top: "#2e3366", horizon: "#c2677c", sun: "#ff6a4a", sunI: 0.35, hemi: 0.42, sky: "#6a5f8e", ground: "#2e2834", night: 0.55 },
  { h: 20.4, top: "#151c3d", horizon: "#3b3f6e", sun: "#8fa0ff", sunI: 0, hemi: 0.24, sky: "#3e4878", ground: "#161a2a", night: 1 },
  { h: 24, top: "#0b1128", horizon: "#1d2650", sun: "#8fa0ff", sunI: 0, hemi: 0.18, sky: "#33406e", ground: "#141a2c", night: 1 },
].map((k) => ({
  ...k,
  top: new THREE.Color(k.top),
  horizon: new THREE.Color(k.horizon),
  sun: new THREE.Color(k.sun),
  sky: new THREE.Color(k.sky),
  ground: new THREE.Color(k.ground),
}));

const SUNRISE = 6.0;
const SUNSET = 19.6;
const MAX_ELEVATION = THREE.MathUtils.degToRad(58);

export class DayState {
  constructor() {
    this.top = new THREE.Color();
    this.horizon = new THREE.Color();
    this.sun = new THREE.Color();
    this.sky = new THREE.Color();
    this.ground = new THREE.Color();
    this.sunDir = new THREE.Vector3();
    this.hours = -1;
  }

  /** Sun rises toward -Z (straight down the road from the home page camera) and sets behind it. */
  set(hours) {
    this.hours = hours = ((hours % 24) + 24) % 24;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= hours) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = THREE.MathUtils.smoothstep(hours, a.h, b.h);
    for (const k of ["top", "horizon", "sun", "sky", "ground"]) this[k].copy(a[k]).lerp(b[k], t);
    this.sunI = THREE.MathUtils.lerp(a.sunI, b.sunI, t);
    this.hemi = THREE.MathUtils.lerp(a.hemi, b.hemi, t);
    this.night = THREE.MathUtils.lerp(a.night, b.night, t);

    const arc = (Math.PI * (hours - SUNRISE)) / (SUNSET - SUNRISE);
    const el = arc > 0 && arc < Math.PI ? MAX_ELEVATION * Math.sin(arc) : -0.25 * Math.sin(Math.min(Math.abs(arc), 1));
    const az = THREE.MathUtils.clamp(arc, -0.4, Math.PI + 0.4) * 0.97 - 0.03;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    return this;
  }
}

/** Gradient dome with a sun disc and, at night, a scatter of stars. Follows the camera. */
export function createSky() {
  const uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uNight: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uNight;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
        col = mix(col, uHorizon, (1.0 - smoothstep(-0.08, 0.0, d.y)) * 0.6);
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        float disc = smoothstep(0.99986, 0.99993, s);
        float halo = pow(s, 90.0) * 0.55 + pow(s, 8.0) * 0.18;
        float above = smoothstep(-0.02, 0.01, uSunDir.y);
        col += uSunColor * (halo * (1.0 - uNight * 0.8)) ;
        col = mix(col, mix(uSunColor, vec3(1.0, 0.94, 0.82), 0.7) * 2.0, disc * above);
        vec3 cell = floor(d * 260.0);
        float star = step(0.9965, hash(cell)) * smoothstep(0.03, 0.25, d.y);
        col += vec3(0.9, 0.93, 1.0) * star * uNight * 0.9;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.scale.setScalar(1000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return {
    mesh,
    material,
    update(day) {
      uniforms.uTop.value.copy(day.top);
      uniforms.uHorizon.value.copy(day.horizon);
      uniforms.uSunDir.value.copy(day.sunDir);
      uniforms.uSunColor.value.copy(day.sun);
      uniforms.uNight.value = day.night;
    },
  };
}
