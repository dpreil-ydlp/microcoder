import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MmcConfig } from "../config/defaults.js";
import { createValidator } from "../schemas/validator.js";
import { appendEvent } from "../trace/events.js";
import {
  databasePath,
  ensureMissionStructure,
  executeStatements,
  missionDir,
  sqlJson,
  sqlString,
} from "../storage/sqlite.js";
import type { CompileResult, CompiledSpec, RuntimeTask, TaskGraph } from "../spec/compiler.js";

export type Mission = {
  mission_id: string;
  goal: string;
  status: "draft" | "active" | "blocked" | "complete" | "failed";
  created_at: string;
  updated_at: string;
  current_task_id: string | null;
  decision_ids: string[];
  risk_flags: string[];
};

export type MissionStartResult =
  | { status: "active"; mission: Mission; task_graph: TaskGraph }
  | { status: "blocked"; questions: string[]; spec: CompiledSpec };

export function initializeLedger(cwd: string, config: MmcConfig): void {
  ensureMissionStructure(cwd, config);
}

export function persistCompileResult(cwd: string, config: MmcConfig, result: CompileResult): string {
  ensureMissionStructure(cwd, config);
  const root = missionDir(cwd, config);
  const specFile = path.join(root, "specs", `${result.spec.spec_id}.json`);
  const latestFile = path.join(root, "spec.json");
  const payload = `${JSON.stringify(result, null, 2)}\n`;
  fs.writeFileSync(specFile, payload, "utf8");
  fs.writeFileSync(latestFile, payload, "utf8");
  appendEvent(cwd, config, {
    event_type: "spec_compiled",
    payload: {
      spec_id: result.spec.spec_id,
      status: result.status,
      blocking_question_count: result.blocking_questions.length,
    },
  });
  return specFile;
}

export function loadCompileResult(cwd: string, config: MmcConfig, file?: string): CompileResult {
  const target = file ? path.resolve(cwd, file) : path.join(missionDir(cwd, config), "spec.json");
  if (!fs.existsSync(target)) throw new Error(`compiled spec not found: ${target}`);
  return JSON.parse(fs.readFileSync(target, "utf8")) as CompileResult;
}

export function startMission(cwd: string, config: MmcConfig, result: CompileResult): MissionStartResult {
  ensureMissionStructure(cwd, config);
  if (result.blocking_questions.length > 0 || result.spec.acceptance_criteria.length === 0) {
    const questions = result.blocking_questions.length
      ? result.blocking_questions
      : ["What measurable acceptance criteria prove this is done?"];
    fs.writeFileSync(
      path.join(missionDir(cwd, config), "current_state.json"),
      `${JSON.stringify({ active_mission_id: null, status: "blocked", questions }, null, 2)}\n`,
      "utf8",
    );
    appendEvent(cwd, config, {
      event_type: "mission_blocked_by_spec",
      payload: { spec_id: result.spec.spec_id, questions },
    });
    return { status: "blocked", questions, spec: result.spec };
  }

  const now = new Date().toISOString();
  const firstTask = result.task_graph.tasks.find((task) => task.status === "ready") ?? result.task_graph.tasks[0];
  const mission: Mission = {
    mission_id: `M-${randomUUID().slice(0, 8)}`,
    goal: result.spec.goal,
    status: "active",
    created_at: now,
    updated_at: now,
    current_task_id: firstTask?.id ?? null,
    decision_ids: [],
    risk_flags: result.spec.risk_flags,
  };
  createValidator().assert("Mission", mission);

  const root = missionDir(cwd, config);
  fs.writeFileSync(path.join(root, "mission.json"), `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(root, "task_graph.json"), `${JSON.stringify(result.task_graph, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(root, "current_state.json"),
    `${JSON.stringify({ active_mission_id: mission.mission_id, status: "active", current_task_id: mission.current_task_id }, null, 2)}\n`,
    "utf8",
  );
  fs.appendFileSync(path.join(root, "mission.md"), `# ${mission.goal}\n\nStarted: ${now}\n`, "utf8");

  persistMissionRows(cwd, config, mission, result.spec, result.task_graph);
  appendEvent(cwd, config, {
    mission_id: mission.mission_id,
    task_id: mission.current_task_id,
    event_type: "mission_started",
    payload: { spec_id: result.spec.spec_id },
  });
  return { status: "active", mission, task_graph: result.task_graph };
}

export function loadMission(cwd: string, config: MmcConfig): Mission {
  const file = path.join(missionDir(cwd, config), "mission.json");
  if (!fs.existsSync(file)) throw new Error("no active mission found");
  const mission = JSON.parse(fs.readFileSync(file, "utf8")) as Mission;
  createValidator().assert("Mission", mission);
  return mission;
}

export function loadTaskGraph(cwd: string, config: MmcConfig): TaskGraph {
  const file = path.join(missionDir(cwd, config), "task_graph.json");
  if (!fs.existsSync(file)) throw new Error("task graph not found");
  const graph = JSON.parse(fs.readFileSync(file, "utf8")) as TaskGraph;
  createValidator().assert("TaskGraph", graph);
  return graph;
}

export function saveTaskGraph(cwd: string, config: MmcConfig, graph: TaskGraph): void {
  createValidator().assert("TaskGraph", graph);
  fs.writeFileSync(path.join(missionDir(cwd, config), "task_graph.json"), `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

export function getNextTask(cwd: string, config: MmcConfig): RuntimeTask | null {
  const graph = loadTaskGraph(cwd, config);
  return graph.tasks.find((task) => task.status === "ready") ?? graph.tasks.find((task) => task.status === "todo") ?? null;
}

export function appendAttemptJsonl(cwd: string, config: MmcConfig, attempt: unknown): void {
  createValidator().assert("Attempt", attempt);
  const row = attempt as {
    attempt_id: string;
    task_id: string;
    phase?: string;
    model_id?: string;
    status: string;
    patch_path?: string;
    confidence_score?: number;
    started_at: string;
    ended_at?: string;
  };
  fs.appendFileSync(path.join(missionDir(cwd, config), "attempts.jsonl"), `${JSON.stringify(attempt)}\n`, "utf8");
  executeStatements(databasePath(cwd, config), [
    `INSERT OR REPLACE INTO attempts
      (attempt_id, task_id, phase, model_id, status, patch_path, confidence_score, started_at, ended_at)
      VALUES (${sqlString(row.attempt_id)}, ${sqlString(row.task_id)}, ${sqlString(row.phase ?? "unknown")},
      ${sqlString(row.model_id)}, ${sqlString(row.status)}, ${sqlString(row.patch_path)},
      ${row.confidence_score ?? "NULL"}, ${sqlString(row.started_at)}, ${sqlString(row.ended_at)});`,
  ]);
}

function persistMissionRows(cwd: string, config: MmcConfig, mission: Mission, spec: CompiledSpec, taskGraph: TaskGraph): void {
  const db = databasePath(cwd, config);
  const now = new Date().toISOString();
  const statements = [
    `INSERT OR REPLACE INTO missions (mission_id, goal, status, created_at, updated_at, current_task_id)
     VALUES (${sqlString(mission.mission_id)}, ${sqlString(mission.goal)}, ${sqlString(mission.status)},
     ${sqlString(mission.created_at)}, ${sqlString(mission.updated_at)}, ${sqlString(mission.current_task_id)});`,
    `INSERT OR REPLACE INTO specs (spec_id, mission_id, spec_json, created_at, updated_at)
     VALUES (${sqlString(spec.spec_id)}, ${sqlString(mission.mission_id)}, ${sqlJson(spec)}, ${sqlString(now)}, ${sqlString(now)});`,
    ...taskGraph.tasks.map((task) => `INSERT OR REPLACE INTO tasks
      (task_id, mission_id, title, status, depends_on_json, acceptance_ids_json, allowed_files_json, risk_flags_json, created_at, updated_at)
      VALUES (${sqlString(task.id)}, ${sqlString(mission.mission_id)}, ${sqlString(task.title)}, ${sqlString(task.status)},
      ${sqlJson(task.depends_on)}, ${sqlJson(task.acceptance_ids)}, ${sqlJson(task.allowed_files ?? [])},
      ${sqlJson(task.risk_flags ?? [])}, ${sqlString(now)}, ${sqlString(now)});`),
  ];
  executeStatements(db, statements);
}
