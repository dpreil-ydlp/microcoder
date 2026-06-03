import fs from "node:fs";
import path from "node:path";
import { buildPhasePacket } from "../core/context/phase-packet.js";
import { buildDesignPacketV2, isFrontendTask } from "../core/design/brain.js";
import { buildDocsPacket } from "../core/docs/brain.js";
import { evaluateEscalation } from "../core/escalation/engine.js";
import { scoreConfidence } from "../core/confidence/engine.js";
import { applyPatchInWorktree } from "../core/harness/patch.js";
import {
  appendAttemptJsonl,
  getNextTask,
  loadTaskGraph,
  markMissionComplete,
  saveTaskGraph,
} from "../core/mission/ledger.js";
import { effectiveModelProvider } from "../core/models/llamacpp-backend.js";
import { generateFromModel, loadModelRegistry, routeModel } from "../core/models/orchestrator.js";
import { buildEvidencePacket, getRepoStatus, refreshIfStale } from "../core/repo/brain.js";
import { ensureMissionStructure, initializeDatabase } from "../core/storage/sqlite.js";
import { appendEvent } from "../core/trace/events.js";
import { runFrontendVerification } from "../core/verifier/frontend.js";
import { runVerificationPlan } from "../core/verifier/runner.js";
import { parsePositiveInteger, valueAfter } from "./args.js";
import type { CliIO } from "./run.js";
import type { loadConfig } from "../core/config/config.js";

type LoadedConfig = ReturnType<typeof loadConfig>;

export function runTaskNextCommand(cwd: string, io: CliIO, loaded: LoadedConfig): number {
  const task = getNextTask(cwd, loaded.config);
  if (!task) {
    io.stdout("no_runnable_task");
    return 2;
  }
  io.stdout(JSON.stringify(task, null, 2));
  return 0;
}

export async function runTaskCommand(cwd: string, io: CliIO, args: string[], loadValidConfig: (cwd: string) => LoadedConfig): Promise<number> {
  const taskId = valueAfter(args, "--task");
  if (!taskId) {
    io.stderr("run requires --task TID");
    return 1;
  }
  const mockPatchFile = valueAfter(args, "--mock-patch");
  const loaded = loadValidConfig(cwd);
  ensureMissionStructure(cwd, loaded.config);
  initializeDatabase(cwd, loaded.config);
  const graph = loadTaskGraph(cwd, loaded.config);
  const task = graph.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    io.stderr(`task not found: ${taskId}`);
    return 1;
  }
  if (task.acceptance_ids.length === 0) {
    io.stdout("blocked_no_acceptance_criteria");
    return 2;
  }
  const beforeRefresh = getRepoStatus(cwd, loaded.config);
  if (beforeRefresh.status !== "fresh") {
    io.stdout(`repo_status ${beforeRefresh.status}; refreshing before code generation`);
  }
  io.stdout(`build_progress preparing task_id=${task.id}`);
  const repo = refreshIfStale(cwd, loaded.config);
  const evidence = buildEvidencePacket(cwd, loaded.config, task, loaded.config.context.default_code_patch_budget_tokens);
  const designPacket = isFrontendTask(task) ? buildDesignPacketV2(cwd, loaded.config, task) : null;
  const docsPacket = await buildDocsPacket(cwd, loaded.config, task, { includeWeb: !mockPatchFile });
  const packet = buildPhasePacket({ config: loaded.config, phase: "code_patch", task, evidencePacket: evidence, docsPacket });
  appendEvent(cwd, loaded.config, {
    task_id: task.id,
    event_type: "phase_packet_built",
    payload: {
      phase: packet.phase,
      evidence_ids: packet.evidence_ids,
      has_design_packet: Boolean(designPacket),
      docs_examples: docsPacket.local_examples.length,
      web_research_status: docsPacket.web?.status ?? "not_requested",
      web_research_results: docsPacket.web?.results.length ?? 0,
    },
  });
  const mockPatch = mockPatchFile ? fs.readFileSync(path.resolve(cwd, mockPatchFile), "utf8") : undefined;
  const route = describeGenerationRoute(cwd, loaded.config, "code_writer");
  io.stdout(`build_progress generating_patch task_id=${task.id} model=${route.modelId} provider=${route.provider} timeout_seconds=${route.timeoutSeconds}`);
  const generated = await withGenerationHeartbeat(
    io,
    task.id,
    route.timeoutSeconds,
    generateFromModel({ cwd, config: loaded.config, role: "code_writer", packet, mockResponse: mockPatch }),
  );
  io.stdout(`build_progress generated_patch task_id=${task.id} model=${generated.model_id} provider=${generated.provider} latency_ms=${generated.latency_ms}`);
  appendEvent(cwd, loaded.config, {
    task_id: task.id,
    event_type: "model_generate_completed",
    payload: { provider: generated.provider, model_id: generated.model_id, latency_ms: generated.latency_ms },
  });
  if (generated.text.startsWith("REQUEST_MORE_EVIDENCE") || generated.text.startsWith("DECLINE")) {
    io.stdout(generated.text);
    return 2;
  }
  io.stdout(`build_progress applying_patch task_id=${task.id}`);
  const patch = applyPatchInWorktree({
    cwd,
    config: loaded.config,
    taskId: task.id,
    patch: generated.text,
    allowedFiles: task.allowed_files ?? [],
  });
  io.stdout(`build_progress verifying task_id=${task.id}`);
  const verification =
    patch.status === "applied"
      ? await runVerificationPlan(patch.worktree_path, loaded.config, task.verification_commands ?? [])
      : { passed: false, results: [], summary: patch.validation.rejected_reason ?? patch.stderr ?? "patch failed" };
  const frontendVerification =
    designPacket && patch.status === "applied"
      ? await runFrontendVerification(cwd, loaded.config, designPacket, patch.worktree_path)
      : null;
  const frontendPassed = !designPacket || frontendVerification?.status === "passed";
  const escalation = evaluateEscalation(cwd, loaded.config, task.id);
  const confidence = scoreConfidence({
    verificationPassed: verification.passed && frontendPassed,
    scopeClean: patch.validation.scope_clean,
    riskFlags: task.risk_flags ?? [],
    repeatedFailureCount: escalation.repeated_failure_count,
    evidenceFresh: repo.status === "fresh",
  });
  const attempt = {
    attempt_id: patch.attempt_id,
    task_id: task.id,
    phase: "code_patch",
    model_id: generated.model_id,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    status: confidence.decision === "accept" ? "accepted" : verification.passed && frontendPassed ? "verified" : "failed",
    patch_path: patch.patch_path,
    verification_results: verification.results,
    confidence_score: confidence.score,
  };
  appendAttemptJsonl(cwd, loaded.config, attempt);
  appendEvent(cwd, loaded.config, {
    task_id: task.id,
    event_type: "attempt_finished",
    payload: {
      attempt_id: attempt.attempt_id,
      patch_status: patch.status,
      worktree_mode: patch.worktree_mode,
      verification_passed: verification.passed,
      frontend_verification: frontendVerification,
      confidence,
      escalation,
    },
  });
  if (confidence.decision === "accept") {
    task.status = "complete";
    saveTaskGraph(cwd, loaded.config, graph);
  }
  io.stdout(`attempt_id ${attempt.attempt_id}`);
  io.stdout(`patch_status ${patch.status}`);
  io.stdout(`worktree_mode ${patch.worktree_mode}`);
  if (patch.status === "applied") {
    io.stdout(`verification ${verification.passed ? "passed" : "failed"} ${verification.summary}`);
  } else {
    io.stdout(`verification skipped ${verification.summary}`);
  }
  io.stdout(`confidence ${confidence.score} ${confidence.decision}`);
  if (confidence.decision !== "accept") io.stdout(`task_not_accepted ${confidence.decision}`);
  if (escalation.action !== "continue") io.stdout(`escalation ${escalation.action}: ${escalation.reason}`);
  return confidence.decision === "accept" ? 0 : 5;
}

function describeGenerationRoute(cwd: string, config: LoadedConfig["config"], role: string): { modelId: string; provider: string; timeoutSeconds: number } {
  const registry = loadModelRegistry(cwd, config);
  const model = routeModel(registry, role, config.hardware.profile, config.models.role_overrides);
  return {
    modelId: model?.id ?? "none",
    provider: model ? effectiveModelProvider(config, model) : "none",
    timeoutSeconds: config.models.llamacpp.timeout_seconds,
  };
}

async function withGenerationHeartbeat<T>(io: CliIO, taskId: string, timeoutSeconds: number, promise: Promise<T>): Promise<T> {
  let elapsed = 0;
  const heartbeatSeconds = Math.max(1, Math.min(10, Math.floor(timeoutSeconds / 6)));
  const timer = setInterval(() => {
    elapsed += heartbeatSeconds;
    io.stdout(`build_progress generating_patch_wait task_id=${taskId} elapsed_seconds=${elapsed} timeout_seconds=${timeoutSeconds}`);
  }, heartbeatSeconds * 1000);
  try {
    return await promise;
  } finally {
    clearInterval(timer);
  }
}

export async function runMissionCommand(
  cwd: string,
  io: CliIO,
  args: string[],
  loadValidConfig: (cwd: string) => LoadedConfig,
  label: "mission" | "build" = "mission",
): Promise<number> {
  const parsed = parseRunMissionArgs(args, label);
  if (typeof parsed === "string") {
    io.stderr(parsed);
    return 1;
  }
  const loaded = loadValidConfig(cwd);
  const maxTasks = parsed.maxTasks;
  let ran = 0;
  while (ran < maxTasks) {
    const task = getNextTask(cwd, loaded.config);
    if (!task) {
      const graph = loadTaskGraph(cwd, loaded.config);
      if (graph.tasks.length > 0 && graph.tasks.every((candidate) => candidate.status === "complete")) {
        markMissionComplete(cwd, loaded.config);
        io.stdout(`${label}_complete completed_tasks=${ran}`);
        return 0;
      }
      io.stdout(ran === 0 ? `${label}_blocked_or_complete no_runnable_task` : `${label}_stopped completed_tasks=${ran}`);
      return ran === 0 ? 2 : 0;
    }
    io.stdout(`${label}_task_start ${task.id} ${task.title}`);
    const code = await runTaskCommand(cwd, io, ["--task", task.id], loadValidConfig);
    ran += 1;
    if (code !== 0) {
      io.stdout(`${label}_stopped code=${code} completed_tasks=${ran - 1}`);
      return code;
    }
  }
  io.stdout(`${label}_stopped max_tasks=${maxTasks}`);
  return 0;
}

export async function runVerifyCommand(cwd: string, io: CliIO, args: string[], loaded: LoadedConfig): Promise<number> {
  const taskId = valueAfter(args, "--task");
  if (!taskId) {
    io.stderr("verify requires --task TID");
    return 1;
  }
  const graph = loadTaskGraph(cwd, loaded.config);
  const task = graph.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    io.stderr(`task not found: ${taskId}`);
    return 1;
  }
  const result = await runVerificationPlan(cwd, loaded.config, task.verification_commands ?? []);
  io.stdout(`${result.passed ? "passed" : "failed"} ${result.summary}`);
  return result.passed ? 0 : 5;
}

function parseRunMissionArgs(args: string[], label: "mission" | "build"): { maxTasks: number } | string {
  let maxTasks = Number.POSITIVE_INFINITY;
  const commandName = label === "build" ? "build run" : "run --mission";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mission") continue;
    if (arg === "--max-tasks") {
      const parsed = parsePositiveInteger(args[index + 1], `${commandName} --max-tasks`);
      if (typeof parsed === "string") return parsed;
      maxTasks = parsed;
      index += 1;
      continue;
    }
    return `unexpected ${commandName} argument: ${arg}`;
  }
  return { maxTasks };
}
