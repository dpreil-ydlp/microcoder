import fs from "node:fs";
import path from "node:path";
import type { MmcConfig } from "../config/defaults.js";
import { databasePath, missionDir, queryJson } from "../storage/sqlite.js";
import { createValidator } from "../schemas/validator.js";

export type ConsistencyReport = {
  status: "pass" | "fail";
  checks: Array<{ name: string; status: "pass" | "fail"; detail: string }>;
};

export function validateMissionConsistency(cwd: string, config: MmcConfig): ConsistencyReport {
  const checks: ConsistencyReport["checks"] = [];
  const root = missionDir(cwd, config);
  const validator = createValidator();

  const missionFile = path.join(root, "mission.json");
  const taskGraphFile = path.join(root, "task_graph.json");
  const specFile = path.join(root, "spec.json");

  if (fs.existsSync(missionFile)) {
    const mission = JSON.parse(fs.readFileSync(missionFile, "utf8"));
    const result = validator.validate("Mission", mission);
    checks.push({ name: "mission_schema", status: result.valid ? "pass" : "fail", detail: result.errors.join("; ") || "mission schema valid" });
  }

  if (fs.existsSync(specFile)) {
    const compileResult = JSON.parse(fs.readFileSync(specFile, "utf8"));
    const specResult = validator.validate("CompiledSpec", compileResult.spec);
    const graphResult = validator.validate("TaskGraph", compileResult.task_graph);
    checks.push({ name: "compiled_spec_schema", status: specResult.valid ? "pass" : "fail", detail: specResult.errors.join("; ") || "compiled spec schema valid" });
    checks.push({ name: "compiled_task_graph_schema", status: graphResult.valid ? "pass" : "fail", detail: graphResult.errors.join("; ") || "task graph schema valid" });
  }

  if (fs.existsSync(taskGraphFile) && fs.existsSync(specFile)) {
    const graph = JSON.parse(fs.readFileSync(taskGraphFile, "utf8")) as { tasks: Array<{ id: string; acceptance_ids: string[] }> };
    const compileResult = JSON.parse(fs.readFileSync(specFile, "utf8")) as { spec: { acceptance_criteria: Array<{ id: string }> } };
    const acIds = new Set(compileResult.spec.acceptance_criteria.map((criterion) => criterion.id));
    const missing = graph.tasks.flatMap((task) => task.acceptance_ids.filter((id) => !acIds.has(id)).map((id) => `${task.id}:${id}`));
    checks.push({
      name: "task_acceptance_links",
      status: missing.length === 0 ? "pass" : "fail",
      detail: missing.length === 0 ? "all task acceptance ids resolve" : `missing acceptance ids ${missing.join(", ")}`,
    });
  }

  const artifactRows = safeQuery<{ path: string; type: string }>(cwd, config, "SELECT path, type FROM artifacts;");
  const missingArtifacts = artifactRows.filter((row) => !fs.existsSync(path.join(root, row.path))).map((row) => `${row.type}:${row.path}`);
  checks.push({
    name: "artifact_rows_have_files",
    status: missingArtifacts.length === 0 ? "pass" : "fail",
    detail: missingArtifacts.length === 0 ? `${artifactRows.length} artifact rows resolve` : missingArtifacts.join(", "),
  });

  const attemptsFile = path.join(root, "attempts.jsonl");
  if (fs.existsSync(attemptsFile)) {
    const invalidAttempts: string[] = [];
    for (const line of fs.readFileSync(attemptsFile, "utf8").split(/\r?\n/).filter(Boolean)) {
      const attempt = JSON.parse(line);
      const result = validator.validate("Attempt", attempt);
      if (!result.valid) invalidAttempts.push(attempt.attempt_id ?? "unknown");
    }
    checks.push({
      name: "attempt_jsonl_schema",
      status: invalidAttempts.length === 0 ? "pass" : "fail",
      detail: invalidAttempts.length === 0 ? "attempts JSONL validates" : `invalid attempts ${invalidAttempts.join(", ")}`,
    });
  }

  return {
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    checks,
  };
}

function safeQuery<T>(cwd: string, config: MmcConfig, sql: string): T[] {
  const db = databasePath(cwd, config);
  if (!fs.existsSync(db)) return [];
  return queryJson<T>(db, sql);
}
