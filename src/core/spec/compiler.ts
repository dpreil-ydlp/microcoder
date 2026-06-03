import { randomUUID } from "node:crypto";
import { createValidator } from "../schemas/validator.js";

export type Requirement = {
  id: string;
  text: string;
};

export type AcceptanceCriterion = {
  id: string;
  text: string;
  verification: string;
};

export type CompiledSpec = {
  spec_id: string;
  goal: string;
  requirements: Requirement[];
  acceptance_criteria: AcceptanceCriterion[];
  non_goals: string[];
  risk_flags: string[];
  ui_states?: string[];
  security_constraints?: string[];
  data_model_changes?: string[];
};

export type TaskGraph = {
  tasks: RuntimeTask[];
};

export type RuntimeTask = {
  id: string;
  title: string;
  description?: string;
  status: "todo" | "ready" | "running" | "blocked" | "complete" | "failed";
  depends_on: string[];
  requirement_ids?: string[];
  acceptance_ids: string[];
  allowed_files?: string[];
  forbidden_files?: string[];
  verification_commands?: string[];
  risk_flags?: string[];
};

export type CompileResult = {
  status: "compiled" | "needs_clarification";
  spec: CompiledSpec;
  blocking_questions: string[];
  task_graph: TaskGraph;
};

export type SpecInputType = "prompt" | "markdown" | "json";

const VAGUE_WORDS = /\b(better|improve|improved|improving|enhance|fix|clean up|polish|nice|modernize|optimize|stuff|things)\b/i;

export function compileSpecInput(content: string, inputType: SpecInputType = detectInputType(content)): CompileResult {
  const spec = inputType === "json" ? compileJsonSpec(content) : compileTextSpec(content, inputType);
  const blocking_questions = generateBlockingQuestions(spec, content);
  const task_graph = generateTaskGraph(spec, blocking_questions.length === 0);
  const status = blocking_questions.length === 0 ? "compiled" : "needs_clarification";

  const validator = createValidator();
  validator.assert("CompiledSpec", spec);
  validator.assert("TaskGraph", task_graph);
  assertAcyclic(task_graph);

  return { status, spec, blocking_questions, task_graph };
}

export function detectInputType(content: string): SpecInputType {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (/^#{1,6}\s+/m.test(trimmed) || /\n[-*]\s+/.test(trimmed)) return "markdown";
  return "prompt";
}

export function generateTaskGraph(spec: CompiledSpec, ready: boolean): TaskGraph {
  const acceptanceIds = spec.acceptance_criteria.map((criterion) => criterion.id);
  const allowedFiles = inferAllowedFiles(spec);
  const verificationCommands = inferTaskVerificationCommands(spec);
  const descriptionSuffix = buildTaskDescriptionSuffix(spec, verificationCommands, allowedFiles);
  const tasks = spec.requirements.map((requirement, index) => ({
    id: `T${index + 1}`,
    title: requirement.text.length > 80 ? `${requirement.text.slice(0, 77)}...` : requirement.text,
    description: [requirement.text, descriptionSuffix].filter(Boolean).join("\n\n"),
    status: ready && index === 0 ? "ready" as const : "todo" as const,
    depends_on: index === 0 ? [] : [`T${index}`],
    requirement_ids: [requirement.id],
    acceptance_ids: acceptanceIds,
    allowed_files: allowedFiles,
    forbidden_files: [".env", ".env.local", ".npmrc"],
    verification_commands: verificationCommands,
    risk_flags: spec.risk_flags,
  }));
  return { tasks };
}

function buildTaskDescriptionSuffix(spec: CompiledSpec, verificationCommands: string[], allowedFiles: string[]): string {
  const acceptance = spec.acceptance_criteria.map((criterion) => `${criterion.id}: ${criterion.text}`).join(" ");
  const lines = [
    acceptance ? `Acceptance criteria: ${acceptance}` : undefined,
    verificationCommands.length ? `Verification commands must pass: ${verificationCommands.join(", ")}.` : undefined,
    verificationCommands.includes("npm test") ? "If creating package.json, do not use the default failing npm test placeholder." : undefined,
    verificationCommands.includes("npm test") && allowedFiles.includes("src/main.js")
      ? "For browser JavaScript projects, package.json test can run: node --check src/main.js."
      : undefined,
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function inferAllowedFiles(spec: CompiledSpec): string[] {
  const text = `${spec.goal}\n${spec.requirements.map((requirement) => requirement.text).join("\n")}`;
  if (!/\b(browser|web|html|frontend|game|canvas|page|site|app)\b/i.test(text)) return [];
  return ["package.json", "index.html", "src/main.js", "src/styles.css", "README.md"];
}

function inferTaskVerificationCommands(spec: CompiledSpec): string[] {
  const commands = spec.acceptance_criteria.map((criterion) => criterion.verification).filter(Boolean);
  return commands.length ? [...new Set(commands)] : ["npm test"];
}

export function generateBlockingQuestions(spec: CompiledSpec, originalContent: string): string[] {
  const questions: string[] = [];
  const text = `${spec.goal}\n${originalContent}`;
  const hasAcceptance = spec.acceptance_criteria.length > 0;
  const vague = VAGUE_WORDS.test(text);

  if (!hasAcceptance || vague) {
    questions.push("What measurable acceptance criteria prove this is done, and which command or check verifies each one?");
  }
  if (vague) {
    questions.push("Which exact user-visible behavior should change, and what current behavior should remain unchanged?");
  }
  if ((vague || !hasAcceptance) && /\bdashboard\b/i.test(text)) {
    questions.push("Which dashboard data, states, filters, and empty/error/loading behavior are required?");
  }
  if ((vague || !hasAcceptance) && /\b(auth|payment|billing|invoice|schema|migration|pii|secret)\b/i.test(text)) {
    questions.push("What security, data, and rollback constraints apply to this change?");
  }
  return [...new Set(questions)];
}

function compileJsonSpec(content: string): CompiledSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`JSON spec parse failed: ${(error as Error).message}`);
  }
  if (!isObject(parsed)) throw new Error("JSON spec must be an object");

  const source = parsed as Record<string, unknown>;
  const goal = stringValue(source.goal) || stringValue(source.title) || "Untitled mission";
  const requirements = normalizeStringOrObjects(source.requirements, "R", goal);
  const acceptance = normalizeAcceptance(source.acceptance_criteria ?? source.acceptanceCriteria);
  const riskFlags = normalizeStringArray(source.risk_flags ?? source.riskFlags);

  const spec: CompiledSpec = {
    spec_id: stringValue(source.spec_id) || `S-${shortId()}`,
    goal,
    requirements: requirements.length ? requirements : [{ id: "R1", text: goal }],
    acceptance_criteria: acceptance,
    non_goals: normalizeStringArray(source.non_goals ?? source.nonGoals),
    risk_flags: [...new Set([...riskFlags, ...inferRiskFlags(goal)])],
  };

  if (Array.isArray(source.ui_states)) spec.ui_states = normalizeStringArray(source.ui_states);
  if (Array.isArray(source.security_constraints)) spec.security_constraints = normalizeStringArray(source.security_constraints);
  if (Array.isArray(source.data_model_changes)) spec.data_model_changes = normalizeStringArray(source.data_model_changes);
  return spec;
}

function compileTextSpec(content: string, inputType: SpecInputType): CompiledSpec {
  const goal = extractGoal(content, inputType);
  const requirements = extractRequirements(content, goal);
  const acceptance_criteria = inputType === "markdown" ? extractAcceptanceCriteria(content) : inferPromptAcceptanceCriteria(content);
  return {
    spec_id: `S-${shortId()}`,
    goal,
    requirements,
    acceptance_criteria,
    non_goals: extractSectionBullets(content, /non[- ]?goals?|out of scope/i),
    risk_flags: inferRiskFlags(content),
    ui_states: /\b(frontend|ui|screen|page|component|dashboard|form|chat)\b/i.test(content)
      ? ["loading", "empty", "error", "success"]
      : undefined,
  };
}

function inferPromptAcceptanceCriteria(content: string): AcceptanceCriterion[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (/\b(browser|web|html|frontend|game|canvas|page|site|app)\b/i.test(trimmed)) {
    return [
      {
        id: "AC1",
        text: "A runnable browser experience implements the requested behavior.",
        verification: "npm test",
      },
      {
        id: "AC2",
        text: "The project includes a clear local run path for opening or serving it in a browser.",
        verification: "npm test",
      },
    ];
  }
  return [
    {
      id: "AC1",
      text: "The requested behavior is implemented and the configured verifier passes.",
      verification: "npm test",
    },
  ];
}

function extractGoal(content: string, inputType: SpecInputType): string {
  const trimmed = content.trim();
  if (inputType === "markdown") {
    const heading = trimmed.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading;
  }
  const firstLine = trimmed.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
  return firstLine ? firstLine.replace(/^goal:\s*/i, "") : "Untitled mission";
}

function extractRequirements(content: string, goal: string): Requirement[] {
  const fromSection = extractSectionBullets(content, /requirements?|functional requirements?/i);
  const lines = fromSection.length ? fromSection : splitSentences(goal);
  return lines.map((text, index) => ({ id: `R${index + 1}`, text }));
}

function extractAcceptanceCriteria(content: string): AcceptanceCriterion[] {
  return extractSectionBullets(content, /acceptance|success criteria|exit criteria/i).map((text, index) => ({
    id: `AC${index + 1}`,
    text,
    verification: inferVerification(text),
  }));
}

function extractSectionBullets(content: string, headingPattern: RegExp): string[] {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      inSection = headingPattern.test(line);
      continue;
    }
    if (!inSection) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim();
    if (bullet) output.push(bullet);
  }
  return output;
}

function normalizeStringOrObjects(value: unknown, prefix: string, fallback: string): Requirement[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (typeof item === "string") return { id: `${prefix}${index + 1}`, text: item };
      if (isObject(item)) {
        const text = stringValue(item.text) || stringValue(item.title);
        if (!text) return null;
        return { id: stringValue(item.id) || `${prefix}${index + 1}`, text };
      }
      return null;
    })
    .filter((item): item is Requirement => item !== null && item.text.trim().length > 0)
    .concat(value.length === 0 ? [{ id: `${prefix}1`, text: fallback }] : []);
}

function normalizeAcceptance(value: unknown): AcceptanceCriterion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (typeof item === "string") {
        return { id: `AC${index + 1}`, text: item, verification: inferVerification(item) };
      }
      if (isObject(item)) {
        const text = stringValue(item.text) || stringValue(item.title);
        if (!text) return null;
        return {
          id: stringValue(item.id) || `AC${index + 1}`,
          text,
          verification: stringValue(item.verification) || inferVerification(text),
        };
      }
      return null;
    })
    .filter((item): item is AcceptanceCriterion => item !== null);
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function splitSentences(value: string): string[] {
  const parts = value
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [value.trim()];
}

function inferVerification(text: string): string {
  if (/\b(typecheck|tsc)\b/i.test(text)) return "npm run typecheck";
  if (/\b(lint)\b/i.test(text)) return "npm run lint";
  if (/\b(playwright|viewport|screenshot)\b/i.test(text)) return "npx playwright test";
  return "npm test";
}

function inferRiskFlags(text: string): string[] {
  const flags: string[] = [];
  if (/\b(auth|permission|login|session)\b/i.test(text)) flags.push("auth");
  if (/\b(payment|invoice|billing|money|credit card|debit card|card payments?)\b/i.test(text)) flags.push("billing");
  if (/\b(schema|migration|database|db)\b/i.test(text)) flags.push("schema");
  if (/\b(secret|token|password|credential|pii)\b/i.test(text)) flags.push("sensitive_data");
  if (/\b(frontend|ui|screen|page|component|dashboard|form|chat)\b/i.test(text)) flags.push("frontend");
  return flags;
}

function assertAcyclic(taskGraph: TaskGraph): void {
  const ids = new Set(taskGraph.tasks.map((task) => task.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) throw new Error(`task graph contains cycle at ${taskId}`);
    visiting.add(taskId);
    const task = taskGraph.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`task graph references missing task ${taskId}`);
    for (const dependency of task.depends_on) {
      if (!ids.has(dependency)) throw new Error(`task ${taskId} depends on missing task ${dependency}`);
      visit(dependency);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const task of taskGraph.tasks) visit(task.id);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortId(): string {
  return randomUUID().slice(0, 8);
}
