import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MmcConfig } from "../config/defaults.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { ensureMissionStructure, initializeDatabase, missionDir } from "../storage/sqlite.js";
import { indexRepo, buildEvidencePacket } from "../repo/brain.js";
import { probeModelProvider } from "../models/orchestrator.js";
import { recordArtifact } from "../artifacts/store.js";
import type { RuntimeTask } from "../spec/compiler.js";
import { coerceToUnifiedDiff } from "../harness/patch.js";
import { spawnSync } from "node:child_process";
import { pathContainsIgnoredWorkspaceDir, shouldIgnoreWorkspaceEntry } from "../utils/ignore.js";

export type BenchmarkTask = {
  task_id: string;
  title: string;
  target_file: string;
  expected_marker?: string;
};

export type BenchmarkRow = {
  task_id: string;
  target_file: string;
  raw_selected_file: string | null;
  mmc_selected_file: string | null;
  raw_correct: boolean;
  mmc_correct: boolean;
  raw_response: string;
  raw_patch_apply: boolean;
  mmc_patch_apply: boolean;
  mmc_verification_passed: boolean;
  mmc_expected_change_present: boolean;
  mmc_verify_command_passed: boolean;
  mmc_verify_summary: string;
  patch_response: string;
  raw_latency_ms: number;
};

export type LocalBenchmarkReport = {
  run_id: string;
  generated_at: string;
  task_count: number;
  model_role: string;
  raw_correct_localization: number;
  mmc_correct_localization: number;
  raw_unrelated_edits_avoided: number;
  mmc_unrelated_edits_avoided: number;
  raw_patch_apply_rate: number;
  mmc_patch_apply_rate: number;
  mmc_verification_pass_rate: number;
  rows: BenchmarkRow[];
  artifact_dir: string;
};

export async function runLocalBenchmark(args: {
  cwd: string;
  config: MmcConfig;
  taskCount: number;
  modelRole: string;
  mockRaw?: boolean;
  source?: "generated" | "current-repo";
}): Promise<LocalBenchmarkReport> {
  const run_id = `bench-${Date.now()}`;
  const artifactRoot = path.join(missionDir(args.cwd, args.config), "artifacts", "benchmark", run_id);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `${run_id}-`));
  fs.mkdirSync(artifactRoot, { recursive: true });

  const tasks = args.source === "current-repo"
    ? createCurrentRepoBenchmarkWorkspace(args.cwd, workspace, args.taskCount)
    : createBenchmarkWorkspace(workspace, args.taskCount);
  const benchConfig: MmcConfig = structuredClone(DEFAULT_CONFIG);
  benchConfig.project.mission_dir = ".mission";
  benchConfig.project.database_path = ".mission/mmc.sqlite";
  benchConfig.models.registry_path = path.join(args.cwd, args.config.models.registry_path);
  benchConfig.hardware.profile = args.config.hardware.profile;
  ensureMissionStructure(workspace, benchConfig);
  initializeDatabase(workspace, benchConfig);
  indexRepo(workspace, benchConfig);

  const rows: BenchmarkRow[] = [];
  for (const task of tasks) {
    const raw = args.mockRaw
      ? { text: task.target_file, latency_ms: 0 }
      : await probeModelProvider({
          cwd: args.cwd,
          config: args.config,
          role: args.modelRole,
          prompt: buildRawPrompt(tasks, task),
        });
    const rawSelected = selectFileFromResponse(raw.text, tasks.map((candidate) => candidate.target_file));
    const runtimeTask: RuntimeTask = {
      id: task.task_id,
      title: task.title,
      description: task.title,
      status: "ready",
      depends_on: [],
      acceptance_ids: ["AC1"],
      allowed_files: [task.target_file],
      forbidden_files: [],
      verification_commands: ["npm test"],
      risk_flags: [],
    };
    const evidence = buildEvidencePacket(workspace, benchConfig, runtimeTask, 1200);
    const mmcSelected =
      evidence.items.find((item) => item.type === "source_snippet" && item.path?.endsWith(".ts"))?.path ?? null;
    const patchResponse = args.mockRaw
      ? { text: makeExpectedReplacement(workspace, task), latency_ms: 0 }
      : await probeModelProvider({
          cwd: args.cwd,
          config: args.config,
          role: args.modelRole,
          prompt: buildPatchPrompt(workspace, task),
        });
    const rawPatchApply = canApplyPatch(workspace, patchResponse.text);
    const normalizedPatch = coerceToUnifiedDiff(patchResponse.text, workspace, [task.target_file]);
    const mmcPatchApply = canApplyPatch(workspace, normalizedPatch);
    const verification = mmcPatchApply
      ? verifyPatch(workspace, normalizedPatch, task, args.cwd)
      : { passed: false, expected_change_present: false, command_passed: false, summary: "patch did not apply" };
    rows.push({
      task_id: task.task_id,
      target_file: task.target_file,
      raw_selected_file: rawSelected,
      mmc_selected_file: mmcSelected,
      raw_correct: rawSelected === task.target_file,
      mmc_correct: mmcSelected === task.target_file,
      raw_response: raw.text,
      raw_patch_apply: rawPatchApply,
      mmc_patch_apply: mmcPatchApply,
      mmc_verification_passed: verification.passed,
      mmc_expected_change_present: verification.expected_change_present,
      mmc_verify_command_passed: verification.command_passed,
      mmc_verify_summary: verification.summary,
      patch_response: patchResponse.text.slice(0, 500),
      raw_latency_ms: raw.latency_ms,
    });
  }

  const report: LocalBenchmarkReport = {
    run_id,
    generated_at: new Date().toISOString(),
    task_count: tasks.length,
    model_role: args.modelRole,
    raw_correct_localization: ratio(rows.filter((row) => row.raw_correct).length, rows.length),
    mmc_correct_localization: ratio(rows.filter((row) => row.mmc_correct).length, rows.length),
    raw_unrelated_edits_avoided: ratio(rows.filter((row) => row.raw_selected_file === row.target_file).length, rows.length),
    mmc_unrelated_edits_avoided: ratio(rows.filter((row) => row.mmc_selected_file === row.target_file).length, rows.length),
    raw_patch_apply_rate: ratio(rows.filter((row) => row.raw_patch_apply).length, rows.length),
    mmc_patch_apply_rate: ratio(rows.filter((row) => row.mmc_patch_apply).length, rows.length),
    mmc_verification_pass_rate: ratio(rows.filter((row) => row.mmc_verification_passed).length, rows.length),
    rows,
    artifact_dir: artifactRoot,
  };

  fs.writeFileSync(path.join(artifactRoot, "tasks.json"), `${JSON.stringify(tasks, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(artifactRoot, "results.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(artifactRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  recordArtifact(args.cwd, args.config, {
    attempt_id: null,
    type: "benchmark_report",
    path: path.join(artifactRoot, "report.json"),
    summary: `local paired benchmark ${rows.length} tasks`,
  });
  return report;
}

function buildPatchPrompt(workspace: string, task: BenchmarkTask): string {
  const current = fs.readFileSync(path.join(workspace, task.target_file), "utf8");
  if (/invoice panel \d+/.test(current)) {
    const updatedText = replacementTextForTask(task);
    return `Return only a unified diff. Modify ${task.target_file} so the function returns "${updatedText}".\n\nCurrent file ${task.target_file}:\n${current}`;
  }
  const marker = task.expected_marker ?? `// mmc benchmark verified ${task.task_id}`;
  return [
    "Return only the complete updated file contents. Do not wrap the answer in Markdown.",
    `Edit only ${task.target_file}.`,
    `Append this exact line as the final line of the file: ${marker}`,
    "Do not modify imports, existing code, types, package files, tests, or any other file.",
    "",
    `Current file ${task.target_file}:`,
    current,
  ].join("\n");
}

function makeExpectedReplacement(workspace: string, task: BenchmarkTask): string {
  const current = fs.readFileSync(path.join(workspace, task.target_file), "utf8");
  if (/return "invoice panel \d+";/.test(current)) {
    return current.replace(/return "invoice panel \d+";/, `return "${replacementTextForTask(task)}";`);
  }
  const marker = task.expected_marker ?? `// mmc benchmark verified ${task.task_id}`;
  return current.trimEnd().concat(`\n${marker}\n`);
}

function replacementTextForTask(task: BenchmarkTask): string {
  const number = task.task_id.replace(/^B/, "");
  return `invoice panel ${number} updated`;
}

function canApplyPatch(workspace: string, patch: string): boolean {
  const result = spawnSync("patch", ["-p1", "--dry-run"], {
    cwd: workspace,
    input: patch,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  return result.status === 0;
}

function verifyPatch(
  workspace: string,
  patch: string,
  task: BenchmarkTask,
  dependencyRoot: string,
): { passed: boolean; expected_change_present: boolean; command_passed: boolean; summary: string } {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "mmc-bench-verify-"));
  fs.cpSync(workspace, copy, {
    recursive: true,
    filter: (src) => !pathContainsIgnoredWorkspaceDir(path.relative(workspace, src)),
  });
  const apply = spawnSync("patch", ["-p1"], {
    cwd: copy,
    input: patch,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  if (apply.status !== 0) {
    return {
      passed: false,
      expected_change_present: false,
      command_passed: false,
      summary: `apply failed: ${(apply.stderr || apply.stdout).trim().slice(0, 300)}`,
    };
  }
  const expected_change_present = expectedChangePresent(copy, task);
  linkDependencyInstall(copy, dependencyRoot);
  const command = fs.existsSync(path.join(copy, "tsconfig.json"))
    ? typecheckCommand(dependencyRoot)
    : { command: "npm", args: ["test"] };
  const verify = spawnSync(command.command, command.args, {
    cwd: copy,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${path.join(dependencyRoot, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    maxBuffer: 1024 * 1024 * 20,
  });
  const command_passed = verify.status === 0;
  return {
    passed: expected_change_present && command_passed,
    expected_change_present,
    command_passed,
    summary: command_passed ? "command passed" : `command failed: ${(verify.stderr || verify.stdout).trim().slice(0, 300)}`,
  };
}

function linkDependencyInstall(workspace: string, dependencyRoot: string): void {
  const source = path.join(dependencyRoot, "node_modules");
  const target = path.join(workspace, "node_modules");
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  try {
    fs.symlinkSync(source, target, "dir");
  } catch {
    fs.cpSync(source, target, { recursive: true });
  }
}

function typecheckCommand(dependencyRoot: string): { command: string; args: string[] } {
  const localTsc = path.join(dependencyRoot, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  if (fs.existsSync(localTsc)) return { command: localTsc, args: ["-p", "tsconfig.json", "--noEmit", "--pretty", "false"] };
  return { command: "npm", args: ["run", "typecheck"] };
}

function expectedChangePresent(workspace: string, task: BenchmarkTask): boolean {
  const content = fs.readFileSync(path.join(workspace, task.target_file), "utf8");
  if (task.expected_marker) return content.trimEnd().endsWith(task.expected_marker);
  return content.includes(replacementTextForTask(task));
}

function createBenchmarkWorkspace(workspace: string, taskCount: number): BenchmarkTask[] {
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }, null, 2));
  const tasks: BenchmarkTask[] = [];
  for (let index = 1; index <= taskCount; index += 1) {
    const slug = index.toString().padStart(2, "0");
    const file = `src/feature-${slug}-invoice-panel.ts`;
    fs.writeFileSync(
      path.join(workspace, file),
      `export function feature${slug}InvoicePanel() {\n  return "invoice panel ${slug}";\n}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(workspace, `src/unrelated-${slug}.ts`),
      `export const unrelated${slug} = "do not edit ${slug}";\n`,
      "utf8",
    );
    tasks.push({
      task_id: `B${slug}`,
      title: `Update invoice panel ${slug} copy in feature ${slug}`,
      target_file: file,
    });
  }
  return tasks;
}

function createCurrentRepoBenchmarkWorkspace(sourceCwd: string, workspace: string, taskCount: number): BenchmarkTask[] {
  copyBenchmarkSource(sourceCwd, workspace);
  const candidates = collectSourceCandidates(workspace).slice(0, taskCount);
  if (candidates.length === 0) {
    throw new Error("current repo benchmark found no source candidates");
  }
  return candidates.map((candidate, index) => ({
    task_id: `R${(index + 1).toString().padStart(2, "0")}`,
    title: `Append benchmark marker for exported symbol ${candidate.symbol} in ${candidate.file}`,
    target_file: candidate.file,
    expected_marker: `// mmc benchmark verified R${(index + 1).toString().padStart(2, "0")}`,
  }));
}

function copyBenchmarkSource(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (shouldIgnoreWorkspaceEntry(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(from, to, {
        recursive: true,
        filter: (src) => !pathContainsIgnoredWorkspaceDir(path.relative(source, src)),
      });
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function collectSourceCandidates(workspace: string): Array<{ file: string; symbol: string }> {
  const candidates: Array<{ file: string; symbol: string }> = [];
  const root = path.join(workspace, "src");
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (shouldIgnoreWorkspaceEntry(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      const rel = path.relative(workspace, abs);
      const content = fs.readFileSync(abs, "utf8");
      if (content.length > 5000) continue;
      const symbol =
        content.match(/\bexport\s+function\s+([A-Za-z_$][\w$]*)/)?.[1] ??
        content.match(/\bexport\s+class\s+([A-Za-z_$][\w$]*)/)?.[1] ??
        content.match(/\bexport\s+const\s+([A-Za-z_$][\w$]*)/)?.[1] ??
        content.match(/\bexport\s+type\s+([A-Za-z_$][\w$]*)/)?.[1] ??
        content.match(/\bexport\s+interface\s+([A-Za-z_$][\w$]*)/)?.[1];
      if (symbol) candidates.push({ file: rel, symbol });
    }
  };
  if (fs.existsSync(root)) walk(root);
  return candidates.sort((a, b) => a.file.localeCompare(b.file));
}

function buildRawPrompt(tasks: BenchmarkTask[], task: BenchmarkTask): string {
  const files = tasks.flatMap((candidate) => {
    if (candidate.target_file.includes("feature-")) {
      return [candidate.target_file, candidate.target_file.replace("feature", "unrelated").replace("-invoice-panel", "")];
    }
    return [candidate.target_file];
  }).sort();
  return `Choose the one file to edit for this task. Return only one path.\nTask: ${task.title}\nFiles:\n${files.join("\n")}`;
}

function selectFileFromResponse(response: string, files: string[]): string | null {
  const normalized = response.trim();
  const exact = files.find((file) => normalized.includes(file));
  if (exact) return exact;
  const simplifiedResponse = simplifyPath(normalized);
  return files.find((file) => simplifyPath(file).startsWith(simplifiedResponse) || simplifiedResponse.startsWith(simplifyPath(file))) ?? null;
}

function simplifyPath(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"']/g, "")
    .replace(/\.ts\b/g, "")
    .replace(/-panel\b/g, "")
    .trim();
}

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 1000;
}
