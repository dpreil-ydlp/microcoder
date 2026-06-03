import type { SpecChatBrief } from "./spec-chat.js";

export type IntentTag =
  | "list"
  | "completion"
  | "board"
  | "tracker"
  | "habit_tracker"
  | "workout_tracker"
  | "inventory_tracker"
  | "build_pipeline_tracker"
  | "timer"
  | "calculator"
  | "markdown"
  | "notes"
  | "game"
  | "matching_game"
  | "contacts"
  | "csv_import"
  | "finance"
  | "schedule"
  | "media"
  | "study"
  | "meal_plan";

export type RiskGate = "vague" | "external_service" | "security_sensitive";

export type IntentAnalysis = {
  confidence: number;
  tags: IntentTag[];
  canonical_goal?: string;
  explicit_request: boolean;
  bare_known_request: boolean;
  redirect_request: boolean;
  slots: {
    modifiers: string[];
    workflow_requirements: string[];
    data_terms: string[];
    constraints: string[];
    personas: string[];
  };
  risk_flags: string[];
  unresolved_risks: RiskGate[];
};

export type BriefPatch = {
  goal?: string;
  users?: string;
  workflows: string[];
  data: string[];
  acceptance: string[];
  constraints: string[];
  risk_flags: string[];
  unresolved_risks: RiskGate[];
};

const BUILD_PREFIX = /^(?:(?:let'?s|let us)\s+|i\s+(?:want|need|would like)\s+to\s+)?(build|make|create|implement|add)\b/i;
const REQUEST_PREFIX = /^(i\s+(?:want|need|would like|could use)\s+(?:a|an|the\s+)?|give me\s+(?:a|an|the\s+)?|i'?m looking for\s+(?:a|an|the\s+)?)/i;
const REDIRECT_PREFIX = /^(?:(?:wait|ok|okay)[,\s]+)?(actually|instead|scratch that|forget that|change (it|this) to|make it|no|nope|nah|wrong)\b/i;

export function analyzeIntent(text: string): IntentAnalysis {
  const trimmed = trimSentence(text);
  const lower = trimmed.toLowerCase();
  const tags: IntentTag[] = [];
  const addTag = (tag: IntentTag, when: boolean) => {
    if (when && !tags.includes(tag)) tags.push(tag);
  };

  addTag("board", /\bkanban\b|\bboard\b/i.test(trimmed) && /\b(task|card|todo|doing|done|column|kanban)\b/i.test(trimmed));
  addTag("list", /\b(to-?do|todo list|task list|checklist)\b/i.test(trimmed) && !/\bkanban\b/i.test(trimmed));
  addTag("completion", /\b(to-?do|todo|checklist|complete|done)\b/i.test(trimmed) && !/\bkanban\b/i.test(trimmed));
  addTag("timer", /\b(pomodoro|timer|countdown)\b/i.test(trimmed));
  addTag("calculator", /\bcalculator\b/i.test(trimmed));
  addTag("markdown", /\bmarkdown\b/i.test(trimmed) && /\bpreview|previewer|editor|render\b/i.test(trimmed));
  addTag("notes", isNotesAppRequest(trimmed));
  addTag("matching_game", /\bmemory\b/i.test(trimmed) && /\b(card|matching|match|game)\b/i.test(trimmed));
  addTag("game", /^snake$/i.test(trimmed) || /\b(snake|chess|puzzle|card game|board game|video game|matching game|game)\b/i.test(trimmed));
  addTag("contacts", /\b(crm|contacts?|leads?|follow-?ups?)\b/i.test(trimmed));
  addTag("csv_import", /\b(csv|import|upload)\b/i.test(trimmed));
  addTag("finance", /\b(expense|budget|spending|income|category totals?|money)\b/i.test(trimmed));
  addTag("schedule", /\b(rsvp|event|guest|attendee|calendar|schedule)\b/i.test(trimmed));
  addTag("media", /\b(image|photo|gallery|album)\b/i.test(trimmed));
  addTag("study", /\b(flashcards?|quiz|study)\b/i.test(trimmed));
  addTag("meal_plan", /\b(recipe|meal|grocery|shopping list)\b/i.test(trimmed));
  addTag("habit_tracker", /\bhabit\s+tracker\b/i.test(trimmed) || /\b(track|log|check off)\s+(my\s+)?habits?\b/i.test(trimmed));
  addTag("workout_tracker", /\b(workout|exercise|fitness)\s+tracker\b/i.test(trimmed));
  addTag("inventory_tracker", /\binventory\s+tracker\b/i.test(trimmed));
  addTag("build_pipeline_tracker", /\b(build pipeline|ci|deployment pipeline)\s+tracker\b/i.test(trimmed));
  addTag("tracker", hasTrackerIntent(trimmed) && !tags.includes("board"));

  const slots = extractSlots(trimmed);
  const risk_flags = inferRiskFlags(trimmed);
  const unresolved_risks = inferUnresolvedRisks(trimmed);
  const bare_known_request = isBareKnownRequest(trimmed, tags);
  const explicit_request = BUILD_PREFIX.test(trimmed) || bare_known_request || REDIRECT_PREFIX.test(trimmed) || (REQUEST_PREFIX.test(trimmed) && tags.length > 0);
  const canonical_goal = canonicalGoal(trimmed, tags);
  const confidence = scoreIntent(trimmed, tags, slots, explicit_request, bare_known_request);

  return {
    confidence,
    tags,
    canonical_goal,
    explicit_request,
    bare_known_request,
    redirect_request: REDIRECT_PREFIX.test(trimmed),
    slots,
    risk_flags,
    unresolved_risks,
  };
}

export function shouldApplyIntentAnalysis(text: string, analysis = analyzeIntent(text)): boolean {
  if (!analysis.explicit_request) return false;
  if (analysis.unresolved_risks.includes("vague")) return false;
  if (!hasEnrichmentSignal(analysis)) return false;
  return analysis.confidence >= 0.35;
}

export function isExplicitIntentRequest(text: string, analysis = analyzeIntent(text)): boolean {
  return analysis.explicit_request && hasEnrichmentSignal(analysis) && analysis.confidence >= 0.35;
}

export function buildBriefPatch(text: string, analysis = analyzeIntent(text)): BriefPatch {
  const workflows = unique([
    ...baseWorkflows(analysis),
    ...analysis.slots.workflow_requirements.map((item) => asWorkflowRequirement(item)),
    ...analysis.slots.modifiers.map((item) => `Support ${item}`),
  ]);
  const data = unique([...baseData(analysis), ...analysis.slots.data_terms.map((item) => `Track ${item}`)]);
  const acceptance = unique([
    "npm test passes",
    acceptanceLine(analysis, workflows),
    ...analysis.slots.modifiers.map((item) => `The browser app supports ${item}`),
    ...analysis.slots.workflow_requirements.map((item) => `The browser app supports ${item}`),
  ]);
  const constraints = unique([
    ...baseConstraints(analysis),
    ...analysis.slots.constraints,
    ...riskConstraints(analysis),
  ]);
  return {
    goal: patchGoal(text, analysis),
    users: analysis.slots.personas[0],
    workflows,
    data,
    acceptance,
    constraints,
    risk_flags: analysis.risk_flags,
    unresolved_risks: analysis.unresolved_risks,
  };
}

export function unresolvedRiskQuestions(risks: RiskGate[]): string[] {
  if (risks.includes("security_sensitive")) {
    return [
      "What security model is required: local-only demo, encrypted local storage, or production-grade secret handling?",
      "What proves this is safe enough for the intended use before any real secrets are stored?",
    ];
  }
  if (risks.includes("external_service")) {
    return [
      "Which parts should be built locally now, and which external services are already configured?",
      "What proves the local build is done before external services are connected?",
    ];
  }
  if (risks.includes("vague")) {
    return [
      "Which exact user-visible behavior should change?",
      "What proves it is done? Give observable acceptance checks.",
    ];
  }
  return [];
}

function patchGoal(text: string, analysis: IntentAnalysis): string | undefined {
  if (analysis.redirect_request && analysis.canonical_goal) return analysis.canonical_goal;
  if (analysis.bare_known_request) return analysis.canonical_goal;
  const first = firstSentence(text);
  if (hasMeaningfulSpecificity(first, analysis)) return first;
  return analysis.canonical_goal;
}

function canonicalGoal(text: string, tags: IntentTag[]): string | undefined {
  if (/^snake$/i.test(text) || /\bsnake\b/i.test(text)) return "Build a browser Snake game";
  if (tags.includes("board")) return "Build a local kanban board";
  if (tags.includes("list") && tags.includes("completion")) return "Build a local todo list app";
  if (tags.includes("notes")) return "Build a local notes app";
  if (tags.includes("habit_tracker")) return "Build a habit tracker";
  if (tags.includes("workout_tracker")) return "Build a workout tracker";
  if (tags.includes("inventory_tracker")) return "Build an inventory tracker";
  if (tags.includes("build_pipeline_tracker")) return "Build a build pipeline tracker";
  if (tags.includes("timer")) return "Build a Pomodoro timer";
  if (tags.includes("calculator")) return "Build a calculator";
  if (tags.includes("markdown")) return "Build a Markdown previewer";
  if (tags.includes("matching_game")) return "Build a memory matching card game";
  if (tags.includes("contacts")) return "Build a lightweight CRM";
  if (tags.includes("finance") && tags.includes("csv_import")) return "Build a CSV expense tracker";
  if (tags.includes("finance")) return "Build a personal budget dashboard";
  if (tags.includes("meal_plan")) return "Build a recipe meal planner";
  if (tags.includes("study")) return "Build a flashcard quiz app";
  if (tags.includes("schedule")) return "Build an event RSVP tracker";
  if (tags.includes("media")) return "Build a local image gallery";
  if (tags.includes("game")) return "Build a browser game";
  if (tags.includes("tracker")) return "Build a local tracker app";
  return undefined;
}

function baseWorkflows(analysis: IntentAnalysis): string[] {
  const workflows: string[] = [];
  const has = (tag: IntentTag) => analysis.tags.includes(tag);
  if (has("list")) workflows.push("Create and edit list items", "View items in a clear list");
  if (has("list") && has("completion")) {
    workflows.splice(0, workflows.length, "Add a todo item with a title", "View active and completed todos in a clear list");
  }
  if (has("completion")) {
    workflows.push(
      has("list") ? "Mark todos complete or active again" : "Mark items complete or active again",
      has("list") ? "Delete todo items that are no longer needed" : "Delete items that are no longer needed",
    );
  }
  if (has("board")) workflows.push("Create task cards", "Move cards between named workflow columns", "Edit and delete cards");
  if (has("tracker")) workflows.push("Create and edit tracked records", "Filter records by status, category, or date", "Show summaries or recent activity");
  if (has("habit_tracker")) workflows.push("Create habits with names and optional categories", "Check off habits for the current day", "Show streaks and weekly habit summaries");
  if (has("workout_tracker")) workflows.push("Add workout entries with exercise details", "Track sets, reps, weight, and notes", "Review workout history by date");
  if (has("inventory_tracker")) workflows.push("Add inventory items with quantity and category", "Filter low-stock items", "Update stock counts");
  if (has("build_pipeline_tracker")) workflows.push("Track pipeline stages and status", "Show build logs", "Record retry history");
  if (has("timer")) workflows.push("Start, pause, resume, and reset the timer", "Show countdown state and completed session count");
  if (has("calculator")) workflows.push("Enter numbers and decimal values", "Run addition, subtraction, multiplication, and division", "Clear input and recover from errors");
  if (has("markdown")) workflows.push("Edit Markdown text", "Preview rendered Markdown output", "Keep editing and preview panes visible together");
  if (has("notes")) workflows.push("Create notes with title and body", "Edit, search, and delete notes", "Persist notes locally between browser sessions");
  if (has("game")) {
    if (analysis.canonical_goal === "Build a browser Snake game") {
      workflows.push("Play Snake on a grid with keyboard controls", "Grow the snake by eating food while avoiding walls and self-collisions", "Show score and allow restart after game over");
    } else {
      workflows.push("Start and play the game", "Show game status, scoring or progress, and restart after completion");
    }
  }
  if (has("matching_game")) workflows.push("Flip two cards at a time", "Keep matched pairs visible", "Track moves and show a win state");
  if (has("contacts")) workflows.push("Create and edit contacts or clients", "Track leads or projects by status", "Add notes and follow-ups");
  if (has("csv_import")) workflows.push("Import CSV data", "Show parsed rows and useful invalid-file feedback");
  if (has("finance")) workflows.push("Categorize amounts", "Show category totals and remaining budget or spending summaries");
  if (has("schedule")) workflows.push("Add guests or scheduled items", "Update RSVP or status values", "Filter by status and show totals");
  if (has("media")) workflows.push("Add image or media entries", "Tag entries", "Search or filter by title and tag");
  if (has("study")) workflows.push("Create study cards with prompts and answers", "Run a quiz session", "Reveal answers and track correct or missed results");
  if (has("meal_plan")) workflows.push("Create recipes with ingredients", "Assign recipes to days", "Generate a grocery list from planned meals");
  return workflows;
}

function baseData(analysis: IntentAnalysis): string[] {
  const data: string[] = [];
  const has = (tag: IntentTag) => analysis.tags.includes(tag);
  if (has("list") && has("completion")) data.push("Todo items stored locally with title and completion state");
  else if (has("list")) data.push("Local list items with title and status");
  if (has("board")) data.push("Local cards with title and workflow column");
  if (has("tracker")) data.push("Local tracked records with status, category, date, and notes");
  if (has("habit_tracker")) data.push("Local habits with completion dates, categories, and streak history");
  if (has("workout_tracker")) data.push("Local workout entries with exercise, sets, reps, weight, and notes");
  if (has("inventory_tracker")) data.push("Local inventory items with quantity, category, and low-stock threshold");
  if (has("build_pipeline_tracker")) data.push("Local pipeline runs with stage status, logs, and retry history");
  if (has("timer")) data.push("Timer state and completed session count");
  if (has("calculator")) data.push("In-memory calculator expression and result");
  if (has("markdown")) data.push("Local Markdown text");
  if (has("notes")) data.push("Local notes with title, body, and updated timestamp");
  if (has("game")) data.push("In-memory game state");
  if (has("contacts")) data.push("Local contacts, lead status, notes, and follow-up dates");
  if (has("csv_import")) data.push("CSV rows with parsed columns and validation errors");
  if (has("finance")) data.push("Local financial entries with category, type, amount, date, and notes");
  if (has("schedule")) data.push("Local attendee or schedule records with status and notes");
  if (has("media")) data.push("Local media entries with URL, title, tags, and notes");
  if (has("study")) data.push("Local study cards and quiz result history");
  if (has("meal_plan")) data.push("Local recipes, ingredients, planned days, and grocery list items");
  return data;
}

function acceptanceLine(analysis: IntentAnalysis, workflows: string[]): string {
  if (analysis.tags.includes("game")) {
    return "The browser game can be opened locally and supports the requested play, status, completion, and restart behavior";
  }
  if (analysis.tags.includes("markdown")) {
    return "The browser app safely renders common Markdown formatting without executing scripts";
  }
  if (analysis.tags.includes("calculator")) {
    return "The browser calculator supports arithmetic, decimals, clear, error handling, and visible results";
  }
  const core = workflows.slice(0, 4).map((item) => item.toLowerCase()).join(", ");
  return `The browser app can be opened locally and supports ${core || "the requested workflows"} with persisted local data`;
}

function baseConstraints(analysis: IntentAnalysis): string[] {
  if (analysis.tags.includes("game") || analysis.tags.includes("calculator")) return ["No accounts, backend, or persistent storage unless requested"];
  return ["No accounts, backend, or cloud sync unless requested"];
}

function riskConstraints(analysis: IntentAnalysis): string[] {
  const constraints: string[] = [];
  if (analysis.unresolved_risks.includes("security_sensitive")) {
    constraints.push("Do not store real passwords or secrets until the security model is explicitly defined");
  }
  if (analysis.unresolved_risks.includes("external_service")) {
    constraints.push("Do not assume live external services, API keys, deployment targets, or payment accounts are configured");
  }
  if (analysis.unresolved_risks.includes("vague")) {
    constraints.push("Do not start building until the exact user-visible behavior and acceptance checks are specified");
  }
  return constraints;
}

function extractSlots(text: string): IntentAnalysis["slots"] {
  const modifiers = unique([
    ...splitFeatureList(captureAfter(text, /\bwith\s+(.+)$/i)),
    ...splitFeatureList(captureAfter(text, /\bincluding\s+(.+)$/i)),
  ]).filter((item) => !/^(acceptance|npm test|the browser app works)$/i.test(item));
  const workflow_requirements = unique([
    ...splitFeatureList(captureAfter(text, /\b(?:where|that)\s+i\s+can\s+(.+)$/i)),
    ...splitFeatureList(captureAfter(text, /\b(?:that|which)\s+(?:lets|allows)\s+me\s+(.+)$/i)),
    ...splitFeatureList(captureAfter(text, /\b(?:that|which)\s+(?:does|supports?|handles?|includes?|tracks?|shows?)\s+(.+)$/i)),
  ]);
  const personas = capturePersonas(text);
  return {
    modifiers: classifyModifiers(modifiers, "modifier"),
    workflow_requirements: classifyModifiers(workflow_requirements, "workflow"),
    data_terms: dataTerms([...modifiers, ...workflow_requirements, text]),
    constraints: constraintTerms(text),
    personas,
  };
}

function captureAfter(text: string, pattern: RegExp): string[] {
  const match = text.match(pattern)?.[1];
  if (!match) return [];
  return [match.replace(/\bwith acceptance:.*$/i, "").replace(/\bacceptance:.*$/i, "").trim()];
}

function splitFeatureList(items: string[]): string[] {
  return items
    .flatMap((item) => item.split(/\s*,\s*|\s+and\s+/i))
    .map((item) => trimSentence(item).replace(/^(and|or)\s+/i, ""))
    .filter((item) => item.length > 0)
    .slice(0, 8);
}

function classifyModifiers(items: string[], kind: "modifier" | "workflow"): string[] {
  return unique(items.map((item) => {
    if (kind === "workflow") return item.replace(/^(to\s+)?/, "");
    return item;
  }));
}

function dataTerms(items: string[]): string[] {
  const text = items.join("\n");
  const terms: string[] = [];
  for (const term of ["tags", "categories", "deadlines", "due dates", "calendar view", "weekly summaries", "streak view", "stage status", "logs", "retry history", "offline", "shared projects"]) {
    if (new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(text)) terms.push(term);
  }
  return terms;
}

function constraintTerms(text: string): string[] {
  const constraints: string[] = [];
  if (/\bshared|collaborat|team|multi-user\b/i.test(text) && !/\bbackend|sync|account\b/i.test(text)) {
    constraints.push("Treat collaboration as local mock behavior unless backend sync is explicitly requested");
  }
  return constraints;
}

function capturePersonas(text: string): string[] {
  const match = text.match(/\bfor\s+([^,.]+?)(?:\s+with|\s+where|\s+that|$)/i)?.[1];
  return match ? [`A user building this for ${trimSentence(match)}`] : [];
}

function inferRiskFlags(text: string): string[] {
  const flags: string[] = [];
  if (/\b(auth|permission|login|session|oauth)\b/i.test(text)) flags.push("auth");
  if (/\b(stripe|payments?|invoice|billing|money|checkout|credit card|debit card|card payments?)\b/i.test(text)) flags.push("billing");
  if (/\b(schema|migration|database|db|sqlite)\b/i.test(text)) flags.push("schema");
  if (/\b(secret|token|password|credential|pii|vault)\b/i.test(text)) flags.push("sensitive_data");
  if (/\b(frontend|ui|screen|page|component|dashboard|form|chat|browser|web)\b/i.test(text)) flags.push("frontend");
  if (/\b(api key|external api|third-party api|live weather|deploy|deployment|hosting|domain)\b/i.test(text)) flags.push("external_service");
  if (/\b(better|improve|improved|improving|enhance|fix|clean up|polish|nice|modernize|optimize|stuff|things)\b/i.test(text)) flags.push("vague");
  return unique(flags);
}

function inferUnresolvedRisks(text: string): RiskGate[] {
  const risks: RiskGate[] = [];
  if (/\b(better|improve|improved|improving|enhance|fix|clean up|polish|nice|modernize|optimize|stuff|things)\b/i.test(text)) {
    risks.push("vague");
  }
  if (/\b(password manager|secret manager|credential manager|store passwords?|store secrets?|vault)\b/i.test(text)
    && !/\b(local-only demo|do not store real|no real secrets|encrypted local storage|production-grade secret handling)\b/i.test(text)) {
    risks.push("security_sensitive");
  }
  if (/\b(stripe|payments?|checkout|billing|deploy|deployment|production|hosting|domain|api key|external api|third-party api|oauth|live weather)\b/i.test(text)
    && !/\b(local only|local-only|mock|already configured|test key|configured external|no live|without live)\b/i.test(text)) {
    risks.push("external_service");
  }
  return unique(risks) as RiskGate[];
}

function scoreIntent(text: string, tags: IntentTag[], slots: IntentAnalysis["slots"], explicit: boolean, bare: boolean): number {
  let score = 0;
  if (explicit) score += 0.25;
  if (bare) score += 0.3;
  score += Math.min(tags.length, 4) * 0.18;
  if (slots.modifiers.length || slots.workflow_requirements.length) score += 0.18;
  if (/\b(app|game|site|website|dashboard|tool|browser|web)\b/i.test(text)) score += 0.1;
  return Math.min(score, 1);
}

function hasEnrichmentSignal(analysis: IntentAnalysis): boolean {
  return analysis.tags.length > 0
    || analysis.slots.modifiers.length > 0
    || analysis.slots.workflow_requirements.length > 0
    || analysis.slots.data_terms.length > 0
    || analysis.slots.constraints.length > 0
    || analysis.slots.personas.length > 0
    || analysis.risk_flags.length > 0;
}

function hasTrackerIntent(text: string): boolean {
  if (/\btracker\b/i.test(text)) return true;
  if (/\btrack\s+[\w-]+/i.test(text)) return true;
  const trackerTerms = ["track", "log", "history", "status"].filter((term) => new RegExp(`\\b${term}\\b`, "i").test(text));
  return trackerTerms.length >= 2;
}

function isBareKnownRequest(text: string, tags: IntentTag[]): boolean {
  if (tags.length === 0) return false;
  if (BUILD_PREFIX.test(text) || REQUEST_PREFIX.test(text) || REDIRECT_PREFIX.test(text)) return false;
  if (/\b(my|our|existing|current|broken|bug|fix|improve|better)\b/i.test(text)) return false;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length > 5) return false;
  return tags.includes("game")
    || /\b(app|tool|system|dashboard|board|tracker|timer|calculator|previewer|crm|gallery|quiz|planner|list|notes?)\b/i.test(text);
}

function hasMeaningfulSpecificity(goal: string, analysis: IntentAnalysis): boolean {
  return analysis.slots.modifiers.length > 0
    || analysis.slots.workflow_requirements.length > 0
    || analysis.slots.personas.length > 0
    || /\b(with|including|where|that|using|for)\b/i.test(goal);
}

function isNotesAppRequest(text: string): boolean {
  return /\bnotes?\s+(app|tool|manager)\b/i.test(text)
    || /\b(note-taking|notetaking)\b/i.test(text)
    || /^(let'?s|let us|i\s+(want|need|would like)\s+to\s+)?(build|make|create)\s+(a\s+)?notes?\b/i.test(text);
}

function asWorkflowRequirement(text: string): string {
  return /^(create|edit|delete|show|view|filter|search|track|import|export|add|mark|share|manage|use|support)\b/i.test(text)
    ? `${text.charAt(0).toUpperCase()}${text.slice(1)}`
    : `Support ${text}`;
}

function firstSentence(text: string): string {
  return trimSentence(text.split(/[.!?]\s+/)[0] ?? text);
}

function trimSentence(text: string): string {
  return text.trim().replace(/\s+/g, " ").replace(/[.]+$/, "");
}

function unique<T extends string>(items: T[]): T[] {
  return [...new Set(items.map((item) => trimSentence(item)).filter(Boolean) as T[])];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
