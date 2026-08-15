import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* Dev: HTML files at /, /app/, /vilkar/ are served as an MPA.
 * Production entries are chosen in scripts/build.mjs — do not set a named
 * rollup input object here. Docker dropped dist/index.html when the landing
 * was keyed as "main" / "landing" instead of Vite's default index.html entry. */
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
});
