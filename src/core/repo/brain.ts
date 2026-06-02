import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { MmcConfig } from "../config/defaults.js";
import { createValidator } from "../schemas/validator.js";
import { databasePath, missionDir, runSqlite, sqlJson, sqlString } from "../storage/sqlite.js";
import { appendEvent } from "../trace/events.js";
import type { RuntimeTask } from "../spec/compiler.js";
import { shouldIgnoreWorkspaceEntry } from "../utils/ignore.js";

export type RepoIndex = {
  repo_sha: string;
  index_sha: string;
  status: "fresh" | "stale" | "not_indexed";
  generated_at: string;
  files: RepoFile[];
  dirty_files: string[];
};

export type RepoFile = {
  path: string;
  sha: string;
  size: number;
  kind: "source" | "test" | "config" | "doc" | "other";
  symbols: string[];
};

export type EvidencePacket = {
  packet_id: string;
  task_id: string;
  repo_sha: string;
  index_sha: string;
  generated_at: string;
  freshness: "fresh";
  items: EvidenceItem[];
};

export type EvidenceItem = {
  id: string;
  type: "source_snippet" | "symbol" | "test" | "diagnostic" | "doc" | "design" | "attempt" | "git";
  path?: string;
  source: string;
  summary: string;
  content?: string;
  rank?: number;
};

export function indexRepo(cwd: string, config: MmcConfig): RepoIndex {
  const files = scanFiles(cwd);
  const repo_sha = hashStrings(files.map((file) => `${file.path}:${file.sha}:${file.size}`));
  const index_sha = hashStrings(files.map((file) => `${file.path}:${file.kind}:${file.sha}`));
  const index: RepoIndex = {
    repo_sha,
    index_sha,
    status: "fresh",
    generated_at: new Date().toISOString(),
    files,
    dirty_files: [],
  };
  writeIndex(cwd, config, index);
  appendEvent(cwd, config, {
    event_type: "repo_indexed",
    payload: { repo_sha, index_sha, file_count: files.length },
  });
  return index;
}

export function getRepoStatus(cwd: string, config: MmcConfig): RepoIndex {
  const saved = readIndex(cwd, config);
  if (!saved) {
    return {
      repo_sha: "unindexed",
      index_sha: "unindexed",
      status: "not_indexed",
      generated_at: "",
      files: [],
      dirty_files: [],
    };
  }
  const currentFiles = scanFiles(cwd);
  const currentRepoSha = hashStrings(currentFiles.map((file) => `${file.path}:${file.sha}:${file.size}`));
  const savedPaths = new Map(saved.files.map((file) => [file.path, file.sha]));
  const dirty = currentFiles
    .filter((file) => savedPaths.get(file.path) !== file.sha)
    .map((file) => file.path)
    .concat(saved.files.filter((file) => !currentFiles.some((candidate) => candidate.path === file.path)).map((file) => file.path));
  return {
    ...saved,
    repo_sha: currentRepoSha,
    status: dirty.length === 0 && currentRepoSha === saved.repo_sha ? "fresh" : "stale",
    dirty_files: [...new Set(dirty)].sort(),
  };
}

export function refreshIfStale(cwd: string, config: MmcConfig): RepoIndex {
  const status = getRepoStatus(cwd, config);
  if (status.status === "fresh") return status;
  return indexRepo(cwd, config);
}

export function buildEvidencePacket(cwd: string, config: MmcConfig, task: RuntimeTask, budgetTokens: number): EvidencePacket {
  const status = getRepoStatus(cwd, config);
  if (status.status !== "fresh") {
    throw Object.assign(new Error("Repo Brain index is stale; refresh before code generation"), { code: "REPO_STALE" });
  }

  const ranked = rankFilesForTask(status.files, task);
  const maxChars = Math.max(500, budgetTokens * 3);
  let used = 0;
  const items: EvidenceItem[] = [
    {
      id: "EV-git-state",
      type: "git",
      source: "repo-brain",
      summary: `repo_sha=${status.repo_sha}; index_sha=${status.index_sha}; files=${status.files.length}`,
      rank: 0,
    },
  ];
  const missingAllowedFiles = (task.allowed_files ?? []).filter((file) => !fs.existsSync(path.join(cwd, file)));
  if (missingAllowedFiles.length > 0) {
    items.push({
      id: "EV-greenfield-files",
      type: "diagnostic",
      source: "repo-brain",
      summary: `greenfield task: allowed files do not exist yet and should be created: ${missingAllowedFiles.join(", ")}`,
      content: `Create these missing allowed files if the task requires them: ${missingAllowedFiles.join(", ")}`,
      rank: 0.25,
    });
  }
  const previousAttempt = latestAttemptForTask(cwd, config, task.id);
  if (previousAttempt) {
    items.push({
      id: "EV-previous-attempt",
      type: "attempt",
      source: "attempt-ledger",
      summary: `previous attempt ${previousAttempt.attempt_id ?? "unknown"} status=${previousAttempt.status ?? "unknown"}`,
      content: summarizeAttempt(previousAttempt),
      rank: 0.3,
    });
  }
  const symbolItems = ranked
    .flatMap((file) => file.symbols.map((symbol) => ({ file, symbol })))
    .slice(0, 40)
    .map(({ file, symbol }, index): EvidenceItem => ({
      id: `EV-symbol-${index + 1}`,
      type: "symbol",
      path: file.path,
      source: "repo-brain",
      summary: `${symbol} in ${file.path}`,
      content: symbol,
      rank: index + 0.5,
    }));
  items.push(...symbolItems);
  for (const file of ranked) {
    if (used >= maxChars) break;
    const abs = path.join(cwd, file.path);
    const content = fs.readFileSync(abs, "utf8").slice(0, Math.min(1800, maxChars - used));
    used += content.length;
    items.push({
      id: `EV-${items.length}`,
      type: file.kind === "test" ? "test" : file.kind === "doc" ? "doc" : "source_snippet",
      path: file.path,
      source: "repo-brain",
      summary: `${file.kind} file ${file.path}`,
      content,
      rank: items.length,
    });
  }

  const packet: EvidencePacket = {
    packet_id: `E-${randomUUID().slice(0, 8)}`,
    task_id: task.id,
    repo_sha: status.repo_sha,
    index_sha: status.index_sha,
    generated_at: new Date().toISOString(),
    freshness: "fresh",
    items,
  };
  createValidator().assert("EvidencePacket", packet);
  persistEvidence(cwd, config, packet);
  return packet;
}

function latestAttemptForTask(cwd: string, config: MmcConfig, taskId: string): Record<string, unknown> | null {
  const file = path.join(missionDir(cwd, config), "attempts.jsonl");
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const attempt = JSON.parse(line) as Record<string, unknown>;
      if (attempt.task_id === taskId && attempt.status !== "accepted") return attempt;
    } catch {
      continue;
    }
  }
  return null;
}

function summarizeAttempt(attempt: Record<string, unknown>): string {
  const results = Array.isArray(attempt.verification_results) ? attempt.verification_results : [];
  const verification = results
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";
      const result = item as Record<string, unknown>;
      return [
        result.command ? `command=${result.command}` : "",
        result.exit_code !== undefined ? `exit=${result.exit_code}` : "",
        result.stdout ? `stdout=${String(result.stdout).slice(0, 500)}` : "",
        result.stderr ? `stderr=${String(result.stderr).slice(0, 500)}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean)
    .join("\n");
  return [`status=${attempt.status ?? "unknown"}`, verification].filter(Boolean).join("\n");
}

function writeIndex(cwd: string, config: MmcConfig, index: RepoIndex): void {
  const root = missionDir(cwd, config);
  fs.writeFileSync(path.join(root, "repo_index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  runSqlite(
    databasePath(cwd, config),
    `INSERT OR REPLACE INTO repo_index (index_sha, repo_sha, status, generated_at, dirty_files_json)
     VALUES (${sqlString(index.index_sha)}, ${sqlString(index.repo_sha)}, ${sqlString(index.status)},
     ${sqlString(index.generated_at)}, ${sqlJson(index.dirty_files)});`,
  );
}

function readIndex(cwd: string, config: MmcConfig): RepoIndex | null {
  const file = path.join(missionDir(cwd, config), "repo_index.json");
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as RepoIndex) : null;
}

function persistEvidence(cwd: string, config: MmcConfig, packet: EvidencePacket): void {
  const root = missionDir(cwd, config);
  const file = path.join(root, "evidence", `${packet.packet_id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  runSqlite(
    databasePath(cwd, config),
    `INSERT OR REPLACE INTO evidence_packets (packet_id, task_id, repo_sha, index_sha, packet_json, generated_at)
     VALUES (${sqlString(packet.packet_id)}, ${sqlString(packet.task_id)}, ${sqlString(packet.repo_sha)},
     ${sqlString(packet.index_sha)}, ${sqlJson(packet)}, ${sqlString(packet.generated_at)});`,
  );
}

function scanFiles(cwd: string): RepoFile[] {
  const files: RepoFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (shouldIgnoreWorkspaceEntry(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(cwd, abs);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = fs.readFileSync(abs);
      files.push({
        path: rel,
        sha: createHash("sha256").update(content).digest("hex"),
        size: content.byteLength,
        kind: classifyFile(rel),
        symbols: extractSymbols(rel, content.toString("utf8")),
      });
    }
  };
  walk(cwd);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function findTestsForFiles(files: RepoFile[], changedFiles: string[]): RepoFile[] {
  const changedNames = changedFiles.map((file) => path.basename(file).replace(/\.(tsx?|jsx?)$/, ""));
  return files
    .filter((file) => file.kind === "test")
    .filter((file) => changedNames.some((name) => file.path.includes(name)))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function classifyFile(filePath: string): RepoFile["kind"] {
  if (/\.(test|spec)\.[jt]sx?$|__tests__\//.test(filePath)) return "test";
  if (/\.(ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift|css|scss)$/.test(filePath)) return "source";
  if (/(package\.json|tsconfig|vite\.config|tailwind\.config|\.ya?ml|\.toml|\.json)$/.test(filePath)) return "config";
  if (/\.(md|mdx)$/.test(filePath)) return "doc";
  return "other";
}

function extractSymbols(filePath: string, content: string): string[] {
  if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) return [];
  const symbols = new Set<string>();
  const patterns = [
    /\bexport\s+function\s+([A-Za-z_$][\w$]*)/g,
    /\bfunction\s+([A-Za-z_$][\w$]*)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/g,
    /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) symbols.add(match[1]);
  }
  return [...symbols].sort();
}

function rankFilesForTask(files: RepoFile[], task: RuntimeTask): RepoFile[] {
  const allowedFiles = new Set(task.allowed_files ?? []);
  const words = new Set(
    `${task.title} ${task.description ?? ""}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 || /^\d+$/.test(word)),
  );
  return files
    .filter((file) => file.kind !== "other")
    .filter((file) => allowedFiles.size === 0 || allowedFiles.has(file.path))
    .map((file) => {
      const haystack = file.path.toLowerCase();
      const symbolHaystack = file.symbols.join(" ").toLowerCase();
      const matches = [...words].filter((word) => haystack.includes(word)).length;
      const symbolMatches = [...words].filter((word) => symbolHaystack.includes(word)).length;
      const kindBoost = file.kind === "source" ? 3 : file.kind === "test" ? 2 : file.kind === "doc" ? 1 : 0;
      return { file, score: matches * 10 + symbolMatches * 4 + kindBoost };
    })
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, 12)
    .map((entry) => entry.file);
}

function hashStrings(values: string[]): string {
  const hash = createHash("sha256");
  for (const value of values) hash.update(value).update("\n");
  return hash.digest("hex").slice(0, 16);
}
