import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { MmcConfig } from "../config/defaults.js";
import type { PhasePacket } from "../context/phase-packet.js";
import { missionDir } from "../storage/sqlite.js";
import { recordArtifact } from "../artifacts/store.js";
import { findPackageRoot } from "../utils/paths.js";
import {
  backendError,
  effectiveModelProvider,
  ensureLlamaCppServer,
  llamaCppBaseUrl,
  stopLlamaCppServer,
} from "./llamacpp-backend.js";

export type ModelProfile = {
  id: string;
  role: string;
  provider: string;
  state_policy: "hot" | "warm" | "cold" | "remote";
  hardware_min_ram_gb?: number;
  context_limit?: number;
};

export type ModelRegistry = {
  models: ModelProfile[];
  role_policy?: Record<string, Record<string, string>>;
};

export const MODEL_ROLES = ["interface", "spec_critic", "planner", "code_writer", "test_writer", "reviewer", "visual_inspector"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export type GenerateResult = {
  provider: string;
  model_id: string;
  text: string;
  latency_ms: number;
};

export function loadModelRegistry(cwd: string, config: MmcConfig): ModelRegistry {
  const packageRoot = findPackageRoot();
  const candidates = [
    path.resolve(cwd, config.models.registry_path),
    path.resolve(cwd, "micro_mission_coder_specs", "12_MODEL_PROFILES.yaml"),
    path.join(packageRoot, "12_MODEL_PROFILES.yaml"),
    path.join(packageRoot, "micro_mission_coder_specs", "12_MODEL_PROFILES.yaml"),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) return { models: [] };
  return parse(fs.readFileSync(file, "utf8")) as ModelRegistry;
}

export function routeModel(
  registry: ModelRegistry,
  role: string,
  profile: string,
  overrides?: Record<string, string>,
): ModelProfile | null {
  const configuredId = overrides?.[role] ?? registry.role_policy?.[profile]?.[role];
  if (configuredId === "disabled" || configuredId === "disabled_by_default") {
    return null;
  }
  if (configuredId) {
    return registry.models.find((model) => model.role === role && model.id === configuredId) ?? registry.models.find((model) => model.id === configuredId) ?? null;
  }
  return registry.models.find((model) => model.role === role) ?? null;
}

export async function generateFromModel(args: {
  cwd: string;
  config: MmcConfig;
  role: string;
  packet: PhasePacket;
  mockResponse?: string;
}): Promise<GenerateResult> {
  const started = Date.now();
  if (args.mockResponse !== undefined) {
    return {
      provider: "mock",
      model_id: "mock",
      text: args.mockResponse,
      latency_ms: Date.now() - started,
    };
  }

  const registry = loadModelRegistry(args.cwd, args.config);
  const model = routeModel(registry, args.role, args.config.hardware.profile, args.config.models.role_overrides);
  if (!model) {
    throw Object.assign(new Error(`no model configured for role ${args.role}`), { code: "MODEL_PROVIDER_FAILED" });
  }
  const provider = effectiveModelProvider(args.config, model);
  const prompt = formatModelPrompt(args.packet);
  if (provider === "llamacpp") {
    try {
      const lease = await ensureLlamaCppServer({ cwd: args.cwd, config: args.config, role: args.role, model });
      try {
        return await generateOpenAICompatible({ ...model, provider }, args.packet, started, {
          baseUrl: llamaCppBaseUrl(args.config),
          timeoutMs: args.config.models.llamacpp.timeout_seconds * 1000,
        });
      } finally {
        if (lease.started_by_microcoder && args.config.models.llamacpp.auto_stop_after_request) {
          await stopLlamaCppServer(args.cwd, args.config);
        }
      }
    } catch (error) {
      if (args.config.models.allow_provider_fallback) {
        const fallback = findOllamaFallback(registry, args.role, model);
        if (fallback) return generateOllama(fallback, prompt, started, args.config.models.llamacpp.timeout_seconds * 1000, { temperature: 0.1 });
      }
      throw error;
    }
  }
  if (["openai-compatible", "vllm"].includes(provider)) {
    return generateOpenAICompatible({ ...model, provider }, args.packet, started, {
      timeoutMs: args.config.models.llamacpp.timeout_seconds * 1000,
    });
  }
  if (provider !== "ollama") {
    throw Object.assign(new Error(`provider ${provider} is configured but not implemented yet`), {
      code: "MODEL_PROVIDER_FAILED",
    });
  }

  return generateOllama(model, prompt, started, args.config.models.llamacpp.timeout_seconds * 1000, { temperature: 0.1 });
}

export async function probeModelProvider(args: {
  cwd: string;
  config: MmcConfig;
  role: string;
  prompt?: string;
}): Promise<GenerateResult> {
  const registry = loadModelRegistry(args.cwd, args.config);
  const model = routeModel(registry, args.role, args.config.hardware.profile, args.config.models.role_overrides);
  if (!model) {
    throw Object.assign(new Error(`no model configured for role ${args.role}`), { code: "MODEL_PROVIDER_FAILED" });
  }
  const started = Date.now();
  const hasCustomPrompt = args.prompt !== undefined;
  const prompt = args.prompt ?? "Return exactly OK and nothing else.";
  let result: GenerateResult;
  const provider = effectiveModelProvider(args.config, model);
  if (provider === "ollama") {
    result = await generateOllama(model, prompt, started, args.config.models.llamacpp.timeout_seconds * 1000, { temperature: 0, numPredict: hasCustomPrompt ? 2048 : 8 });
  } else if (provider === "llamacpp") {
    try {
      const lease = await ensureLlamaCppServer({ cwd: args.cwd, config: args.config, role: args.role, model });
      try {
        result = await generateOpenAICompatible(
          { ...model, provider },
          probePacket(prompt),
          started,
          {
            baseUrl: llamaCppBaseUrl(args.config),
            timeoutMs: args.config.models.llamacpp.timeout_seconds * 1000,
          },
        );
      } finally {
        if (lease.started_by_microcoder && args.config.models.llamacpp.auto_stop_after_request) {
          await stopLlamaCppServer(args.cwd, args.config);
        }
      }
    } catch (error) {
      if (args.config.models.allow_provider_fallback) {
        const fallback = findOllamaFallback(registry, args.role, model);
        if (fallback) {
          result = await generateOllama(fallback, prompt, started, args.config.models.llamacpp.timeout_seconds * 1000, { temperature: 0, numPredict: hasCustomPrompt ? 2048 : 8 });
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  } else if (["openai-compatible", "vllm"].includes(provider)) {
    result = await generateOpenAICompatible({ ...model, provider }, probePacket(prompt), started, {
      timeoutMs: args.config.models.llamacpp.timeout_seconds * 1000,
    });
  } else {
    throw Object.assign(new Error(`provider ${provider} is configured but not implemented yet`), {
      code: "MODEL_PROVIDER_FAILED",
    });
  }

  const artifactPath = path.join(missionDir(args.cwd, args.config), "artifacts", `model-probe-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify({ role: args.role, prompt, result }, null, 2)}\n`, "utf8");
  recordArtifact(args.cwd, args.config, {
    attempt_id: null,
    type: "model_probe",
    path: artifactPath,
    summary: `${result.provider}:${result.model_id} latency_ms=${result.latency_ms}`,
  });
  return result;
}

async function generateOllama(
  model: ModelProfile,
  prompt: string,
  started: number,
  timeoutMs: number,
  options: { temperature: number; numPredict?: number },
): Promise<GenerateResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout("http://localhost:11434/api/generate", timeoutMs, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        prompt,
        stream: false,
        options: { temperature: options.temperature, ...(options.numPredict ? { num_predict: options.numPredict } : {}) },
      }),
    });
  } catch (error) {
    throw Object.assign(new Error(`ollama request failed: ${formatFetchError(error, timeoutMs)}`), { code: "MODEL_PROVIDER_FAILED" });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`ollama returned HTTP ${response.status}`), { code: "MODEL_PROVIDER_FAILED" });
  }
  const body = (await response.json()) as { response?: string };
  return {
    provider: "ollama",
    model_id: model.id,
    text: body.response ?? "",
    latency_ms: Date.now() - started,
  };
}

function probePacket(prompt: string): PhasePacket {
  return {
    phase: "planner",
    task_id: "MODEL_PROBE",
    budget_tokens: 256,
    allowed_actions: ["emit_json"],
    evidence_ids: [],
    required_output: "plain_text",
    mission_slice: { prompt },
  };
}

function findOllamaFallback(registry: ModelRegistry, role: string, current: ModelProfile): ModelProfile | null {
  return registry.models.find((candidate) => candidate.role === role && candidate.provider === "ollama" && candidate.id !== current.id) ?? null;
}

function formatModelPrompt(packet: PhasePacket): string {
  const packetJson = JSON.stringify(packet, null, 2);
  if (packet.phase !== "code_patch") {
    return `Return only the required Micro Mission Coder phase output.\n\nPhase packet:\n${packetJson}`;
  }
  const allowed = packet.allowed_files?.length ? packet.allowed_files.map((file) => `- ${file}`).join("\n") : "- No files are currently allowed; request more evidence instead.";
  return [
    "You are Micro Mission Coder running a code_patch phase.",
    "Return ONLY a unified diff patch.",
    "Do not wrap the diff in markdown fences. Do not include explanations, shell commands, or prose outside the patch.",
    "Use /dev/null for new files.",
    "Every changed file needs its own top-level diff --git section with --- and +++ headers.",
    "Never write diff --git, new file mode, index, ---, +++, or @@ lines as added file content.",
    "Make the verification commands pass. If npm test is listed for a new project, create a valid package.json test script.",
    "For browser JavaScript projects, prefer an npm test script like `node --check src/main.js`; never use placeholder echo tests.",
    "Empty repository evidence is normal for new projects; create the requested files from the task and docs context when allowed_files lists new paths.",
    "If evidence says allowed files are missing, that is permission to create them, not a reason to request more evidence.",
    "Do not request more evidence just because evidence_ids is empty.",
    "Only touch paths listed under Allowed files. If the task cannot be completed within those paths, return exactly REQUEST_MORE_EVIDENCE: <reason>.",
    "If the request is unsafe or impossible, return exactly DECLINE: <reason>.",
    "",
    "Allowed files:",
    allowed,
    "",
    "Phase packet:",
    packetJson,
  ].join("\n");
}

async function generateOpenAICompatible(
  model: ModelProfile,
  packet: PhasePacket,
  started: number,
  options: { baseUrl?: string; timeoutMs?: number } = {},
): Promise<GenerateResult> {
  const baseUrl =
    options.baseUrl ??
    process.env.MMC_OPENAI_COMPAT_BASE_URL ??
    (model.provider === "llamacpp" ? "http://localhost:8080/v1" : "http://localhost:8000/v1");
  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl.replace(/\/$/, "")}/chat/completions`, options.timeoutMs, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.MMC_OPENAI_COMPAT_API_KEY ? { authorization: `Bearer ${process.env.MMC_OPENAI_COMPAT_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: model.id,
        temperature: 0.1,
        messages: [
          { role: "system", content: "You are Micro Mission Coder. Follow the requested output contract exactly." },
          { role: "user", content: formatModelPrompt(packet) },
        ],
      }),
    });
  } catch (error) {
    if (model.provider === "llamacpp") {
      throw backendError("MODEL_PROBE_FAILED", `llama.cpp OpenAI-compatible request failed: ${formatFetchError(error, options.timeoutMs)}`);
    }
    throw Object.assign(new Error(`${model.provider} request failed: ${formatFetchError(error, options.timeoutMs)}`), { code: "MODEL_PROVIDER_FAILED" });
  }
  if (!response.ok) {
    if (model.provider === "llamacpp") {
      throw backendError("MODEL_PROBE_FAILED", `llama.cpp returned HTTP ${response.status}`);
    }
    throw Object.assign(new Error(`${model.provider} returned HTTP ${response.status}`), { code: "MODEL_PROVIDER_FAILED" });
  }
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string }; text?: string }> };
  return {
    provider: model.provider,
    model_id: model.id,
    text: body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? "",
    latency_ms: Date.now() - started,
  };
}

function fetchWithTimeout(url: string, timeoutMs: number | undefined, init: RequestInit): Promise<Response> {
  if (!timeoutMs) return fetch(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function formatFetchError(error: unknown, timeoutMs: number | undefined): string {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError") return `timed out after ${Math.round((timeoutMs ?? 0) / 1000)}s`;
  return message;
}
