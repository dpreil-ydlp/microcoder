import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import type { MmcConfig } from "../config/defaults.js";
import { missionDir } from "../storage/sqlite.js";
import { ensureDir, resolveFromCwd } from "../utils/paths.js";
import type { ModelProfile } from "./orchestrator.js";
import {
  cleanupUnownedPid,
  isOwnedPidRecord,
  isProcessAlive,
  readOwnedPidRecord,
  readPidRecord,
  removeFileIfExists,
  waitForProcessExit,
  writePidRecord,
} from "./llamacpp-process.js";

export const LLAMACPP_STATUS = [
  "READY",
  "NO_MODEL_BACKEND",
  "MISSING_BINARY",
  "MISSING_MODEL",
  "SERVER_START_FAILED",
  "MODEL_PROBE_FAILED",
] as const;

export type LlamaCppStatus = (typeof LLAMACPP_STATUS)[number];

export type LlamaCppBackendReport = {
  provider: "llamacpp";
  status: LlamaCppStatus;
  message: string;
  base_url: string;
  host: string;
  port: number;
  model_path: string | null;
  binary_path: string | null;
  pid_file: string;
  log_file: string;
  auto_start: boolean;
  auto_stop_after_request: boolean;
  managed_pid: number | null;
};

export type LlamaCppServerLease = LlamaCppBackendReport & {
  started_by_microcoder: boolean;
};

export function effectiveModelProvider(config: MmcConfig, model: ModelProfile): string {
  if (model.provider === "llamacpp") return "llamacpp";
  if (config.models.provider_default === "llamacpp") return "llamacpp";
  return model.provider || config.models.provider_default;
}

export function llamaCppBaseUrl(config: MmcConfig): string {
  return `http://${config.models.llamacpp.host}:${config.models.llamacpp.port}/v1`;
}

export function resolveLlamaCppModelPath(cwd: string, config: MmcConfig, role: string, model?: ModelProfile): string | null {
  const configured =
    config.models.llamacpp.model_paths[role] ??
    (model ? config.models.llamacpp.model_paths[model.id] : undefined) ??
    config.models.llamacpp.model_paths.default;
  return configured ? resolveFromCwd(cwd, configured) : null;
}

export function resolveLlamaCppBinaryPath(cwd: string, config: MmcConfig): string | null {
  const configured = config.models.llamacpp.llama_server_path;
  return configured ? resolveFromCwd(cwd, configured) : null;
}

export function llamaCppPidFile(cwd: string, config: MmcConfig): string {
  return config.models.llamacpp.pid_file
    ? resolveFromCwd(cwd, config.models.llamacpp.pid_file)
    : path.join(missionDir(cwd, config), "backend", "llamacpp.pid");
}

export function llamaCppLogFile(cwd: string, config: MmcConfig): string {
  return config.models.llamacpp.log_file
    ? resolveFromCwd(cwd, config.models.llamacpp.log_file)
    : path.join(missionDir(cwd, config), "backend", "llamacpp.log");
}

export async function inspectLlamaCppBackend(args: {
  cwd: string;
  config: MmcConfig;
  role: string;
  model: ModelProfile | null;
}): Promise<LlamaCppBackendReport> {
  const base = baseReport(args.cwd, args.config, args.role, args.model);
  if (!args.model || effectiveModelProvider(args.config, args.model) !== "llamacpp") {
    return {
      ...base,
      status: "NO_MODEL_BACKEND",
      message: `role ${args.role} is not routed to llama.cpp`,
    };
  }
  const modelError = missingModelMessage(base.model_path, args.role, args.model);
  if (modelError) {
    return { ...base, status: "MISSING_MODEL", message: modelError };
  }
  cleanupUnownedPid(base.pid_file, {
    host: args.config.models.llamacpp.host,
    port: args.config.models.llamacpp.port,
    model_path: base.model_path,
    binary_path: base.binary_path,
  });
  const pid = readOwnedPidRecord(base.pid_file, {
    host: args.config.models.llamacpp.host,
    port: args.config.models.llamacpp.port,
    model_path: base.model_path,
    binary_path: base.binary_path,
  })?.pid ?? null;
  const healthy = await isLlamaCppHealthy(args.config);
  if (healthy) {
    return { ...base, status: "READY", message: "llama.cpp server is healthy", managed_pid: pid };
  }
  if (args.config.models.llamacpp.auto_start) {
    const binaryError = missingBinaryMessage(base.binary_path);
    if (binaryError) return { ...base, status: "MISSING_BINARY", message: binaryError, managed_pid: pid };
  }
  return {
    ...base,
    status: "SERVER_START_FAILED",
    message: args.config.models.llamacpp.auto_start
      ? "llama.cpp server is not healthy; auto-start is enabled but has not run in doctor mode"
      : "llama.cpp server is not healthy; set auto_start true or run microcoder backend start",
    managed_pid: pid,
  };
}

export async function ensureLlamaCppServer(args: {
  cwd: string;
  config: MmcConfig;
  role: string;
  model: ModelProfile;
}): Promise<LlamaCppServerLease> {
  const report = await inspectLlamaCppBackend(args);
  if (report.status === "READY") return { ...report, started_by_microcoder: false };
  if (report.status !== "SERVER_START_FAILED") throw backendError(report.status, report.message);
  if (!args.config.models.llamacpp.auto_start) {
    throw backendError(
      "SERVER_START_FAILED",
      `${report.message}; configured endpoint ${report.base_url.replace(/\/v1$/, "")}`,
    );
  }
  return startLlamaCppServer(args);
}

export async function startLlamaCppServer(args: {
  cwd: string;
  config: MmcConfig;
  role: string;
  model: ModelProfile;
}): Promise<LlamaCppServerLease> {
  const report = baseReport(args.cwd, args.config, args.role, args.model);
  const modelError = missingModelMessage(report.model_path, args.role, args.model);
  if (modelError) throw backendError("MISSING_MODEL", modelError);
  const binaryError = missingBinaryMessage(report.binary_path);
  if (binaryError) throw backendError("MISSING_BINARY", binaryError);
  cleanupUnownedPid(report.pid_file, {
    host: args.config.models.llamacpp.host,
    port: args.config.models.llamacpp.port,
    model_path: report.model_path,
    binary_path: report.binary_path,
  });

  const pidRecord = readOwnedPidRecord(report.pid_file, {
    host: args.config.models.llamacpp.host,
    port: args.config.models.llamacpp.port,
    model_path: report.model_path,
    binary_path: report.binary_path,
  });
  if (pidRecord?.pid && isProcessAlive(pidRecord.pid) && !(await isLlamaCppHealthy(args.config))) {
    throw backendError(
      "SERVER_START_FAILED",
      `managed llama.cpp pid ${pidRecord.pid} is running but health checks fail; inspect ${report.log_file} or run microcoder backend stop`,
    );
  }

  if (await isLlamaCppHealthy(args.config)) {
    return { ...report, status: "READY", message: "llama.cpp server is already healthy", managed_pid: pidRecord?.pid ?? null, started_by_microcoder: false };
  }
  if (await isPortOpen(args.config.models.llamacpp.host, args.config.models.llamacpp.port)) {
    throw backendError(
      "SERVER_START_FAILED",
      `port ${args.config.models.llamacpp.host}:${args.config.models.llamacpp.port} is already in use but is not a healthy llama.cpp server`,
    );
  }

  ensureDir(path.dirname(report.pid_file));
  ensureDir(path.dirname(report.log_file));
  const logFd = fs.openSync(report.log_file, "a");
  const child = spawn(report.binary_path!, buildLlamaServerArgs(args.config, report.model_path!), {
    cwd: args.cwd,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  fs.closeSync(logFd);
  child.unref();
  if (!child.pid) {
    throw backendError("SERVER_START_FAILED", `failed to spawn llama-server; inspect ${report.log_file}`);
  }
  writePidRecord(report.pid_file, {
    pid: child.pid,
    host: args.config.models.llamacpp.host,
    port: args.config.models.llamacpp.port,
    model_path: report.model_path!,
    binary_path: report.binary_path!,
    started_at: new Date().toISOString(),
  });

  const healthy = await waitForLlamaCppHealth(args.config, args.config.models.llamacpp.startup_timeout_seconds * 1000);
  if (!healthy) {
    await stopLlamaCppServer(args.cwd, args.config);
    throw backendError(
      "SERVER_START_FAILED",
      `llama-server pid ${child.pid} did not become healthy within ${args.config.models.llamacpp.startup_timeout_seconds}s; inspect ${report.log_file}${tailLog(report.log_file)}`,
    );
  }
  return {
    ...report,
    status: "READY",
    message: "llama.cpp server started and passed health checks",
    managed_pid: child.pid,
    started_by_microcoder: true,
  };
}

export async function stopLlamaCppServer(cwd: string, config: MmcConfig): Promise<{ stopped: boolean; pid: number | null; message: string }> {
  const pidFile = llamaCppPidFile(cwd, config);
  const record = readPidRecord(pidFile);
  if (!record?.pid) {
    removeFileIfExists(pidFile);
    return { stopped: false, pid: null, message: "no managed llama.cpp pid file" };
  }
  if (!isProcessAlive(record.pid)) {
    removeFileIfExists(pidFile);
    return { stopped: false, pid: record.pid, message: "stale llama.cpp pid file removed" };
  }
  const expected = {
    host: config.models.llamacpp.host,
    port: config.models.llamacpp.port,
    binary_path: resolveLlamaCppBinaryPath(cwd, config),
  };
  if (!isOwnedPidRecord(record, expected)) {
    removeFileIfExists(pidFile);
    return {
      stopped: false,
      pid: record.pid,
      message: "llama.cpp pid ownership could not be verified; pid file removed without signaling",
    };
  }
  try {
    process.kill(record.pid, "SIGTERM");
  } catch {
    removeFileIfExists(pidFile);
    return { stopped: false, pid: record.pid, message: "managed llama.cpp process was already gone" };
  }
  const exited = await waitForProcessExit(record.pid, 3000);
  if (!exited && isProcessAlive(record.pid)) {
    try {
      process.kill(record.pid, "SIGKILL");
    } catch {
      // Process exited between checks.
    }
  }
  removeFileIfExists(pidFile);
  return { stopped: true, pid: record.pid, message: "managed llama.cpp server stopped" };
}

export function backendError(status: LlamaCppStatus, message: string): Error {
  return Object.assign(new Error(`${status}: ${message}`), {
    code: "MODEL_PROVIDER_FAILED",
    backend_status: status,
  });
}

function baseReport(cwd: string, config: MmcConfig, role: string, model: ModelProfile | null): LlamaCppBackendReport {
  const pidFile = llamaCppPidFile(cwd, config);
  const modelPath = resolveLlamaCppModelPath(cwd, config, role, model ?? undefined);
  const binaryPath = resolveLlamaCppBinaryPath(cwd, config);
  const record = readOwnedPidRecord(pidFile, {
    host: config.models.llamacpp.host,
    port: config.models.llamacpp.port,
    model_path: modelPath,
    binary_path: binaryPath,
  });
  return {
    provider: "llamacpp",
    status: "NO_MODEL_BACKEND",
    message: "",
    base_url: llamaCppBaseUrl(config),
    host: config.models.llamacpp.host,
    port: config.models.llamacpp.port,
    model_path: modelPath,
    binary_path: binaryPath,
    pid_file: pidFile,
    log_file: llamaCppLogFile(cwd, config),
    auto_start: config.models.llamacpp.auto_start,
    auto_stop_after_request: config.models.llamacpp.auto_stop_after_request,
    managed_pid: record?.pid ?? null,
  };
}

function buildLlamaServerArgs(config: MmcConfig, modelPath: string): string[] {
  const args = [
    "--model",
    modelPath,
    "--host",
    config.models.llamacpp.host,
    "--port",
    String(config.models.llamacpp.port),
    "--ctx-size",
    String(config.models.llamacpp.context_size),
    "--n-gpu-layers",
    String(config.models.llamacpp.gpu_layers),
  ];
  if (config.models.llamacpp.threads > 0) args.push("--threads", String(config.models.llamacpp.threads));
  return args;
}

function missingModelMessage(modelPath: string | null, role: string, model: ModelProfile | null): string | null {
  if (!modelPath) {
    return `no GGUF model path configured for role ${role}; set models.llamacpp.model_paths.${role} or ${model ? `models.llamacpp.model_paths["${model.id}"]` : "a role model path"}`;
  }
  if (!fs.existsSync(modelPath)) return `GGUF model path does not exist: ${modelPath}`;
  return null;
}

function missingBinaryMessage(binaryPath: string | null): string | null {
  if (!binaryPath) return "models.llamacpp.llama_server_path is not configured";
  if (!fs.existsSync(binaryPath)) return `llama-server binary does not exist: ${binaryPath}`;
  try {
    fs.accessSync(binaryPath, fs.constants.X_OK);
  } catch {
    return `llama-server binary is not executable: ${binaryPath}`;
  }
  return null;
}

async function isLlamaCppHealthy(config: MmcConfig): Promise<boolean> {
  const root = `http://${config.models.llamacpp.host}:${config.models.llamacpp.port}`;
  return (await endpointOk(`${root}/health`)) || (await endpointOk(`${root}/v1/models`));
}

async function endpointOk(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForLlamaCppHealth(config: MmcConfig, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLlamaCppHealthy(config)) return true;
    await delay(200);
  }
  return false;
}

async function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function tailLog(file: string): string {
  if (!fs.existsSync(file)) return "";
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return "";
  return `; last log: ${text.split(/\r?\n/).slice(-5).join(" | ").slice(0, 500)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
