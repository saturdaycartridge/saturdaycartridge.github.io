"""Writes src/data/everyday-cars.json from the pack's build metadata and the face counts that
tools/export_vehicles.py records. Run by tools/build-models.sh."""
import json
import os
import sys

meta_dir, faces_dir, out = sys.argv[1:4]

# showroom order, and each vehicle's paint in the pack's line-up shots (PackScenes.Hero)
ORDER = [
    ("Hatchback", "Yellow"), ("Sedan", "Navy"), ("Wagon", "Green"), ("Crossover", "Orange"), ("SUV", "Graphite"),
    ("Minivan", "Sand"), ("Pickup", "Silver"), ("Truck", "Black"), ("Coupe", "Red"), ("SportsGT", "Blue"),
    ("Supercar", "Lime"), ("Van", "White"), ("SemiTruck", "Red"), ("SemiTrailer", "White"),
]

previous = {}
if os.path.exists(out):
    previous = {v["id"]: v for v in json.load(open(out))}

data = []
for vid, paint in ORDER:
    m = json.load(open(os.path.join(meta_dir, vid + ".json")))
    faces_path = os.path.join(faces_dir, vid + ".faces.json")
    faces = json.load(open(faces_path)) if os.path.exists(faces_path) else previous.get(vid, {}).get("faces")
    v = {
        "id": vid,
        "title": m["title"],
        "tris": [m["tris_lod0"], m["tris_lod1"], m["tris_lod2"]],
        "length": round(m["length"], 2),
        "width": round(m["width"], 2),
        "height": round(m["height"], 2),
        "wheelRadius": m["wheel_radius"],
        "paint": paint,
    }
    if m.get("hitch_x"):
        v["hitch"] = m["hitch_x"]
    if m.get("kingpin_x"):
        v["kingpin"] = m["kingpin_x"]
    v["faces"] = faces
    data.append(v)

with open(out, "w") as fp:
    json.dump(data, fp, indent=1)
print("wrote", out)
