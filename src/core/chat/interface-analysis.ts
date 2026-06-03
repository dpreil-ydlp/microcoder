import type { MmcConfig } from "../config/defaults.js";
import type { PhasePacket } from "../context/phase-packet.js";
import {
  generateFromModel,
  loadModelRegistry,
  routeModel,
} from "../models/orchestrator.js";
import { effectiveModelProvider, inspectLlamaCppBackend } from "../models/llamacpp-backend.js";
import type { BriefPatch, RiskGate } from "./intent.js";
import type { SpecChatBrief } from "./spec-chat.js";

export type InterfaceAnalysisKind = "build_request" | "needs_clarification" | "meta" | "unknown";

export type InterfaceModelPatch = BriefPatch & {
  kind: InterfaceAnalysisKind;
  confidence: number;
  provider: string;
  model_id: string;
  reply?: string;
};

export type CompiledPlanControlKind =
  | "start_current_plan"
  | "inspect_plan"
  | "change_plan"
  | "reset_plan"
  | "show_progress"
  | "thanks"
  | "unknown";

export type CompiledPlanControlIntent = {
  kind: CompiledPlanControlKind;
  confidence: number;
  source: "interface_model" | "heuristic";
  provider?: string;
  model_id?: string;
  reason?: string;
  reply?: string;
};

const RISK_GATES: RiskGate[] = ["vague", "external_service", "security_sensitive"];

export async function analyzeWithInterfaceModel(args: {
  cwd: string;
  config: MmcConfig;
  brief: SpecChatBrief;
  userText: string;
}): Promise<InterfaceModelPatch | null> {
  const settings = args.config.chat.interface_model;
  if (!settings.enabled) return null;
  if (settings.require_explicit_route && !hasExplicitInterfaceRoute(args.config)) return null;
  const registry = loadModelRegistry(args.cwd, args.config);
  const model = routeModel(registry, "interface", args.config.hardware.profile, args.config.models.role_overrides);
  if (!model) return null;
  const timeoutMs = settings.timeout_seconds * 1000;
  const provider = effectiveModelProvider(args.config, model);
  const ready = await interfaceBackendReady(args.cwd, args.config, provider, model, Math.min(timeoutMs, 500));
  if (!ready) {
    if (settings.fallback_to_heuristics) return null;
    throw Object.assign(new Error(`interface model backend is not ready for provider ${provider}`), { code: "MODEL_PROVIDER_FAILED" });
  }

  try {
    const result = await generateFromModel({
      cwd: args.cwd,
      config: args.config,
      role: "interface",
      packet: buildInterfacePacket(args.userText, args.brief),
      timeoutMs,
    });
    const parsed = parseInterfaceModelPatch(result.text, {
      minimumConfidence: settings.minimum_confidence,
      provider: result.provider,
      modelId: result.model_id,
    });
    return parsed;
  } catch (error) {
    if (settings.fallback_to_heuristics) return null;
    throw error;
  }
}

export async function analyzeCompiledPlanControlWithInterfaceModel(args: {
  cwd: string;
  config: MmcConfig;
  userText: string;
  currentPlan: { goal: string; taskCount?: number };
  activeBuild?: { goal: string; status: string } | null;
}): Promise<CompiledPlanControlIntent | null> {
  const settings = args.config.chat.interface_model;
  if (!settings.enabled) return null;
  if (settings.require_explicit_route && !hasExplicitInterfaceRoute(args.config)) return null;
  const registry = loadModelRegistry(args.cwd, args.config);
  const model = routeModel(registry, "interface", args.config.hardware.profile, args.config.models.role_overrides);
  if (!model) return null;
  const timeoutMs = settings.timeout_seconds * 1000;
  const provider = effectiveModelProvider(args.config, model);
  const ready = await interfaceBackendReady(args.cwd, args.config, provider, model, Math.min(timeoutMs, 500));
  if (!ready) {
    if (settings.fallback_to_heuristics) return null;
    throw Object.assign(new Error(`interface model backend is not ready for provider ${provider}`), { code: "MODEL_PROVIDER_FAILED" });
  }

  try {
    const result = await generateFromModel({
      cwd: args.cwd,
      config: args.config,
      role: "interface",
      packet: buildCompiledPlanControlPacket(args.userText, args.currentPlan, args.activeBuild ?? null),
      timeoutMs,
    });
    return parseCompiledPlanControlIntent(result.text, {
      minimumConfidence: settings.minimum_confidence,
      provider: result.provider,
      modelId: result.model_id,
    });
  } catch (error) {
    if (settings.fallback_to_heuristics) return null;
    throw error;
  }
}

export function hasExplicitInterfaceRoute(config: MmcConfig): boolean {
  return Boolean(
    config.models.role_overrides?.interface
      || (config.models.provider_default === "llamacpp" && (config.models.llamacpp.model_paths.interface || config.models.llamacpp.model_paths.default)),
  );
}

function buildInterfacePacket(userText: string, brief: SpecChatBrief): PhasePacket {
  return {
    phase: "interface",
    task_id: "INTERFACE_ANALYSIS",
    budget_tokens: 800,
    allowed_actions: ["emit_json", "ask_user", "block"],
    evidence_ids: [],
    required_output: "json",
    mission_slice: {
      user_message: userText,
      current_brief: {
        goal: brief.goal ?? null,
        users: brief.users ?? null,
        workflows: brief.workflows,
        data: brief.data,
        acceptance: brief.acceptance,
        constraints: brief.constraints,
        unresolved_risks: brief.unresolved_risks ?? [],
      },
      output_contract: {
        kind: "build_request | needs_clarification | meta | unknown",
        confidence: "number from 0 to 1",
        reply: "one short user-facing sentence in normal language",
        goal: "concrete build goal when kind is build_request",
        users: "target user summary if inferable",
        workflows: ["specific user-visible workflows or screens"],
        data: ["stored, imported, or displayed data"],
        acceptance: ["observable done checks"],
        constraints: ["non-goals, local-only assumptions, or clarification questions"],
        risk_flags: ["short risk labels"],
        unresolved_risks: ["vague | external_service | security_sensitive"],
      },
      rules: [
        "Infer a normal v1 app shape from the user's actual words.",
        "Do not return a canned app type unless the user asked for it.",
        "For buildable local browser apps, include enough workflows and acceptance checks to compile a spec.",
        "If external services, payments, deployment, auth, credentials, or real secrets are requested, set unresolved_risks instead of pretending they are configured.",
        "Return only the JSON object.",
      ],
    },
  };
}

function buildCompiledPlanControlPacket(
  userText: string,
  currentPlan: { goal: string; taskCount?: number },
  activeBuild: { goal: string; status: string } | null,
): PhasePacket {
  return {
    phase: "interface",
    task_id: "COMPILED_PLAN_CONTROL",
    budget_tokens: 400,
    allowed_actions: ["emit_json", "block"],
    evidence_ids: [],
    required_output: "json",
    mission_slice: {
      mode: "compiled_plan_control",
      user_message: userText,
      current_plan: {
        goal: currentPlan.goal,
        status: "compiled",
        task_count: currentPlan.taskCount ?? null,
      },
      active_build: activeBuild
        ? {
            goal: activeBuild.goal,
            status: activeBuild.status,
          }
        : null,
      output_contract: {
        kind: "start_current_plan | inspect_plan | change_plan | reset_plan | show_progress | thanks | unknown",
        confidence: "number from 0 to 1",
        reply: "one short user-facing sentence in normal language",
        reason: "short reason based on the user's words and current context",
      },
      rules: [
        "Interpret the user message in the context of an existing compiled build plan.",
        "If the user says continue, resume, proceed, use that, that one, the previous plan is fine, looks good, go, or similar acceptance language, return start_current_plan.",
        "If the user asks what the plan, spec, scope, requirements, or acceptance checks are, return inspect_plan.",
        "If the user asks to start over, reset, discard, cancel, abandon, clear, remove, or delete the current plan or active/paused build, return reset_plan.",
        "If the user describes a different app, game, site, tool, workflow, or product instead of the current plan, return change_plan.",
        "If the user asks what is next, progress, or status, return show_progress.",
        "Return only the JSON object.",
      ],
    },
  };
}

function parseInterfaceModelPatch(
  text: string,
  options: { minimumConfidence: number; provider: string; modelId: string },
): InterfaceModelPatch | null {
  const parsed = parseJsonObject(text);
  if (!isPlainObject(parsed)) return null;
  const kind = parseKind(parsed.kind);
  const confidence = parsed.confidence === undefined && kind !== "unknown" ? 0.75 : normalizeConfidence(parsed.confidence);
  if (confidence < options.minimumConfidence) return null;
  const patch: InterfaceModelPatch = {
    kind,
    confidence,
    provider: options.provider,
    model_id: options.modelId,
    reply: stringValue(parsed.reply ?? parsed.assistant_reply ?? parsed.message),
    goal: stringValue(parsed.goal),
    users: stringValue(parsed.users),
    workflows: stringArray(parsed.workflows),
    data: stringArray(parsed.data),
    acceptance: stringArray(parsed.acceptance ?? parsed.acceptance_criteria),
    constraints: stringArray(parsed.constraints),
    risk_flags: stringArray(parsed.risk_flags),
    unresolved_risks: stringArray(parsed.unresolved_risks).filter((risk): risk is RiskGate => RISK_GATES.includes(risk as RiskGate)),
  };
  if (kind === "build_request" && (!patch.goal || patch.workflows.length === 0 || patch.acceptance.length === 0)) return null;
  if (kind !== "build_request" && patch.unresolved_risks.length === 0 && patch.constraints.length === 0) return null;
  return patch;
}

function parseCompiledPlanControlIntent(
  text: string,
  options: { minimumConfidence: number; provider: string; modelId: string },
): CompiledPlanControlIntent | null {
  const parsed = parseJsonObject(text);
  if (!isPlainObject(parsed)) return null;
  const kind = parseCompiledPlanControlKind(parsed.kind);
  const confidence = parsed.confidence === undefined && kind !== "unknown" ? 0.75 : normalizeConfidence(parsed.confidence);
  if (confidence < options.minimumConfidence) return null;
  return {
    kind,
    confidence,
    source: "interface_model",
    provider: options.provider,
    model_id: options.modelId,
    reason: stringValue(parsed.reason),
    reply: stringValue(parsed.reply ?? parsed.assistant_reply ?? parsed.message),
  };
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function interfaceBackendReady(
  cwd: string,
  config: MmcConfig,
  provider: string,
  model: NonNullable<ReturnType<typeof routeModel>>,
  timeoutMs: number,
): Promise<boolean> {
  if (provider === "ollama") return await isOllamaReady(timeoutMs);
  if (provider === "llamacpp") {
    const report = await inspectLlamaCppBackend({ cwd, config, role: "interface", model });
    return report.status === "READY" || (report.status === "SERVER_START_FAILED" && config.models.llamacpp.auto_start);
  }
  return true;
}

async function isOllamaReady(timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function parseKind(value: unknown): InterfaceAnalysisKind {
  const token = normalizedKindToken(value);
  if (["build_request", "build", "app_request", "project_request", "create_app"].includes(token)) return "build_request";
  if (["needs_clarification", "clarification", "ask_user", "need_more_info", "needs_more_info"].includes(token)) return "needs_clarification";
  if (["meta", "help", "capability", "question"].includes(token)) return "meta";
  return "unknown";
}

function parseCompiledPlanControlKind(value: unknown): CompiledPlanControlKind {
  const token = normalizedKindToken(value);
  if (["start_current_plan", "start", "continue", "resume", "proceed", "accept", "approve", "go"].includes(token)) return "start_current_plan";
  if (["inspect_plan", "inspect", "show_plan", "plan", "spec", "requirements", "acceptance"].includes(token)) return "inspect_plan";
  if (["change_plan", "change", "replace_plan", "new_plan", "different_plan", "switch_plan"].includes(token)) return "change_plan";
  if (["reset_plan", "reset", "cancel", "cancel_build", "discard", "discard_build", "start_over", "start_fresh", "clear_build", "delete_build"].includes(token)) return "reset_plan";
  if (["show_progress", "progress", "status", "next", "whats_next"].includes(token)) return "show_progress";
  if (["thanks", "thank_you", "ack", "acknowledge"].includes(token)) return "thanks";
  return "unknown";
}

function normalizedKindToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

function normalizeConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  if (number > 1 && number <= 100) return number / 100;
  return Math.max(0, Math.min(1, number));
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return cleanStrings([value]);
  if (!Array.isArray(value)) return [];
  return cleanStrings(value);
}

function cleanStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => stringValue(value)).filter((value): value is string => Boolean(value)))];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed || undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
