import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://saturdaycartridge.github.io",
  // contact.astro -> /contact.html: the Asset Store publisher profile links to that address
  build: { format: "preserve" },
  trailingSlash: "ignore",
  devToolbar: { enabled: false },
});
