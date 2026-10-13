import * as THREE from "three";
import { MaterialSet } from "./materials.js";

// What you see through the label of a cartridge that is still in the workshop: a greybox blockout
// turning on a stand, on an editor-style grid. Deliberately unfinished.

function gridTexture() {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.fillStyle = "#4a4f59";
  g.fillRect(0, 0, s, s);
  g.strokeStyle = "rgba(170,176,190,0.18)";
  g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * s;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, s);
    g.moveTo(0, p);
    g.lineTo(s, p);
    g.stroke();
  }
  g.strokeStyle = "rgba(190,196,210,0.38)";
  g.lineWidth = 4;
  g.strokeRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function lumpy(radius, detail, seed) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const k =
      Math.sin(n.x * 3.1 + seed) * 0.12 +
      Math.sin(n.y * 4.3 + seed * 2) * 0.1 +
      Math.sin((n.z + n.x) * 5.7 + seed * 3) * 0.06 +
      (n.y > 0.55 ? -0.18 * (n.y - 0.55) : 0);
    v.addScaledVector(n, k * radius);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Workshop {
  constructor({ stencilRef, portal, kind = "kit" }) {
    this.scene = new THREE.Scene();
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.mats = new MaterialSet({ stencilRef, planes: [portal] });
    const M = (o) => this.mats.configure(new THREE.MeshStandardMaterial(o));

    const back = new THREE.Mesh(
      new THREE.SphereGeometry(400, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying float vY;
          void main() {
            vY = normalize(position).y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying float vY;
          void main() {
            vec3 a = vec3(0.075, 0.083, 0.10);
            vec3 b = vec3(0.028, 0.032, 0.042);
            gl_FragColor = vec4(mix(a, b, smoothstep(0.0, 0.6, vY)), 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    const bm = back.material;
    bm.stencilWrite = true;
    bm.stencilRef = stencilRef;
    bm.stencilFunc = THREE.EqualStencilFunc;
    back.renderOrder = -10;
    this.root.add(back);

    const tex = gridTexture();
    tex.repeat.set(40, 40);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), M({ map: tex, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.root.add(floor);
    this.scene.fog = new THREE.Fog("#4c525e", 40, 120);

    const stand = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.9, 0.5, 40), M({ color: "#6d727c", roughness: 0.6 }));
    stand.position.y = 0.25;
    stand.receiveShadow = stand.castShadow = true;
    this.root.add(stand);

    this.turn = new THREE.Group();
    this.turn.position.y = 0.5;
    this.root.add(this.turn);
    const grey = M({ color: "#cfd2d8", roughness: 0.85 });
    const edges = this.mats.configure(new THREE.LineBasicMaterial({ color: "#2b2f38", transparent: true, opacity: 0.7 }));
    const block = (w, h, d, x, y, z, ry = 0) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, grey);
      mesh.position.set(x, y + h / 2, z);
      mesh.rotation.y = ry;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edges));
      this.turn.add(mesh);
      return mesh;
    };

    if (kind === "kit") {
      // a modular corner: wall pieces, a doorway, steps and a column
      block(6, 4.2, 0.6, 0, 0, -2.4);
      block(0.6, 4.2, 4.2, -2.7, 0, -0.6);
      block(1.6, 0.5, 2.2, 1.2, 0, 0.9);
      block(1.6, 0.5, 1.4, 1.2, 0.5, 0.5);
      block(1.6, 0.5, 0.7, 1.2, 1.0, 0.15);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 4.2, 10), grey);
      col.position.set(-1.2, 2.1, 1.5);
      col.castShadow = true;
      col.add(new THREE.LineSegments(new THREE.EdgesGeometry(col.geometry, 30), edges));
      this.turn.add(col);
      block(6.4, 0.4, 4.8, -0.1, 4.2, -0.4);
    } else {
      // a sculpt in progress: one smooth lump, one still faceted
      const clay = M({ color: "#d8cfc4", roughness: 0.62 });
      const a = new THREE.Mesh(lumpy(1.9, 5, 1.3), clay);
      a.position.set(-0.6, 2.2, 0);
      a.scale.set(1, 1.15, 0.9);
      a.castShadow = true;
      const b = new THREE.Mesh(lumpy(1.15, 1, 4.1), M({ color: "#c2c5cc", roughness: 0.85, flatShading: true }));
      b.position.set(1.9, 1.15, 0.8);
      b.castShadow = true;
      b.add(new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry, 1), edges));
      this.turn.add(a, b);
    }

    this.scene.add(new THREE.HemisphereLight("#dfe4ef", "#3a3e47", 1.1));
    const key = new THREE.DirectionalLight("#fff3e2", 2.6);
    key.position.set(-8, 14, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    const c = key.shadow.camera;
    c.left = c.bottom = -7;
    c.right = c.top = 7;
    key.shadow.radius = 4;
    this.root.add(key, key.target);
  }

  update(dt, motion = 1) {
    this.turn.rotation.y += dt * 0.35 * motion;
  }
}
