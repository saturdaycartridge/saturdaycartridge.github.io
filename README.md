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

- `src/pages/index.astro` - home: the cartridge, the dive through its label, and the shelf of packs
- `src/pages/packs/everyday-cars/` - the Everyday Cars showroom and pack details
- `src/pages/contact.astro` - support, served at `/contact.html` (the address the Asset Store profile links to)
- `src/pages/404.astro`

## Adding a pack

Add it to `src/data/packs.js`; the shelf captions read from there. A pack still in the workshop shows on a grey
cartridge with label-maker tape (`tape`). Giving a released pack its own cartridge world means adding a scene
like `src/three/roadworld.js` and wiring it into `src/three/story.js`.

## 3D

- `src/three/story.js` - the home page: one sticky canvas, scrubbed by scroll. Each cartridge label is a
  stencil portal into its own scene (`roadworld.js`, `workshop.js`), drawn through the label window.
- `src/three/showroom.js` - the pack page viewer
- `src/three/vehicle.js`, `materials.js` - load the vehicles and dress them in the pack's own materials
  (colours mirror `Assets/_PackTools/Editor/PackMaterials.cs` and `PackConfig.cs` in the pack project)

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
