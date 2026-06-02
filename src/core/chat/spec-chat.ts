import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MmcConfig } from "../config/defaults.js";
import { compileSpecInput, type CompileResult } from "../spec/compiler.js";
import { persistCompileResult } from "../mission/ledger.js";
import { missionDir } from "../storage/sqlite.js";
import { runWebSearch, type WebResearchPacket } from "../web/research.js";
import {
  analyzeIntent,
  buildBriefPatch,
  isExplicitIntentRequest,
  shouldApplyIntentAnalysis,
  unresolvedRiskQuestions,
  type RiskGate,
  type IntentAnalysis,
  type BriefPatch,
} from "./intent.js";

export type SpecChatStatus = "collecting" | "compiled";

export type SpecChatMessage = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type SpecChatQuestion = {
  id: "app_goal" | "users" | "workflows" | "data" | "acceptance" | "constraints";
  text: string;
};

export type SpecChatBrief = {
  goal?: string;
  users?: string;
  workflows: string[];
  data: string[];
  acceptance: string[];
  constraints: string[];
  notes: string[];
  standard_context?: SpecChatStandardContext;
  risk_flags?: string[];
  unresolved_risks?: RiskGate[];
};

export type SpecChatStandardContext = {
  status: WebResearchPacket["status"];
  query: string;
  generated_at: string;
  sources: Array<{ title: string; url: string; snippet: string }>;
  error?: string;
};

export type SpecChatState = {
  chat_id: string;
  status: SpecChatStatus;
  created_at: string;
  updated_at: string;
  messages: SpecChatMessage[];
  brief: SpecChatBrief;
  pending_questions: SpecChatQuestion[];
  compiled_spec_path?: string;
  compile_result?: CompileResult;
};

export type SpecChatTurnResult = {
  state: SpecChatState;
  assistant_text: string;
  compiled_spec_path?: string;
  compile_result?: CompileResult;
  state_path: string;
  draft_spec_path: string;
};

const QUESTION_BANK: SpecChatQuestion[] = [
  { id: "app_goal", text: "What are we building, in one concrete sentence?" },
  { id: "users", text: "Who is this for, and what do they need to accomplish first?" },
  { id: "workflows", text: "What are the core workflows or screens? List the must-have actions." },
  { id: "data", text: "What data does it store, import, or display?" },
  { id: "acceptance", text: "What proves it is done? Give observable acceptance checks." },
  { id: "constraints", text: "What is out of scope, risky, or must not change?" },
];

export function loadSpecChatState(cwd: string, config: MmcConfig): SpecChatState {
  const file = specChatStatePath(cwd, config);
  if (!fs.existsSync(file)) return newSpecChatState();
  return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SpecChatState>);
}

export function resetSpecChatState(cwd: string, config: MmcConfig): SpecChatState {
  const state = newSpecChatState();
  saveSpecChatState(cwd, config, state);
  return state;
}

export async function handleSpecChatTurn(cwd: string, config: MmcConfig, userText: string): Promise<SpecChatTurnResult> {
  const trimmed = userText.trim();
  if (!trimmed) throw new Error("chat requires a message");
  let state = loadSpecChatState(cwd, config);
  if (state.status === "collecting" && shouldReplaceCollectingBrief(state, trimmed)) {
    state = newSpecChatState();
  }
  state.messages.push({ role: "user", content: trimmed, created_at: new Date().toISOString() });
  if (state.status === "compiled" && state.compiled_spec_path && state.compile_result) {
    const assistant_text = compiledFollowUpReply();
    state.messages.push({ role: "assistant", content: assistant_text, created_at: new Date().toISOString() });
    state.updated_at = new Date().toISOString();
    saveSpecChatState(cwd, config, state);
    return {
      state,
      assistant_text,
      compiled_spec_path: state.compiled_spec_path,
      compile_result: state.compile_result,
      state_path: specChatStatePath(cwd, config),
      draft_spec_path: specChatDraftPath(cwd, config),
    };
  }
  mergeUserTextIntoBrief(state, trimmed);
  await refreshStandardContext(config, state, trimmed);

  const compile = maybeCompileChatSpec(cwd, config, state);
  if (compile) {
    state.status = "compiled";
    state.compiled_spec_path = compile.path;
    state.compile_result = compile.result;
    state.pending_questions = [];
  } else {
    state.status = "collecting";
    state.pending_questions = nextQuestions(state.brief);
  }

  const assistant_text = compile ? compiledReply(compile.result, state) : collectingReply(state);
  state.messages.push({ role: "assistant", content: assistant_text, created_at: new Date().toISOString() });
  state.updated_at = new Date().toISOString();
  persistDraft(cwd, config, state);
  saveSpecChatState(cwd, config, state);
  return {
    state,
    assistant_text,
    compiled_spec_path: state.compiled_spec_path,
    compile_result: state.compile_result,
    state_path: specChatStatePath(cwd, config),
    draft_spec_path: specChatDraftPath(cwd, config),
  };
}

export function specChatStatePath(cwd: string, config: MmcConfig): string {
  return path.join(missionDir(cwd, config), "chat", "spec-chat.json");
}

export function specChatDraftPath(cwd: string, config: MmcConfig): string {
  return path.join(missionDir(cwd, config), "chat", "spec-chat.md");
}

export function buildSpecMarkdown(state: SpecChatState, options: { includeStandardContext?: boolean } = {}): string {
  const brief = state.brief;
  const requirements = [
    brief.goal ? implementationRequirement(brief.goal) : undefined,
    ...brief.workflows.map(trimSentence),
    ...brief.data.map((item) => `Handle data: ${trimSentence(item)}.`),
  ].filter((line): line is string => Boolean(line));
  const acceptance = brief.acceptance.length
    ? brief.acceptance.map(trimSentence)
    : ["The requested behavior is implemented and `npm test` passes."];
  const nonGoals = brief.constraints.length ? brief.constraints.map(trimSentence) : ["Production deployment is out of scope unless requested."];
  return [
    `# ${brief.goal ?? "Untitled app"}`,
    "",
    "## Requirements",
    ...requirements.map((item) => `- ${item}`),
    "",
    "## Acceptance",
    ...acceptance.map((item) => `- ${item}`),
    "",
    "## Non Goals",
    ...nonGoals.map((item) => `- ${item}`),
    ...(options.includeStandardContext === false ? [] : standardContextMarkdown(brief)),
    "",
  ].join("\n");
}

function newSpecChatState(): SpecChatState {
  const now = new Date().toISOString();
  return {
    chat_id: `C-${randomUUID().slice(0, 8)}`,
    status: "collecting",
    created_at: now,
    updated_at: now,
    messages: [],
    brief: {
      workflows: [],
      data: [],
      acceptance: [],
      constraints: [],
      notes: [],
    },
    pending_questions: QUESTION_BANK.slice(0, 3),
  };
}

function normalizeState(input: Partial<SpecChatState>): SpecChatState {
  const state = newSpecChatState();
  return {
    ...state,
    ...input,
    brief: {
      ...state.brief,
      ...(input.brief ?? {}),
      workflows: unique(input.brief?.workflows ?? []),
      data: unique(input.brief?.data ?? []),
      acceptance: unique(input.brief?.acceptance ?? []),
      constraints: unique(input.brief?.constraints ?? []),
      notes: unique(input.brief?.notes ?? []),
      standard_context: input.brief?.standard_context,
      risk_flags: unique(input.brief?.risk_flags ?? []),
      unresolved_risks: unique(input.brief?.unresolved_risks ?? []) as RiskGate[],
    },
    messages: input.messages ?? [],
    pending_questions: input.pending_questions ?? state.pending_questions,
  };
}

function saveSpecChatState(cwd: string, config: MmcConfig, state: SpecChatState): void {
  const file = specChatStatePath(cwd, config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function persistDraft(cwd: string, config: MmcConfig, state: SpecChatState): void {
  const file = specChatDraftPath(cwd, config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buildSpecMarkdown(state), "utf8");
}

function mergeUserTextIntoBrief(state: SpecChatState, text: string): void {
  const hadBriefBeforeTurn = hasBuildBrief(state.brief);
  const intent = analyzeIntent(text);
  const willApplyIntent = (!hadBriefBeforeTurn || isExplicitIntentRequest(text, intent)) && shouldApplyIntentAnalysis(text, intent);
  state.brief.notes = unique([...state.brief.notes, text]);
  if (state.pending_questions.length === 1) {
    assignAnswer(state.brief, state.pending_questions[0].id, text);
  }
  if (!state.brief.goal && isGoalLike(text)) state.brief.goal = firstSentence(text);
  if (mentionsUsers(text) && !state.brief.users) state.brief.users = text;
  if (mentionsData(text)) state.brief.data = unique([...state.brief.data, ...splitList(text)]);
  if (mentionsAcceptance(text)) state.brief.acceptance = unique([...state.brief.acceptance, ...splitList(text)]);
  if (mentionsConstraint(text)) state.brief.constraints = unique([...state.brief.constraints, ...splitList(text)]);
  if (mentionsWorkflow(text) && !willApplyIntent) state.brief.workflows = unique([...state.brief.workflows, ...splitList(text)]);
  if (willApplyIntent) {
    applyIntentPatch(state.brief, buildBriefPatch(text, intent), intent);
  }
  refreshBriefRiskState(state.brief);
}

function assignAnswer(brief: SpecChatBrief, id: SpecChatQuestion["id"], text: string): void {
  if (!isSubstantive(text)) return;
  if (id === "app_goal" && !brief.goal) brief.goal = firstSentence(text);
  if (id === "users" && !brief.users) brief.users = text;
  if (id === "workflows") brief.workflows = unique([...brief.workflows, ...splitList(text)]);
  if (id === "data") brief.data = unique([...brief.data, ...splitList(text)]);
  if (id === "acceptance") brief.acceptance = unique([...brief.acceptance, ...splitList(text)]);
  if (id === "constraints") brief.constraints = unique([...brief.constraints, ...splitList(text)]);
}

function applyIntentPatch(brief: SpecChatBrief, patch: BriefPatch, analysis: IntentAnalysis): void {
  if (patch.goal && (!brief.goal || shouldReplaceGoalWithPatch(brief.goal, analysis))) brief.goal = patch.goal;
  if (patch.users && !brief.users) brief.users = patch.users;
  brief.workflows = unique([...brief.workflows, ...patch.workflows]);
  brief.acceptance = unique([...brief.acceptance, ...patch.acceptance]);
  brief.data = unique([...brief.data, ...patch.data]);
  brief.constraints = unique([...brief.constraints, ...patch.constraints]);
  brief.risk_flags = unique([...(brief.risk_flags ?? []), ...patch.risk_flags]);
  brief.unresolved_risks = unique([...(brief.unresolved_risks ?? []), ...patch.unresolved_risks]) as RiskGate[];
}

function shouldReplaceGoalWithPatch(currentGoal: string, analysis: IntentAnalysis): boolean {
  if (analysis.bare_known_request) return true;
  if (analysis.slots.modifiers.length || analysis.slots.workflow_requirements.length || analysis.slots.personas.length) return false;
  return currentGoal.trim().split(/\s+/).length <= 6;
}

function refreshBriefRiskState(brief: SpecChatBrief): void {
  const analysis = analyzeIntent(userSuppliedRiskText(brief));
  const resolved = riskResolutionText(brief);
  const unresolved = analysis.unresolved_risks.filter((risk) => !resolved.includes(risk));
  if (analysis.risk_flags.length || brief.risk_flags?.length) {
    brief.risk_flags = unique([...(brief.risk_flags ?? []), ...analysis.risk_flags]);
  }
  brief.unresolved_risks = unique(unresolved) as RiskGate[];
}

function riskResolutionText(brief: SpecChatBrief): RiskGate[] {
  const text = [brief.users, ...brief.workflows, ...brief.acceptance, ...brief.notes].join("\n");
  const resolved: RiskGate[] = [];
  if (/\b(local-only demo|do not store real|no real secrets|encrypted local storage|production-grade secret handling)\b/i.test(text)) {
    resolved.push("security_sensitive");
  }
  if (/\b(local only|local-only|mock|already configured|test key|configured external|no live|without live)\b/i.test(text)) {
    resolved.push("external_service");
  }
  if (brief.workflows.length > 1 && brief.acceptance.length > 0 && !/\b(better|improve|improved|improving|enhance|fix|clean up|polish|nice|modernize|optimize|stuff|things)\b/i.test(brief.workflows.join("\n"))) {
    resolved.push("vague");
  }
  return resolved;
}

function userSuppliedRiskText(brief: SpecChatBrief): string {
  return [
    brief.goal,
    brief.users,
    ...brief.workflows,
    ...brief.data,
    ...brief.acceptance,
    ...brief.notes,
  ].filter(Boolean).join("\n");
}

function maybeCompileChatSpec(cwd: string, config: MmcConfig, state: SpecChatState): { result: CompileResult; path: string } | null {
  if (!isBuildable(state.brief)) return null;
  const result = compileSpecInput(buildSpecMarkdown(state, { includeStandardContext: false }), "markdown");
  if (result.status !== "compiled") {
    state.pending_questions = result.blocking_questions.map((text) => ({ id: "acceptance", text }));
    return null;
  }
  return { result, path: persistCompileResult(cwd, config, result) };
}

function isBuildable(brief: SpecChatBrief): boolean {
  return Boolean(brief.goal && brief.workflows.length > 0 && brief.acceptance.length > 0 && (brief.unresolved_risks?.length ?? 0) === 0);
}

function nextQuestions(brief: SpecChatBrief): SpecChatQuestion[] {
  const text = briefText(brief);
  if (brief.unresolved_risks?.length) {
    return unresolvedRiskQuestions(brief.unresolved_risks).map((question, index) => ({
      id: index === 0 ? "constraints" : "acceptance",
      text: question,
    }));
  }
  const missing = QUESTION_BANK.filter((question) => {
    if (question.id === "app_goal") return !brief.goal;
    if (question.id === "users") return !brief.users;
    if (question.id === "workflows") return brief.workflows.length === 0;
    if (question.id === "data") return brief.data.length === 0 && needsDataQuestion(text);
    if (question.id === "acceptance") return brief.acceptance.length === 0;
    if (question.id === "constraints") return brief.constraints.length === 0 && needsConstraintQuestion(text);
    return false;
  });
  return missing.slice(0, 2);
}

function collectingReply(state: SpecChatState): string {
  const questions = state.pending_questions.length ? state.pending_questions : nextQuestions(state.brief);
  const lines = [`${state.brief.goal ? `Got it: ${state.brief.goal}.` : "Got it."} I need a little more before I can build it well.`];
  const securityWarning = securityScopeWarning(state.brief);
  if (securityWarning) lines.push(securityWarning);
  const externalWarning = externalSetupWarning(state.brief);
  if (externalWarning) lines.push(externalWarning);
  const standardQuestion = standardContextQuestion(state.brief);
  if (standardQuestion) lines.push(standardQuestion);
  if (questions.length) {
    lines.push("Tell me:");
    lines.push(...questions.map((question) => `- ${question.text}`));
  }
  return lines.join("\n");
}

function compiledReply(result: CompileResult, state: SpecChatState): string {
  const lines = ["I have a build plan."];
  if (state.brief.standard_context?.status === "READY" && state.brief.standard_context.sources.length > 0) {
    lines.push("I checked current web references and saved the source notes with it.");
  }
  lines.push(`I broke it into ${result.task_graph.tasks.length} build steps.`);
  lines.push("Next: say `build it` or run `/build start`.");
  return lines.join("\n");
}

function compiledFollowUpReply(): string {
  return [
    "I already have the build plan.",
    "Ask `what's the plan?` to inspect it, or say `build it` to start.",
    "To change direction, run `/chat reset` and describe the new version.",
  ].join("\n");
}

async function refreshStandardContext(config: MmcConfig, state: SpecChatState, userText: string): Promise<void> {
  if (!shouldUseStandardContext(config, state, userText)) return;
  const query = buildStandardContextQuery(state.brief, userText);
  if (!query || state.brief.standard_context?.query === query) return;
  const packet = await runWebSearch(config, query);
  state.brief.standard_context = {
    status: packet.status,
    query: packet.query,
    generated_at: packet.generated_at,
    sources: packet.results.slice(0, 3).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
    })),
    error: packet.error,
  };
}

function shouldUseStandardContext(config: MmcConfig, state: SpecChatState, userText: string): boolean {
  if (!config.web_research.enabled || !config.web_research.auto_include_in_chat) return false;
  if (isMetaChat(userText)) return false;
  return Boolean(state.brief.goal || state.brief.workflows.length || state.brief.acceptance.length);
}

function buildStandardContextQuery(brief: SpecChatBrief, userText: string): string {
  const goal = brief.goal ?? userText;
  return [goal, brief.users, ...brief.workflows.slice(0, 3), "standard UX requirements acceptance criteria examples"]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function standardContextQuestion(brief: SpecChatBrief): string | null {
  const text = briefText(brief);
  if (!brief.standard_context || brief.standard_context.status !== "READY" || brief.workflows.length > 0) return null;
  if (/\bcrm\b/i.test(text)) {
    return "Common CRM shape usually means contacts, pipeline stages, notes, and follow-ups; tell me which of those belong in v1.";
  }
  if (/\bdashboard\b/i.test(text)) {
    return "For a dashboard, the important choices are metrics, filters, and empty/loading/error states.";
  }
  if (/\b(todo|task|tracker)\b/i.test(text)) {
    return "For a tracker, decide whether v1 needs due dates, priority, categories, or history.";
  }
  return null;
}

function standardContextMarkdown(brief: SpecChatBrief): string[] {
  const context = brief.standard_context;
  if (!context) return [];
  const lines = ["", "## Standards Context", `- Query: ${context.query}`, `- Status: ${context.status}`];
  if (context.error) lines.push(`- Error: ${context.error}`);
  lines.push(...context.sources.map((source) => `- ${source.title}: ${source.url}${source.snippet ? ` - ${source.snippet}` : ""}`));
  return lines;
}

function splitList(text: string): string[] {
  const bulletItems = text
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));
  if (bulletItems.length) return bulletItems.map(trimSentence);
  return text
    .split(/[.;]\s+/)
    .map((item) => trimSentence(item))
    .filter((item) => item.length > 0);
}

function firstSentence(text: string): string {
  return trimSentence(text.split(/[.!?]\s+/)[0] ?? text);
}

function implementationRequirement(goal: string): string {
  const trimmed = trimSentence(goal)
    .replace(/^(let'?s|let us)\s+/i, "")
    .replace(/^i\s+(want|need|would like)\s+to\s+/i, "");
  if (/^(build|create|implement|add|make)\b/i.test(trimmed)) {
    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
  }
  return `Build ${trimmed}.`;
}

function trimSentence(text: string): string {
  return text.trim().replace(/\s+/g, " ").replace(/[.]+$/, "");
}

function isSubstantive(text: string): boolean {
  return text.trim().split(/\s+/).length >= 3;
}

function isGoalLike(text: string): boolean {
  if (!isSubstantive(text)) return false;
  if (isMetaChat(text)) return false;
  return /^(let'?s|let us|i\s+(want|need|would like)\s+to\s+)?(build|make|create|implement|add)\b/i.test(text)
    || /\b(app|game|site|website|dashboard|crm|tracker|tool|browser|web)\b/i.test(text);
}

function isMetaChat(text: string): boolean {
  return /^(what can you do|what do you need|thanks|thank you|ok|okay|\?+|what\?|huh|help)\b/i.test(text.trim());
}

function mentionsUsers(text: string): boolean {
  return /\b(users?|customers?|admins?|teams?|operators?|visitors?|clients?)\b/i.test(text);
}

function mentionsWorkflow(text: string): boolean {
  return /\b(can|should|must|workflow|screen|page|view|create|edit|delete|search|filter|upload|import|export|track|build|show|manage)\b/i.test(text);
}

function mentionsData(text: string): boolean {
  return /\b(data|database|store|save|record|schema|import|export|file|api|auth|login|account|profile|payment|invoice)\b/i.test(text);
}

function mentionsAcceptance(text: string): boolean {
  return /\b(done|acceptance|verify|test|passes|prove|should show|can run|browser|works|success)\b/i.test(text);
}

function mentionsConstraint(text: string): boolean {
  return /\b(out of scope|non-goal|do not|don't|must not|avoid|risk|constraint|security|privacy|no )\b/i.test(text);
}

function briefText(brief: SpecChatBrief): string {
  return [
    brief.goal,
    brief.users,
    ...brief.workflows,
    ...brief.data,
    ...brief.acceptance,
    ...brief.constraints,
    ...(brief.risk_flags ?? []),
    ...(brief.unresolved_risks ?? []),
    ...brief.notes,
  ].filter(Boolean).join("\n");
}

function needsDataQuestion(text: string): boolean {
  return /\b(crm|dashboard|tracker|database|admin|billing|invoice|auth|account|upload|import|export|store|save|records?|users?)\b/i.test(text);
}

function needsConstraintQuestion(text: string): boolean {
  return /\b(auth|payment|billing|invoice|admin|pii|privacy|security|database|production|deploy|migration)\b/i.test(text);
}

function isVagueBrief(text: string): boolean {
  return /\b(better|improve|improved|improving|enhance|fix|clean up|polish|nice|modernize|optimize|stuff|things)\b/i.test(text);
}

function requiresExternalSetup(text: string): boolean {
  return /\b(stripe|payments?|checkout|billing|deploy|deployment|production|hosting|domain|live|api key|external api|third-party api|oauth|live weather)\b/i.test(text);
}

function externalSetupWarning(brief: SpecChatBrief): string | null {
  const text = briefText(brief);
  if (!requiresExternalSetup(text)) return null;
  const needsPaymentOrDeploy = /\b(stripe|payments?|checkout|billing|deploy|deployment|production|hosting|domain)\b/i.test(text);
  if (!needsPaymentOrDeploy && /\b(api key|external api|third-party api|oauth|live weather)\b/i.test(text)) {
    return "I can build the local app path, but third-party APIs need configured accounts, keys, and targets.";
  }
  return "I can build the local app path, but live payments, deployment, or third-party APIs need configured accounts, keys, and targets.";
}

function requiresSensitiveSecurityScope(text: string): boolean {
  return /\b(password manager|secret manager|credential manager|store passwords?|store secrets?|vault)\b/i.test(text);
}

function securityScopeWarning(brief: SpecChatBrief): string | null {
  if (!requiresSensitiveSecurityScope(briefText(brief))) return null;
  return "A password or secret manager is security-sensitive; I need the safety model before pretending this is buildable.";
}

function shouldReplaceCollectingBrief(state: SpecChatState, text: string): boolean {
  if (!state.brief.goal) return false;
  const intent = analyzeIntent(text);
  if (!isExplicitIntentRequest(text, intent)) return false;
  return true;
}

function hasBuildBrief(brief: SpecChatBrief): boolean {
  return Boolean(brief.goal || brief.workflows.length > 0 || brief.acceptance.length > 0 || brief.data.length > 0);
}

function unique(items: string[]): string[] {
  return [...new Set(items.map(trimSentence).filter(Boolean))];
}
