import { writeDefaultConfigIfMissing, loadConfig, saveConfig } from "../core/config/config.js";
import {
  effectiveModelProvider,
  inspectLlamaCppBackend,
  llamaCppLogFile,
  llamaCppPidFile,
  resolveLlamaCppModelPath,
  startLlamaCppServer,
  stopLlamaCppServer,
} from "../core/models/llamacpp-backend.js";
import { loadModelRegistry, MODEL_ROLES, probeModelProvider, routeModel } from "../core/models/orchestrator.js";
import { ensureMissionStructure, initializeDatabase } from "../core/storage/sqlite.js";
import type { CliIO } from "./run.js";
import { parseOptionalBoolean, parseOptionalInteger, validateFlagArgs, valueAfter, valuesAfter } from "./args.js";

type LoadedConfig = ReturnType<typeof loadConfig>;

export function runSetupBackendLlamacppCommand(cwd: string, io: CliIO, args: string[], loadValidConfig: (cwd: string) => LoadedConfig): number {
  const flagError = validateFlagArgs(args, {
    valueFlags: [
      "--server",
      "--model",
      "--host",
      "--port",
      "--ctx",
      "--context-size",
      "--gpu-layers",
      "--threads",
      "--timeout",
      "--startup-timeout",
      "--auto-start",
      "--auto-stop",
      "--fallback",
      "--provider-default",
    ],
    bareFlags: ["--select"],
  });
  if (flagError) return writeError(io, flagError);
  writeDefaultConfigIfMissing(cwd);
  const loaded = loadValidConfig(cwd);
  const serverPath = valueAfter(args, "--server");
  if (serverPath) loaded.config.models.llamacpp.llama_server_path = serverPath;
  for (const assignment of valuesAfter(args, "--model")) {
    const [key, ...pathParts] = assignment.split("=");
    const modelPath = pathParts.join("=");
    if (!key || !modelPath) {
      io.stderr("--model must use role_or_model_id=/path/to/model.gguf");
      return 1;
    }
    loaded.config.models.llamacpp.model_paths[key] = modelPath;
  }
  const host = valueAfter(args, "--host");
  if (host) loaded.config.models.llamacpp.host = host;
  const port = parseOptionalInteger(valueAfter(args, "--port"), "--port");
  if (typeof port === "string") return writeError(io, port);
  if (port !== undefined) loaded.config.models.llamacpp.port = port;
  const contextSize = parseOptionalInteger(valueAfter(args, "--ctx") ?? valueAfter(args, "--context-size"), "--ctx");
  if (typeof contextSize === "string") return writeError(io, contextSize);
  if (contextSize !== undefined) loaded.config.models.llamacpp.context_size = contextSize;
  const gpuLayers = parseOptionalInteger(valueAfter(args, "--gpu-layers"), "--gpu-layers", 0);
  if (typeof gpuLayers === "string") return writeError(io, gpuLayers);
  if (gpuLayers !== undefined) loaded.config.models.llamacpp.gpu_layers = gpuLayers;
  const threads = parseOptionalInteger(valueAfter(args, "--threads"), "--threads", 0);
  if (typeof threads === "string") return writeError(io, threads);
  if (threads !== undefined) loaded.config.models.llamacpp.threads = threads;
  const timeout = parseOptionalInteger(valueAfter(args, "--timeout"), "--timeout");
  if (typeof timeout === "string") return writeError(io, timeout);
  if (timeout !== undefined) loaded.config.models.llamacpp.timeout_seconds = timeout;
  const startupTimeout = parseOptionalInteger(valueAfter(args, "--startup-timeout"), "--startup-timeout");
  if (typeof startupTimeout === "string") return writeError(io, startupTimeout);
  if (startupTimeout !== undefined) loaded.config.models.llamacpp.startup_timeout_seconds = startupTimeout;
  const autoStart = parseOptionalBoolean(valueAfter(args, "--auto-start"), "--auto-start");
  if (typeof autoStart === "string") return writeError(io, autoStart);
  if (autoStart !== undefined) loaded.config.models.llamacpp.auto_start = autoStart;
  const autoStop = parseOptionalBoolean(valueAfter(args, "--auto-stop"), "--auto-stop");
  if (typeof autoStop === "string") return writeError(io, autoStop);
  if (autoStop !== undefined) loaded.config.models.llamacpp.auto_stop_after_request = autoStop;
  const fallback = parseOptionalBoolean(valueAfter(args, "--fallback"), "--fallback");
  if (typeof fallback === "string") return writeError(io, fallback);
  if (fallback !== undefined) loaded.config.models.allow_provider_fallback = fallback;
  const providerDefault = valueAfter(args, "--provider-default");
  if (providerDefault && !["ollama", "llamacpp"].includes(providerDefault)) {
    io.stderr("--provider-default must be ollama or llamacpp");
    return 1;
  }
  if (providerDefault) loaded.config.models.provider_default = providerDefault;
  if (args.includes("--select")) loaded.config.models.provider_default = "llamacpp";

  saveConfig(cwd, loaded.config);
  io.stdout("backend llamacpp configured");
  io.stdout(`provider_default ${loaded.config.models.provider_default}`);
  io.stdout(`llama_server_path ${loaded.config.models.llamacpp.llama_server_path ?? "none"}`);
  io.stdout(`host ${loaded.config.models.llamacpp.host}`);
  io.stdout(`port ${loaded.config.models.llamacpp.port}`);
  io.stdout(`context_size ${loaded.config.models.llamacpp.context_size}`);
  io.stdout(`gpu_layers ${loaded.config.models.llamacpp.gpu_layers}`);
  io.stdout(`threads ${loaded.config.models.llamacpp.threads}`);
  io.stdout(`timeout_seconds ${loaded.config.models.llamacpp.timeout_seconds}`);
  io.stdout(`startup_timeout_seconds ${loaded.config.models.llamacpp.startup_timeout_seconds}`);
  io.stdout(`auto_start ${loaded.config.models.llamacpp.auto_start}`);
  io.stdout(`auto_stop_after_request ${loaded.config.models.llamacpp.auto_stop_after_request}`);
  io.stdout(`allow_provider_fallback ${loaded.config.models.allow_provider_fallback}`);
  io.stdout(`model_paths ${JSON.stringify(loaded.config.models.llamacpp.model_paths)}`);
  if (loaded.config.models.provider_default !== "llamacpp") io.stdout("select_hint microcoder setup backend llamacpp --select");
  return 0;
}

export function runModelsListCommand(cwd: string, io: CliIO, loaded: LoadedConfig): number {
  const registry = loadModelRegistry(cwd, loaded.config);
  const routed = MODEL_ROLES.map((role) => {
    const model = routeModel(registry, role, loaded.config.hardware.profile, loaded.config.models.role_overrides);
    const provider = model ? effectiveModelProvider(loaded.config, model) : null;
    return {
      role,
      model: model?.id ?? null,
      registry_provider: model?.provider ?? null,
      backend: provider,
      provider,
      model_path: provider === "llamacpp" ? resolveLlamaCppModelPath(cwd, loaded.config, role, model ?? undefined) : null,
      route_source: loaded.config.models.role_overrides?.[role] ? "override" : registry.role_policy?.[loaded.config.hardware.profile]?.[role] ? "profile" : "fallback",
    };
  });
  io.stdout(JSON.stringify({
    profile: loaded.config.hardware.profile,
    provider_default: loaded.config.models.provider_default,
    allow_provider_fallback: loaded.config.models.allow_provider_fallback,
    llamacpp: {
      host: loaded.config.models.llamacpp.host,
      port: loaded.config.models.llamacpp.port,
      llama_server_path: loaded.config.models.llamacpp.llama_server_path ?? null,
      auto_start: loaded.config.models.llamacpp.auto_start,
      auto_stop_after_request: loaded.config.models.llamacpp.auto_stop_after_request,
      pid_file: llamaCppPidFile(cwd, loaded.config),
      log_file: llamaCppLogFile(cwd, loaded.config),
    },
    overrides: loaded.config.models.role_overrides ?? {},
    models: registry.models,
    routed,
  }, null, 2));
  return 0;
}

export function runModelsStatusCommand(cwd: string, io: CliIO, loaded: LoadedConfig): number {
  const registry = loadModelRegistry(cwd, loaded.config);
  const overrides = loaded.config.models.role_overrides ?? {};
  io.stdout(`profile ${loaded.config.hardware.profile}`);
  io.stdout(`registry_models ${registry.models.length}`);
  io.stdout("");
  for (const role of MODEL_ROLES) {
    const routed = routeModel(registry, role, loaded.config.hardware.profile, overrides);
    const provider = routed ? effectiveModelProvider(loaded.config, routed) : "disabled";
    const routeSource = overrides[role] ? "override" : registry.role_policy?.[loaded.config.hardware.profile]?.[role] ? "profile" : "fallback";
    const candidates = registry.models.filter((model) => model.role === role);
    io.stdout(`${role}`);
    io.stdout(`  active ${routed?.id ?? "disabled"} (${routeSource}) backend=${provider}`);
    if (provider === "llamacpp") {
      io.stdout(`  gguf ${resolveLlamaCppModelPath(cwd, loaded.config, role, routed ?? undefined) ?? "missing"}`);
    }
    if (candidates.length === 0) {
      io.stdout("  choices none");
      continue;
    }
    for (const model of candidates) {
      const selected = routed?.id === model.id ? "*" : " ";
      io.stdout(`  ${selected} ${model.id} provider=${model.provider} state=${model.state_policy} min_ram=${model.hardware_min_ram_gb ?? "n/a"}GB ctx=${model.context_limit ?? "n/a"}`);
    }
  }
  io.stdout("");
  io.stdout("commands:");
  io.stdout("  microcoder models set <role> <model|disabled>");
  io.stdout("  microcoder models clear <role>");
  io.stdout("  microcoder models profile <constrained_16gb|middle_32gb|strong_middle_48gb|strong_local_64gb>");
  return 0;
}

export function runModelsSetCommand(cwd: string, io: CliIO, role: string | undefined, modelId: string | undefined, loadValidConfig: (cwd: string) => LoadedConfig): number {
  if (!role || !MODEL_ROLES.includes(role as (typeof MODEL_ROLES)[number])) {
    io.stderr(`role must be one of ${MODEL_ROLES.join(", ")}`);
    return 1;
  }
  if (!modelId) {
    io.stderr("models set requires <role> <model|disabled>");
    return 1;
  }
  writeDefaultConfigIfMissing(cwd);
  const loaded = loadValidConfig(cwd);
  const registry = loadModelRegistry(cwd, loaded.config);
  if (modelId !== "disabled" && !registry.models.some((model) => model.role === role && model.id === modelId)) {
    const choices = registry.models.filter((model) => model.role === role).map((model) => model.id);
    io.stderr(`model must be one of ${choices.join(", ") || "none"} or disabled`);
    return 1;
  }
  loaded.config.models.role_overrides = { ...(loaded.config.models.role_overrides ?? {}), [role]: modelId };
  saveConfig(cwd, loaded.config);
  io.stdout(`model_route ${role} ${modelId}`);
  return 0;
}

export function runModelsClearCommand(cwd: string, io: CliIO, role: string | undefined, loadValidConfig: (cwd: string) => LoadedConfig): number {
  if (!role || !MODEL_ROLES.includes(role as (typeof MODEL_ROLES)[number])) {
    io.stderr(`role must be one of ${MODEL_ROLES.join(", ")}`);
    return 1;
  }
  writeDefaultConfigIfMissing(cwd);
  const loaded = loadValidConfig(cwd);
  const overrides = { ...(loaded.config.models.role_overrides ?? {}) };
  delete overrides[role];
  loaded.config.models.role_overrides = overrides;
  saveConfig(cwd, loaded.config);
  io.stdout(`model_route_cleared ${role}`);
  return 0;
}

export async function runModelsProbeCommand(cwd: string, io: CliIO, role: string, loaded: LoadedConfig): Promise<number> {
  ensureMissionStructure(cwd, loaded.config);
  initializeDatabase(cwd, loaded.config);
  const result = await probeModelProvider({ cwd, config: loaded.config, role });
  if (!result.text.trim()) {
    io.stderr(`model probe returned empty response for ${result.provider}:${result.model_id}`);
    return 7;
  }
  io.stdout(`provider ${result.provider}`);
  io.stdout(`model_id ${result.model_id}`);
  io.stdout(`latency_ms ${result.latency_ms}`);
  io.stdout(`response ${result.text.trim().slice(0, 200)}`);
  return 0;
}

export async function runBackendStatusCommand(cwd: string, io: CliIO, role: string, loaded: LoadedConfig): Promise<number> {
  const registry = loadModelRegistry(cwd, loaded.config);
  const model = routeModel(registry, role, loaded.config.hardware.profile, loaded.config.models.role_overrides);
  const report = await inspectLlamaCppBackend({ cwd, config: loaded.config, role, model });
  io.stdout(`provider ${report.provider}`);
  io.stdout(`role ${role}`);
  io.stdout(`model_id ${model?.id ?? "none"}`);
  io.stdout(`status ${report.status}`);
  io.stdout(`message ${report.message}`);
  io.stdout(`base_url ${report.base_url}`);
  io.stdout(`model_path ${report.model_path ?? "none"}`);
  io.stdout(`binary_path ${report.binary_path ?? "none"}`);
  io.stdout(`pid_file ${report.pid_file}`);
  io.stdout(`log_file ${report.log_file}`);
  io.stdout(`managed_pid ${report.managed_pid ?? "none"}`);
  return report.status === "READY" || report.status === "NO_MODEL_BACKEND" ? 0 : 7;
}

export async function runBackendStartCommand(cwd: string, io: CliIO, role: string, loaded: LoadedConfig): Promise<number> {
  ensureMissionStructure(cwd, loaded.config);
  const registry = loadModelRegistry(cwd, loaded.config);
  const model = routeModel(registry, role, loaded.config.hardware.profile, loaded.config.models.role_overrides);
  if (!model || effectiveModelProvider(loaded.config, model) !== "llamacpp") {
    io.stderr(`role ${role} is not routed to llama.cpp`);
    return 7;
  }
  const lease = await startLlamaCppServer({ cwd, config: loaded.config, role, model });
  io.stdout(`status ${lease.status}`);
  io.stdout(`message ${lease.message}`);
  io.stdout(`pid ${lease.managed_pid ?? "none"}`);
  io.stdout(`base_url ${lease.base_url}`);
  io.stdout(`model_path ${lease.model_path}`);
  io.stdout(`log_file ${lease.log_file}`);
  return 0;
}

export async function runBackendStopCommand(cwd: string, io: CliIO, loaded: LoadedConfig): Promise<number> {
  const result = await stopLlamaCppServer(cwd, loaded.config);
  io.stdout(`stopped ${result.stopped}`);
  io.stdout(`pid ${result.pid ?? "none"}`);
  io.stdout(`message ${result.message}`);
  return 0;
}

function writeError(io: CliIO, message: string): number {
  io.stderr(message);
  return 1;
}
