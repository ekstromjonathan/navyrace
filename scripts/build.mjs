import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const root = process.cwd();

/* Vite resolves paths that start with "/" as URLs from the project root,
 * not as filesystem paths. Docker's WORKDIR /app made
 * path.resolve(cwd, "index.html") === "/app/index.html", which Vite then
 * loaded as app/index.html (the trainer). The landing pass "succeeded"
 * with ~1700 modules and wrote dist/app, assets, favicon.svg, signup —
 * never dist/index.html.
 * Keep these POSIX-relative so the output names are index.html, app/, vilkar/. */
const landing = "index.html";
const appPage = "app/index.html";
const vilkar = "vilkar/index.html";
const workoutPage = "workout/index.html";

for (const file of [landing, appPage, vilkar, workoutPage]) {
  const abs = resolve(root, file);
  if (!existsSync(abs)) {
    console.error(`build: missing HTML entry ${abs}`);
    process.exit(1);
  }
}

let base;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg.startsWith("--base=")) base = arg.slice("--base=".length);
  else if (arg === "--base") base = argv[++i];
}

const viteConfig = {
  configFile: false,
  root,
  appType: "mpa",
  base,
  plugins: [react()],
};

function listDist() {
  const dir = resolve(root, "dist");
  if (!existsSync(dir)) return "(no dist/)";
  return readdirSync(dir).join(", ");
}

console.log(`build: cwd=${root} landing=${landing} (relative; not ${resolve(root, landing)})`);

await build({
  ...viteConfig,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: landing,
    },
  },
});

const landingOut = resolve(root, "dist/index.html");
if (!existsSync(landingOut)) {
  console.error(`build: landing pass did not emit dist/index.html; dist has: ${listDist()}`);
  process.exit(1);
}

const landingHtml = readFileSync(landingOut, "utf8");
if (!/lodd\.ai/i.test(landingHtml) || /\sid=["']root["']/.test(landingHtml)) {
  console.error("build: dist/index.html is not the lodd.ai landing page");
  process.exit(1);
}

await build({
  ...viteConfig,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: [appPage, vilkar, workoutPage],
    },
  },
});

for (const file of ["dist/index.html", "dist/app/index.html", "dist/vilkar/index.html", "dist/workout/index.html"]) {
  if (!existsSync(resolve(root, file))) {
    console.error(`build: missing ${file}; dist has: ${listDist()}`);
    process.exit(1);
  }
}

console.log("build: dist/index.html, dist/app/, dist/vilkar/, dist/workout/ ok");

await import("./sync-pt-dist.mjs");
