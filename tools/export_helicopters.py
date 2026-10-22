"""Export the Helicopter Pack FBX models for the website.

Run with Blender 5.x:
  blender -b --factory-startup --python tools/export_helicopters.py -- <models dir> <out dir> [Name ...]

Per aircraft, in <out>:
  <Name>.lite.glb       LOD1 and LOD2 with the whole node tree (rotors, sockets), shown first
  <Name>.lod0.glb       LOD0 meshes under the same node names, grafted into the lite tree on demand
  <Name>.lite.wire.bin  quad edges of LOD1 and LOD2 (the GLB only carries triangles)
  <Name>.lod0.wire.bin  quad edges of LOD0
  <Name>.meta.json      sockets and quad/other face counts per LOD
The meshes keep UV0 (cockpit dial artwork) and the airframe coordinates in UV2/UV3 that the paint shaders
read; tools/pack_helicopters.mjs folds those into one attribute and compresses the files.
"""
import json
import os
import struct
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
src, out = args[0], args[1]
names = args[2:] or sorted(f[:-4] for f in os.listdir(src) if f.endswith(".fbx"))
os.makedirs(out, exist_ok=True)


def to_gltf(v):
    """Blender Z-up -> glTF Y-up, the conversion the glTF exporter applies."""
    return (v[0], v[2], -v[1])


def lod_of(name):
    return int(name[-1]) if "_LOD" in name else 0


def wire_parts(objs):
    """Quad edges per LOD, in the space of each mesh's parent node (which the viewer looks up by name)."""
    parts = {}
    for ob in objs:
        if ob.type != "MESH":
            continue
        key = (lod_of(ob.name), ob.parent.name if ob.parent else "")
        mat = ob.matrix_local if ob.parent else ob.matrix_world
        verts, edges = parts.setdefault(key, ([], []))
        base = len(verts)
        verts.extend(to_gltf(mat @ v.co) for v in ob.data.vertices)
        edges.extend((base + e.vertices[0], base + e.vertices[1]) for e in ob.data.edges)
    return parts


def varints(values):
    """Unsigned LEB128."""
    out = bytearray()
    for v in values:
        while v > 0x7F:
            out.append(v & 0x7F | 0x80)
            v >>= 7
        out.append(v)
    return out


def zigzag(v):
    return v * 2 if v >= 0 else -v * 2 - 1


def write_wire(parts, path):
    """WIRE2: per part, positions quantized to 16 bits and stored as zigzag deltas, then edges sorted
    by first vertex, stored as (delta of first vertex, zigzag of second minus first); all LEB128 varints.
    Close vertices and edges keep the numbers small, so this compresses far better than raw indices."""
    header, blobs, offset = [], [], 0
    for (lod, node), (verts, edges) in sorted(parts.items()):
        lo = [min(v[i] for v in verts) for i in range(3)]
        hi = [max(v[i] for v in verts) for i in range(3)]
        scale = [(hi[i] - lo[i]) / 65535.0 or 1.0 for i in range(3)]
        prev = [0, 0, 0]
        nums = []
        for v in verts:
            q = [round((v[i] - lo[i]) / scale[i]) for i in range(3)]
            nums += [zigzag(q[i] - prev[i]) for i in range(3)]
            prev = q
        pos = varints(nums)
        pairs = sorted({(min(a, b), max(a, b)) for a, b in edges})
        nums, last = [], 0
        for a, b in pairs:
            nums += [a - last, zigzag(b - a)]
            last = a
        idx = varints(nums)
        header.append({"lod": lod, "node": node, "vertices": len(verts), "edges": len(pairs),
                       "min": lo, "scale": scale, "positions": offset, "indices": offset + len(pos)})
        blobs += [pos, idx]
        offset += len(pos) + len(idx)
    head = json.dumps(header, separators=(",", ":")).encode()
    head += b" " * (-len(head) % 4)
    with open(path, "wb") as f:
        f.write(b"WIR2" + struct.pack("<I", len(head)) + head + b"".join(blobs))


def export(path, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_vertex_color="NONE",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
    )


for name in names:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(src, name + ".fbx"))
    objs = list(bpy.data.objects)
    bpy.context.view_layer.update()

    # Unity's lightmap UVs are of no use here; drop them so UV0, AirframeXZ, AirframeY become TEXCOORD_0..2
    for me in bpy.data.meshes:
        layer = me.uv_layers.get("UVLightmap")
        if layer:
            me.uv_layers.remove(layer)
        names_now = [u.name for u in me.uv_layers]
        if names_now != ["UVMap", "AirframeXZ", "AirframeY"]:
            raise RuntimeError(f"{name}/{me.name}: unexpected UV layers {names_now}")

    meshes = [o for o in objs if o.type == "MESH"]
    empties = [o for o in objs if o.type != "MESH"]
    lite = [o for o in meshes if lod_of(o.name) > 0]
    lod0 = [o for o in meshes if lod_of(o.name) == 0]

    parts = wire_parts(objs)
    write_wire({k: v for k, v in parts.items() if k[0] > 0}, os.path.join(out, name + ".lite.wire.bin"))
    write_wire({k: v for k, v in parts.items() if k[0] == 0}, os.path.join(out, name + ".lod0.wire.bin"))

    faces = [[0, 0] for _ in range(3)]
    for ob in meshes:
        f = faces[lod_of(ob.name)]
        for poly in ob.data.polygons:
            f[0 if len(poly.vertices) == 4 else 1] += 1
    sockets = {o.name[len("Socket_"):]: [round(c, 4) for c in to_gltf(o.matrix_world.translation)]
               for o in empties if o.name.startswith("Socket_")}
    with open(os.path.join(out, name + ".meta.json"), "w") as fp:
        json.dump({"faces": faces, "sockets": sockets}, fp)

    export(os.path.join(out, name + ".lite.glb"), empties + lite)
    export(os.path.join(out, name + ".lod0.glb"), empties + lod0)
    print("exported", name)
