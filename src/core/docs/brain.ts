import fs from "node:fs";
import path from "node:path";
import type { MmcConfig } from "../config/defaults.js";
import type { RuntimeTask } from "../spec/compiler.js";
import { shouldIgnoreWorkspaceEntry } from "../utils/ignore.js";
import { buildWebResearchQuery, runWebSearch, type WebResearchPacket } from "../web/research.js";

export type DocsPacket = {
  task_id: string;
  package_versions: Record<string, string>;
  local_examples: string[];
  notes: string[];
  web?: WebResearchPacket;
};

export async function buildDocsPacket(cwd: string, config: MmcConfig, task: RuntimeTask, options: { includeWeb?: boolean } = {}): Promise<DocsPacket> {
  const packageVersions = readPackageVersions(cwd);
  const includeWeb = options.includeWeb ?? true;
  const web =
    includeWeb && config.web_research.enabled && config.web_research.auto_include_in_docs
      ? await runWebSearch(config, buildWebResearchQuery(task, packageVersions))
      : undefined;
  const notes = ["Prefer local examples and official package docs; do not invent version-specific APIs."];
  if (web) notes.push(`Web research ${web.status}: ${web.results.length} result(s) for "${web.query}".`);
  return {
    task_id: task.id,
    package_versions: packageVersions,
    local_examples: findLocalExamples(cwd, task).slice(0, 8),
    notes,
    web,
  };
}

function readPackageVersions(cwd: string): Record<string, string> {
  const packageJson = path.join(cwd, "package.json");
  if (!fs.existsSync(packageJson)) return {};
  const parsed = JSON.parse(fs.readFileSync(packageJson, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
}

function findLocalExamples(cwd: string, task: RuntimeTask): string[] {
  const words = new Set(
    `${task.title} ${task.description ?? ""}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3),
  );
  const matches: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (shouldIgnoreWorkspaceEntry(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx|md|mdx)$/.test(entry.name)) {
        const rel = path.relative(cwd, abs);
        if ([...words].some((word) => rel.toLowerCase().includes(word))) matches.push(rel);
      }
    }
  };
  walk(cwd);
  return matches.sort();
}
