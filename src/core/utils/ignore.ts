import path from "node:path";

export const IGNORED_WORKSPACE_DIRS = new Set([
  ".git",
  ".mission",
  ".gauntlet",
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".turbo",
  "build",
]);

export const IGNORED_WORKSPACE_FILES = new Set([".DS_Store", "gauntlet-report.md"]);

export function shouldIgnoreWorkspaceEntry(name: string): boolean {
  return IGNORED_WORKSPACE_DIRS.has(name) || IGNORED_WORKSPACE_FILES.has(name);
}

export function pathContainsIgnoredWorkspaceDir(filePath: string): boolean {
  return filePath.split(path.sep).some((part) => IGNORED_WORKSPACE_DIRS.has(part));
}
