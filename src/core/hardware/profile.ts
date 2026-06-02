import os from "node:os";

export type HardwareProfileName =
  | "constrained_16gb"
  | "middle_32gb"
  | "strong_middle_48gb"
  | "strong_local_64gb";

export type HardwareProfile = {
  name: HardwareProfileName;
  ram_gb: number;
  vram_gb: number | null;
  ssd_gb?: number;
  parallel_model_calls: number;
  parallel_test_jobs: number;
  context_budget_tokens: number;
  vision_enabled: boolean;
  playwright_enabled: boolean;
};

export const HARDWARE_PROFILES: Record<HardwareProfileName, HardwareProfile> = {
  constrained_16gb: {
    name: "constrained_16gb",
    ram_gb: 16,
    vram_gb: null,
    parallel_model_calls: 1,
    parallel_test_jobs: 0,
    context_budget_tokens: 4096,
    vision_enabled: false,
    playwright_enabled: false,
  },
  middle_32gb: {
    name: "middle_32gb",
    ram_gb: 32,
    vram_gb: 8,
    ssd_gb: 1000,
    parallel_model_calls: 1,
    parallel_test_jobs: 1,
    context_budget_tokens: 8192,
    vision_enabled: false,
    playwright_enabled: true,
  },
  strong_middle_48gb: {
    name: "strong_middle_48gb",
    ram_gb: 48,
    vram_gb: 12,
    ssd_gb: 1000,
    parallel_model_calls: 1,
    parallel_test_jobs: 2,
    context_budget_tokens: 16000,
    vision_enabled: true,
    playwright_enabled: true,
  },
  strong_local_64gb: {
    name: "strong_local_64gb",
    ram_gb: 64,
    vram_gb: 24,
    ssd_gb: 2000,
    parallel_model_calls: 2,
    parallel_test_jobs: 2,
    context_budget_tokens: 32000,
    vision_enabled: true,
    playwright_enabled: true,
  },
};

export function isHardwareProfileName(value: string): value is HardwareProfileName {
  return Object.hasOwn(HARDWARE_PROFILES, value);
}

export function detectHostRamGb(): number {
  return Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10;
}

export function detectSuggestedProfile(ramGb = detectHostRamGb()): HardwareProfileName {
  if (ramGb < 24) return "constrained_16gb";
  if (ramGb < 48) return "middle_32gb";
  if (ramGb < 64) return "strong_middle_48gb";
  return "strong_local_64gb";
}
