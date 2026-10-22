// Compress the Blender exports of the Helicopter Pack for the web (run by tools/build-helicopters.sh).
//   node tools/pack_helicopters.mjs <materials.json> <in.glb> <out.glb>
//
// The paint shaders draw in each part's airframe coordinates, which the pack carries in UV2 (x, z) and
// UV3 (y). Here they become one int16 attribute, _AIRFRAME, in millimetres (glTF flips V, so z = 1 - v).
// The material values from the pack's materials.json go into each material's extras.
// UV0 only matters for the cockpit dial and display artwork, so other primitives lose it.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import { readFileSync } from "node:fs";

const [materialsPath, input, output] = process.argv.slice(2);
const entries = new Map(JSON.parse(readFileSync(materialsPath, "utf8")).materials.map((m) => [m.name, m]));
const kinds = new Map([...entries].map(([k, m]) => [k, m.kind]));
const round = (v) => Math.round(v * 1e5) / 1e5;
const TEXTURED = new Set(["Instrument", "Display"]);
const MM = 1000;

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(input);
doc.setLogger({ debug() {}, info() {}, warn() {}, error: console.error });

const folded = new Map();
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? "";
    if (!kinds.has(name)) throw new Error(`${input}: no material entry for "${name}"`);
    const xz = prim.getAttribute("TEXCOORD_1");
    const y = prim.getAttribute("TEXCOORD_2");
    if (!xz || !y) throw new Error(`${input}: ${mesh.getName()} has no airframe UVs`);
    if (!folded.has(xz)) {
      const a = xz.getArray();
      const b = y.getArray();
      const n = xz.getCount();
      const out = new Int16Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = [a[i * 2], b[i * 2], 1 - a[i * 2 + 1]];
        for (let k = 0; k < 3; k++) {
          const q = Math.round(v[k] * MM);
          if (q < -32767 || q > 32767) throw new Error(`${input}: airframe coordinate ${v[k]} out of range`);
          out[i * 3 + k] = q;
        }
      }
      folded.set(xz, doc.createAccessor().setType("VEC3").setArray(out).setBuffer(xz.getBuffer()));
    }
    prim.setAttribute("_AIRFRAME", folded.get(xz));
    prim.setAttribute("TEXCOORD_1", null);
    prim.setAttribute("TEXCOORD_2", null);
    if (!TEXTURED.has(kinds.get(name))) prim.setAttribute("TEXCOORD_0", null);
  }
}

// The pack's material values (linear colours, shader scalars) ride along in each material's extras,
// which three.js hands over as material.userData.
for (const mat of doc.getRoot().listMaterials()) {
  const e = entries.get(mat.getName());
  if (!e) continue;
  const rt = { kind: e.kind };
  for (const v of e.vectors) rt[v.key] = v.value.slice(0, 3).map(round);
  for (const v of e.scalars) rt[v.key] = round(v.value);
  mat.setExtras({ rt });
}

await doc.transform(prune({ keepAttributes: true, keepLeaves: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: "high" }));
await io.write(output, doc);
