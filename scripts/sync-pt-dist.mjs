import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, "dist");
const to = join(root, "pt", "dist");
const landing = join(from, "index.html");

if (!existsSync(landing)) {
  let listing = "(dist missing)";
  try {
    listing = readdirSync(from, { withFileTypes: true })
      .map((d) => `${d.isDirectory() ? "dir" : "file"} ${d.name}`)
      .join("\n");
  } catch {
    /* ignore */
  }
  console.error("sync-pt-dist: missing dist/index.html — run vite build first");
  console.error(`sync-pt-dist: dist listing:\n${listing}`);
  process.exit(1);
}

rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("sync-pt-dist: copied dist → pt/dist");
