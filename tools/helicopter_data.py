"""Write src/data/helicopters.json from the Helicopter Pack project.

    python3 tools/helicopter_data.py [meta dir]   # HELI=<path> points at another pack project

Reads Source/build/catalog.json (sizes, rotor direction) and the pack's Documentation/UnityTriangleCounts.md
(triangles as Unity imports them). With the meta dir written by tools/export_helicopters.py (run through
tools/build-helicopters.sh) it also adds quad and other face counts per LOD and the pilot's eye point,
which the 3D viewer uses; without it those fields are kept from the current file. The ids are the pack's prefab names, generic roles like the titles.
"""
import json, os, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HELI = Path(os.environ.get('HELI', HERE.parents[2] / 'Helicopter Pack'))
OUT = HERE.parent / 'src/data/helicopters.json'

# id -> (display name, class, one line). Order is the order on the site.
ROSTER = [
    ('RescueTwin', 'Rescue Twin', 'Civil', 'A light twin in rescue red under white, with a hoist and a five-blade rotor.'),
    ('LightUtility', 'Light Utility', 'Civil', 'A compact five-blade utility helicopter in white with a teal belly band.'),
    ('Firefighter', 'Firefighter', 'Civil', 'The utility airframe in gloss fire red over white, with a belly water tank.'),
    ('UtilityTransport', 'Utility Transport', 'Utility', 'A medium utility helicopter in flat dark green, with door guns.'),
    ('MaritimePatrol', 'Maritime Patrol', 'Utility', 'The naval variant in light ghost grey, with a radome and a torpedo.'),
    ('HeavyLift', 'Heavy Lift', 'Utility', 'A tandem-rotor heavy lifter in olive drab, its rotors turning in opposite directions.'),
    ('LightScout', 'Light Scout', 'Attack', 'The light observation airframe in matte black, armed with rocket pods and miniguns.'),
    ('TandemGunship', 'Tandem Gunship', 'Attack', 'A tandem-seat attack helicopter with a chin gun, sensor turret and stub wings.'),
    ('TandemGunshipII', 'Tandem Gunship II', 'Attack', 'The newer, darker gunship with a mast-mounted radome above the rotor.'),
    ('TwinAttack', 'Twin Attack', 'Attack', 'A narrow twin-engine attack helicopter in gunship grey with a four-blade rotor.'),
    ('EscortAttack', 'Escort Attack', 'Attack', 'A compact escort helicopter in two-tone green-grey camouflage with a roof sight.'),
    ('AssaultGunship', 'Assault Gunship', 'Attack', 'A heavy assault gunship in desert camouflage over a pale belly, with a chin gun.'),
]


def imported_tris():
    text = (HELI / 'Assets/RotorTrail - Helicopter Pack/Documentation/UnityTriangleCounts.md').read_text()
    rows = {}
    for line in text.splitlines():
        m = re.match(r'\|\s*(\w+)\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|', line)
        if m: rows[m.group(1)] = [int(m.group(i).replace(',', '')) for i in (2, 3, 4)]
    return rows


def main():
    catalog = {a['name']: a for a in json.loads((HELI / 'Source/build/catalog.json').read_text())['aircraft']}
    tris = imported_tris()
    meta_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    current = {h['id']: h for h in json.loads(OUT.read_text())} if OUT.exists() else {}
    out = []
    for key, title, cls, line in ROSTER:
        a = catalog[key]
        length, width, height = (round(v, 2) for v in a['bodySize'])
        h = dict(id=key, title=title, cls=cls, line=line, tris=tris[key], length=length, width=width, height=height,
                 materials=len(a['materials']), clockwise=a['clockwise'])
        meta_file = meta_dir / f'{key}.meta.json' if meta_dir else None
        if meta_file and meta_file.exists():
            meta = json.loads(meta_file.read_text())
            h['faces'] = meta['faces']
            sockets = meta['sockets']
            h['eye'] = sockets.get('pilot_eye') or sockets.get('gunner_eye')
        else:
            for k in ('faces', 'eye'):
                if k in current.get(key, {}): h[k] = current[key][k]
        out.append(h)
    OUT.write_text(json.dumps(out, indent=1) + '\n')
    print(f'{len(out)} helicopters -> {OUT}')


if __name__ == '__main__':
    main()
