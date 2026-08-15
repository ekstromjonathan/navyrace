import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = dirname(fileURLToPath(import.meta.url));

const pages = {
  landing: resolve(root, "index.html"),
  app: resolve(root, "app/index.html"),
  vilkar: resolve(root, "vilkar/index.html"),
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
