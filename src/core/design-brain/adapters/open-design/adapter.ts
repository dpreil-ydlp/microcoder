import fs from "node:fs";
import path from "node:path";
import type { MmcConfig } from "../../../config/defaults.js";
import { missionDir } from "../../../storage/sqlite.js";
import { shouldIgnoreWorkspaceEntry } from "../../../utils/ignore.js";

export type OpenDesignAsset = {
  kind: "skill" | "design_system" | "template" | "artifact";
  name: string;
  path: string;
  excerpt: string;
};

export type OpenDesignSelection = {
  enabled: boolean;
  selected_system: string | null;
  selected_skills: string[];
  selected_template: string | null;
  brief_id: string | null;
  assets: OpenDesignAsset[];
};

export function detectOpenDesign(cwd: string): string | null {
  const candidates = [
    path.join(cwd, "open-design"),
    path.join(cwd, "vendor", "open-design"),
    path.join(cwd, "node_modules", "open-design"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function indexOpenDesignAssets(root: string): OpenDesignAsset[] {
  const assets: OpenDesignAsset[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldIgnoreWorkspaceEntry(entry.name)) walk(abs);
        continue;
      }
      if (shouldIgnoreWorkspaceEntry(entry.name)) continue;
      if (!entry.isFile() || !/\.(md|mdx|json|ya?ml)$/i.test(entry.name)) continue;
      const rel = path.relative(root, abs);
      const kind = classifyAsset(rel);
      assets.push({
        kind,
        name: path.basename(entry.name, path.extname(entry.name)),
        path: rel,
        excerpt: fs.readFileSync(abs, "utf8").slice(0, 900),
      });
    }
  };
  walk(root);
  return assets;
}

export function selectOpenDesignAssets(cwd: string, config: MmcConfig, taskText: string): OpenDesignSelection {
  const root = detectOpenDesign(cwd);
  if (!root || config.design.open_design.enabled === false) {
    return {
      enabled: false,
      selected_system: null,
      selected_skills: [],
      selected_template: null,
      brief_id: null,
      assets: [],
    };
  }
  const words = new Set(taskText.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
  const assets = indexOpenDesignAssets(root)
    .map((asset) => ({ asset, score: [...words].filter((word) => `${asset.name} ${asset.path}`.toLowerCase().includes(word)).length }))
    .sort((a, b) => b.score - a.score || a.asset.path.localeCompare(b.asset.path))
    .map((entry) => entry.asset);
  const system = assets.find((asset) => asset.kind === "design_system") ?? null;
  const template = assets.find((asset) => asset.kind === "template") ?? null;
  const skills = assets
    .filter((asset) => asset.kind === "skill")
    .slice(0, Math.max(1, Math.min(3, config.design.open_design.max_selected_skills)));
  const brief_id = `open-design-${Date.now()}`;
  const selected = [system, template, ...skills].filter((asset): asset is OpenDesignAsset => asset !== null);
  const target = path.join(missionDir(cwd, config), "design", `${brief_id}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify({ root, assets: selected }, null, 2)}\n`, "utf8");
  return {
    enabled: true,
    selected_system: system?.name ?? null,
    selected_skills: skills.map((skill) => skill.name),
    selected_template: template?.name ?? null,
    brief_id,
    assets: selected,
  };
}

function classifyAsset(rel: string): OpenDesignAsset["kind"] {
  if (/skill/i.test(rel)) return "skill";
  if (/design[-_ ]?system|system/i.test(rel)) return "design_system";
  if (/template/i.test(rel)) return "template";
  return "artifact";
}
