import fs from "node:fs";
import path from "node:path";
import type { MmcConfig } from "../config/defaults.js";
import { missionDir } from "../storage/sqlite.js";
import { recordArtifact } from "../artifacts/store.js";

export type BenchmarkReport = {
  generated_at: string;
  metrics: {
    correct_localization: number | null;
    patch_apply_rate: number | null;
    verification_pass_rate: number | null;
    unrelated_edits_avoided: number | null;
    mission_completion_rate: number | null;
  };
  note: string;
};

export function exportBenchmarkSkeleton(cwd: string, config: MmcConfig): BenchmarkReport {
  const report: BenchmarkReport = {
    generated_at: new Date().toISOString(),
    metrics: {
      correct_localization: null,
      patch_apply_rate: null,
      verification_pass_rate: null,
      unrelated_edits_avoided: null,
      mission_completion_rate: null,
    },
    note: "Benchmark runner scaffold exported; fill with paired raw-model and MMC task rows before claiming benchmark results.",
  };
  const target = path.join(missionDir(cwd, config), "artifacts", "benchmark-report.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  recordArtifact(cwd, config, {
    attempt_id: null,
    type: "benchmark_report",
    path: target,
    summary: "raw model vs MMC benchmark report scaffold",
  });
  return report;
}
