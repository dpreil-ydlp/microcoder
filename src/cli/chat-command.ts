import fs from "node:fs";
import path from "node:path";
import type { LoadedConfig } from "../core/config/config.js";
import type { MmcConfig } from "../core/config/defaults.js";
import { ensureMissionStructure, initializeDatabase, missionDir } from "../core/storage/sqlite.js";
import {
  analyzeCompiledPlanControlWithInterfaceModel,
  type CompiledPlanControlIntent,
  type CompiledPlanControlKind,
} from "../core/chat/interface-analysis.js";
import {
  archiveActiveMission,
  clearLatestCompileResult,
  loadCompileResult,
  loadMission,
  loadTaskGraph,
  startMission,
} from "../core/mission/ledger.js";
import { handleSpecChatTurn, loadSpecChatState, resetSpecChatState } from "../core/chat/spec-chat.js";
import { analyzeIntent, isExplicitIntentRequest } from "../core/chat/intent.js";
import type { CompileResult } from "../core/spec/compiler.js";
import { normalizeComparableText } from "../core/utils/paths.js";
import type { CliIO } from "./run.js";
import { runMissionCommand } from "./mission-command.js";

export async function runChatCommand(cwd: string, loaded: LoadedConfig, io: CliIO, args: string[]): Promise<number> {
  const config = loaded.config;
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
  if (isIdeaRequest(message)) {
    io.stdout("Try one of these: a todo list, a Snake game, a habit tracker, or a tiny CRM. Tell me which one you want, or describe your own.");
    return 0;
  }

  const state = loadSpecChatState(cwd, config);
  const activeMission = loadActiveMission(cwd, config);
  const startFreshMessage = extractStartFreshMessage(message);
  if (startFreshMessage) {
    const archived = activeMission?.status === "active" ? archiveActiveMission(cwd, config, "user_start_fresh") : null;
    resetSpecChatState(cwd, config);
    clearLatestCompileResult(cwd, config);
    if (archived) io.stdout(`Okay. I set aside the paused build: ${archived.mission.goal}.`);
    else io.stdout("Okay. Starting fresh.");
    const result = await handleSpecChatTurn(cwd, config, startFreshMessage);
    io.stdout(result.assistant_text);
    if (interactive) return 0;
    io.stdout(`chat_status ${result.state.status}`);
    io.stdout(`chat_state ${path.relative(cwd, result.state_path)}`);
    io.stdout(`draft_spec ${path.relative(cwd, result.draft_spec_path)}`);
    if (result.compiled_spec_path) io.stdout(`compiled_spec ${path.relative(cwd, result.compiled_spec_path)}`);
    return result.state.status === "compiled" ? 0 : 2;
  }
  if (state.status !== "compiled" && isStartOverIntent(message)) {
    const archived = activeMission?.status === "active" ? archiveActiveMission(cwd, config, "user_start_fresh") : null;
    resetSpecChatState(cwd, config);
    if (!hasBuildState(cwd, config)) clearLatestCompileResult(cwd, config);
    if (archived) io.stdout(`Okay. I set aside the paused build: ${archived.mission.goal}.`);
    else io.stdout("Okay. Starting fresh.");
    io.stdout("What do you want to build?");
    return 0;
  }
  if (state.status !== "compiled" && isThanks(message)) {
    if (activeMission?.status === "active") {
      io.stdout("No problem. Say `continue` to keep building, `what's next?` for progress, or `start over` to discard it.");
      return 0;
    }
    io.stdout("No problem. What do you want to build next?");
    return 0;
  }
  if (activeMission?.status === "active" && isPauseIntent(message)) {
    writePausedBuildStatus(io, activeMission);
    return 0;
  }
  if (!activeMission && isPauseIntent(message)) {
    io.stdout("Nothing is building right now. What do you want to build?");
    return 0;
  }
  if (activeMission?.status === "active" && isProgressQuestion(message)) {
    writeActiveMissionStatus(cwd, config, io, activeMission);
    return 0;
  }
  if (state.status !== "compiled" && !state.brief.goal && isSpecInspectionIntent(message)) {
    io.stdout("You haven't told me yet. What do you want to build?");
    return 0;
  }
  if (state.status !== "compiled" && state.brief.goal && isSpecInspectionIntent(message)) {
    io.stdout(`We're shaping: ${state.brief.goal}.`);
    io.stdout(state.pending_questions[0]?.text ?? "Tell me what should happen next.");
    return 0;
  }
  if (state.status !== "compiled" && !state.brief.goal && isPromptlessQuestion(message)) {
    io.stdout("Tell me what you want to build, in one concrete sentence.");
    return 0;
  }
  if (state.status !== "compiled" && !state.brief.goal && isBuildStartWithoutPlanIntent(message)) {
    io.stdout("I don't have a build plan yet. What do you want to build?");
    return 0;
  }
  if (state.status === "compiled" && state.compiled_spec_path) {
    const compiledResult = state.compile_result ?? loadCompileResult(cwd, config);
    const planControl = await classifyCompiledPlanControl(cwd, config, message, compiledResult, activeMission);
    if (planControl.kind === "inspect_plan") {
      writeInterfaceReply(io, planControl);
      const missionMatchesPlan = activeMission?.status === "active" && !isCompiledPlanNewerThanMission(state.updated_at, activeMission);
      const differentActiveBuild = activeMission?.status === "active" && !missionMatchesPlan;
      writeSpecSummary(io, compiledResult, state.compiled_spec_path, missionMatchesPlan, interactive, differentActiveBuild ? activeMission : undefined);
      return 0;
    }
    if (planControl.kind === "reset_plan") {
      writeInterfaceReply(io, planControl);
      const archived = shouldArchiveActiveBuildForPlanReset(activeMission, compiledResult)
        ? archiveActiveMission(cwd, config, "user_start_fresh")
        : null;
      resetSpecChatState(cwd, config);
      clearLatestCompileResult(cwd, config);
      if (archived) io.stdout(`Okay. I set aside the paused build: ${archived.mission.goal}.`);
      else io.stdout("Okay. Starting fresh.");
      io.stdout("What do you want to build?");
      return 0;
    }
    if (planControl.kind === "change_plan") {
      writeInterfaceReply(io, planControl);
      resetSpecChatState(cwd, config);
      const result = await handleSpecChatTurn(cwd, config, message);
      io.stdout(result.assistant_text);
      if (activeMission?.status === "active") {
        io.stdout(`Your current build is still paused: ${activeMission.goal}. Say \`continue\` to keep it, or \`build it\` to set it aside and start this new plan.`);
      }
      if (interactive) return 0;
      io.stdout(`chat_status ${result.state.status}`);
      io.stdout(`chat_state ${path.relative(cwd, result.state_path)}`);
      io.stdout(`draft_spec ${path.relative(cwd, result.draft_spec_path)}`);
      if (result.compiled_spec_path) io.stdout(`compiled_spec ${path.relative(cwd, result.compiled_spec_path)}`);
      return result.state.status === "compiled" ? 0 : 2;
    }
    if (planControl.kind === "start_current_plan") {
      writeInterfaceReply(io, planControl);
      if (activeMission?.status === "complete" && !isCompiledPlanNewerThanMission(state.updated_at, activeMission)) {
        writeCompletedBuildStatus(io, activeMission);
        return 0;
      }
      if (activeMission?.status === "active" && !isCompiledPlanNewerThanMission(state.updated_at, activeMission)) {
        io.stdout(`Continuing build ${activeMission.mission_id}.`);
        return await runActiveBuild(cwd, loaded, io);
      }
      io.stdout("Starting build from the compiled spec.");
      return await startCompiledBuildAndRun(cwd, loaded, io, state.updated_at);
    }
    if (planControl.kind === "show_progress") {
      writeInterfaceReply(io, planControl);
      if (activeMission?.status === "complete" && !isCompiledPlanNewerThanMission(state.updated_at, activeMission)) {
        writeCompletedBuildStatus(io, activeMission);
        return 0;
      }
      if (activeMission?.status === "active") {
        writeActiveMissionStatus(cwd, config, io, activeMission);
        return 0;
      }
      io.stdout(`I have a build plan ready: ${compiledResult.spec.goal}.`);
      io.stdout(`Build steps: ${compiledResult.task_graph.tasks.length}`);
      io.stdout("Say `continue` to start it, or ask `what's the plan?`.");
      return 0;
    }
    if (planControl.kind === "thanks") {
      writeInterfaceReply(io, planControl);
      if (activeMission?.status === "active") {
        io.stdout("No problem. Say `continue` to keep building, `what's next?` for progress, or `start over` to discard it.");
      } else {
        io.stdout("No problem. Say `continue` to start, or tell me what to change.");
      }
      return 0;
    }
    if (activeMission?.status === "complete" && (isPromptlessQuestion(message) || isResumeIntent(message))) {
      writeCompletedBuildStatus(io, activeMission);
      return 0;
    }
    if (activeMission?.status === "active") {
      writeActiveMissionStatus(cwd, config, io, activeMission);
      return 0;
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
  if (!hasBuildState(cwd, config)) clearLatestCompileResult(cwd, config);
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

async function classifyCompiledPlanControl(
  cwd: string,
  config: MmcConfig,
  message: string,
  compiledResult: CompileResult,
  activeMission: ReturnType<typeof loadMission> | null,
): Promise<CompiledPlanControlIntent> {
  if (isPromptlessQuestion(message)) {
    return heuristicControl("unknown", 0.2, "confused follow-up without a control intent");
  }
  const modelIntent = await analyzeCompiledPlanControlWithInterfaceModel({
    cwd,
    config,
    userText: message,
    currentPlan: {
      goal: compiledResult.spec.goal,
      taskCount: compiledResult.task_graph.tasks.length,
    },
    activeBuild: activeMission
      ? {
          goal: activeMission.goal,
          status: activeMission.status,
        }
      : null,
  });
  if (modelIntent && modelIntent.kind !== "unknown") return modelIntent;
  const fallback = classifyCompiledPlanControlHeuristically(message, compiledResult, activeMission);
  return fallback.kind !== "unknown" ? fallback : modelIntent ?? fallback;
}

function classifyCompiledPlanControlHeuristically(
  message: string,
  compiledResult: CompileResult,
  activeMission: ReturnType<typeof loadMission> | null,
): CompiledPlanControlIntent {
  const currentGoalForFollowUp = activeMission?.status === "active" ? activeMission.goal : compiledResult.spec.goal;
  if (isStartOverIntent(message)) return heuristicControl("reset_plan", 0.85, "user asked to start over");
  if (isCompiledPlanRejectionIntent(message)) return heuristicControl("reset_plan", 0.78, "user rejected the current plan");
  if (isSpecInspectionIntent(message)) return heuristicControl("inspect_plan", 0.85, "user asked to inspect the plan");
  if (isNewGoalIntent(message, currentGoalForFollowUp)) return heuristicControl("change_plan", 0.8, "user described a different build goal");
  if (isProgressQuestion(message)) return heuristicControl("show_progress", 0.75, "user asked for progress");
  if (isThanks(message)) return heuristicControl("thanks", 0.7, "user acknowledged the plan");
  if (isCompiledBuildStartIntent(message) || isResumeIntent(message) || isCurrentPlanContinuationIntent(message)) {
    return heuristicControl("start_current_plan", 0.78, "user accepted or continued the current plan");
  }
  return heuristicControl("unknown", 0.2, "no confident compiled-plan control intent");
}

function heuristicControl(kind: CompiledPlanControlKind, confidence: number, reason: string): CompiledPlanControlIntent {
  return {
    kind,
    confidence,
    source: "heuristic",
    reason,
  };
}

function shouldArchiveActiveBuildForPlanReset(
  activeMission: ReturnType<typeof loadMission> | null,
  compiledResult: CompileResult,
): boolean {
  return activeMission?.status === "active"
    && Boolean(activeMission.current_task_id)
    && normalizeComparableText(activeMission.goal) === normalizeComparableText(compiledResult.spec.goal);
}

function writeInterfaceReply(io: CliIO, intent: CompiledPlanControlIntent): void {
  if (intent.source === "interface_model" && intent.reply) io.stdout(intent.reply);
}

async function startCompiledBuildAndRun(cwd: string, loaded: LoadedConfig, io: CliIO, compiledUpdatedAt?: string): Promise<number> {
  const config = loaded.config;
  const result = loadCompileResult(cwd, config);
  const activeMission = loadActiveMission(cwd, config);
  if (activeMission?.status === "active") {
    const shouldReplace = isDifferentCompiledBuild(result, activeMission) || isCompiledPlanNewerThanMission(compiledUpdatedAt, activeMission);
    if (!shouldReplace) {
      io.stdout(`Continuing build ${activeMission.mission_id}.`);
      return await runActiveBuild(cwd, loaded, io);
    }
    const archived = archiveActiveMission(cwd, config, "replace_active_build");
    if (archived) io.stdout(`Set aside active build: ${archived.mission.goal}.`);
  }
  const started = startMission(cwd, config, result);
  if (started.status === "blocked") {
    io.stdout("blocked_by_spec_ambiguity");
    started.questions.forEach((question) => io.stdout(`- ${question}`));
    return 2;
  }
  io.stdout(`build_id ${started.mission.mission_id}`);
  io.stdout(`status ${started.mission.status}`);
  io.stdout(`current_task_id ${started.mission.current_task_id ?? "none"}`);
  return await runActiveBuild(cwd, loaded, io);
}

async function runActiveBuild(cwd: string, loaded: LoadedConfig, io: CliIO): Promise<number> {
  io.stdout("Build running. Each task will show progress, verification, and confidence.");
  const code = await runMissionCommand(cwd, io, ["--mission"], () => loaded, "build");
  io.stdout(code === 0 ? "Build finished." : `Build stopped with exit code ${code}.`);
  return code;
}

function isCompiledPlanNewerThanMission(compiledUpdatedAt: string | undefined, mission: ReturnType<typeof loadMission>): boolean {
  const compiledTime = Date.parse(compiledUpdatedAt ?? "");
  const missionTime = Date.parse(mission.created_at);
  return Number.isFinite(compiledTime) && Number.isFinite(missionTime) && compiledTime > missionTime;
}

function isGreeting(value: string): boolean {
  return /^(h|hi|hello|hey|yo|sup)\b[!. ]*$/i.test(value.trim());
}

function isCapabilityQuestion(value: string): boolean {
  const text = value.trim();
  return /^(what can you do|what can you do for me|what can you help with|what do you do|how does this work|help|help me|who are you|are you a chatbot|what is this|what's this|what is this tool|what is microcoder|what's microcoder|how do i use you|what does this do|how do i use this)\??$/i.test(text);
}

function isIdeaRequest(value: string): boolean {
  const text = normalizeChatInput(value);
  return /^(i dont know|dont know|not sure|got any ideas|any ideas|what should i build|surprise me|bored surprise me|give me ideas)$/.test(text);
}

function isThanks(value: string): boolean {
  return /^(thanks|thank you|thx)\b[!. ]*$/i.test(value.trim());
}

function isPromptlessQuestion(value: string): boolean {
  return /^(\?+|huh|what\?|what now|what do you need( from me)?)$/i.test(value.trim());
}

function isBuildStartWithoutPlanIntent(value: string): boolean {
  const text = normalizeChatInput(value);
  if (/\b(change|different|instead|new)\b/.test(text)) return false;
  return isPlanApproval(text)
    || /^(build|start|run|do|ship)\s+(it|this|that|the build|the plan)\b/.test(text)
    || /\b(build it|start it|run it|ship it|run with that|build with that)\b/.test(text);
}

function isPauseIntent(value: string): boolean {
  const text = normalizeChatInput(value);
  return /^(stop|cancel|pause|wait|hold on|actually no|never mind|nevermind|undo|not now|not yet)$/.test(text);
}

function isStartOverIntent(value: string): boolean {
  const text = normalizeChatInput(value);
  return /^(?:(?:lets|let us)\s+)?(start over|start fresh|fresh start|restart|reset|scratch that|forget it|forget this|forget that|discard it|discard this|discard that|abandon it|abandon this|abandon that|clear it|clear this|clear that)(\s+(please|now|the build|the plan))?$/.test(text);
}

function isCompiledPlanRejectionIntent(value: string): boolean {
  return /^(no|n|nope|nah|not this|not that|wrong one)$/i.test(value.trim());
}

function extractStartFreshMessage(value: string): string | null {
  const text = normalizeChatInput(value);
  const match = text.match(
    /^(?:(?:lets|let us)\s+)?(?:start over|start fresh|fresh start|new build|new one|reset|scratch that|forget it|forget this|forget that|discard it|discard this|discard that|clear it|clear this|clear that)(?:\s+(?:and|then|instead|now))?\s+(.+)$/,
  );
  if (!match?.[1]) return null;
  const rest = match[1].trim();
  if (!rest || /^(please|now|instead|it|this|that|the build|the old build|the plan)$/.test(rest)) return null;
  if (/^(build|make|create|implement|add)\b/.test(rest)) return rest;
  if (/^(a|an|the)\s+/.test(rest) || /\b(app|game|site|website|dashboard|tool|tracker|reviewer|manager|system|portal|list)\b/.test(rest)) {
    return `build ${rest}`;
  }
  return null;
}

function isResumeIntent(value: string): boolean {
  const text = normalizeChatInput(value);
  return /^(continue|resume|keep going|lets keep going|pick up|pick up where we left off|im back|continue with that one)$/.test(text);
}

function isProgressQuestion(value: string): boolean {
  const text = normalizeChatInput(value);
  return /^(whats next|where were we|hows the build going|show progress|any progress|progress|status|what now)$/.test(text);
}

function isCompiledBuildStartIntent(value: string): boolean {
  const text = normalizeChatInput(value);
  if (/\b(change|different|instead|new)\b/.test(text)) return false;
  return isExplicitBuildStart(text) || isPlanApproval(text);
}

function isCurrentPlanContinuationIntent(value: string): boolean {
  const text = normalizeChatInput(value);
  if (!text || isPromptlessQuestion(value)) return false;
  if (/\b(change|different|instead|new|another|other)\b/.test(text)) return false;
  const hasAction = /\b(continue|resume|proceed|start|run|go|build|make|do|use|ship|accept|approve|keep going|carry on|move forward)\b/.test(text);
  const hasPlanReference = /\b(it|this|that|one|plan|build|current|existing|earlier|previous|same)\b/.test(text);
  if (hasAction && hasPlanReference) return true;
  if (/^(continue|resume|proceed|keep going|carry on|move forward|run it|start it|use it|use that|that one|same one|the same one)$/.test(text)) return true;
  return /\b(previous|earlier|that|this|same|current|existing)\b.*\b(fine|good|ok|okay|right|works)\b/.test(text);
}

function isExplicitBuildStart(text: string): boolean {
  return /^(build|start|run|make|do|ship)\b/.test(text)
    || /^(ok|okay|yes|yep|yeah|sure|alright|fine|please)\s+(so\s+)?(build|start|run|make|do|ship)\b/.test(text)
    || /\b(build it|start it|run it|ship it|build with that|run with that)\b/.test(text);
}

function isPlanApproval(text: string): boolean {
  return /^(go|lets go|yes|yep|yeah|sure|ok|okay|alright|fine|please)$/.test(text)
    || /\b(go ahead|lets go|lets do it|do it|looks good|sounds good)\b/.test(text);
}

function isNewGoalIntent(value: string, currentGoal?: string): boolean {
  const text = normalizeChatInput(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const intent = analyzeIntent(value);
  if (intent.redirect_request) {
    return isExplicitIntentRequest(value, intent) || hasRedirectedProductRequest(text);
  }
  const object = "(?!it\\b|this\\b|that\\b|the\\b|one\\b)[a-z0-9][\\w-]*";
  const hasNewGoalSyntax = new RegExp(`^(build|make|create|implement|add)\\s+${object}\\b`).test(text)
    || new RegExp(`^(let'?s|let us)\\s+(build|make|create)\\s+${object}\\b`).test(text)
    || new RegExp(`^i\\s+(want|need|would like)\\s+to\\s+(build|make|create)\\s+${object}\\b`).test(text);
  if (!hasNewGoalSyntax) return false;
  if (currentGoal && isSameCompiledGoalFollowUp(intent, currentGoal)) return false;
  return true;
}

function isSameCompiledGoalFollowUp(intent: ReturnType<typeof analyzeIntent>, currentGoal: string): boolean {
  if (intent.redirect_request) return false;
  if (!intent.canonical_goal) return false;
  if (
    intent.slots.modifiers.length
    || intent.slots.workflow_requirements.length
    || intent.slots.personas.length
    || intent.slots.constraints.length
  ) {
    return false;
  }
  return normalizeComparableText(intent.canonical_goal) === normalizeComparableText(currentGoal);
}

function hasRedirectedProductRequest(text: string): boolean {
  const content = text
    .replace(/^(?:(?:wait|ok|okay)\s+)?(actually|instead|scratch that|forget that|change (it|this) to|make it|no|nope|nah|wrong)\s+/i, "")
    .trim();
  if (!content || /^(it|this|that|one)\b/.test(content)) return false;
  const object = "(?!it\\b|this\\b|that\\b|the\\b|one\\b)[a-z0-9][\\w-]*";
  if (new RegExp(`^(build|make|create|implement|add)\\s+${object}\\b`).test(content)) return true;
  return /^(a|an|the)?\s*[a-z0-9].*\b(app|game|site|website|dashboard|tool|tracker|reviewer|manager|system|portal)\b/.test(content);
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

function hasBuildState(cwd: string, config: MmcConfig): boolean {
  if (loadActiveMission(cwd, config)) return true;
  const currentStateFile = path.join(missionDir(cwd, config), "current_state.json");
  if (!fs.existsSync(currentStateFile)) return false;
  try {
    const currentState = JSON.parse(fs.readFileSync(currentStateFile, "utf8")) as { status?: string };
    return ["active", "blocked", "failed", "complete"].includes(currentState.status ?? "");
  } catch {
    return false;
  }
}

function writeActiveMissionStatus(cwd: string, config: MmcConfig, io: CliIO, mission: ReturnType<typeof loadMission>): void {
  const progress = buildBuildProgressText(cwd, config);
  io.stdout(`Build in progress: ${mission.goal}.`);
  if (progress) io.stdout(progress);
  io.stdout("Next: say `continue` to keep building, `what's next?` for progress, or `start over` to discard it.");
}

function writePausedBuildStatus(io: CliIO, mission: ReturnType<typeof loadMission>): void {
  io.stdout(`Okay. I paused the build: ${mission.goal}.`);
  io.stdout("Say `continue` to resume it, or `start over` to discard it.");
}

function writeCompletedBuildStatus(io: CliIO, mission: ReturnType<typeof loadMission>): void {
  io.stdout("Build already complete.");
  io.stdout(`build_id ${mission.mission_id}`);
  io.stdout("To change it, run `/chat reset` and describe the new version.");
}

function writeSpecSummary(
  io: CliIO,
  result: CompileResult,
  compiledSpecPath: string,
  missionActive: boolean,
  interactive: boolean,
  differentActiveBuild?: ReturnType<typeof loadMission>,
): void {
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
  if (differentActiveBuild) {
    io.stdout(`Existing build is paused: ${differentActiveBuild.goal}. Say \`build it\` to set it aside and start this plan, or \`continue\` to resume it.`);
    return;
  }
  io.stdout(missionActive ? "Next: run `/build step` or `/build run`." : "Next: run `/build start`.");
}

function isDifferentCompiledBuild(result: CompileResult, mission: ReturnType<typeof loadMission>): boolean {
  return normalizeComparableText(result.spec.goal) !== normalizeComparableText(mission.goal);
}

function buildBuildProgressText(cwd: string, config: MmcConfig): string | null {
  try {
    const graph = loadTaskGraph(cwd, config);
    const tasks = graph.tasks;
    const complete = tasks.filter((task) => task.status === "complete").length;
    const next = tasks.find((task) => task.status === "ready") ?? tasks.find((task) => task.status === "todo") ?? null;
    return `Progress: ${complete}/${tasks.length} done${next ? `; next is ${next.id} ${next.title}` : ""}.`;
  } catch {
    return null;
  }
}

function normalizeChatInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.,;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(let)'s\b/g, "$1s")
    .replace(/\b(i)'m\b/g, "$1m")
    .replace(/\b(do)n'?t\b/g, "$1nt")
    .replace(/'/g, "")
    .trim();
}
