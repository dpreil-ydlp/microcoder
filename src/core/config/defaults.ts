import { stringify } from "yaml";
import type { HardwareProfileName } from "../hardware/profile.js";

export type MmcConfig = {
  project: {
    name: string;
    mission_dir: string;
    database_path: string;
  };
  hardware: {
    profile: HardwareProfileName;
    max_ram_gb: number;
    max_vram_gb: number;
    max_parallel_model_calls: number;
    max_parallel_test_jobs: number;
    context_budget_tokens: number;
    battery_saver: boolean;
  };
  repo_brain: {
    enabled: boolean;
    require_fresh_index: boolean;
    tree_sitter: boolean;
    lsp: boolean;
    ripgrep_internal: boolean;
    refresh_on_patch: boolean;
  };
  context: {
    no_global_tool_catalog: boolean;
    default_code_patch_budget_tokens: number;
    default_planner_budget_tokens: number;
    include_evidence_ids: boolean;
  };
  web_research: {
    enabled: boolean;
    auto_include_in_docs: boolean;
    auto_include_in_chat: boolean;
    provider: "duckduckgo_html" | "custom_json";
    search_url: string;
    timeout_seconds: number;
    max_results: number;
    max_result_chars: number;
    user_agent: string;
    allowed_domains: string[];
  };
  chat: {
    interface_model: {
      enabled: boolean;
      require_explicit_route: boolean;
      timeout_seconds: number;
      fallback_to_heuristics: boolean;
      minimum_confidence: number;
    };
  };
  models: {
    provider_default: string;
    registry_path: string;
    role_overrides?: Record<string, string>;
    allow_provider_fallback: boolean;
    llamacpp: {
      llama_server_path?: string;
      host: string;
      port: number;
      context_size: number;
      gpu_layers: number;
      threads: number;
      timeout_seconds: number;
      startup_timeout_seconds: number;
      auto_start: boolean;
      auto_stop_after_request: boolean;
      model_paths: Record<string, string>;
      pid_file?: string;
      log_file?: string;
    };
    unload_cold_after_seconds: number;
    keep_warm_for_seconds: number;
  };
  harness: {
    use_worktrees: boolean;
    patch_only: boolean;
    command_timeout_seconds: number;
    allow_dependency_install: boolean;
    allowed_commands: string[];
  };
  verification: {
    targeted_tests_first: boolean;
    full_tests_on_high_confidence_only: boolean;
    playwright_enabled: boolean;
    playwright_targeted_only: boolean;
    app_start_command?: string;
    app_url?: string;
  };
  vision: {
    enabled: boolean;
    cold_load_only: boolean;
  };
  evaluation: {
    trace_all_model_calls: boolean;
    store_artifacts: boolean;
    baseline_raw_model: string;
  };
  design: {
    open_design: {
      enabled: "optional" | boolean;
      mode_by_hardware: Record<string, string>;
      max_selected_skills: number;
      max_design_tokens: number;
      use_mcp_hot_path: boolean;
    };
    shadcn_ui: {
      enabled: boolean;
      policy: string;
    };
    chatcn: {
      enabled: "optional" | boolean;
      use_only_for_surfaces: string[];
    };
  };
};

export const DEFAULT_CONFIG: MmcConfig = {
  project: {
    name: "micro-mission-coder",
    mission_dir: ".mission",
    database_path: ".mission/mmc.sqlite",
  },
  hardware: {
    profile: "middle_32gb",
    max_ram_gb: 32,
    max_vram_gb: 8,
    max_parallel_model_calls: 1,
    max_parallel_test_jobs: 1,
    context_budget_tokens: 8192,
    battery_saver: false,
  },
  repo_brain: {
    enabled: true,
    require_fresh_index: true,
    tree_sitter: true,
    lsp: false,
    ripgrep_internal: true,
    refresh_on_patch: true,
  },
  context: {
    no_global_tool_catalog: true,
    default_code_patch_budget_tokens: 4096,
    default_planner_budget_tokens: 1800,
    include_evidence_ids: true,
  },
  web_research: {
    enabled: true,
    auto_include_in_docs: true,
    auto_include_in_chat: true,
    provider: "duckduckgo_html",
    search_url: "https://html.duckduckgo.com/html/",
    timeout_seconds: 5,
    max_results: 5,
    max_result_chars: 1200,
    user_agent: "microcoder/0.1 local docs research",
    allowed_domains: [],
  },
  chat: {
    interface_model: {
      enabled: true,
      require_explicit_route: true,
      timeout_seconds: 12,
      fallback_to_heuristics: true,
      minimum_confidence: 0.55,
    },
  },
  models: {
    provider_default: "ollama",
    registry_path: "./12_MODEL_PROFILES.yaml",
    allow_provider_fallback: false,
    llamacpp: {
      host: "127.0.0.1",
      port: 8080,
      context_size: 4096,
      gpu_layers: 0,
      threads: 0,
      timeout_seconds: 60,
      startup_timeout_seconds: 30,
      auto_start: false,
      auto_stop_after_request: true,
      model_paths: {},
    },
    unload_cold_after_seconds: 30,
    keep_warm_for_seconds: 300,
  },
  harness: {
    use_worktrees: true,
    patch_only: true,
    command_timeout_seconds: 120,
    allow_dependency_install: false,
    allowed_commands: [
      "npm run typecheck",
      "npm run lint",
      "npm run test",
      "pnpm typecheck",
      "pnpm lint",
      "pnpm test",
      "npm test",
      "npx playwright test",
      "pytest",
    ],
  },
  verification: {
    targeted_tests_first: true,
    full_tests_on_high_confidence_only: false,
    playwright_enabled: true,
    playwright_targeted_only: true,
    app_start_command: undefined,
    app_url: undefined,
  },
  vision: {
    enabled: false,
    cold_load_only: true,
  },
  evaluation: {
    trace_all_model_calls: true,
    store_artifacts: true,
    baseline_raw_model: "qwen2.5-coder-7b-q4",
  },
  design: {
    open_design: {
      enabled: "optional",
      mode_by_hardware: {
        "16gb": "reference_only",
        "24_32gb": "reference_or_small_prototype",
        "48_64gb": "prototype_and_critique",
      },
      max_selected_skills: 3,
      max_design_tokens: 1500,
      use_mcp_hot_path: false,
    },
    shadcn_ui: {
      enabled: true,
      policy: "prefer_existing_repo_components_first",
    },
    chatcn: {
      enabled: "optional",
      use_only_for_surfaces: ["chat", "agent_conversation", "messaging"],
    },
  },
};

const MODEL_CHEAT_SHEET = `# Model routing cheat sheet
# This is comments only. Copy the lines you want into the real models block above.
#
# Pin a role:
# models:
#   role_overrides:
#     interface: liquid-lfm2-1.2b
#     code_writer: qwen2.5-coder:7b
#     test_writer: phi4-mini
#     reviewer: phi4-mini
#
# Use llama.cpp for the interface model:
# models:
#   llamacpp:
#     llama_server_path: /opt/homebrew/bin/llama-server
#     auto_start: true
#     auto_stop_after_request: true
#     model_paths:
#       interface: /path/to/Models/LiquidAI/LFM2-1.2B-GGUF/LFM2-1.2B-Q4_K_M.gguf
#       liquid-lfm2-1.2b: /path/to/Models/LiquidAI/LFM2-1.2B-GGUF/LFM2-1.2B-Q4_K_M.gguf
#
# Available model ids by role:
# interface:
#   gemma3:1b                  ollama   hot   8GB   ctx 32768
#   liquid-lfm2-1.2b           llamacpp warm  16GB  ctx 32768
# spec_critic:
#   smollm2:360m               ollama   hot   8GB   ctx 8192
#   gemma3:1b                  ollama   hot   8GB   ctx 32768
# planner:
#   gemma3:1b                  ollama   hot   8GB   ctx 32768
# code_writer:
#   qwen2.5-coder:3b           ollama   warm  16GB  ctx 32768
#   qwen2.5-coder:7b           ollama   warm  24GB  ctx 32768
# test_writer:
#   qwen2.5-coder:7b           ollama   warm  24GB  ctx 32768
#   phi4-mini                  ollama   cold  24GB  ctx 32768
# reviewer:
#   gemma3:1b                  ollama   hot   8GB   ctx 32768
#   phi4-mini                  ollama   cold  24GB  ctx 32768
# visual_inspector:
#   moondream                  ollama   cold  32GB  ctx 8192
`;

export function renderConfig(config: MmcConfig): string {
  return `${stringify(config).trimEnd()}\n\n${MODEL_CHEAT_SHEET}`;
}

export function renderDefaultConfig(): string {
  return renderConfig(DEFAULT_CONFIG);
}
