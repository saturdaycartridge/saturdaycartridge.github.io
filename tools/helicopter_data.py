"""Write src/data/helicopters.json from the Helicopter Pack project.

    python3 tools/helicopter_data.py            # HELI=<path> points at another pack project

Reads Source/build/catalog.json (sizes, blade counts) and the pack's Documentation/UnityTriangleCounts.md
(triangles as Unity imports them). The ids are the pack's prefab names, generic roles like the titles.
"""
import json, os, re
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
    out = []
    for key, title, cls, line in ROSTER:
        a = catalog[key]
        length, width, height = (round(v, 2) for v in a['bodySize'])
        out.append(dict(id=key, title=title, cls=cls, line=line, tris=tris[key], length=length, width=width, height=height,
                        materials=len(a['materials'])))
    OUT.write_text(json.dumps(out, indent=1) + '\n')
    print(f'{len(out)} helicopters -> {OUT}')


if __name__ == '__main__':
    main()
