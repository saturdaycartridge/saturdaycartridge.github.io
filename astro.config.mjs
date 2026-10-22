import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://saturdaycartridge.github.io",
  // contact.astro -> /contact.html: the Asset Store publisher profile links to that address
  build: { format: "preserve" },
  trailingSlash: "ignore",
  devToolbar: { enabled: false },
  vite: {
    // Pre-bundle every three.js module the viewers use when the dev server starts. Otherwise Vite finds them
    // page by page (the helicopter viewer is a dynamic import), re-bundles, and a page already holding the
    // old bundle gets "504 Outdated Optimize Dep" and no 3D.
    optimizeDeps: {
      include: [
        "three",
        "three/addons/controls/OrbitControls.js",
        "three/addons/environments/RoomEnvironment.js",
        "three/addons/libs/meshopt_decoder.module.js",
        "three/addons/loaders/GLTFLoader.js",
      ],
    },
  },
});
