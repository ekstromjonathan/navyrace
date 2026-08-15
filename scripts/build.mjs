import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
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

const inline = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg.startsWith("--base=")) inline.base = arg.slice("--base=".length);
  else if (arg === "--base") inline.base = argv[++i];
}

/* Pass 1: default Vite HTML entry (a string, not { landing: ... }).
 * This is what actually writes dist/index.html. */
await build({
  ...inline,
  build: {
    emptyOutDir: true,
    rollupOptions: { input: landing },
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
  ...inline,
  build: {
    emptyOutDir: false,
    rollupOptions: { input: [app, vilkar] },
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
