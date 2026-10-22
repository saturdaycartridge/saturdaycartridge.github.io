# saturdaycartridge.github.io

Website for Saturday Cartridge. Built with [Astro](https://astro.build) and [three.js](https://threejs.org) and
published to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main` (Settings > Pages > Source
must be "GitHub Actions").

```
npm install
npm run dev        # http://localhost:8742
npm run build      # static site in dist/
```

## Pages

- `src/pages/index.astro` - home: the wordmark, the pack index and pack cards
- `src/pages/packs/everyday-cars/` - the Everyday Cars showroom (three.js) and pack details
- `src/pages/packs/helicopters/` - the RotorTrail Helicopter Pack: hangar viewer, paint schemes, specs (coming soon)
- `src/pages/contact.astro` - support, served at `/contact.html` (the address the Asset Store profile links to)
- `src/pages/404.astro`

## Look and interactions

A minimal sheet: paper, ink, hairlines, one amber signal colour, and Archivo's width axis for display type
(`src/styles/global.css`). `src/scripts/micro.js` holds the small interactions every page can opt into with a
data attribute: `data-reveal`, `data-count`, `data-scramble`, `data-magnetic`, `data-tilt`, `data-cursor`,
`data-preview`, `data-wordmark`, `data-clock` and `data-copy` (each is described at the top of the file). They
respect `prefers-reduced-motion` and switch off the pointer effects on touch screens.

## Adding a pack

Add it to `src/data/packs.js`; the home page index and cards read from there. A pack without `href` shows as a
quiet row (in the workshop).

## Helicopter Pack images and data

The hangar viewer is real-time 3D where WebGL 2 works (see Models below); the Unity captures are its
fallback and the paint-scheme and gallery images. They come from the Helicopter Pack project (`Helicopter Pack` next to this pack's
folder; `HELI=<path>` points elsewhere). After re-capturing there (`Source/unity.sh HelicopterPackTools.Builder.Capture`
and `CaptureStore`):

```
python3 tools/helicopter_data.py      # src/data/helicopters.json: names, triangles, sizes
bash tools/helicopter-images.sh       # public/assets/img/helicopters/*.webp and og.jpg
```

Aircraft ids are the pack's prefab names (generic roles such as `RescueTwin`); titles and one-line descriptions
are in `tools/helicopter_data.py`.

## 3D

- `src/three/showroom.js` - the Everyday Cars viewer
- `src/three/vehicle.js`, `materials.js` - load the vehicles and dress them in the pack's own materials
  (colours mirror `Assets/_PackTools/Editor/PackMaterials.cs` and `PackConfig.cs` in the pack project)
- `src/three/hangar3d.js` - the Helicopter Pack viewer, started by `src/scripts/hangar.js` when the hangar
  nears the screen; its studio matches the pack's captures (`HelicopterPackScenes.cs`)
- `src/three/helicopter.js` - one aircraft: lite file first, LOD0 grafted in on request, rotors and blur discs
  as in `HelicopterRotors.cs`, quad wireframe
- `src/three/rotortrail.js` - three.js ports of the pack's URP shaders (paint, surface, glass, emissive,
  rotor disc), fed by the material values the packer stores in each GLB

## Models

`public/models/everyday-cars/` holds gzipped, meshopt-compressed GLBs (all LODs, and a `.lite` LOD1/LOD2
version for traffic) and the quad edges of every LOD for the wireframe views. Rebuild them from the pack's
FBX files with Blender 5.x on your PATH:

```
npm run models                  # every vehicle
npm run models -- Sedan Van     # some of them
```

`MODELS=<path>` points at a different Models folder; the default is the pack project this folder sits in.
`src/data/everyday-cars.json` (titles, triangle and quad counts, sizes) comes from the pack's
`Source/build/meta` files.

`public/models/helicopters/` holds, per aircraft, `<id>.lite.glb.gz` (LOD1 and LOD2, loaded first),
`<id>.lod0.glb.gz` (loaded when someone picks LOD0) and the quad edges of each for the wireframe. The meshes
keep the airframe coordinates (the pack's UV2/UV3) that the paint shader draws in, and each material carries
its values from the pack's `Source/build/materials.json`. Rebuild them, and the face counts and pilot eye
points in `src/data/helicopters.json`, from the pack's FBX files (Blender 5.x):

```
npm run helicopters                      # every aircraft
npm run helicopters -- RescueTwin        # some of them
```
