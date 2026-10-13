import * as THREE from "three";

const cache = new Map();

function canvasTexture(key, size, draw) {
  let t = cache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Soft round glow for lamps, white so a material colour can tint it. */
export const glowTexture = () =>
  canvasTexture("glow", 128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.12, "rgba(255,255,255,0.85)");
    r.addColorStop(0.35, "rgba(255,255,255,0.28)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });

/** Pool of light on the ground, brightest near the bottom edge (the lamp end). */
export const poolTexture = () =>
  canvasTexture("pool", 256, (g, s) => {
    const r = g.createRadialGradient(s / 2, s * 0.92, 0, s / 2, s * 0.92, s * 0.9);
    r.addColorStop(0, "rgba(255,255,255,0.9)");
    r.addColorStop(0.4, "rgba(255,255,255,0.35)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });

/** Round contact shadow. */
export const blobTexture = () =>
  canvasTexture("blob", 128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(0,0,0,0.75)");
    r.addColorStop(0.55, "rgba(0,0,0,0.4)");
    r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
