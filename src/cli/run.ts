import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { writeDefaultConfigIfMissing, loadConfig, saveConfig } from "../core/config/config.js";
import { HARDWARE_PROFILES, detectHostRamGb, isHardwareProfileName } from "../core/hardware/profile.js";
import { ensureMissionStructure, initializeDatabase, missionDir, queryJson, databasePath } from "../core/storage/sqlite.js";
import { initializeLedger, loadCompileResult, persistCompileResult, startMission } from "../core/mission/ledger.js";
import { compileSpecInput, detectInputType } from "../core/spec/compiler.js";
import { createValidator } from "../core/schemas/validator.js";
import { schemaFixtures } from "../core/schemas/fixtures.js";
import { indexRepo, getRepoStatus } from "../core/repo/brain.js";
import { loadModelRegistry, routeModel } from "../core/models/orchestrator.js";
import {
  effectiveModelProvider,
  inspectLlamaCppBackend,
} from "../core/models/llamacpp-backend.js";
import { parseTouchedFiles, validatePatchScope } from "../core/harness/patch.js";
import { exportBenchmarkSkeleton } from "../core/evaluation/benchmark.js";
import { runLocalBenchmark } from "../core/evaluation/local-benchmark.js";
import { appendEvent } from "../core/trace/events.js";
import { validateMissionConsistency } from "../core/evaluation/consistency.js";
import { parsePositiveInteger, valueAfter } from "./args.js";
import { runChatCommand } from "./chat-command.js";
import {
  runMissionCommand,
  runTaskCommand,
  runTaskNextCommand,
  runVerifyCommand,
} from "./mission-command.js";
import {
  runBackendStartCommand,
  runBackendStatusCommand,
  runBackendStopCommand,
  runModelsClearCommand,
  runModelsListCommand,
  runModelsProbeCommand,
  runModelsSetCommand,
  runModelsStatusCommand,
  runSetupBackendLlamacppCommand,
} from "./model-command.js";
import { runTui } from "./tui.js";
import { runSetupWebResearchCommand, runWebSearchCommand } from "./web-command.js";

export type CliIO = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

export type RunOptions = {
  cwd?: string;
  io?: CliIO;
};

const HELP = `Microcoder

Usage:
  microcoder
  microcoder web [--port 4180]
  microcoder web search "<query>"
  microcoder init
  microcoder doctor
  microcoder chat "<what you want to build>"
  microcoder chat status
  microcoder chat reset
  microcoder setup web [--enabled true] [--auto true] [--chat true] [--provider duckduckgo_html] [--url URL]
  microcoder setup backend llamacpp [--server path] [--model role=path] [--select]
  microcoder spec create "<goal>"
  microcoder spec compile [file]
  microcoder build status
  microcoder build start [spec]
  microcoder build step
  microcoder build run [max-tasks]
  microcoder build next
  microcoder build validate
  microcoder repo index
  microcoder repo status
  microcoder task next
  microcoder run --task T4 [--mock-patch file]
  microcoder verify --task T4
  microcoder attempts list --task T4
  microcoder artifacts list --attempt A9
  microcoder patch apply --attempt A9
  microcoder config profile middle_32gb
  microcoder config frontend "<start command>" <url>
  microcoder models list
  microcoder models status
  microcoder models set <role> <model|disabled>
  microcoder models clear <role>
  microcoder models profile middle_32gb
  microcoder models probe [role]
  microcoder backend status [role]
  microcoder backend start [role]
  microcoder backend stop
  microcoder tui [--snapshot] [--command "/build status"]
  microcoder tui web [--port 4180]
  microcoder eval export
  microcoder eval chat-lab
  microcoder eval build-lab
  microcoder eval benchmark [--count 20] [--mock-raw]
  microcoder eval validate

Alias:
  mmc <command>

Compatibility:
  microcoder mission start [spec]
  microcoder run --mission
`;

export async function runCli(argv: string[], options: RunOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const io = options.io ?? {
    stdout: (message: string) => process.stdout.write(`${message}\n`),
    stderr: (message: string) => process.stderr.write(`${message}\n`),
  };

  try {
    const [command, subcommand, ...rest] = argv;
    if (!command || command === "--help" || command === "-h" || command === "help") {
      io.stdout(HELP.trimEnd());
      return 0;
    }

    if (command === "init") return cmdInit(cwd, io);
    if (command === "doctor") return await cmdDoctor(cwd, io);
    if (command === "chat") return await cmdChat(cwd, io, [subcommand, ...rest].filter(Boolean));
    if (command === "web" && subcommand === "search") return await cmdWebSearch(cwd, io, rest.join(" "));
    if (command === "setup" && subcommand === "web") return cmdSetupWebResearch(cwd, io, rest);
    if (command === "setup" && subcommand === "backend" && rest[0] === "llamacpp") return cmdSetupBackendLlamacpp(cwd, io, rest.slice(1));
    if (command === "spec" && subcommand === "create") return cmdSpecCreate(cwd, io, rest.join(" "));
    if (command === "spec" && subcommand === "compile") return cmdSpecCompile(cwd, io, rest[0]);
    if (command === "build") return await cmdBuild(cwd, io, subcommand, rest);
    if (command === "mission" && subcommand === "start") return cmdMissionStart(cwd, io, rest[0]);
    if (command === "repo" && subcommand === "index") return cmdRepoIndex(cwd, io);
    if (command === "repo" && subcommand === "status") return cmdRepoStatus(cwd, io);
    if (command === "task" && subcommand === "next") return cmdTaskNext(cwd, io);
    if (command === "run" && argv.includes("--mission")) return await cmdRunMission(cwd, io, [subcommand, ...rest].filter(Boolean));
    if (command === "run") return await cmdRunTask(cwd, io, [subcommand, ...rest].filter(Boolean));
    if (command === "verify") return await cmdVerify(cwd, io, [subcommand, ...rest].filter(Boolean));
    if (command === "attempts" && subcommand === "list") return cmdAttemptsList(cwd, io, rest);
    if (command === "artifacts" && subcommand === "list") return cmdArtifactsList(cwd, io, rest);
    if (command === "patch" && subcommand === "apply") return cmdPatchApply(cwd, io, rest);
    if (command === "config" && subcommand === "profile") return cmdConfigProfile(cwd, io, rest[0]);
    if (command === "config" && subcommand === "frontend") return cmdConfigFrontend(cwd, io, rest[0], rest[1]);
    if (command === "models" && subcommand === "list") return cmdModelsList(cwd, io);
    if (command === "models" && (!subcommand || subcommand === "status")) return cmdModelsStatus(cwd, io);
    if (command === "models" && subcommand === "set") return cmdModelsSet(cwd, io, rest[0], rest[1]);
    if (command === "models" && subcommand === "clear") return cmdModelsClear(cwd, io, rest[0]);
    if (command === "models" && subcommand === "profile") return cmdConfigProfile(cwd, io, rest[0]);
    if (command === "models" && subcommand === "probe") return await cmdModelsProbe(cwd, io, rest[0] ?? "code_writer");
    if (command === "backend" && (!subcommand || subcommand === "status")) return await cmdBackendStatus(cwd, io, rest[0] ?? "code_writer");
    if (command === "backend" && subcommand === "start") return await cmdBackendStart(cwd, io, rest[0] ?? "code_writer");
    if (command === "backend" && subcommand === "stop") return await cmdBackendStop(cwd, io);
    if (command === "tui") return await runTui(cwd, [subcommand, ...rest].filter(Boolean), io, runCli);
    if (command === "eval" && subcommand === "export") return cmdEvalExport(cwd, io);
    if (command === "eval" && subcommand === "chat-lab") return await cmdEvalChatLab(cwd, io);
    if (command === "eval" && subcommand === "build-lab") return await cmdEvalBuildLab(cwd, io);
    if (command === "eval" && subcommand === "benchmark") return await cmdEvalBenchmark(cwd, io, rest);
    if (command === "eval" && subcommand === "validate") return cmdEvalValidate(cwd, io);

    io.stderr(`unknown command: ${argv.join(" ")}`);
    io.stdout(HELP.trimEnd());
    return 1;
  } catch (error) {
    const code = errorToExitCode(error);
    io.stderr((error as Error).message);
    return code;
  }
}

function cmdInit(cwd: string, io: CliIO): number {
  const configWrite = writeDefaultConfigIfMissing(cwd);
  const loaded = loadConfig(cwd);
  if (loaded.errors.length) {
    io.stderr(`config validation failed:\n${loaded.errors.map((error) => `- ${error}`).join("\n")}`);
    return 1;
  }
  ensureMissionStructure(cwd, loaded.config);
  initializeDatabase(cwd, loaded.config);
  initializeLedger(cwd, loaded.config);
  validateSchemaFixtures();
  const profile = HARDWARE_PROFILES[loaded.config.hardware.profile];
  io.stdout(`initialized ${loaded.config.project.name}`);
  io.stdout(`${configWrite.created ? "created" : "found"} ${path.relative(cwd, configWrite.path)}`);
  io.stdout(`created state_dir ${loaded.config.project.mission_dir}/`);
  io.stdout(`database ${loaded.config.project.database_path}`);
  io.stdout(`hardware_profile ${profile.name} context_budget_tokens=${profile.context_budget_tokens}`);
  return 0;
}

async function cmdDoctor(cwd: string, io: CliIO): Promise<number> {
  const loaded = loadConfig(cwd);
  if (loaded.errors.length) {
    io.stderr(`config validation failed:\n${loaded.errors.map((error) => `- ${error}`).join("\n")}`);
    return 1;
  }
  const sqlite = spawnSync("sqlite3", ["--version"], { encoding: "utf8" });
  const git = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8" });
  const hostRam = detectHostRamGb();
  io.stdout(`node ${process.version}`);
  io.stdout(`platform ${os.platform()} ${os.arch()}`);
  io.stdout(`host_ram_gb ${hostRam}`);
  io.stdout(`hardware_profile ${loaded.config.hardware.profile}`);
  io.stdout(`state_dir ${loaded.config.project.mission_dir}`);
  io.stdout(`database_path ${loaded.config.project.database_path}`);
  io.stdout(`sqlite ${sqlite.status === 0 ? sqlite.stdout.trim() : "missing"}`);
  io.stdout(`git ${git.status === 0 ? "inside_work_tree" : "not_a_git_repo"}`);
  io.stdout(`web_research_enabled ${loaded.config.web_research.enabled}`);
  io.stdout(`web_research_auto_include_in_docs ${loaded.config.web_research.auto_include_in_docs}`);
  io.stdout(`web_research_auto_include_in_chat ${loaded.config.web_research.auto_include_in_chat}`);
  io.stdout(`web_research_provider ${loaded.config.web_research.provider}`);
  io.stdout(`web_research_search_url ${loaded.config.web_research.search_url}`);
  io.stdout(`model_provider_default ${loaded.config.models.provider_default}`);
  io.stdout(`allow_provider_fallback ${loaded.config.models.allow_provider_fallback}`);

  const registry = loadModelRegistry(cwd, loaded.config);
  const model = routeModel(registry, "code_writer", loaded.config.hardware.profile, loaded.config.models.role_overrides);
  const provider = model ? effectiveModelProvider(loaded.config, model) : "none";
  io.stdout(`code_writer_model ${model?.id ?? "none"}`);
  io.stdout(`code_writer_backend ${provider}`);
  const llama = await inspectLlamaCppBackend({ cwd, config: loaded.config, role: "code_writer", model });
  io.stdout(`llamacpp_status ${llama.status}`);
  io.stdout(`llamacpp_message ${llama.message}`);
  io.stdout(`llamacpp_base_url ${llama.base_url}`);
  io.stdout(`llamacpp_model_path ${llama.model_path ?? "none"}`);
  io.stdout(`llamacpp_binary_path ${llama.binary_path ?? "none"}`);
  io.stdout(`llamacpp_pid_file ${llama.pid_file}`);
  io.stdout(`llamacpp_log_file ${llama.log_file}`);
  if (provider === "llamacpp" && llama.status !== "READY") return 7;
  return 0;
}

async function cmdChat(cwd: string, io: CliIO, args: string[]): Promise<number> {
  const loaded = requireValidConfig(cwd);
  return await runChatCommand(cwd, loaded.config, io, args);
}

async function cmdWebSearch(cwd: string, io: CliIO, query: string): Promise<number> {
  const loaded = requireValidConfig(cwd);
  return runWebSearchCommand(loaded.config, io, query);
}

function cmdSetupWebResearch(cwd: string, io: CliIO, args: string[]): number {
  writeDefaultConfigIfMissing(cwd);
  const loaded = requireValidConfig(cwd);
  return runSetupWebResearchCommand(cwd, loaded.config, io, args);
}

function cmdSpecCreate(cwd: string, io: CliIO, goal: string): number {
  if (!goal.trim()) {
    io.stderr("spec create requires a goal or spec text");
    return 1;
  }
  const loaded = requireValidConfig(cwd);
  ensureMissionStructure(cwd, loaded.config);
  initializeDatabase(cwd, loaded.config);
  const result = compileSpecInput(goal, detectInputType(goal));
  const file = persistCompileResult(cwd, loaded.config, result);
  io.stdout(`spec_id ${result.spec.spec_id}`);
  io.stdout(`status ${result.status}`);
  io.stdout(`draft_spec ${path.relative(cwd, file)}`);
  if (result.blocking_questions.length) {
    io.stdout("blocking_questions:");
    result.blocking_questions.forEach((question) => io.stdout(`- ${question}`));
    return 2;
  }
  io.stdout(`tasks ${result.task_graph.tasks.length}`);
  return 0;
}

function cmdSpecCompile(cwd: string, io: CliIO, file?: string): number {
  const loaded = requireValidConfig(cwd);
  ensureMissionStructure(cwd, loaded.config);
  initializeDatabase(cwd, loaded.config);
  const content = file
    ? fs.readFileSync(path.resolve(cwd, file), "utf8")
    : JSON.stringify(loadCompileResult(cwd, loaded.config).spec);
  const result = compileSpecInput(content, file?.endsWith(".json") ? "json" : detectInputType(content));
  const output = persistCompileResult(cwd, loaded.config, result);
  io.stdout(`spec_id ${result.spec.spec_id}`);
  io.stdout(`status ${result.status}`);
  io.stdout(`compiled_spec ${path.relative(cwd, output)}`);
  if (result.blocking_questions.length) {
    result.blocking_questions.forEach((question) => io.stdout(`question ${question}`));
    return 2;
  }
  io.stdout(JSON.stringify(result.task_graph, null, 2));
  return 0;
}

function cmdMissionStart(cwd: string, io: CliIO, file?: string): number {
  return startCompiledBuild(cwd, io, file, "mission");
}

function cmdBuildStart(cwd: string, io: CliIO, file?: string): number {
  return startCompiledBuild(cwd, io, file, "build");
}

function startCompiledBuild(cwd: string, io: CliIO, file: string | undefined, label: "mission" | "build"): number {
  const loaded = requireValidConfig(cwd);
  ensureMissionStructure(cwd, loaded.config);
  initializeDatabase(cwd, loaded.config);
  const result = file
    ? compileSpecInput(fs.readFileSync(path.resolve(cwd, file), "utf8"), file.endsWith(".json") ? "json" : undefined)
    : loadCompileResult(cwd, loaded.config);
  const started = startMission(cwd, loaded.config, result);
  if (started.status === "blocked") {
    io.stdout("blocked_by_spec_ambiguity");
    started.questions.forEach((question) => io.stdout(`- ${question}`));
    return 2;
  }
  io.stdout(`${label}_id ${started.mission.mission_id}`);
  io.stdout(`status ${started.mission.status}`);
  io.stdout(`current_task_id ${started.mission.current_task_id ?? "none"}`);
  return 0;
}

function cmdRepoIndex(cwd: string, io: CliIO): number {
  const loaded = requireValidConfig(cwd);
  ensureMissionStructure(cwd, loaded.config);
  initializeDatabase(cwd, loaded.config);
  const index = indexRepo(cwd, loaded.config);
  io.stdout(`status ${index.status}`);
  io.stdout(`repo_sha ${index.repo_sha}`);
  io.stdout(`index_sha ${index.index_sha}`);
  io.stdout(`files ${index.files.length}`);
  return 0;
}

function cmdRepoStatus(cwd: string, io: CliIO): number {
  const loaded = requireValidConfig(cwd);
  ensureMissionStructure(cwd, loaded.config);
  const status = getRepoStatus(cwd, loaded.config);
  io.stdout(`status ${status.status}`);
  io.stdout(`repo_sha ${status.repo_sha}`);
  io.stdout(`index_sha ${status.index_sha}`);
  io.stdout(`dirty_files ${JSON.stringify(status.dirty_files)}`);
  return status.status === "fresh" ? 0 : 3;
}

function cmdTaskNext(cwd: string, io: CliIO): number {
  const loaded = requireValidConfig(cwd);
  return runTaskNextCommand(cwd, io, loaded);
}

async function cmdRunTask(cwd: string, io: CliIO, args: string[]): Promise<number> {
  return await runTaskCommand(cwd, io, args, requireValidConfig);
}

async function cmdRunMission(cwd: string, io: CliIO, args: string[]): Promise<number> {
  return await runMissionCommand(cwd, io, args, requireValidConfig);
}

async function cmdRunBuild(cwd: string, io: CliIO, args: string[]): Promise<number> {
  return await runMissionCommand(cwd, io, args, requireValidConfig, "build");
}

async function cmdBuild(cwd: string, io: CliIO, subcommand: string | undefined, rest: string[]): Promise<number> {
  if (!subcommand || subcommand === "status") return await runTui(cwd, ["--snapshot"], io, runCli);
  if (subcommand === "spec") return cmdSpecCreate(cwd, io, rest.join(" "));
  if (subcommand === "compile") return cmdSpecCompile(cwd, io, rest[0]);
  if (subcommand === "start") return cmdBuildStart(cwd, io, rest[0]);
  if (subcommand === "next") return cmdTaskNext(cwd, io);
  if (subcommand === "step") return await cmdRunBuild(cwd, io, ["--mission", "--max-tasks", "1"]);
  if (subcommand === "run") {
    if (rest.length > 1) {
      io.stderr("build run accepts at most one positive max-tasks value");
      return 1;
    }
    return await cmdRunBuild(cwd, io, ["--mission", ...(rest[0] ? ["--max-tasks", rest[0]] : [])]);
  }
  if (subcommand === "validate") return cmdEvalValidate(cwd, io);
  io.stderr(`unknown build command: ${subcommand}`);
  return 1;
}

async function cmdVerify(cwd: string, io: CliIO, args: string[]): Promise<number> {
  const loaded = requireValidConfig(cwd);
  return await runVerifyCommand(cwd, io, args, loaded);
}

function cmdAttemptsList(cwd: string, io: CliIO, args: string[]): number {
  const taskId = valueAfter(args, "--task");
  const loaded = requireValidConfig(cwd);
  const file = path.join(missionDir(cwd, loaded.config), "attempts.jsonl");
  if (!fs.existsSync(file)) {
    io.stdout("[]");
    return 0;
  }
  const rows = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { task_id?: string })
    .filter((row) => !taskId || row.task_id === taskId);
  io.stdout(JSON.stringify(rows, null, 2));
  return 0;
}

function cmdArtifactsList(cwd: string, io: CliIO, args: string[]): number {
  const attemptId = valueAfter(args, "--attempt");
  const loaded = requireValidConfig(cwd);
  initializeDatabase(cwd, loaded.config);
  const where = attemptId ? `WHERE attempt_id = '${attemptId.replaceAll("'", "''")}'` : "";
  const rows = queryJson(databasePath(cwd, loaded.config), `SELECT * FROM artifacts ${where};`);
  io.stdout(JSON.stringify(rows, null, 2));
  return 0;
}

function cmdPatchApply(cwd: string, io: CliIO, args: string[]): number {
  const attemptId = valueAfter(args, "--attempt");
  if (!attemptId) {
    io.stderr("patch apply requires --attempt AID");
    return 1;
  }
  const loaded = requireValidConfig(cwd);
  ensureMissionStructure(cwd, loaded.config);
  initializeDatabase(cwd, loaded.config);
  const attemptsFile = path.join(missionDir(cwd, loaded.config), "attempts.jsonl");
  if (!fs.existsSync(attemptsFile)) {
    io.stderr("no attempts recorded");
    return 1;
  }
  const attempt = fs
    .readFileSync(attemptsFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { attempt_id?: string; status?: string; patch_path?: string })
    .find((row) => row.attempt_id === attemptId);
  if (!attempt) {
    io.stderr(`attempt not found: ${attemptId}`);
    return 1;
  }
  if (attempt.status !== "accepted") {
    io.stderr(`attempt is not accepted: ${attempt.status ?? "unknown"}`);
    return 5;
  }
  if (!attempt.patch_path) {
    io.stderr(`attempt has no patch: ${attemptId}`);
    return 1;
  }
  const patchPath = path.resolve(cwd, attempt.patch_path);
  if (!fs.existsSync(patchPath)) {
    io.stderr(`patch file not found: ${patchPath}`);
    return 1;
  }
  const patchText = fs.readFileSync(patchPath, "utf8");
  const touchedFiles = parseTouchedFiles(patchText);
  const validation = validatePatchScope(patchText, touchedFiles);
  if (!validation.scope_clean) {
    io.stderr(validation.rejected_reason ?? "patch failed scope validation");
    return 5;
  }
  const dryRun = spawnSync("patch", ["-p1", "--forward", "--dry-run"], {
    cwd,
    input: patchText,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  if (dryRun.status !== 0) {
    io.stderr((dryRun.stderr || dryRun.stdout).trim());
    return 5;
  }
  const apply = spawnSync("patch", ["-p1", "--forward"], {
    cwd,
    input: patchText,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  if (apply.status !== 0) {
    io.stderr((apply.stderr || apply.stdout).trim());
    return 5;
  }
  indexRepo(cwd, loaded.config);
  appendEvent(cwd, loaded.config, {
    task_id: undefined,
    event_type: "accepted_patch_applied",
    payload: { attempt_id: attemptId, patch_path: patchPath, touched_files: touchedFiles },
  });
  io.stdout(`applied_attempt ${attemptId}`);
  io.stdout(`patch_path ${patchPath}`);
  io.stdout(`touched_files ${JSON.stringify(touchedFiles)}`);
  return 0;
}

function cmdConfigProfile(cwd: string, io: CliIO, profile?: string): number {
  if (!profile || !isHardwareProfileName(profile)) {
    io.stderr("profile must be one of constrained_16gb, middle_32gb, strong_middle_48gb, strong_local_64gb");
    return 1;
  }
  writeDefaultConfigIfMissing(cwd);
  const loaded = requireValidConfig(cwd);
  loaded.config.hardware.profile = profile;
  const hardware = HARDWARE_PROFILES[profile];
  loaded.config.hardware.max_parallel_model_calls = hardware.parallel_model_calls;
  loaded.config.hardware.max_parallel_test_jobs = hardware.parallel_test_jobs;
  loaded.config.hardware.context_budget_tokens = hardware.context_budget_tokens;
  loaded.config.vision.enabled = hardware.vision_enabled;
  loaded.config.verification.playwright_enabled = hardware.playwright_enabled;
  saveConfig(cwd, loaded.config);
  io.stdout(`hardware_profile ${profile}`);
  io.stdout(`vision_enabled ${loaded.config.vision.enabled}`);
  io.stdout(`parallel_model_calls ${loaded.config.hardware.max_parallel_model_calls}`);
  return 0;
}

function cmdConfigFrontend(cwd: string, io: CliIO, startCommand?: string, appUrl?: string): number {
  if (!startCommand || !appUrl) {
    io.stderr('config frontend requires "<start command>" <url>');
    return 1;
  }
  writeDefaultConfigIfMissing(cwd);
  const loaded = requireValidConfig(cwd);
  loaded.config.verification.app_start_command = startCommand;
  loaded.config.verification.app_url = appUrl;
  saveConfig(cwd, loaded.config);
  io.stdout(`app_start_command ${startCommand}`);
  io.stdout(`app_url ${appUrl}`);
  return 0;
}

function cmdSetupBackendLlamacpp(cwd: string, io: CliIO, args: string[]): number {
  return runSetupBackendLlamacppCommand(cwd, io, args, requireValidConfig);
}

function cmdModelsList(cwd: string, io: CliIO): number {
  const loaded = requireValidConfig(cwd);
  return runModelsListCommand(cwd, io, loaded);
}

function cmdModelsStatus(cwd: string, io: CliIO): number {
  const loaded = requireValidConfig(cwd);
  return runModelsStatusCommand(cwd, io, loaded);
}

function cmdModelsSet(cwd: string, io: CliIO, role?: string, modelId?: string): number {
  return runModelsSetCommand(cwd, io, role, modelId, requireValidConfig);
}

function cmdModelsClear(cwd: string, io: CliIO, role?: string): number {
  return runModelsClearCommand(cwd, io, role, requireValidConfig);
}

async function cmdModelsProbe(cwd: string, io: CliIO, role: string): Promise<number> {
  const loaded = requireValidConfig(cwd);
  return await runModelsProbeCommand(cwd, io, role, loaded);
}

async function cmdBackendStatus(cwd: string, io: CliIO, role: string): Promise<number> {
  const loaded = requireValidConfig(cwd);
  return await runBackendStatusCommand(cwd, io, role, loaded);
}

async function cmdBackendStart(cwd: string, io: CliIO, role: string): Promise<number> {
  const loaded = requireValidConfig(cwd);
  return await runBackendStartCommand(cwd, io, role, loaded);
}

async function cmdBackendStop(cwd: string, io: CliIO): Promise<number> {
  const loaded = requireValidConfig(cwd);
  return await runBackendStopCommand(cwd, io, loaded);
}

function cmdEvalExport(cwd: string, io: CliIO): number {
  const loaded = requireValidConfig(cwd);
  ensureMissionStructure(cwd, loaded.config);
  const report = exportBenchmarkSkeleton(cwd, loaded.config);
  io.stdout(JSON.stringify(report, null, 2));
  return 0;
}

type ChatLabTurn = {
  input: string;
  expect?: string[];
  reject?: string[];
  status?: number;
};

type ChatLabScenario = {
  name: string;
  turns: ChatLabTurn[];
};

const CHAT_LAB_SCENARIOS: ChatLabScenario[] = [
  {
    name: "greeting stays short",
    turns: [
      {
        input: "hi",
        expect: ["Hey. What do you want to build?"],
        reject: ["chat_status", "spec_id", "compiled_spec"],
      },
    ],
  },
  {
    name: "todo list compiles without dumb clarification",
    turns: [
      {
        input: "build me a todo list",
        expect: ["I have a build plan.", "Next: say `build it`"],
        reject: ["Which exact user-visible behavior should change?", "What proves it is done?", "chat_status", "compiled_spec"],
      },
    ],
  },
  {
    name: "todo list replaces stale vague brief",
    turns: [
      {
        input: "make the dashboard better",
        expect: ["I need a little more before I can build it well."],
        reject: ["I have a build plan."],
      },
      {
        input: "build me a todo list",
        expect: ["I have a build plan.", "Next: say `build it`"],
        reject: ["Which exact user-visible behavior should change?", "What proves it is done?"],
      },
    ],
  },
  {
    name: "snake inspect and build",
    turns: [
      {
        input: "snake game",
        expect: ["I have a build plan.", "Next: say `build it`"],
        reject: ["chat_status", "compiled_spec"],
      },
      {
        input: "what is the spec?",
        expect: ["Build plan", "Goal: Build a browser Snake game", "Done when:"],
        reject: ["compiled_spec"],
      },
      {
        input: "build it",
        expect: ["Starting build from the compiled spec.", "status active"],
        reject: ["I already turned this into a buildable spec."],
      },
    ],
  },
  {
    name: "confused before brief asks for build",
    turns: [
      {
        input: "??",
        expect: ["Tell me what you want to build, in one concrete sentence."],
        reject: ["I have a build plan.", "chat_status"],
      },
    ],
  },
  {
    name: "compiled confusion does not recompile",
    turns: [
      {
        input: "snake game",
        expect: ["I have a build plan."],
      },
      {
        input: "what?",
        expect: ["I already have the build plan.", "say `build it` to start"],
        reject: ["compiled_spec", "chat_status"],
      },
    ],
  },
  {
    name: "generic app stays collecting",
    turns: [
      {
        input: "build me an app",
        expect: ["I need a little more before I can build it well.", "What proves it is done?"],
        reject: ["I have a build plan."],
      },
    ],
  },
  {
    name: "active build warns while accepting new standard brief",
    turns: [
      {
        input: "snake game",
        expect: ["I have a build plan."],
      },
      {
        input: "build it",
        expect: ["status active"],
      },
      {
        input: "make a todo tracker",
        expect: ["I have a build plan.", "Existing build still active:"],
        reject: ["Build already active."],
      },
    ],
  },
  {
    name: "capability answer stays conversational",
    turns: [
      {
        input: "what can you do?",
        expect: ["Tell me what you want to build in plain English"],
        reject: ["chat_status", "spec_id", "compiled_spec"],
      },
    ],
  },
];

async function cmdEvalChatLab(cwd: string, io: CliIO): Promise<number> {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactRoot = path.join(cwd, ".gauntlet", "chat-lab", runId);
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "microcoder-chat-lab-"));
  const cases: Array<{ name: string; status: "pass" | "fail"; transcript: string; message?: string }> = [];
  fs.mkdirSync(artifactRoot, { recursive: true });

  for (const scenario of CHAT_LAB_SCENARIOS) {
    const caseId = scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const workspace = path.join(workspaceRoot, caseId);
    const transcriptFile = path.join(artifactRoot, `${caseId}.txt`);
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }), "utf8");
    const transcript: string[] = [];
    let failure: string | undefined;

    try {
      await runCaptured(["init"], workspace, transcript);
      await runCaptured(["setup", "web", "--enabled", "false", "--auto", "false", "--chat", "false"], workspace, transcript);
      for (const turn of scenario.turns) {
        const result = await runCaptured(["tui", "--command", turn.input], workspace, transcript, `microcoder> ${turn.input}`);
        const expectedStatus = turn.status ?? 0;
        if (result.code !== expectedStatus) {
          throw new Error(`${turn.input} exited ${result.code}, expected ${expectedStatus}`);
        }
        for (const expected of turn.expect ?? []) {
          if (!result.output.includes(expected)) throw new Error(`${turn.input} missing ${JSON.stringify(expected)}`);
        }
        for (const rejected of turn.reject ?? []) {
          if (result.output.includes(rejected)) throw new Error(`${turn.input} included forbidden ${JSON.stringify(rejected)}`);
        }
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      transcript.push(`FAIL ${failure}`);
    }

    fs.writeFileSync(transcriptFile, `${transcript.join("\n").trimEnd()}\n`, "utf8");
    cases.push({
      name: scenario.name,
      status: failure ? "fail" : "pass",
      transcript: path.relative(cwd, transcriptFile),
      message: failure,
    });
  }

  const failures = cases.filter((item) => item.status === "fail");
  const report = {
    run_id: runId,
    generated_at: new Date().toISOString(),
    artifact_root: artifactRoot,
    workspace_root: workspaceRoot,
    case_count: cases.length,
    failure_count: failures.length,
    cases,
  };
  fs.writeFileSync(path.join(artifactRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(artifactRoot, "report.md"),
    [
      "# Microcoder Chat Lab",
      "",
      `Run: ${runId}`,
      `Cases: ${cases.length}`,
      `Failures: ${failures.length}`,
      "",
      ...cases.map((item) => `- ${item.status === "pass" ? "PASS" : "FAIL"} ${item.name}${item.message ? `: ${item.message}` : ""}`),
      "",
    ].join("\n"),
    "utf8",
  );

  io.stdout(`chat_lab_status ${failures.length ? "failed" : "passed"}`);
  io.stdout(`chat_lab_cases ${cases.length}`);
  io.stdout(`chat_lab_failures ${failures.length}`);
  io.stdout(`chat_lab_artifacts ${path.relative(cwd, artifactRoot)}`);
  if (failures.length) return 1;
  return 0;
}

type BuildLabPromptScenario = {
  name: string;
  turns: ChatLabTurn[];
  compiled?: boolean;
  assertions?: BuildLabSpecAssertions;
};

type BuildLabSpecAssertions = {
  goalIncludes?: string[];
  requirementsInclude?: string[];
  requirementsReject?: string[];
  acceptanceInclude?: string[];
  nonGoalsInclude?: string[];
  riskFlagsInclude?: string[];
  riskFlagsReject?: string[];
  unresolvedRisksInclude?: string[];
  briefIncludes?: string[];
  briefReject?: string[];
  taskCountMin?: number;
};

type BuildLabCompiledSpec = {
  spec?: {
    goal?: string;
    requirements?: Array<{ text?: string }>;
    acceptance_criteria?: Array<{ text?: string }>;
    non_goals?: string[];
    risk_flags?: string[];
  };
  task_graph?: { tasks?: Array<{ title?: string }> };
};

type BuildLabCase = {
  name: string;
  status: "pass" | "fail";
  kind: "prompt" | "build";
  transcript: string;
  message?: string;
  spec_excerpt?: string[];
};

const BUILD_LAB_PROMPTS: BuildLabPromptScenario[] = [
  {
    name: "todo list",
    turns: [{ input: "build me a todo list", expect: ["I have a build plan."], reject: ["Which exact user-visible behavior should change?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["todo list"],
      requirementsInclude: ["Add a todo item with a title", "Mark todos complete or active again", "Todo items stored locally"],
      requirementsReject: ["build me a todo list"],
      acceptanceInclude: ["npm test passes"],
      taskCountMin: 5,
    },
  },
  {
    name: "notes app",
    turns: [{ input: "build a notes app where I can create, edit, search, and delete notes", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["notes app"],
      requirementsInclude: ["Create notes with title and body", "Edit, search, and delete notes"],
      acceptanceInclude: ["npm test passes"],
    },
  },
  {
    name: "kanban board",
    turns: [{ input: "build a simple kanban board for tasks with todo, doing, and done columns", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["kanban board"],
      requirementsInclude: ["Create task cards", "Move cards between named workflow columns"],
      requirementsReject: ["Build a local todo list app"],
    },
  },
  {
    name: "csv expense tracker",
    turns: [{ input: "build an expense tracker that imports a CSV and shows category totals", expect: ["I have a build plan."], reject: ["What data does it store"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["expense tracker"],
      requirementsInclude: ["Import CSV data", "Categorize amounts", "category totals"],
    },
  },
  {
    name: "pomodoro timer",
    turns: [{ input: "build a pomodoro timer with start, pause, reset, and session count", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["pomodoro timer"],
      requirementsInclude: ["Start, pause, resume, and reset the timer", "completed session count"],
    },
  },
  {
    name: "calculator",
    turns: [{ input: "build a calculator", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["calculator"],
      requirementsInclude: ["Run addition, subtraction, multiplication, and division", "Clear input and recover from errors"],
    },
  },
  {
    name: "markdown previewer",
    turns: [{ input: "build a markdown previewer with split editing and preview", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["markdown previewer"],
      requirementsInclude: ["Edit Markdown text", "Preview rendered Markdown output", "split editing", "preview"],
      acceptanceInclude: ["safely renders common Markdown"],
    },
  },
  {
    name: "memory card game",
    turns: [{ input: "build a memory matching card game", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["memory matching card game"],
      requirementsInclude: ["Flip two cards at a time", "Track moves and show a win state"],
    },
  },
  {
    name: "lightweight crm",
    turns: [{ input: "build a lightweight CRM for freelance designers", expect: ["I have a build plan."], reject: ["What data does it store"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["lightweight CRM"],
      requirementsInclude: ["Create and edit contacts or clients", "Track leads or projects by status"],
      briefIncludes: ["freelance designers"],
    },
  },
  {
    name: "habit tracker",
    turns: [{ input: "build a habit tracker with streaks", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["habit tracker", "streaks"],
      requirementsInclude: ["Create habits with names", "Check off habits", "Show streaks", "Support streaks"],
      briefIncludes: ["streaks"],
    },
  },
  {
    name: "bare habit tracker",
    turns: [{ input: "habit tracker", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["habit tracker"],
      requirementsInclude: ["Create habits with names", "Check off habits", "Show streaks"],
      requirementsReject: ["Build a local tracker app"],
    },
  },
  {
    name: "workout tracker",
    turns: [{ input: "build a workout tracker for exercises, sets, reps, and notes", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["workout tracker"],
      requirementsInclude: ["Add workout entries", "Track sets, reps, weight, and notes"],
      briefIncludes: ["sets", "reps", "notes"],
    },
  },
  {
    name: "recipe meal planner",
    turns: [{ input: "build a recipe meal planner that creates a grocery list", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["recipe meal planner"],
      requirementsInclude: ["Create recipes with ingredients", "Generate a grocery list"],
    },
  },
  {
    name: "flashcard quiz",
    turns: [{ input: "build a flashcard quiz app for studying", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["flashcard quiz"],
      requirementsInclude: ["Create study cards with prompts and answers", "Run a quiz session"],
    },
  },
  {
    name: "inventory tracker",
    turns: [{ input: "build an inventory tracker with low stock filters", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["inventory tracker", "low stock filters"],
      requirementsInclude: ["Add inventory items", "Filter low-stock items", "Support low stock filters"],
      briefIncludes: ["low stock filters"],
    },
  },
  {
    name: "event rsvp tracker",
    turns: [{ input: "build an event RSVP tracker for guests", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["event RSVP tracker"],
      requirementsInclude: ["Add guests or scheduled items", "Update RSVP or status values"],
    },
  },
  {
    name: "image gallery",
    turns: [{ input: "build an image gallery with tags and search", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["image gallery", "tags", "search"],
      requirementsInclude: ["Add image or media entries", "Search or filter by title and tag", "Support tags", "Support search"],
    },
  },
  {
    name: "budget dashboard",
    turns: [{ input: "build a budget dashboard with spending categories", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["budget dashboard", "spending categories"],
      requirementsInclude: ["Categorize amounts", "spending summaries", "Support spending categories"],
    },
  },
  {
    name: "vague dashboard",
    turns: [{ input: "make the dashboard better", expect: ["I need a little more before I can build it well.", "Which exact user-visible behavior should change?"], reject: ["I have a build plan."] }],
    compiled: false,
    assertions: {
      riskFlagsInclude: ["vague"],
      unresolvedRisksInclude: ["vague"],
    },
  },
  {
    name: "order status page not tracker",
    turns: [{ input: "build an order status page", expect: ["I need a little more before I can build it well."], reject: ["I have a build plan."] }],
    compiled: false,
    assertions: {
      briefIncludes: ["order status page"],
      briefReject: ["Build a local tracker app", "Create and edit tracked records"],
    },
  },
  {
    name: "stripe deployment risk",
    turns: [
      {
        input: "build an app that uses Stripe payments and deploy it",
        expect: ["I need a little more before I can build it well.", "live payments, deployment, or third-party APIs need configured accounts", "Which parts should be built locally now"],
        reject: ["I have a build plan."],
      },
    ],
    compiled: false,
    assertions: {
      riskFlagsInclude: ["billing", "external_service"],
      unresolvedRisksInclude: ["external_service"],
    },
  },
  {
    name: "password manager security risk",
    turns: [
      {
        input: "build a password manager",
        expect: ["I need a little more before I can build it well.", "security-sensitive", "What security model is required"],
        reject: ["I have a build plan."],
      },
    ],
    compiled: false,
    assertions: {
      riskFlagsInclude: ["sensitive_data"],
      unresolvedRisksInclude: ["security_sensitive"],
    },
  },
  {
    name: "live weather api risk",
    turns: [
      {
        input: "build a weather app using a live weather API",
        expect: ["I need a little more before I can build it well.", "third-party APIs need configured accounts", "Which parts should be built locally now"],
        reject: ["I have a build plan."],
      },
    ],
    compiled: false,
    assertions: {
      riskFlagsInclude: ["external_service"],
      unresolvedRisksInclude: ["external_service"],
    },
  },
  {
    name: "todo list modifiers",
    turns: [{ input: "build a todo list with deadlines, tags, and shared projects", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["todo list", "deadlines", "tags", "shared projects"],
      requirementsInclude: ["Support deadlines", "Support tags", "Support shared projects"],
      briefIncludes: ["deadlines", "tags", "shared projects"],
    },
  },
  {
    name: "kanban calendar modifier",
    turns: [{ input: "build a kanban board with calendar view", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["kanban board", "calendar view"],
      requirementsInclude: ["Create task cards", "Support calendar view"],
      requirementsReject: ["Build a local todo list app"],
    },
  },
  {
    name: "build pipeline tracker",
    turns: [{ input: "build a build pipeline tracker with stage status, logs, and retry history", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["build pipeline tracker", "stage status", "logs", "retry history"],
      requirementsInclude: ["Support stage status", "Support logs", "Support retry history"],
      requirementsReject: ["habit tracker", "workout tracker", "inventory tracker"],
    },
  },
  {
    name: "unseen chess variant",
    turns: [{ input: "build a chess variant with fairy pieces", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["chess variant", "fairy pieces"],
      requirementsInclude: ["Start and play the game", "Support fairy pieces"],
    },
  },
  {
    name: "todo stripe collision stays blocked",
    turns: [
      {
        input: "build a todo list with Stripe checkout and acceptance: npm test passes",
        expect: ["I need a little more before I can build it well.", "Which parts should be built locally now"],
        reject: ["I have a build plan."],
      },
    ],
    compiled: false,
    assertions: {
      riskFlagsInclude: ["billing", "external_service"],
      unresolvedRisksInclude: ["external_service"],
      briefIncludes: ["todo list", "Stripe checkout"],
    },
  },
  {
    name: "notes offline dark mode modifiers",
    turns: [{ input: "build a notes app with dark mode and offline-first local storage", expect: ["I have a build plan."], reject: ["What proves it is done?"] }],
    compiled: true,
    assertions: {
      goalIncludes: ["notes app", "dark mode", "offline-first local storage"],
      requirementsInclude: ["Support dark mode", "Support offline-first local storage"],
      nonGoalsInclude: ["No accounts, backend, or cloud sync unless requested"],
      briefReject: ["Include a usable dark mode", "Support offline-first local behavior unless external sync is explicitly configured"],
    },
  },
];

async function cmdEvalBuildLab(cwd: string, io: CliIO): Promise<number> {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactRoot = path.join(cwd, ".gauntlet", "build-lab", runId);
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "microcoder-build-lab-"));
  const cases: BuildLabCase[] = [];
  fs.mkdirSync(artifactRoot, { recursive: true });

  for (const scenario of BUILD_LAB_PROMPTS) {
    const result = await runBuildPromptScenario(workspaceRoot, artifactRoot, scenario);
    cases.push(result);
  }
  cases.push(await runSeededBugfixBuild(workspaceRoot, artifactRoot));
  cases.push(await runSeededStyleBuild(workspaceRoot, artifactRoot));

  const failures = cases.filter((item) => item.status === "fail");
  const report = {
    run_id: runId,
    generated_at: new Date().toISOString(),
    artifact_root: artifactRoot,
    workspace_root: workspaceRoot,
    case_count: cases.length,
    failure_count: failures.length,
    cases,
  };
  fs.writeFileSync(path.join(artifactRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(artifactRoot, "report.md"),
    [
      "# Microcoder Build Lab",
      "",
      `Run: ${runId}`,
      `Cases: ${cases.length}`,
      `Failures: ${failures.length}`,
      "",
      ...cases.map((item) => `- ${item.status === "pass" ? "PASS" : "FAIL"} ${item.kind} ${item.name}${item.message ? `: ${item.message}` : ""}`),
      "",
    ].join("\n"),
    "utf8",
  );

  io.stdout(`build_lab_status ${failures.length ? "failed" : "passed"}`);
  io.stdout(`build_lab_cases ${cases.length}`);
  io.stdout(`build_lab_failures ${failures.length}`);
  io.stdout(`build_lab_artifacts ${path.relative(cwd, artifactRoot)}`);
  return failures.length ? 1 : 0;
}

async function runBuildPromptScenario(
  workspaceRoot: string,
  artifactRoot: string,
  scenario: BuildLabPromptScenario,
): Promise<BuildLabCase> {
  const caseId = scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const workspace = path.join(workspaceRoot, caseId);
  const transcriptFile = path.join(artifactRoot, `${caseId}.txt`);
  const transcript: string[] = [];
  let specExcerpt: string[] | undefined;
  let failure: string | undefined;
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }), "utf8");
  try {
    await runCaptured(["init"], workspace, transcript);
    await runCaptured(["setup", "web", "--enabled", "false", "--auto", "false", "--chat", "false"], workspace, transcript);
    for (const turn of scenario.turns) {
      const result = await runCaptured(["tui", "--command", turn.input], workspace, transcript, `microcoder> ${turn.input}`);
      if (result.code !== (turn.status ?? 0)) throw new Error(`${turn.input} exited ${result.code}, expected ${turn.status ?? 0}`);
      for (const expected of turn.expect ?? []) {
        if (!result.output.includes(expected)) throw new Error(`${turn.input} missing ${JSON.stringify(expected)}`);
      }
      for (const rejected of turn.reject ?? []) {
        if (result.output.includes(rejected)) throw new Error(`${turn.input} included forbidden ${JSON.stringify(rejected)}`);
      }
    }
    const specFile = path.join(workspace, ".mission", "spec.json");
    if (scenario.compiled === false && fs.existsSync(specFile)) throw new Error("scenario compiled when it should have kept collecting");
    if (scenario.compiled) {
      if (!fs.existsSync(specFile)) throw new Error("scenario did not compile a spec");
      const spec = fs.readFileSync(specFile, "utf8");
      const parsedSpec = JSON.parse(spec) as BuildLabCompiledSpec;
      specExcerpt = compiledSpecExcerpt(spec);
      transcript.push("compiled_spec_excerpt:");
      transcript.push(...specExcerpt.map((line) => `  ${line}`));
      assertBuildLabSpec(scenario.name, parsedSpec, loadBuildLabBriefText(workspace), scenario.assertions);
    } else if (scenario.assertions) {
      assertBuildLabCollectingState(scenario.name, loadBuildLabBriefText(workspace), scenario.assertions);
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    transcript.push(`FAIL ${failure}`);
  }
  fs.writeFileSync(transcriptFile, `${transcript.join("\n").trimEnd()}\n`, "utf8");
  return { name: scenario.name, status: failure ? "fail" : "pass", kind: "prompt", transcript: path.relative(process.cwd(), transcriptFile), message: failure, spec_excerpt: specExcerpt };
}

function loadBuildLabBriefText(workspace: string): string {
  const stateFile = path.join(workspace, ".mission", "chat", "spec-chat.json");
  if (!fs.existsSync(stateFile)) return "";
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as { brief?: unknown };
  return JSON.stringify(state.brief ?? {});
}

function assertBuildLabSpec(
  scenarioName: string,
  parsed: BuildLabCompiledSpec,
  briefText: string,
  assertions: BuildLabSpecAssertions = {},
): void {
  const spec = parsed.spec ?? {};
  const goal = spec.goal ?? "";
  const requirements = (spec.requirements ?? []).map((item) => item.text ?? "").join("\n");
  const acceptance = (spec.acceptance_criteria ?? []).map((item) => item.text ?? "").join("\n");
  const nonGoals = (spec.non_goals ?? []).join("\n");
  const riskFlags = (spec.risk_flags ?? []).join("\n");
  const taskCount = parsed.task_graph?.tasks?.length ?? 0;

  if (!goal) throw new Error(`${scenarioName} compiled without a goal`);
  if (!requirements.trim()) throw new Error(`${scenarioName} compiled without requirements`);
  if (!acceptance.trim()) throw new Error(`${scenarioName} compiled without acceptance criteria`);
  if (!taskCount) throw new Error(`${scenarioName} compiled without task graph tasks`);

  assertIncludes(goal, assertions.goalIncludes, "goal");
  assertIncludes(requirements, assertions.requirementsInclude, "requirements");
  assertRejects(requirements, assertions.requirementsReject, "requirements");
  assertIncludes(acceptance, assertions.acceptanceInclude, "acceptance");
  assertIncludes(nonGoals, assertions.nonGoalsInclude, "non_goals");
  assertIncludes(riskFlags, assertions.riskFlagsInclude, "risk_flags");
  assertRejects(riskFlags, assertions.riskFlagsReject, "risk_flags");
  assertIncludes(briefText, assertions.briefIncludes, "brief");
  assertRejects(briefText, assertions.briefReject, "brief");
  if (assertions.taskCountMin !== undefined && taskCount < assertions.taskCountMin) {
    throw new Error(`task graph has ${taskCount} tasks, expected at least ${assertions.taskCountMin}`);
  }
}

function assertBuildLabCollectingState(
  scenarioName: string,
  briefText: string,
  assertions: BuildLabSpecAssertions,
): void {
  if (!briefText) throw new Error(`${scenarioName} did not persist a collecting brief`);
  assertIncludes(briefText, assertions.briefIncludes, "brief");
  assertRejects(briefText, assertions.briefReject, "brief");
  assertIncludes(briefText, assertions.riskFlagsInclude, "brief risk_flags");
  assertIncludes(briefText, assertions.unresolvedRisksInclude, "brief unresolved_risks");
}

function assertIncludes(text: string, expected: string[] | undefined, label: string): void {
  for (const value of expected ?? []) {
    if (!text.toLowerCase().includes(value.toLowerCase())) throw new Error(`${label} missing ${JSON.stringify(value)}`);
  }
}

function assertRejects(text: string, rejected: string[] | undefined, label: string): void {
  for (const value of rejected ?? []) {
    if (text.toLowerCase().includes(value.toLowerCase())) throw new Error(`${label} included forbidden ${JSON.stringify(value)}`);
  }
}

function compiledSpecExcerpt(rawSpec: string): string[] {
  const parsed = JSON.parse(rawSpec) as BuildLabCompiledSpec;
  const spec = parsed.spec ?? {};
  const requirements = (spec.requirements ?? []).map((item) => item.text).filter(Boolean).slice(0, 10);
  const acceptance = (spec.acceptance_criteria ?? []).map((item) => item.text).filter(Boolean).slice(0, 5);
  const tasks = (parsed.task_graph?.tasks ?? []).map((item) => item.title).filter(Boolean).slice(0, 10);
  return [
    `goal: ${spec.goal ?? "none"}`,
    ...requirements.map((item) => `requirement: ${item}`),
    ...acceptance.map((item) => `acceptance: ${item}`),
    ...(spec.non_goals ?? []).slice(0, 3).map((item) => `non_goal: ${item}`),
    ...tasks.map((item) => `task: ${item}`),
  ];
}

async function runSeededBugfixBuild(
  workspaceRoot: string,
  artifactRoot: string,
): Promise<{ name: string; status: "pass" | "fail"; kind: "build"; transcript: string; message?: string }> {
  const workspace = path.join(workspaceRoot, "seeded-bugfix");
  const transcriptFile = path.join(artifactRoot, "seeded-bugfix.txt");
  const transcript: string[] = [];
  let failure: string | undefined;
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node test.js" } }), "utf8");
  fs.writeFileSync(path.join(workspace, "src", "math.js"), "export function add(a, b) { return a - b; }\n", "utf8");
  fs.writeFileSync(path.join(workspace, "test.js"), "import { add } from './src/math.js'; if (add(1, 2) !== 3) process.exit(1);\n", "utf8");
  try {
    await runAcceptedPatchBuild({
      workspace,
      transcript,
      spec: {
        goal: "Repair addition implementation",
        requirements: ["Return the sum of both inputs from add"],
        acceptance_criteria: [{ text: "npm test passes", verification: "npm test" }],
        non_goals: [],
        risk_flags: [],
      },
      allowedFiles: ["src/math.js"],
      patchFile: "fix.patch",
      patch: `diff --git a/src/math.js b/src/math.js
--- a/src/math.js
+++ b/src/math.js
@@ -1 +1 @@
-export function add(a, b) { return a - b; }
+export function add(a, b) { return a + b; }
`,
    });
    assertShellPass(workspace, transcript, "npm", ["test"]);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    transcript.push(`FAIL ${failure}`);
  }
  fs.writeFileSync(transcriptFile, `${transcript.join("\n").trimEnd()}\n`, "utf8");
  return { name: "seeded existing-repo bugfix", status: failure ? "fail" : "pass", kind: "build", transcript: path.relative(process.cwd(), transcriptFile), message: failure };
}

async function runSeededStyleBuild(
  workspaceRoot: string,
  artifactRoot: string,
): Promise<{ name: string; status: "pass" | "fail"; kind: "build"; transcript: string; message?: string }> {
  const workspace = path.join(workspaceRoot, "seeded-style-improvement");
  const transcriptFile = path.join(artifactRoot, "seeded-style-improvement.txt");
  const transcript: string[] = [];
  let failure: string | undefined;
  const port = 4700 + Math.floor(Math.random() * 1000);
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node --check src/main.js" } }), "utf8");
  fs.writeFileSync(path.join(workspace, "index.html"), "<main class=\"app\"><h1>Tasks</h1><button>Add</button></main>\n", "utf8");
  fs.writeFileSync(path.join(workspace, "src", "main.js"), "export const ready = true;\n", "utf8");
  fs.writeFileSync(path.join(workspace, "src", "styles.css"), ".app{font-family:sans-serif}button{padding:4px}\n", "utf8");
  fs.writeFileSync(
    path.join(workspace, "server.js"),
    `const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
http.createServer((request, response) => {
  if (request.url === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  const target = request.url === "/" ? "index.html" : request.url.slice(1);
  const file = path.join(root, target);
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200);
    response.end(data);
  });
}).listen(${port}, "127.0.0.1");
`,
    "utf8",
  );
  try {
    await runAcceptedPatchBuild({
      workspace,
      transcript,
      spec: {
        goal: "Update task app stylesheet",
        requirements: ["Apply clearer spacing, contrast, and button styling without changing behavior"],
        acceptance_criteria: [{ text: "npm test passes", verification: "npm test" }],
        non_goals: ["No framework rewrite"],
        risk_flags: [],
      },
      allowedFiles: ["src/styles.css"],
      frontendCommand: "node server.js",
      frontendUrl: `http://127.0.0.1:${port}/`,
      patchFile: "style.patch",
      patch: `diff --git a/src/styles.css b/src/styles.css
--- a/src/styles.css
+++ b/src/styles.css
@@ -1 +1 @@
-.app{font-family:sans-serif}button{padding:4px}
+.app{font-family:sans-serif;max-width:720px;margin:32px auto;padding:24px;border:1px solid #d8dee8;background:#fff}button{padding:10px 14px;border:1px solid #1f2937;background:#1f2937;color:#fff}
`,
    });
    assertShellPass(workspace, transcript, "npm", ["test"]);
    if (!fs.readFileSync(path.join(workspace, "src", "styles.css"), "utf8").includes("max-width:720px")) {
      throw new Error("style patch was not applied to the checkout");
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    transcript.push(`FAIL ${failure}`);
  }
  fs.writeFileSync(transcriptFile, `${transcript.join("\n").trimEnd()}\n`, "utf8");
  return { name: "seeded style improvement", status: failure ? "fail" : "pass", kind: "build", transcript: path.relative(process.cwd(), transcriptFile), message: failure };
}

async function runAcceptedPatchBuild(args: {
  workspace: string;
  transcript: string[];
  spec: unknown;
  allowedFiles: string[];
  frontendCommand?: string;
  frontendUrl?: string;
  patchFile: string;
  patch: string;
}): Promise<void> {
  await runCaptured(["init"], args.workspace, args.transcript);
  await runCaptured(["setup", "web", "--enabled", "false", "--auto", "false", "--chat", "false"], args.workspace, args.transcript);
  if (args.frontendCommand && args.frontendUrl) {
    await runCaptured(["config", "frontend", args.frontendCommand, args.frontendUrl], args.workspace, args.transcript);
  }
  fs.writeFileSync(path.join(args.workspace, "valid-spec.json"), JSON.stringify(args.spec), "utf8");
  await runCaptured(["spec", "compile", "valid-spec.json"], args.workspace, args.transcript);
  await runCaptured(["build", "start"], args.workspace, args.transcript);
  const graphPath = path.join(args.workspace, ".mission", "task_graph.json");
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as { tasks: Array<{ allowed_files: string[]; verification_commands: string[] }> };
  graph.tasks[0].allowed_files = args.allowedFiles;
  graph.tasks[0].verification_commands = ["npm test"];
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), "utf8");
  fs.writeFileSync(path.join(args.workspace, args.patchFile), args.patch, "utf8");
  const run = await runCaptured(["run", "--task", "T1", "--mock-patch", args.patchFile], args.workspace, args.transcript);
  if (run.code !== 0) throw new Error(`run --task failed with ${run.code}`);
  if (!run.output.includes("patch_status applied") || !run.output.includes("verification passed")) {
    throw new Error("run --task did not apply and verify the patch");
  }
  const attempts = fs.readFileSync(path.join(args.workspace, ".mission", "attempts.jsonl"), "utf8").trim().split(/\r?\n/);
  const latest = JSON.parse(attempts[attempts.length - 1] ?? "{}") as { attempt_id?: string; status?: string };
  if (!latest.attempt_id || latest.status !== "accepted") throw new Error(`latest attempt was not accepted: ${JSON.stringify(latest)}`);
  const applied = await runCaptured(["patch", "apply", "--attempt", latest.attempt_id], args.workspace, args.transcript);
  if (applied.code !== 0 || !applied.output.includes(`applied_attempt ${latest.attempt_id}`)) {
    throw new Error(`patch apply failed for ${latest.attempt_id}`);
  }
}

function assertShellPass(cwd: string, transcript: string[], command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  transcript.push(`$ ${[command, ...args].join(" ")}`);
  transcript.push((result.stdout ?? "") + (result.stderr ?? "") || "(no output)");
  transcript.push(`exit ${result.status ?? 1}`);
  transcript.push("");
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
}

async function runCaptured(argv: string[], cwd: string, transcript: string[], prompt?: string): Promise<{ code: number; output: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(argv, {
    cwd,
    io: {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
  });
  const output = [...stdout, ...stderr].join("\n");
  transcript.push(prompt ?? `$ microcoder ${argv.join(" ")}`);
  transcript.push(output || "(no output)");
  transcript.push(`exit ${code}`);
  transcript.push("");
  return { code, output };
}

async function cmdEvalBenchmark(cwd: string, io: CliIO, args: string[]): Promise<number> {
  const loaded = requireValidConfig(cwd);
  ensureMissionStructure(cwd, loaded.config);
  initializeDatabase(cwd, loaded.config);
  const parsedCount = parsePositiveInteger(valueAfter(args, "--count") ?? "20", "eval benchmark --count");
  if (typeof parsedCount === "string") {
    io.stderr(parsedCount);
    return 1;
  }
  const parsedSource = parseBenchmarkSource(valueAfter(args, "--source"));
  if (!parsedSource.ok) {
    io.stderr(parsedSource.error);
    return 1;
  }
  const modelRole = valueAfter(args, "--role") ?? "code_writer";
  const report = await runLocalBenchmark({
    cwd,
    config: loaded.config,
    taskCount: parsedCount,
    modelRole,
    mockRaw: args.includes("--mock-raw"),
    source: parsedSource.source,
  });
  io.stdout(JSON.stringify(report, null, 2));
  return 0;
}

function cmdEvalValidate(cwd: string, io: CliIO): number {
  const loaded = requireValidConfig(cwd);
  ensureMissionStructure(cwd, loaded.config);
  initializeDatabase(cwd, loaded.config);
  const report = validateMissionConsistency(cwd, loaded.config);
  io.stdout(JSON.stringify(report, null, 2));
  return report.status === "pass" ? 0 : 1;
}

function requireValidConfig(cwd: string): ReturnType<typeof loadConfig> {
  const loaded = loadConfig(cwd);
  const errors = loaded.errors;
  if (errors.length) {
    throw Object.assign(new Error(`config validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`), {
      code: "VALIDATION",
    });
  }
  return loaded;
}

function validateSchemaFixtures(): void {
  const validator = createValidator();
  for (const [name, fixture] of Object.entries(schemaFixtures)) {
    validator.assert(name as Parameters<typeof validator.assert>[0], fixture);
  }
}

function parseBenchmarkSource(value: string | undefined):
  | { ok: true; source: "generated" | "current-repo" }
  | { ok: false; error: string } {
  if (!value || value === "generated") return { ok: true, source: "generated" };
  if (value === "current-repo") return { ok: true, source: "current-repo" };
  return { ok: false, error: "eval benchmark --source must be generated or current-repo" };
}

function errorToExitCode(error: unknown): number {
  const code = (error as { code?: string }).code;
  if (code === "REPO_STALE") return 3;
  if (code === "COMMAND_BLOCKED" || code === "VALIDATION") return 1;
  if (code === "MODEL_PROVIDER_FAILED") return 7;
  return 1;
}
