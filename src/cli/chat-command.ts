import path from "node:path";
import type { MmcConfig } from "../core/config/defaults.js";
import { ensureMissionStructure, initializeDatabase } from "../core/storage/sqlite.js";
import { loadCompileResult, loadMission, startMission } from "../core/mission/ledger.js";
import { handleSpecChatTurn, loadSpecChatState, resetSpecChatState } from "../core/chat/spec-chat.js";
import type { CompileResult } from "../core/spec/compiler.js";
import type { CliIO } from "./run.js";

export async function runChatCommand(cwd: string, config: MmcConfig, io: CliIO, args: string[]): Promise<number> {
  ensureMissionStructure(cwd, config);
  initializeDatabase(cwd, config);

  const interactive = args[0] === "--interactive";
  const chatArgs = interactive ? args.slice(1) : args;
  if (args[0] === "reset") return resetChat(cwd, config, io);
  if (chatArgs.length === 0 || chatArgs[0] === "status") return showChatStatus(cwd, config, io);

  const message = chatArgs.join(" ");
  if (isGreeting(message)) {
    io.stdout("Hey. What do you want to build?");
    return 0;
  }
  if (isCapabilityQuestion(message)) {
    io.stdout("Tell me what you want to build in plain English. I'll turn it into a plan, ask only for missing details, then you can say `build it`.");
    return 0;
  }
  if (isThanks(message)) {
    io.stdout("No problem. What do you want to build next?");
    return 0;
  }

  const state = loadSpecChatState(cwd, config);
  if (state.status !== "compiled" && !state.brief.goal && isPromptlessQuestion(message)) {
    io.stdout("Tell me what you want to build, in one concrete sentence.");
    return 0;
  }
  if (state.status === "compiled" && state.compiled_spec_path) {
    const activeMission = loadActiveMission(cwd, config);
    if (isSpecInspectionIntent(message)) {
      writeSpecSummary(io, state.compile_result ?? loadCompileResult(cwd, config), state.compiled_spec_path, activeMission?.status === "active", interactive);
      return 0;
    }
    if (activeMission?.status === "active" && isNewGoalIntent(message)) {
      resetSpecChatState(cwd, config);
      const result = await handleSpecChatTurn(cwd, config, message);
      io.stdout(result.assistant_text);
      io.stdout(`Existing build still active: ${activeMission.mission_id}`);
      io.stdout("Finish it with `/build step` or `/build run`; use `/chat reset` if this new brief was accidental.");
      if (interactive) return 0;
      io.stdout(`chat_status ${result.state.status}`);
      io.stdout(`chat_state ${path.relative(cwd, result.state_path)}`);
      io.stdout(`draft_spec ${path.relative(cwd, result.draft_spec_path)}`);
      if (result.compiled_spec_path) io.stdout(`compiled_spec ${path.relative(cwd, result.compiled_spec_path)}`);
      return result.state.status === "compiled" ? 0 : 2;
    }
    if (activeMission?.status === "active") {
      writeActiveMissionStatus(io, activeMission);
      return 0;
    }
    if (isBuildIntent(message)) {
      io.stdout("Starting build from the compiled spec.");
      return startCompiledBuild(cwd, config, io);
    }
  }

  const result = await handleSpecChatTurn(cwd, config, message);
  io.stdout(result.assistant_text);
  if (interactive) return 0;
  io.stdout(`chat_status ${result.state.status}`);
  io.stdout(`chat_state ${path.relative(cwd, result.state_path)}`);
  io.stdout(`draft_spec ${path.relative(cwd, result.draft_spec_path)}`);
  if (result.compiled_spec_path) io.stdout(`compiled_spec ${path.relative(cwd, result.compiled_spec_path)}`);
  return result.state.status === "compiled" ? 0 : 2;
}

function resetChat(cwd: string, config: MmcConfig, io: CliIO): number {
  const state = resetSpecChatState(cwd, config);
  io.stdout(`chat_id ${state.chat_id}`);
  io.stdout("chat_status collecting");
  io.stdout("message reset");
  return 0;
}

function showChatStatus(cwd: string, config: MmcConfig, io: CliIO): number {
  const state = loadSpecChatState(cwd, config);
  io.stdout(`chat_id ${state.chat_id}`);
  io.stdout(`chat_status ${state.status}`);
  io.stdout(`goal ${state.brief.goal ?? "none"}`);
  io.stdout(`users ${state.brief.users ?? "none"}`);
  io.stdout(`workflows ${state.brief.workflows.length}`);
  io.stdout(`acceptance ${state.brief.acceptance.length}`);
  if (state.pending_questions.length) {
    io.stdout("next_questions:");
    state.pending_questions.forEach((question) => io.stdout(`- ${question.text}`));
  }
  if (state.compiled_spec_path) io.stdout(`compiled_spec ${path.relative(cwd, state.compiled_spec_path)}`);
  return 0;
}

function startCompiledBuild(cwd: string, config: MmcConfig, io: CliIO): number {
  const started = startMission(cwd, config, loadCompileResult(cwd, config));
  if (started.status === "blocked") {
    io.stdout("blocked_by_spec_ambiguity");
    started.questions.forEach((question) => io.stdout(`- ${question}`));
    return 2;
  }
  io.stdout(`build_id ${started.mission.mission_id}`);
  io.stdout(`status ${started.mission.status}`);
  io.stdout(`current_task_id ${started.mission.current_task_id ?? "none"}`);
  return 0;
}

function isGreeting(value: string): boolean {
  return /^(hi|hello|hey|yo|sup)\b[!. ]*$/i.test(value.trim());
}

function isCapabilityQuestion(value: string): boolean {
  return /^(what can you do|what do you do|how does this work|help)\??$/i.test(value.trim());
}

function isThanks(value: string): boolean {
  return /^(thanks|thank you|thx)\b[!. ]*$/i.test(value.trim());
}

function isPromptlessQuestion(value: string): boolean {
  return /^(\?+|huh|what\?|what now|what do you need( from me)?)$/i.test(value.trim());
}

function isBuildIntent(value: string): boolean {
  const text = value
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\b(change|different|instead|new)\b/.test(text)) return false;
  return /^(build|start|run|make|do|ship)\b/.test(text)
    || /^(ok|okay|yes|yep|yeah|sure|alright|fine|please)\s+(so\s+)?(build|start|run|make|do|ship)\b/.test(text)
    || /\b(go ahead|let's do it|do it|build it|start it|run it|ship it|run with that|build with that)\b/.test(text);
}

function isNewGoalIntent(value: string): boolean {
  const text = value
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const object = "(?!it\\b|this\\b|that\\b|the\\b|one\\b)[a-z0-9][\\w-]*";
  return new RegExp(`^(build|make|create|implement|add)\\s+${object}\\b`).test(text)
    || new RegExp(`^(let'?s|let us)\\s+(build|make|create)\\s+${object}\\b`).test(text)
    || new RegExp(`^i\\s+(want|need|would like)\\s+to\\s+(build|make|create)\\s+${object}\\b`).test(text);
}

function isSpecInspectionIntent(value: string): boolean {
  const text = value.trim();
  return /\b(what|show|view|print|display|read|summari[sz]e|describe)\b.*\b(spec|brief|plan|requirements?|acceptance|scope)\b/i.test(text)
    || /\b(spec|brief|plan|requirements?|acceptance|scope)\b.*\b(what|show|view|print|display|read|summari[sz]e|describe)\b/i.test(text)
    || /\bwhat (are|am) (we|i) building\b/i.test(text);
}

function loadActiveMission(cwd: string, config: MmcConfig): ReturnType<typeof loadMission> | null {
  try {
    return loadMission(cwd, config);
  } catch {
    return null;
  }
}

function writeActiveMissionStatus(io: CliIO, mission: ReturnType<typeof loadMission>): void {
  io.stdout("Build already active.");
  io.stdout(`build_id ${mission.mission_id}`);
  io.stdout(`status ${mission.status}`);
  io.stdout(`current_task_id ${mission.current_task_id ?? "none"}`);
  io.stdout("Next: run `/build step` or `/build run`.");
}

function writeSpecSummary(io: CliIO, result: CompileResult, compiledSpecPath: string, missionActive: boolean, interactive: boolean): void {
  io.stdout("Build plan");
  if (!interactive) io.stdout(`spec_id ${result.spec.spec_id}`);
  io.stdout(`Goal: ${result.spec.goal}`);
  io.stdout("What it will do:");
  result.spec.requirements.forEach((requirement) => io.stdout(`- ${requirement.text}`));
  io.stdout("Done when:");
  result.spec.acceptance_criteria.forEach((criterion) => io.stdout(`- ${criterion.text} [${criterion.verification}]`));
  if (result.spec.non_goals.length) {
    io.stdout("Out of scope:");
    result.spec.non_goals.forEach((nonGoal) => io.stdout(`- ${nonGoal}`));
  }
  io.stdout(`Build steps: ${result.task_graph.tasks.length}`);
  if (!interactive) io.stdout(`compiled_spec ${compiledSpecPath}`);
  io.stdout(missionActive ? "Next: run `/build step` or `/build run`." : "Next: run `/build start`.");
}
