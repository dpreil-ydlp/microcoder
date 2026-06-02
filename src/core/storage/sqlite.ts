import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { MmcConfig } from "../config/defaults.js";
import { ensureDir, resolveFromCwd } from "../utils/paths.js";

export const MIGRATIONS_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS missions (
  mission_id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  current_task_id TEXT
);

CREATE TABLE IF NOT EXISTS specs (
  spec_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  depends_on_json TEXT NOT NULL,
  acceptance_ids_json TEXT NOT NULL,
  allowed_files_json TEXT,
  risk_flags_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_index (
  index_sha TEXT PRIMARY KEY,
  repo_sha TEXT NOT NULL,
  status TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  dirty_files_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_packets (
  packet_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  repo_sha TEXT NOT NULL,
  index_sha TEXT NOT NULL,
  packet_json TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  model_id TEXT,
  status TEXT NOT NULL,
  patch_path TEXT,
  confidence_score REAL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  mission_id TEXT,
  task_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  attempt_id TEXT,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL
);
`;

export function missionDir(cwd: string, config: MmcConfig): string {
  return resolveFromCwd(cwd, config.project.mission_dir);
}

export function databasePath(cwd: string, config: MmcConfig): string {
  return resolveFromCwd(cwd, config.project.database_path);
}

export function ensureMissionStructure(cwd: string, config: MmcConfig): void {
  const root = missionDir(cwd, config);
  for (const dir of [
    root,
    path.join(root, "specs"),
    path.join(root, "evidence"),
    path.join(root, "checkpoints"),
    path.join(root, "artifacts"),
    path.join(root, "artifacts", "visual"),
    path.join(root, "artifacts", "design"),
    path.join(root, "design"),
  ]) {
    ensureDir(dir);
  }

  ensureFile(path.join(root, "attempts.jsonl"), "");
  ensureFile(path.join(root, "events.jsonl"), "");
  ensureFile(path.join(root, "decision_log.md"), "# Decision Log\n");
  ensureFile(
    path.join(root, "current_state.json"),
    `${JSON.stringify({ active_mission_id: null, status: "initialized" }, null, 2)}\n`,
  );
}

export function initializeDatabase(cwd: string, config: MmcConfig): string {
  const db = databasePath(cwd, config);
  ensureDir(path.dirname(db));
  runSqlite(db, MIGRATIONS_SQL);
  return db;
}

export function runSqlite(dbPath: string, sql: string): string {
  const result = spawnSync("sqlite3", [dbPath], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `sqlite3 exited ${result.status}`);
  }
  return result.stdout;
}

export function queryJson<T>(dbPath: string, sql: string): T[] {
  const result = spawnSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `sqlite3 exited ${result.status}`);
  }
  const text = result.stdout.trim();
  return text ? (JSON.parse(text) as T[]) : [];
}

export function executeStatements(dbPath: string, statements: string[]): void {
  if (statements.length === 0) return;
  runSqlite(dbPath, `BEGIN;\n${statements.join("\n")}\nCOMMIT;\n`);
}

export function sqlString(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return `'${value.replaceAll("'", "''")}'`;
}

export function sqlJson(value: unknown): string {
  return sqlString(JSON.stringify(value));
}

function ensureFile(file: string, content: string): void {
  if (!fs.existsSync(file)) fs.writeFileSync(file, content, "utf8");
}
