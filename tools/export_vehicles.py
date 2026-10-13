"""Export the Everyday Cars FBX models for the website.

Run with Blender 5.x:
  blender -b --factory-startup --python tools/export_vehicles.py -- <models dir> <out dir> [Name ...]

Writes <out>/<Name>.faces.json ([quads, other faces] per LOD), <out>/<Name>.glb (all LODs, wheel pivots, named material slots), <out>/<Name>.lite.glb (LOD1 and
LOD2 only, for background traffic) and <out>/<Name>.wire.bin, the quad edges of every LOD (the GLB only
carries triangles, so its wireframe would show the diagonals).
Run tools/build-models.sh afterwards to compress the GLBs.
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
    """Quad edges per LOD. Wheels keep their own part (local to the wheel pivot) so they can spin;
    everything else merges into the vehicle root."""
    parts = {}
    for ob in objs:
        if ob.type != "MESH":
            continue
        lod = lod_of(ob.name)
        if ob.parent and ob.parent.name.startswith("Wheel_"):
            key, mat = (lod, ob.parent.name), ob.matrix_parent_inverse @ ob.matrix_basis
        else:
            key, mat = (lod, "root"), ob.matrix_world
        verts, edges = parts.setdefault(key, ([], []))
        base = len(verts)
        verts.extend(to_gltf(mat @ v.co) for v in ob.data.vertices)
        edges.extend((base + e.vertices[0], base + e.vertices[1]) for e in ob.data.edges)
    # LOD2 has no separate wheels: they are part of the body mesh
    return parts


def write_wire(parts, path):
    header, blobs, offset = [], [], 0
    for (lod, node), (verts, edges) in sorted(parts.items()):
        lo = [min(v[i] for v in verts) for i in range(3)]
        hi = [max(v[i] for v in verts) for i in range(3)]
        scale = [(hi[i] - lo[i]) / 65535.0 or 1.0 for i in range(3)]
        pos = bytearray()
        for v in verts:
            pos += struct.pack("<3H", *(round((v[i] - lo[i]) / scale[i]) for i in range(3)))
        pos += b"\0" * (-len(pos) % 4)
        wide = len(verts) > 65535
        idx = struct.pack(f"<{len(edges) * 2}{'I' if wide else 'H'}", *(i for e in edges for i in e))
        idx += b"\0" * (-len(idx) % 4)
        header.append({"lod": lod, "node": node, "vertices": len(verts), "edges": len(edges),
                       "min": lo, "scale": scale, "positions": offset, "indices": offset + len(pos),
                       "wide": wide})
        blobs += [pos, idx]
        offset += len(pos) + len(idx)
    head = json.dumps(header, separators=(",", ":")).encode()
    head += b" " * (-len(head) % 4)
    with open(path, "wb") as f:
        f.write(b"WIRE" + struct.pack("<I", len(head)) + head + b"".join(blobs))


def export(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
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
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.view_layer.update()

    write_wire(wire_parts(objs), os.path.join(out, name + ".wire.bin"))
    faces = [[0, 0] for _ in range(3)]
    for ob in objs:
        if ob.type == "MESH":
            f = faces[lod_of(ob.name)]
            for poly in ob.data.polygons:
                f[0 if len(poly.vertices) == 4 else 1] += 1
    with open(os.path.join(out, name + ".faces.json"), "w") as fp:
        json.dump(faces, fp)
    export(os.path.join(out, name + ".glb"))
    for ob in objs:
        if ob.type == "MESH" and (ob.name.endswith("_LOD0") or ob.name == "SteeringWheel"):
            bpy.data.objects.remove(ob)
    export(os.path.join(out, name + ".lite.glb"))
    print("exported", name)
