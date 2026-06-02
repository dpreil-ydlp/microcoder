import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../core/config/config.js";
import { missionDir } from "../core/storage/sqlite.js";
import { loadSpecChatState } from "../core/chat/spec-chat.js";
import { loadModelRegistry, MODEL_ROLES, routeModel } from "../core/models/orchestrator.js";
import { effectiveModelProvider, resolveLlamaCppModelPath } from "../core/models/llamacpp-backend.js";
import { getRepoStatus } from "../core/repo/brain.js";
import { findPackageRoot } from "../core/utils/paths.js";
import type { CliIO, RunOptions } from "./run.js";
import type { MmcConfig } from "../core/config/defaults.js";
import type { Mission } from "../core/mission/ledger.js";
import type { RuntimeTask, TaskGraph } from "../core/spec/compiler.js";

export type TuiCommand =
  | { kind: "continue" }
  | { kind: "exit" }
  | { kind: "help" }
  | { kind: "message"; message: string }
  | { kind: "snapshot" }
  | { kind: "run"; argv: string[]; refreshAfter: boolean; echo?: boolean; display?: string; progress?: string };

export type TuiRunner = (argv: string[], options?: RunOptions) => Promise<number>;

const TUI_HELP = [
  "Commands:",
  "  type normally                    shape the app brief",
  "  /build status                    show dashboard",
  "  /build spec <goal-or-spec>        create/compile a build spec",
  "  /build compile [file]             compile latest spec or file",
  "  /build start [file]               start building from the compiled spec",
  "  /build next                       show next build task",
  "  /build step                       run one build task",
  "  /build run [max-tasks]            run the build loop",
  "  /build validate                   validate build artifacts",
  "  /chat status                      show current app brief",
  "  /chat reset                       reset current app brief",
  "  /run-task <task-id>               run one named task",
  "  /verify <task-id>                 run task verifier",
  "  /index                            refresh Repo Brain",
  "  /models                           show model picker",
  "  /models set <role> <model>        pin a model route",
  "  /models clear <role>              clear a pinned route",
  "  /models profile <profile>         switch hardware/profile route",
  "  /probe [role]                     probe a model route",
  "  /backend status [role]            show llama.cpp backend readiness",
  "  /attempts [task-id]               list attempts",
  "  /artifacts [attempt-id]           list artifacts",
  "  /patch apply <attempt-id>         apply an accepted patch",
  "  /raw <microcoder args>            run any microcoder command",
  "  /help",
  "  /exit",
].join("\n");

export async function runTui(cwd: string, args: string[], io: CliIO, runner: TuiRunner): Promise<number> {
  if (args[0] === "web") {
    return startWebTui(cwd, args.slice(1), io);
  }

  if (args.includes("--snapshot")) {
    io.stdout(buildTuiSnapshot(cwd));
    return 0;
  }

  const command = valueAfter(args, "--command");
  if (command) {
    return executeTuiLine(cwd, command, io, runner);
  }

  if (!input.isTTY) {
    const lines = fs.readFileSync(0, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      io.stdout(buildTuiSnapshot(cwd));
      return 0;
    }
    let code = 0;
    for (const line of lines) {
      code = await executeTuiLine(cwd, line, io, runner);
      if (parseTuiCommand(line).kind === "exit") break;
    }
    return code;
  }

  output.write(`${buildTuiSnapshot(cwd)}\n\n${TUI_HELP}\n\n`);
  const rl = createInterface({ input, output, prompt: "microcoder> " });
  rl.prompt();
  for await (const line of rl) {
    const text = line.trim();
    try {
      const commandResult = parseTuiCommand(text);
      if (commandResult.kind === "exit") break;
      await executeParsedTuiCommand(cwd, commandResult, io, runner);
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error));
    }
    rl.prompt();
  }
  rl.close();
  return 0;
}

export async function executeTuiLine(cwd: string, line: string, io: CliIO, runner: TuiRunner): Promise<number> {
  return executeParsedTuiCommand(cwd, parseTuiCommand(line), io, runner);
}

export async function executeParsedTuiCommand(cwd: string, command: TuiCommand, io: CliIO, runner: TuiRunner): Promise<number> {
  if (command.kind === "continue") return 0;
  if (command.kind === "exit") return 0;
  if (command.kind === "help") {
    io.stdout(TUI_HELP);
    return 0;
  }
  if (command.kind === "message") {
    io.stdout(command.message);
    return 0;
  }
  if (command.kind === "snapshot") {
    io.stdout(buildTuiSnapshot(cwd));
    return 0;
  }

  if (command.echo !== false) io.stdout(`$ microcoder ${command.display ?? command.argv.join(" ")}`);
  if (command.progress) io.stdout(command.progress);
  const code = await runner(command.argv, { cwd, io });
  if (command.progress) io.stdout(code === 0 ? "Build command finished." : `Build command stopped with exit code ${code}.`);
  if (command.refreshAfter) {
    io.stdout("");
    io.stdout(buildTuiSnapshot(cwd));
  }
  return code;
}

export function parseTuiCommand(line: string): TuiCommand {
  const text = line.trim();
  if (!text) return { kind: "continue" };
  if (!text.startsWith("/")) return parsePlainTextInput(text);
  if (text === "/exit" || text === "/quit") return { kind: "exit" };
  if (text === "/help" || text === "help") return { kind: "help" };
  if (text === "/refresh" || text === "/status" || text === "/build status" || text === "/mission status") return { kind: "snapshot" };

  const rawRest = commandRest(text, "/raw");
  if (rawRest !== null && rawRest) return { kind: "run", argv: splitArgs(rawRest), refreshAfter: false };
  if (text === "/init") return { kind: "run", argv: ["init"], refreshAfter: true };
  if (text === "/doctor") return { kind: "run", argv: ["doctor"], refreshAfter: false };
  const chatRest = commandRest(text, "/chat");
  if (chatRest !== null) return parseChatCommand(chatRest);
  if (text === "/index") return { kind: "run", argv: ["repo", "index"], refreshAfter: true };
  const modelsRest = commandRest(text, "/models");
  if (modelsRest !== null) return parseModelsCommand(modelsRest);
  const backendRest = commandRest(text, "/backend");
  if (backendRest !== null) return parseBackendCommand(backendRest);
  const probeRest = commandRest(text, "/probe");
  if (probeRest !== null) return { kind: "run", argv: ["models", "probe", ...splitArgs(probeRest)], refreshAfter: false };
  const runTaskRest = commandRest(text, "/run-task");
  if (runTaskRest !== null && runTaskRest) return { kind: "run", argv: ["run", "--task", ...splitArgs(runTaskRest)], refreshAfter: true };
  const verifyRest = commandRest(text, "/verify");
  if (verifyRest !== null && verifyRest) return { kind: "run", argv: ["verify", "--task", ...splitArgs(verifyRest)], refreshAfter: false };
  const attemptsRest = commandRest(text, "/attempts");
  if (attemptsRest !== null) return optionalFilterCommand("attempts", "list", "--task", attemptsRest);
  const artifactsRest = commandRest(text, "/artifacts");
  if (artifactsRest !== null) return optionalFilterCommand("artifacts", "list", "--attempt", artifactsRest);
  const patchRest = commandRest(text, "/patch");
  if (patchRest !== null) return parsePatchCommand(patchRest);

  const buildRest = commandRest(text, "/build");
  if (buildRest !== null) return parseBuildCommand(buildRest, "/build");
  const missionRest = commandRest(text, "/mission");
  if (missionRest !== null) return parseBuildCommand(missionRest, "/mission");
  throw new Error("Unknown TUI command. Use /help.");
}

function parsePlainTextInput(text: string): TuiCommand {
  if (/^(hi|hello|hey|yo|sup)\b[!. ]*$/i.test(text)) {
    return { kind: "message", message: "Hey. What do you want to build?" };
  }
  return { kind: "run", argv: ["chat", "--interactive", text], refreshAfter: false, echo: false };
}

function parsePatchCommand(rest: string): TuiCommand {
  const parts = splitArgs(rest);
  if (parts[0] === "apply" && parts[1]) {
    return { kind: "run", argv: ["patch", "apply", "--attempt", parts[1]], refreshAfter: true };
  }
  throw new Error("Usage: /patch apply <attempt-id>");
}

function parseModelsCommand(rest: string): TuiCommand {
  const parts = splitArgs(rest);
  if (parts.length === 0) return { kind: "run", argv: ["models", "status"], refreshAfter: false };
  if (parts[0] === "list" || parts[0] === "json") return { kind: "run", argv: ["models", "list"], refreshAfter: false };
  if (parts[0] === "status") return { kind: "run", argv: ["models", "status"], refreshAfter: false };
  if (parts[0] === "set" && parts[1] && parts[2]) {
    return { kind: "run", argv: ["models", "set", parts[1], parts[2]], refreshAfter: true };
  }
  if (parts[0] === "clear" && parts[1]) {
    return { kind: "run", argv: ["models", "clear", parts[1]], refreshAfter: true };
  }
  if (parts[0] === "profile" && parts[1]) {
    return { kind: "run", argv: ["models", "profile", parts[1]], refreshAfter: true };
  }
  throw new Error("Usage: /models [status|list|set <role> <model|disabled>|clear <role>|profile <profile>]");
}

function parseChatCommand(rest: string): TuiCommand {
  const parts = splitArgs(rest);
  if (parts.length === 0 || parts[0] === "status") return { kind: "run", argv: ["chat", "status"], refreshAfter: false };
  if (parts[0] === "reset") return { kind: "run", argv: ["chat", "reset"], refreshAfter: true };
  return { kind: "run", argv: ["chat", "--interactive", rest], refreshAfter: false, echo: false };
}

function parseBackendCommand(rest: string): TuiCommand {
  const parts = splitArgs(rest);
  if (parts.length === 0 || parts[0] === "status") return { kind: "run", argv: ["backend", "status", ...parts.slice(1)], refreshAfter: false };
  if (parts[0] === "start") return { kind: "run", argv: ["backend", "start", ...parts.slice(1)], refreshAfter: false };
  if (parts[0] === "stop") return { kind: "run", argv: ["backend", "stop"], refreshAfter: false };
  throw new Error("Usage: /backend [status [role]|start [role]|stop]");
}

export function buildTuiSnapshot(cwd: string): string {
  const loaded = loadConfig(cwd);
  const errors = loaded.errors;
  const lines = [
    "Microcoder Build Console",
    `Project: ${cwd}`,
  ];
  if (errors.length) {
    lines.push("Config: invalid", ...errors.map((error) => `  - ${error}`), "", "Run /init or /doctor first.");
    return lines.join("\n");
  }

  const config = loaded.config;
  const root = missionDir(cwd, config);
  lines.push(`Profile: ${config.hardware.profile}`, `State dir: ${path.relative(cwd, root) || root}`);

  const mission = readJsonFile<Mission>(path.join(root, "mission.json"));
  const state = readJsonFile<Record<string, unknown>>(path.join(root, "current_state.json"));
  const graph = readJsonFile<TaskGraph>(path.join(root, "task_graph.json"));
  const tasks = graph?.tasks ?? [];
  const next = tasks.find((task) => task.status === "ready") ?? tasks.find((task) => task.status === "todo") ?? null;
  const counts = countTasks(tasks);
  const repo = safeRepoStatus(cwd, config);
  const chat = loadSpecChatState(cwd, config);

  lines.push(
    "",
    "Build",
    `  id: ${mission?.mission_id ?? String(state?.active_mission_id ?? "none")}`,
    `  status: ${mission?.status ?? String(state?.status ?? "not_initialized")}`,
    `  goal: ${shorten(mission?.goal ?? "none", 100)}`,
    `  progress: ${counts.complete}/${tasks.length} complete, ${counts.ready} ready, ${counts.todo} todo, ${counts.blocked} blocked, ${counts.failed} failed`,
    `  next: ${next ? `${next.id} ${shorten(next.title, 90)}` : "none"}`,
    `  repo: ${repo.status}${repo.dirty_files.length ? ` dirty=${repo.dirty_files.length}` : ""}`,
    "",
    "Brief",
    `  status: ${chat.status}`,
    `  goal: ${shorten(chat.brief.goal ?? "none", 90)}`,
    `  next: ${chat.pending_questions[0]?.text ?? "none"}`,
    "",
    "Routes",
    ...routeLines(cwd, config).map((line) => `  ${line}`),
    "",
    "Latest Attempts",
    ...attemptLines(root).map((line) => `  ${line}`),
    "",
    "Fast Keys",
    "  type normally  /chat status  /build start  /index  /build step  /build run  /build validate  /models  /help",
  );
  return lines.join("\n");
}

function parseBuildCommand(commandLine: string, label: "/build" | "/mission"): TuiCommand {
  const [command, ...rest] = splitArgs(commandLine);
  if (!command || command === "status") return { kind: "snapshot" };
  if (command === "spec") return { kind: "run", argv: ["spec", "create", rest.join(" ")], refreshAfter: true };
  if (command === "compile") return { kind: "run", argv: ["spec", "compile", ...rest], refreshAfter: true };
  if (command === "start") return { kind: "run", argv: ["build", "start", ...rest], refreshAfter: true, progress: "Starting build from the compiled spec..." };
  if (command === "next") return { kind: "run", argv: ["task", "next"], refreshAfter: false };
  if (command === "step") {
    return {
      kind: "run",
      argv: ["build", "step"],
      refreshAfter: true,
      progress: "Building one task. Generating a patch, verifying it, then recording the result...",
    };
  }
  if (command === "run") {
    const argv = ["build", "run"];
    if (rest.length > 1) throw new Error(`Invalid ${label} run usage. Use ${label} run [positive-max-tasks].`);
    if (rest[0]) {
      if (!/^[1-9]\d*$/.test(rest[0])) throw new Error(`Invalid ${label} run max-tasks. Use a positive integer.`);
      argv.push(rest[0]);
    }
    return {
      kind: "run",
      argv,
      refreshAfter: true,
      progress: "Build running. Each task will show its attempt, verification, and confidence before the dashboard refreshes...",
    };
  }
  if (command === "validate") return { kind: "run", argv: ["eval", "validate"], refreshAfter: false };
  if (command === "models") return { kind: "run", argv: ["models", "status"], refreshAfter: false };
  throw new Error(`Unknown ${label} command: ${command}`);
}

function optionalFilterCommand(command: string, subcommand: string, flag: string, rawRest: string): TuiCommand {
  const rest = splitArgs(rawRest);
  return { kind: "run", argv: [command, subcommand, ...(rest[0] ? [flag, rest[0]] : [])], refreshAfter: false };
}

function routeLines(cwd: string, config: MmcConfig): string[] {
  const registry = loadModelRegistry(cwd, config);
  if (registry.models.length === 0) return ["no model registry"];
  return MODEL_ROLES.map((role) => {
    const routed = routeModel(registry, role, config.hardware.profile, config.models.role_overrides);
    const provider = routed ? effectiveModelProvider(config, routed) : null;
    const modelPath = provider === "llamacpp" ? ` gguf=${resolveLlamaCppModelPath(cwd, config, role, routed ?? undefined) ?? "missing"}` : "";
    const source = config.models.role_overrides?.[role] ? " override" : "";
    return `${role}: ${routed?.id ?? "disabled"} provider=${provider ?? "disabled"}${modelPath}${source}`;
  });
}

function attemptLines(root: string): string[] {
  const file = path.join(root, "attempts.jsonl");
  if (!fs.existsSync(file)) return ["none"];
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-5).reverse();
  if (rows.length === 0) return ["none"];
  return rows.map((line) => {
    try {
      const row = JSON.parse(line) as { attempt_id?: string; task_id?: string; status?: string; model_id?: string; confidence_score?: number };
      return `${row.attempt_id ?? "unknown"} ${row.task_id ?? "?"} ${row.status ?? "?"} model=${row.model_id ?? "?"} confidence=${row.confidence_score ?? "n/a"}`;
    } catch {
      return shorten(line, 120);
    }
  });
}

function safeRepoStatus(cwd: string, config: MmcConfig): { status: string; dirty_files: string[] } {
  try {
    return getRepoStatus(cwd, config);
  } catch {
    return { status: "unknown", dirty_files: [] };
  }
}

function countTasks(tasks: RuntimeTask[]): Record<RuntimeTask["status"], number> {
  return tasks.reduce<Record<RuntimeTask["status"], number>>(
    (counts, task) => {
      counts[task.status] += 1;
      return counts;
    },
    { todo: 0, ready: 0, running: 0, blocked: 0, complete: 0, failed: 0 },
  );
}

function readJsonFile<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function splitArgs(inputText: string): string[] {
  const matches = inputText.match(/"([^"]*)"|'([^']*)'|\S+/g) ?? [];
  return matches.map((value) => {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  });
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function commandRest(text: string, command: string): string | null {
  if (text === command) return "";
  return text.startsWith(`${command} `) ? text.slice(command.length + 1) : null;
}

async function startWebTui(cwd: string, args: string[], io: CliIO): Promise<number> {
  const packageRoot = findPackageRoot();
  const script = path.join(packageRoot, "tools", "mmc-pty-web-console.py");
  if (!fs.existsSync(script)) {
    throw Object.assign(new Error(`web TUI helper not found: ${script}`), { code: "VALIDATION" });
  }
  const port = valueAfter(args, "--port") ?? "4180";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw Object.assign(new Error(`invalid web TUI port: ${port}`), { code: "VALIDATION" });
  }
  const builtCli = path.join(packageRoot, "dist", "src", "cli", "mmc.js");
  const tuiArgv = fs.existsSync(builtCli)
    ? [process.execPath, builtCli, "tui"]
    : ["npm", "run", "-s", "mmc", "--", "tui"];

  const child = spawn("python3", [script], {
    cwd,
    env: {
      ...process.env,
      MMC_WEB_TUI_CWD: cwd,
      MMC_WEB_TUI_PORT: port,
      MMC_WEB_TUI_ARGV: JSON.stringify(tuiArgv),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => io.stdout(chunk.toString("utf8").trimEnd()));
  child.stderr.on("data", (chunk) => io.stderr(chunk.toString("utf8").trimEnd()));
  return new Promise((resolve) => {
    child.on("error", (error) => {
      io.stderr(error.message);
      resolve(1);
    });
    child.on("exit", (code, signal) => resolve(signal ? 1 : code ?? 0));
  });
}

function shorten(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}
