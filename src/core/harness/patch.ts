import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import type { MmcConfig } from "../config/defaults.js";
import { missionDir } from "../storage/sqlite.js";
import { recordArtifact } from "../artifacts/store.js";
import { pathContainsIgnoredWorkspaceDir, shouldIgnoreWorkspaceEntry } from "../utils/ignore.js";

export type PatchValidation = {
  scope_clean: boolean;
  touched_files: string[];
  rejected_reason?: string;
};

export type PatchApplyResult = {
  attempt_id: string;
  status: "applied" | "failed_scope" | "failed_apply";
  worktree_path: string;
  patch_path: string;
  validation: PatchValidation;
  worktree_mode: "git_worktree" | "directory_copy";
  stderr?: string;
};

const SECRET_FILE_PATTERNS = [/^\.env/, /\.pem$/, /\.key$/, /\.p12$/, /\.npmrc$/];
const TEST_DISABLE_PATTERNS = [/\bdescribe\.skip\b/, /\bit\.skip\b/, /\btest\.skip\b/, /\bvi\.mock\([^)]*test/i];
const FAILING_TEST_SCRIPT_PATTERNS = [/Error: no test specified/i, /No tests yet/i, /"test"\s*:\s*"[^"]*exit 1/i];

export function parseTouchedFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const match = line.match(/^(?:---|\+\+\+) [ab]\/(.+)$/);
    if (match && match[1] !== "/dev/null") files.add(match[1]);
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diffMatch) {
      files.add(diffMatch[1]);
      files.add(diffMatch[2]);
    }
  }
  return [...files].sort();
}

export function coerceToUnifiedDiff(modelOutput: string, cwd: string, allowedFiles: string[]): string {
  const trimmedOutput = modelOutput.trim();
  const fencedPatch = extractFencedPatch(modelOutput);
  if (fencedPatch) return recountUnifiedDiff(repairModelPrefixedDiffSections(fencedPatch));
  if (/^(diff --git |--- a\/)/.test(trimmedOutput)) return recountUnifiedDiff(repairModelPrefixedDiffSections(trimmedOutput.concat("\n")));
  if (allowedFiles.length !== 1) return modelOutput;
  const file = allowedFiles[0];
  const originalPath = path.join(cwd, file);
  if (!fs.existsSync(originalPath)) return modelOutput;
  const replacement = extractReplacementFile(modelOutput);
  if (!replacement.trim()) return modelOutput;
  const original = fs.readFileSync(originalPath, "utf8");
  if (original === replacement) return modelOutput;
  if (!looksLikeWholeFileReplacement(original, replacement)) return modelOutput;
  return makeUnifiedDiff(file, original, replacement);
}

function recountUnifiedDiff(patch: string): string {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (!header) {
      out.push(line);
      continue;
    }
    const hunkLines: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      const hunkLine = lines[cursor];
      if (/^(?:@@ |diff --git |--- |\+\+\+ )/.test(hunkLine)) break;
      hunkLines.push(hunkLine);
      if (hunkLine.startsWith("\\ No newline")) continue;
      if (hunkLine.startsWith(" ") || hunkLine.startsWith("-")) oldCount += 1;
      if (hunkLine.startsWith(" ") || hunkLine.startsWith("+")) newCount += 1;
    }
    out.push(`@@ -${header[1]},${oldCount} +${header[2]},${newCount} @@${header[3]}`);
    out.push(...hunkLines);
    index = cursor - 1;
  }
  return out.join("\n").replace(/\n*$/, "\n");
}

function repairModelPrefixedDiffSections(patch: string): string {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("+diff --git a/")) {
      out.push(line);
      continue;
    }

    out.push(line.slice(1));
    let sawNewFileMode = false;
    let sawOldHeader = false;
    for (index += 1; index < lines.length; index += 1) {
      const next = lines[index];
      if (
        next.startsWith("+new file mode ") ||
        next.startsWith("+deleted file mode ") ||
        next.startsWith("+old mode ") ||
        next.startsWith("+new mode ") ||
        next.startsWith("+similarity index ") ||
        next.startsWith("+rename from ") ||
        next.startsWith("+rename to ") ||
        next.startsWith("+index ")
      ) {
        const unprefixed = next.slice(1);
        if (unprefixed.startsWith("new file mode ")) sawNewFileMode = true;
        out.push(unprefixed);
        continue;
      }
      if (next.startsWith("+--- ")) {
        sawOldHeader = true;
        out.push(next.slice(1));
        continue;
      }
      if (next.startsWith("+++ ") || next.startsWith("++++ ")) {
        if (sawNewFileMode && !sawOldHeader) out.push("--- /dev/null");
        out.push(next.startsWith("++++ ") ? next.slice(1) : next);
        break;
      }
      if (next.startsWith("+@@ ")) {
        if (sawNewFileMode && !sawOldHeader) out.push("--- /dev/null");
        out.push(next.slice(1));
        break;
      }
      index -= 1;
      break;
    }
  }
  return out.join("\n");
}

export function validatePatchScope(patch: string, allowedFiles: string[], options?: { allowConfig?: boolean }): PatchValidation {
  const touched_files = parseTouchedFiles(patch);
  if (touched_files.length === 0) {
    return { scope_clean: false, touched_files, rejected_reason: "patch does not touch any files" };
  }
  if (TEST_DISABLE_PATTERNS.some((pattern) => pattern.test(patch))) {
    return { scope_clean: false, touched_files, rejected_reason: "patch appears to disable tests" };
  }
  if (FAILING_TEST_SCRIPT_PATTERNS.some((pattern) => pattern.test(patch))) {
    return { scope_clean: false, touched_files, rejected_reason: "patch leaves a failing npm test placeholder" };
  }
  const secretFile = touched_files.find((file) => SECRET_FILE_PATTERNS.some((pattern) => pattern.test(file)));
  if (secretFile && !options?.allowConfig) {
    return { scope_clean: false, touched_files, rejected_reason: `patch touches secret/config file ${secretFile}` };
  }
  const lifecycle = parseFileLifecycle(patch);
  const unapprovedNew = lifecycle.created.find((file) => !allowedFiles.includes(file));
  if (unapprovedNew) {
    return { scope_clean: false, touched_files, rejected_reason: `patch creates new file without explicit permission: ${unapprovedNew}` };
  }
  const deleted = lifecycle.deleted[0];
  if (deleted) {
    return { scope_clean: false, touched_files, rejected_reason: `patch deletes file without elevated permission: ${deleted}` };
  }
  if (allowedFiles.length > 0) {
    const outside = touched_files.find((file) => !allowedFiles.includes(file));
    if (outside) {
      return { scope_clean: false, touched_files, rejected_reason: `patch touches file outside allowed scope: ${outside}` };
    }
  }
  return { scope_clean: true, touched_files };
}

function parseFileLifecycle(patch: string): { created: string[]; deleted: string[] } {
  const created = new Set<string>();
  const deleted = new Set<string>();
  let oldFile: string | null = null;
  for (const line of patch.split(/\r?\n/)) {
    const oldMatch = line.match(/^--- (?:a\/(.+)|\/dev\/null)$/);
    if (oldMatch) {
      oldFile = oldMatch[1] ?? "/dev/null";
      continue;
    }
    const newMatch = line.match(/^\+\+\+ (?:b\/(.+)|\/dev\/null)$/);
    if (!newMatch) continue;
    const newFile = newMatch[1] ?? "/dev/null";
    if (oldFile === "/dev/null" && newFile !== "/dev/null") created.add(newFile);
    if (oldFile !== null && oldFile !== "/dev/null" && newFile === "/dev/null") deleted.add(oldFile);
  }
  return { created: [...created], deleted: [...deleted] };
}

export function applyPatchInWorktree(args: {
  cwd: string;
  config: MmcConfig;
  taskId: string;
  patch: string;
  allowedFiles: string[];
}): PatchApplyResult {
  const attempt_id = `A-${randomUUID().slice(0, 8)}`;
  const root = missionDir(args.cwd, args.config);
  const worktree_path = path.join(root, "worktrees", `${args.taskId}-${attempt_id}`);
  const patch_path = path.join(root, "artifacts", `${attempt_id}.patch`);
  const patchText = coerceToUnifiedDiff(args.patch, args.cwd, args.allowedFiles);
  fs.mkdirSync(path.dirname(patch_path), { recursive: true });
  fs.writeFileSync(patch_path, patchText, "utf8");
  recordArtifact(args.cwd, args.config, {
    attempt_id,
    type: "patch",
    path: patch_path,
    summary: `model patch for ${args.taskId}`,
  });

  const validation = validatePatchScope(patchText, args.allowedFiles);
  if (!validation.scope_clean) {
    return { attempt_id, status: "failed_scope", worktree_path, patch_path, validation, worktree_mode: "directory_copy" };
  }

  const worktree_mode = createIsolatedWorkspace(args.cwd, worktree_path, args.config);
  const preflight = runPatchCommand(worktree_path, patchText, true);
  if (preflight.status !== 0) {
    return {
      attempt_id,
      status: "failed_apply",
      worktree_path,
      patch_path,
      validation,
      worktree_mode,
      stderr: formatPatchCommandFailure("patch preflight failed", preflight),
    };
  }
  const result = runPatchCommand(worktree_path, patchText, false);
  if (result.status !== 0) {
    resetFailedPatchWorkspace(args.cwd, worktree_path, worktree_mode);
    return {
      attempt_id,
      status: "failed_apply",
      worktree_path,
      patch_path,
      validation,
      worktree_mode,
      stderr: formatPatchCommandFailure("patch apply failed", result),
    };
  }
  return { attempt_id, status: "applied", worktree_path, patch_path, validation, worktree_mode };
}

function runPatchCommand(worktreePath: string, patchText: string, dryRun: boolean): ReturnType<typeof spawnSync> {
  return spawnSync("patch", ["-p1", "--forward", ...(dryRun ? ["--dry-run"] : [])], {
    cwd: worktreePath,
    input: patchText,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
}

function formatPatchCommandFailure(prefix: string, result: ReturnType<typeof spawnSync>): string {
  const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  return detail ? `${prefix}\n${detail}` : prefix;
}

function resetFailedPatchWorkspace(source: string, worktreePath: string, mode: "git_worktree" | "directory_copy"): void {
  if (mode === "git_worktree") {
    spawnSync("git", ["reset", "--hard", "HEAD"], { cwd: worktreePath, encoding: "utf8" });
    spawnSync("git", ["clean", "-fd"], { cwd: worktreePath, encoding: "utf8" });
    return;
  }
  fs.rmSync(worktreePath, { recursive: true, force: true });
  copyWorkspace(source, worktreePath);
}

function extractReplacementFile(output: string): string {
  const fence = output.match(/```(?:[A-Za-z0-9_-]+)?\s*\n([\s\S]*?)```/);
  return fence?.[1]?.trimEnd().concat("\n") ?? output.trim().concat("\n");
}

function extractFencedPatch(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed.startsWith("```")) return null;
  const withoutOpeningFence = trimmed.replace(/^```[A-Za-z0-9_-]*\s*\n/, "");
  const content = withoutOpeningFence.replace(/\n```\s*$/, "").trim();
  if (!content) return null;
  return /^(diff --git |--- a\/)/.test(content) ? content.concat("\n") : null;
}

function looksLikeWholeFileReplacement(original: string, replacement: string): boolean {
  const originalLines = original.trimEnd().split(/\r?\n/).length;
  const replacementLines = replacement.trimEnd().split(/\r?\n/).length;
  if (originalLines > 5 && replacementLines < Math.max(3, Math.floor(originalLines * 0.5))) return false;
  if (/\bexport\b/.test(original) && !/\bexport\b/.test(replacement)) return false;
  if (/\bimport\b/.test(original) && !/\bimport\b/.test(replacement)) return false;
  return true;
}

function makeUnifiedDiff(file: string, original: string, replacement: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mmc-diff-"));
  const oldFile = path.join(tmp, "old");
  const newFile = path.join(tmp, "new");
  fs.writeFileSync(oldFile, original, "utf8");
  fs.writeFileSync(newFile, replacement, "utf8");
  const result = spawnSync("diff", ["-u", "--label", `a/${file}`, "--label", `b/${file}`, oldFile, newFile], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  if (result.status !== 0 && result.status !== 1) return replacement;
  return result.stdout;
}

function createIsolatedWorkspace(source: string, target: string, config: MmcConfig): "git_worktree" | "directory_copy" {
  if (config.harness.use_worktrees && isGitRepo(source)) {
    const add = spawnSync("git", ["worktree", "add", "--detach", target, "HEAD"], {
      cwd: source,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 10,
    });
    if (add.status === 0) return "git_worktree";
  }
  copyWorkspace(source, target);
  return "directory_copy";
}

function isGitRepo(cwd: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() === "true";
}

function copyWorkspace(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (shouldIgnoreWorkspaceEntry(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(from, to, { recursive: true, filter: (src) => !pathContainsIgnoredWorkspaceDir(path.relative(source, src)) });
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}
