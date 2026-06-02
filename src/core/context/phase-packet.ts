import type { MmcConfig } from "../config/defaults.js";
import { createValidator } from "../schemas/validator.js";
import type { RuntimeTask } from "../spec/compiler.js";
import type { EvidencePacket } from "../repo/brain.js";
import type { DocsPacket } from "../docs/brain.js";
import type { WebResearchPacket } from "../web/research.js";

export type Phase =
  | "spec_critic"
  | "planner"
  | "code_patch"
  | "test_writer"
  | "bug_analysis"
  | "review"
  | "docs_summary"
  | "design_critic";

export type PhasePacket = {
  phase: Phase;
  task_id: string;
  budget_tokens: number;
  allowed_actions: string[];
  allowed_files?: string[];
  forbidden_files?: string[];
  mission_slice?: Record<string, unknown>;
  spec_slice?: Record<string, unknown>;
  docs_slice?: {
    package_versions: Record<string, string>;
    local_examples: string[];
    notes: string[];
    web?: WebResearchPacket;
  };
  evidence_ids: string[];
  evidence?: Record<string, unknown>[];
  required_output: string;
};

export function buildPhasePacket(args: {
  config: MmcConfig;
  phase: Phase;
  task: RuntimeTask;
  evidencePacket?: EvidencePacket;
  docsPacket?: DocsPacket;
  missionSlice?: Record<string, unknown>;
  specSlice?: Record<string, unknown>;
}): PhasePacket {
  const budget_tokens =
    args.phase === "code_patch"
      ? args.config.context.default_code_patch_budget_tokens
      : args.config.context.default_planner_budget_tokens;
  const packet: PhasePacket = {
    phase: args.phase,
    task_id: args.task.id,
    budget_tokens: Math.min(budget_tokens, args.config.hardware.context_budget_tokens),
    allowed_actions: allowedActions(args.phase),
    allowed_files: args.task.allowed_files ?? [],
    forbidden_files: args.task.forbidden_files ?? [".env", ".env.local"],
    mission_slice: args.missionSlice ?? {
      task: {
        id: args.task.id,
        title: args.task.title,
        description: args.task.description,
        acceptance_ids: args.task.acceptance_ids,
        allowed_files: args.task.allowed_files ?? [],
        forbidden_files: args.task.forbidden_files ?? [],
        verification_commands: args.task.verification_commands ?? [],
        risk_flags: args.task.risk_flags ?? [],
      },
    },
    spec_slice: args.specSlice,
    docs_slice: args.docsPacket
      ? {
          package_versions: args.docsPacket.package_versions,
          local_examples: args.docsPacket.local_examples,
          notes: args.docsPacket.notes,
          web: args.docsPacket.web,
        }
      : undefined,
    evidence_ids: args.evidencePacket?.items.map((item) => item.id) ?? [],
    evidence: args.evidencePacket?.items.map((item) => ({
      id: item.id,
      type: item.type,
      path: item.path,
      summary: item.summary,
      content: item.content,
    })),
    required_output: requiredOutput(args.phase),
  };
  createValidator().assert("PhasePacket", packet);
  return packet;
}

function allowedActions(phase: Phase): string[] {
  switch (phase) {
    case "code_patch":
      return ["emit_unified_diff", "request_more_evidence", "decline"];
    case "planner":
      return ["request_more_evidence", "produce_patch_plan", "ask_user", "block", "run_verification"];
    case "review":
      return ["approve", "veto", "needs_more_verification"];
    case "bug_analysis":
      return ["propose_hypotheses", "request_more_evidence", "escalate"];
    default:
      return ["emit_json", "ask_user", "block"];
  }
}

function requiredOutput(phase: Phase): string {
  if (phase === "code_patch") return "unified_diff";
  return "json";
}
