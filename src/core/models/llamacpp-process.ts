import fs from "node:fs";
import { spawnSync } from "node:child_process";

export type LlamaCppPidRecord = {
  pid: number;
  host?: string;
  port?: number;
  model_path?: string;
  binary_path?: string;
  started_at?: string;
};

export type LlamaCppPidExpectation = {
  host?: string;
  port?: number;
  model_path?: string | null;
  binary_path?: string | null;
};

export function readOwnedPidRecord(file: string, expected: LlamaCppPidExpectation): LlamaCppPidRecord | null {
  const record = readPidRecord(file);
  return record && isOwnedPidRecord(record, expected) ? record : null;
}

export function cleanupUnownedPid(file: string, expected: LlamaCppPidExpectation): void {
  const record = readPidRecord(file);
  if (!record?.pid) return;
  if (!isProcessAlive(record.pid) || !isOwnedPidRecord(record, expected)) removeFileIfExists(file);
}

export function writePidRecord(file: string, record: LlamaCppPidRecord): void {
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export function readPidRecord(file: string): LlamaCppPidRecord | null {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return null;
  const numeric = Number.parseInt(text, 10);
  if (Number.isInteger(numeric) && String(numeric) === text) return { pid: numeric };
  try {
    const parsed = JSON.parse(text) as LlamaCppPidRecord;
    return Number.isInteger(parsed.pid) ? parsed : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await delay(100);
  }
  return !isProcessAlive(pid);
}

export function removeFileIfExists(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Ignore cleanup races.
  }
}

export function isOwnedPidRecord(record: LlamaCppPidRecord, expected: LlamaCppPidExpectation): boolean {
  if (!Number.isInteger(record.pid) || record.pid <= 0) return false;
  if (record.host !== expected.host || record.port !== expected.port) return false;
  if (expected.model_path && record.model_path !== expected.model_path) return false;
  if (expected.binary_path && record.binary_path !== expected.binary_path) return false;
  if (!record.binary_path && !record.model_path) return false;
  const command = processCommand(record.pid);
  if (!command) return false;
  if (record.binary_path && !command.includes(record.binary_path)) return false;
  if (record.model_path && !command.includes(record.model_path)) return false;
  return true;
}

function processCommand(pid: number): string | null {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
