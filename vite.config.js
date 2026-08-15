import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* Prefer cwd so Docker (/app) and local both resolve the MPA pages. */
const pages = {
  landing: resolve(process.cwd(), "index.html"),
  app: resolve(process.cwd(), "app/index.html"),
  vilkar: resolve(process.cwd(), "vilkar/index.html"),
};

for (const [name, file] of Object.entries(pages)) {
  if (!existsSync(file)) {
    throw new Error(`vite.config: missing ${name} page at ${file}`);
  }
}

export default defineConfig({
  appType: "mpa",
  plugins: [react()],
  server: {
    host: true,
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 8080,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: pages,
    },
  },
});
