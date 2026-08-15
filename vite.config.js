import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* Dev: HTML files at /, /app/, /vilkar/ are served as an MPA.
 * Production entries are chosen in scripts/build.mjs as relative paths.
 * Do not pass absolute /app/index.html into Vite — Docker WORKDIR /app
 * made that resolve to the trainer page, so dist/index.html was never written. */
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
