import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function moduleDir(importMetaUrl: string): string {
  return path.dirname(fileURLToPath(importMetaUrl));
}

export function findPackageRoot(start = moduleDir(import.meta.url)): string {
  let current = start;
  while (true) {
    if (
      fs.existsSync(path.join(current, "package.json")) &&
      fs.existsSync(path.join(current, "micro_mission_coder_specs"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not locate microcoder package root from ${start}`);
    }
    current = parent;
  }
}

export function resolveFromCwd(cwd: string, maybeRelative: string): string {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.join(cwd, maybeRelative);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
