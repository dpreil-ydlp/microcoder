import fs from "node:fs";
import path from "node:path";
import type { MmcConfig } from "../config/defaults.js";
import { missionDir } from "../storage/sqlite.js";

export type EscalationDecision = {
  action: "continue" | "ask_user" | "retry_with_strategy_change" | "escalate";
  reason: string;
  repeated_failure_count: number;
};

export function evaluateEscalation(cwd: string, config: MmcConfig, taskId: string): EscalationDecision {
  const repeated_failure_count = countRecentFailedAttempts(cwd, config, taskId);
  if (repeated_failure_count >= 3) {
    return {
      action: "escalate",
      reason: "three consecutive failed attempts for the same task",
      repeated_failure_count,
    };
  }
  if (repeated_failure_count >= 2) {
    return {
      action: "retry_with_strategy_change",
      reason: "two consecutive failed attempts; next run must change strategy or request more evidence",
      repeated_failure_count,
    };
  }
  return { action: "continue", reason: "no repeated failure loop detected", repeated_failure_count };
}

export function countRecentFailedAttempts(cwd: string, config: MmcConfig, taskId: string): number {
  const file = path.join(missionDir(cwd, config), "attempts.jsonl");
  if (!fs.existsSync(file)) return 0;
  const attempts = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { task_id?: string; status?: string })
    .filter((attempt) => attempt.task_id === taskId)
    .reverse();

  let count = 0;
  for (const attempt of attempts) {
    if (attempt.status === "failed" || attempt.status === "reverted") {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}
