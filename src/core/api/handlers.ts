import type { MmcConfig } from "../config/defaults.js";
import { compileSpecInput } from "../spec/compiler.js";
import { getRepoStatus, indexRepo, buildEvidencePacket, type EvidencePacket } from "../repo/brain.js";
import { buildPhasePacket, type Phase, type PhasePacket } from "../context/phase-packet.js";
import { generateFromModel } from "../models/orchestrator.js";
import { applyPatchInWorktree } from "../harness/patch.js";
import { runVerificationPlan } from "../verifier/runner.js";
import { scoreConfidence } from "../confidence/engine.js";
import type { RuntimeTask } from "../spec/compiler.js";

export async function handleInternalApi(args: {
  cwd: string;
  config: MmcConfig;
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}): Promise<unknown> {
  const { cwd, config, method, path, body = {} } = args;
  if (method === "GET" && path === "/repo/status") return getRepoStatus(cwd, config);
  if (method === "POST" && path === "/repo/refresh") return indexRepo(cwd, config);
  if (method === "POST" && path === "/repo/evidence") {
    return buildEvidencePacket(cwd, config, requiredObject<RuntimeTask>(body.task, "task"), Number(body.budget_tokens ?? 2000));
  }
  if (method === "POST" && path === "/spec/compile") {
    return compileSpecInput(String(body.content ?? ""), String(body.input_type ?? "markdown") === "json" ? "json" : "markdown");
  }
  if (method === "POST" && path === "/context/phase-packet") {
    return buildPhasePacket({
      config,
      phase: phaseValue(body.phase),
      task: requiredObject<RuntimeTask>(body.task, "task"),
      evidencePacket: optionalObject<EvidencePacket>(body.evidence_packet, "evidence_packet"),
    });
  }
  if (method === "POST" && path === "/model/generate") {
    return generateFromModel({
      cwd,
      config,
      role: String(body.role ?? "code_writer"),
      packet: requiredObject<PhasePacket>(body.phase_packet, "phase_packet"),
      mockResponse: typeof body.mock_response === "string" ? body.mock_response : undefined,
    });
  }
  if (method === "POST" && path === "/harness/apply-patch") {
    return applyPatchInWorktree({
      cwd,
      config,
      taskId: String(body.task_id),
      patch: String(body.patch ?? ""),
      allowedFiles: Array.isArray(body.allowed_files) ? body.allowed_files.filter((item): item is string => typeof item === "string") : [],
    });
  }
  if (method === "POST" && path === "/harness/verify") {
    return runVerificationPlan(
      cwd,
      config,
      Array.isArray(body.commands) ? body.commands.filter((item): item is string => typeof item === "string") : [],
    );
  }
  if (method === "POST" && path === "/confidence/score") {
    return scoreConfidence({
      verificationPassed: Boolean(body.verification_passed),
      scopeClean: Boolean(body.scope_clean),
      riskFlags: Array.isArray(body.risk_flags) ? body.risk_flags.filter((item): item is string => typeof item === "string") : [],
      evidenceFresh: body.evidence_fresh !== false,
    });
  }
  throw Object.assign(new Error(`unsupported internal API route ${method} ${path}`), { code: "VALIDATION" });
}

const PHASES = new Set<Phase>([
  "spec_critic",
  "planner",
  "code_patch",
  "test_writer",
  "bug_analysis",
  "review",
  "docs_summary",
  "design_critic",
]);

function phaseValue(value: unknown): Phase {
  const phase = String(value ?? "planner");
  if (PHASES.has(phase as Phase)) return phase as Phase;
  throw Object.assign(new Error(`invalid phase: ${phase}`), { code: "VALIDATION" });
}

function requiredObject<T extends object>(value: unknown, label: string): T {
  if (isRecord(value)) return value as T;
  throw Object.assign(new Error(`${label} must be an object`), { code: "VALIDATION" });
}

function optionalObject<T extends object>(value: unknown, label: string): T | undefined {
  if (value === undefined) return undefined;
  return requiredObject<T>(value, label);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
