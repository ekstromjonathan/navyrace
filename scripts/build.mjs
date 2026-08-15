import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const root = process.cwd();
const landing = resolve(root, "index.html");
const app = resolve(root, "app/index.html");
const vilkar = resolve(root, "vilkar/index.html");

for (const file of [landing, app, vilkar]) {
  if (!existsSync(file)) {
    console.error(`build: missing HTML entry ${file}`);
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

/* Pass 1 is intentionally isolated from vite.config.js. Railway previously
 * merged the named MPA config into this call and omitted the root HTML page.
 * A single string entry rooted at the repo always emits dist/index.html. */
await build({
  ...viteConfig,
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: landing,
    },
  },
});

if (!existsSync(resolve(root, "dist/index.html"))) {
  const listing = existsSync(resolve(root, "dist"))
    ? readdirSync(resolve(root, "dist")).join(", ")
    : "(no dist/)";
  console.error(`build: landing pass did not emit dist/index.html; dist has: ${listing}`);
  process.exit(1);
}

/* Pass 2: trainer + terms, keep the landing files. */
await build({
  ...viteConfig,
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: false,
    rollupOptions: {
      input: [app, vilkar],
    },
  },
});

for (const file of ["dist/index.html", "dist/app/index.html", "dist/vilkar/index.html"]) {
  if (!existsSync(resolve(root, file))) {
    console.error(`build: missing ${file}`);
    process.exit(1);
  }
}

console.log("build: dist/index.html, dist/app/, dist/vilkar/ ok");

await import("./sync-pt-dist.mjs");
