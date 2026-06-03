import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { DEFAULT_CONFIG, renderConfig, renderDefaultConfig, type MmcConfig } from "./defaults.js";
import { isHardwareProfileName } from "../hardware/profile.js";

export const CONFIG_FILE = ".micro-mission-coder.yaml";

export type LoadedConfig = {
  config: MmcConfig;
  path: string;
  source: "default" | "file";
  errors: string[];
};

export function configPath(cwd: string): string {
  return path.join(cwd, CONFIG_FILE);
}

export function writeDefaultConfigIfMissing(cwd: string): { path: string; created: boolean } {
  const target = configPath(cwd);
  if (fs.existsSync(target)) return { path: target, created: false };
  fs.writeFileSync(target, renderDefaultConfig(), "utf8");
  return { path: target, created: true };
}

export function loadConfig(cwd: string): LoadedConfig {
  const target = configPath(cwd);
  if (!fs.existsSync(target)) {
    return { config: structuredClone(DEFAULT_CONFIG), path: target, source: "default", errors: [] };
  }

  let parsed: unknown;
  try {
    parsed = parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    return {
      config: structuredClone(DEFAULT_CONFIG),
      path: target,
      source: "file",
      errors: [`config YAML parse failed: ${(error as Error).message}`],
    };
  }

  const merged = deepMerge(structuredClone(DEFAULT_CONFIG), parsed);
  const errors = validateConfig(merged);
  return { config: merged as MmcConfig, path: target, source: "file", errors };
}

export function saveConfig(cwd: string, config: MmcConfig): void {
  fs.writeFileSync(configPath(cwd), renderConfig(config), "utf8");
}

export function validateConfig(config: unknown): string[] {
  if (!isPlainObject(config)) return ["config must be an object"];
  const errors: string[] = [];
  const c = config as Partial<MmcConfig>;

  if (!c.project?.mission_dir) errors.push("project.mission_dir is required");
  if (!c.project?.database_path) errors.push("project.database_path is required");
  if (!c.hardware?.profile || !isHardwareProfileName(c.hardware.profile)) {
    errors.push("hardware.profile must be one of constrained_16gb, middle_32gb, strong_middle_48gb, strong_local_64gb");
  }
  if ((c.hardware?.max_parallel_model_calls ?? 0) < 1) {
    errors.push("hardware.max_parallel_model_calls must be at least 1");
  }
  if ((c.hardware?.context_budget_tokens ?? 0) < 1024) {
    errors.push("hardware.context_budget_tokens must be at least 1024");
  }
  const webResearch = c.web_research;
  if (!isPlainObject(webResearch)) {
    errors.push("web_research must be an object");
  } else {
    if (typeof webResearch.enabled !== "boolean") errors.push("web_research.enabled must be a boolean");
    if (typeof webResearch.auto_include_in_docs !== "boolean") errors.push("web_research.auto_include_in_docs must be a boolean");
    if (typeof webResearch.auto_include_in_chat !== "boolean") errors.push("web_research.auto_include_in_chat must be a boolean");
    if (!["duckduckgo_html", "custom_json"].includes(webResearch.provider as string)) {
      errors.push("web_research.provider must be duckduckgo_html or custom_json");
    }
    if (!isHttpUrl(webResearch.search_url)) errors.push("web_research.search_url must be an http(s) URL");
    if (!isPositiveInteger(webResearch.timeout_seconds)) errors.push("web_research.timeout_seconds must be a positive integer");
    if (!isPositiveInteger(webResearch.max_results)) errors.push("web_research.max_results must be a positive integer");
    if (!isPositiveInteger(webResearch.max_result_chars)) errors.push("web_research.max_result_chars must be a positive integer");
    if (!webResearch.user_agent || typeof webResearch.user_agent !== "string") {
      errors.push("web_research.user_agent is required");
    }
    if (!Array.isArray(webResearch.allowed_domains) || !webResearch.allowed_domains.every((domain) => typeof domain === "string" && domain.trim())) {
      errors.push("web_research.allowed_domains must be an array of domains");
    }
  }
  const chat = c.chat;
  if (!isPlainObject(chat)) {
    errors.push("chat must be an object");
  } else if (!isPlainObject(chat.interface_model)) {
    errors.push("chat.interface_model must be an object");
  } else {
    if (typeof chat.interface_model.enabled !== "boolean") errors.push("chat.interface_model.enabled must be a boolean");
    if (typeof chat.interface_model.require_explicit_route !== "boolean") {
      errors.push("chat.interface_model.require_explicit_route must be a boolean");
    }
    if (!isPositiveInteger(chat.interface_model.timeout_seconds)) errors.push("chat.interface_model.timeout_seconds must be a positive integer");
    if (typeof chat.interface_model.fallback_to_heuristics !== "boolean") {
      errors.push("chat.interface_model.fallback_to_heuristics must be a boolean");
    }
    if (typeof chat.interface_model.minimum_confidence !== "number" || chat.interface_model.minimum_confidence < 0 || chat.interface_model.minimum_confidence > 1) {
      errors.push("chat.interface_model.minimum_confidence must be between 0 and 1");
    }
  }
  if (!["ollama", "llamacpp"].includes(c.models?.provider_default ?? "")) {
    errors.push("models.provider_default must be ollama or llamacpp");
  }
  if (typeof c.models?.allow_provider_fallback !== "boolean") {
    errors.push("models.allow_provider_fallback must be a boolean");
  }
  const llama = c.models?.llamacpp;
  if (!isPlainObject(llama)) {
    errors.push("models.llamacpp must be an object");
  } else {
    if (!llama.host || typeof llama.host !== "string") errors.push("models.llamacpp.host is required");
    if (!isPort(llama.port)) errors.push("models.llamacpp.port must be between 1 and 65535");
    if (!isPositiveInteger(llama.context_size)) errors.push("models.llamacpp.context_size must be a positive integer");
    if (!isNonNegativeInteger(llama.gpu_layers)) errors.push("models.llamacpp.gpu_layers must be a non-negative integer");
    if (!isNonNegativeInteger(llama.threads)) errors.push("models.llamacpp.threads must be a non-negative integer");
    if (!isPositiveInteger(llama.timeout_seconds)) errors.push("models.llamacpp.timeout_seconds must be a positive integer");
    if (!isPositiveInteger(llama.startup_timeout_seconds)) errors.push("models.llamacpp.startup_timeout_seconds must be a positive integer");
    if (typeof llama.auto_start !== "boolean") errors.push("models.llamacpp.auto_start must be a boolean");
    if (typeof llama.auto_stop_after_request !== "boolean") errors.push("models.llamacpp.auto_stop_after_request must be a boolean");
    if (!isPlainObject(llama.model_paths)) errors.push("models.llamacpp.model_paths must be an object");
  }
  if (c.context?.no_global_tool_catalog !== true) {
    errors.push("context.no_global_tool_catalog must stay true");
  }
  if (c.harness?.patch_only !== true) {
    errors.push("harness.patch_only must stay true");
  }
  if (c.harness?.allow_dependency_install !== false) {
    errors.push("harness.allow_dependency_install must stay false unless explicitly approved outside config");
  }
  if (c.design?.open_design?.use_mcp_hot_path !== false) {
    errors.push("design.open_design.use_mcp_hot_path must stay false");
  }
  return errors;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override ?? base;
  const output: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    output[key] = deepMerge(output[key], value);
  }
  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
