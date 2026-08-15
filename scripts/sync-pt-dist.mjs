import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, "dist");
const to = join(root, "pt", "dist");

if (!existsSync(join(from, "index.html"))) {
  console.error("sync-pt-dist: missing dist/index.html — run vite build first");
  process.exit(1);
}

rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("sync-pt-dist: copied dist → pt/dist");
