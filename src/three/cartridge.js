import * as THREE from "three";

// The logo cartridge as an object. Built in logo units (the 64-unit SVG grid, y flipped, origin at the
// bottom of the connector) and scaled down to a real cartridge: SCALE * 55 units = 13.75 cm tall.
export const SCALE = 0.0025;

// label window in logo units: the yellow label (x 18..46, y 23.5..41 in the SVG) minus a bezel
const LABEL = { x0: -14, x1: 14, y0: 14, y1: 31.5, r: 2.5 };
const BEZEL = 1.3;
export const WINDOW = { x0: LABEL.x0 + BEZEL, x1: LABEL.x1 - BEZEL, y0: LABEL.y0 + BEZEL, y1: LABEL.y1 - BEZEL, r: 1.4 };
const Z = { backFront: 1.6, mask: 1.72, print: 1.76, front: 4.5 };

function bodyShape() {
  const s = new THREE.Shape();
  s.moveTo(-14, 46);
  s.lineTo(14, 46);
  s.absarc(14, 41, 5, Math.PI / 2, 0, true);
  s.lineTo(19, 12);
  s.lineTo(16, 12);
  s.lineTo(16, 6);
  s.absarc(14, 6, 2, 0, -Math.PI / 2, true);
  s.lineTo(-14, 4);
  s.absarc(-14, 6, 2, -Math.PI / 2, -Math.PI, true);
  s.lineTo(-16, 12);
  s.lineTo(-19, 12);
  s.lineTo(-19, 41);
  s.absarc(-14, 41, 5, Math.PI, Math.PI / 2, true);
  return s;
}

function roundRect({ x0, x1, y0, y1, r }, path = new THREE.Shape()) {
  path.moveTo(x0 + r, y0);
  path.lineTo(x1 - r, y0);
  path.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  path.lineTo(x1, y1 - r);
  path.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  path.lineTo(x0 + r, y1);
  path.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(x0, y0 + r);
  path.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return path;
}

function windowGeometry() {
  const g = new THREE.ShapeGeometry(roundRect(WINDOW), 6);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, (p.getX(i) - WINDOW.x0) / (WINDOW.x1 - WINDOW.x0), (p.getY(i) - WINDOW.y0) / (WINDOW.y1 - WINDOW.y0));
  }
  return g;
}

/** The printed label from the logo, seen before the cartridge powers on. */
function printTexture() {
  const w = 1024;
  const h = Math.round((w * (WINDOW.y1 - WINDOW.y0)) / (WINDOW.x1 - WINDOW.x0));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  // map logo SVG coordinates onto the visible window
  const sx = w / (WINDOW.x1 - WINDOW.x0);
  const toX = (x) => (x - 32 - WINDOW.x0) * sx;
  const toY = (y) => (55 - y - WINDOW.y1) * -sx;
  g.fillStyle = "#FFC94A";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#1B2233";
  g.beginPath();
  g.arc(toX(32), toY(38), 7 * sx, Math.PI, 0);
  g.closePath();
  g.fill();
  g.strokeStyle = "#1B2233";
  g.lineWidth = 2 * sx;
  g.lineCap = "round";
  const ray = (x1, y1, x2, y2) => {
    g.beginPath();
    g.moveTo(toX(x1), toY(y1));
    g.lineTo(toX(x2), toY(y2));
    g.stroke();
  };
  ray(32, 26.6, 32, 29);
  ray(24.9, 29.9, 26.5, 31.5);
  ray(39.1, 29.9, 37.5, 31.5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Canvas texture that redraws once the display face has loaded (canvas text can't wait for it). */
function textTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const paint = () => {
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    t.needsUpdate = true;
  };
  paint();
  document.fonts?.load('700 64px "Archivo Variable"').then(paint, () => {});
  return t;
}

/** Brand name moulded into the plastic under the label. */
function mouldTexture(text, ink) {
  return textTexture(1024, 128, (g, w, h) => {
    let size = 58;
    const font = () => `expanded 760 ${size}px "Archivo Variable", "Archivo", sans-serif`;
    if ("fontStretch" in g) g.fontStretch = "expanded";
    g.letterSpacing = "10px";
    g.font = font();
    size = Math.min(size, Math.floor((size * w * 0.86) / g.measureText(text).width));
    g.font = font();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillText(text, w / 2, h / 2 + 3);
    g.fillStyle = ink;
    g.fillText(text, w / 2, h / 2);
  });
}

/** Label-maker tape, the way unreleased cartridges get marked. */
function tapeTexture(text) {
  return textTexture(1024, 144, (g, w, h) => {
    g.fillStyle = "#23252b";
    g.fillRect(0, 0, w, h);
    const sheen = g.createLinearGradient(0, 0, 0, h);
    sheen.addColorStop(0, "rgba(255,255,255,0.10)");
    sheen.addColorStop(0.45, "rgba(255,255,255,0.02)");
    sheen.addColorStop(1, "rgba(0,0,0,0.18)");
    g.fillStyle = sheen;
    g.fillRect(0, 0, w, h);
    g.font = `condensed 760 84px "Archivo Variable", "Archivo", sans-serif`;
    if ("fontStretch" in g) g.fontStretch = "condensed";
    g.letterSpacing = "10px";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.fillText(text, w / 2 + 2, h / 2 + 5);
    g.fillStyle = "#e9ebef";
    g.fillText(text, w / 2, h / 2 + 3);
  });
}

/**
 * Builds one cartridge. `stencilRef` is written wherever its label window is visible, so the world
 * behind it can be drawn through. Returns the group plus the window mask and an optional print overlay
 * (which lives in a separate overlay scene, drawn last).
 */
export function createCartridge({ body = "#EDF0F6", accent = "#8F99B6", bezel = "#FFC94A", stencilRef = 1, tape = null, print = false, mould = "SATURDAY CARTRIDGE", mouldInk = "#c9cfdc" }) {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(SCALE);
  group.add(inner);

  const plastic = new THREE.MeshStandardMaterial({ color: body, roughness: 0.52, metalness: 0 });
  const trim = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.48, metalness: 0 });
  const yellow = new THREE.MeshStandardMaterial({ color: bezel, roughness: 0.45, metalness: 0 });
  const shape = bodyShape();

  const back = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 5.2, bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.7, bevelSegments: 4, curveSegments: 18 }),
    plastic,
  );
  back.position.z = Z.backFront - 5.9;

  const frontShape = bodyShape();
  frontShape.holes.push(roundRect(LABEL, new THREE.Path()));
  const front = new THREE.Mesh(
    new THREE.ExtrudeGeometry(frontShape, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.7, bevelSegments: 4, curveSegments: 18 }),
    plastic,
  );
  front.position.z = Z.front - 2.2;

  const bezelShape = roundRect({ ...LABEL, x0: LABEL.x0 + 0.05, x1: LABEL.x1 - 0.05, y0: LABEL.y0 + 0.05, y1: LABEL.y1 - 0.05 });
  bezelShape.holes.push(roundRect(WINDOW, new THREE.Path()));
  const bez = new THREE.Mesh(
    new THREE.ExtrudeGeometry(bezelShape, { depth: 1.0, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 3, curveSegments: 14 }),
    yellow,
  );
  bez.position.z = Z.backFront + 0.3;

  const ridgeGeo = new THREE.CapsuleGeometry(0.6, 25, 4, 10);
  ridgeGeo.rotateZ(Math.PI / 2);
  for (const y of [40, 36]) {
    const r = new THREE.Mesh(ridgeGeo, trim);
    r.position.set(0, y, Z.front + 0.1);
    r.scale.z = 0.7;
    inner.add(r);
  }

  const connector = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundRect({ x0: -11, x1: 11, y0: 0.4, y1: 7, r: 1 }), { depth: 3.6, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.4, bevelSegments: 3 }),
    trim,
  );
  connector.position.z = -2.2;

  for (const m of [back, front, bez, connector]) {
    m.castShadow = true;
    m.receiveShadow = true;
    inner.add(m);
  }

  const mask = new THREE.Mesh(
    windowGeometry(),
    new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    }),
  );
  mask.position.z = Z.mask;
  mask.renderOrder = 100;
  inner.add(mask);

  let printMesh = null;
  if (print) {
    printMesh = new THREE.Mesh(
      windowGeometry(),
      new THREE.MeshBasicMaterial({
        map: printTexture(),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        stencilWrite: true,
        stencilRef,
        stencilFunc: THREE.EqualStencilFunc,
      }),
    );
    printMesh.position.z = Z.print;
  }

  if (mould) {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(27, 27 / 8),
      new THREE.MeshStandardMaterial({ map: mouldTexture(mould, mouldInk), transparent: true, roughness: 0.55, depthWrite: false }),
    );
    plate.position.set(0, 8.4, Z.front + 0.02);
    plate.renderOrder = 1;
    inner.add(plate);
  }

  if (tape) {
    const tex = tapeTexture(tape);
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(23, 3.2, 0.12),
      [null, null, null, null, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }), null].map(
        (m) => m ?? new THREE.MeshStandardMaterial({ color: "#23252b", roughness: 0.4 }),
      ),
    );
    strip.position.set(-0.6, 32.1, Z.front + 0.08);
    strip.rotation.z = THREE.MathUtils.degToRad(-2.2);
    strip.castShadow = true;
    inner.add(strip);
  }

  return {
    group,
    inner,
    mask,
    print: printMesh,
    /** world-space corners of the window, for the inside test */
    windowCorners(out = []) {
      inner.updateWorldMatrix(true, false);
      const pts = [
        [WINDOW.x0, WINDOW.y0],
        [WINDOW.x1, WINDOW.y0],
        [WINDOW.x1, WINDOW.y1],
        [WINDOW.x0, WINDOW.y1],
      ];
      pts.forEach(([x, y], i) => (out[i] ??= new THREE.Vector3()).set(x, y, Z.mask).applyMatrix4(inner.matrixWorld));
      return out;
    },
    windowCenter(out = new THREE.Vector3()) {
      inner.updateWorldMatrix(true, false);
      return out.set((WINDOW.x0 + WINDOW.x1) / 2, (WINDOW.y0 + WINDOW.y1) / 2, Z.mask).applyMatrix4(inner.matrixWorld);
    },
    windowSize() {
      return { w: (WINDOW.x1 - WINDOW.x0) * SCALE, h: (WINDOW.y1 - WINDOW.y0) * SCALE };
    },
    /** world-space z of the window plane (cartridges face +Z and are not rotated) */
    get windowZ() {
      return group.position.z + Z.mask * SCALE;
    },
    height: 46 * SCALE,
    width: 39.4 * SCALE,
  };
}
