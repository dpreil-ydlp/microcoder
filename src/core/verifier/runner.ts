import { spawn } from "node:child_process";
import type { MmcConfig } from "../config/defaults.js";

export type CommandResult = {
  command: string;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  started_at: string;
  ended_at: string;
};

export type VerificationResult = {
  passed: boolean;
  results: CommandResult[];
  summary: string;
};

const HARD_BLOCK_PATTERNS = [
  /\bnpm\s+install\b/,
  /\bpnpm\s+(add|install)\b/,
  /\byarn\s+add\b/,
  /\brm\s+-rf\b/,
  /\bgit\s+push\b/,
  /\bdeploy\b/,
  /\bcurl\b.*\|\s*(sh|bash)\b/,
  /\b(drop|truncate)\s+database\b/i,
];

export function validateCommandAllowed(command: string, config: MmcConfig): void {
  if (HARD_BLOCK_PATTERNS.some((pattern) => pattern.test(command))) {
    throw Object.assign(new Error(`blocked command: ${command}`), { code: "COMMAND_BLOCKED" });
  }
  const allowed = config.harness.allowed_commands.some((prefix) => command === prefix || command.startsWith(`${prefix} `));
  if (!allowed) {
    throw Object.assign(new Error(`command not in allowlist: ${command}`), { code: "COMMAND_BLOCKED" });
  }
}

export async function runVerificationPlan(cwd: string, config: MmcConfig, commands: string[]): Promise<VerificationResult> {
  const selected = commands.length ? commands : ["npm test"];
  const results: CommandResult[] = [];
  for (const command of selected) {
    validateCommandAllowed(command, config);
    results.push(await runCommand(cwd, command, config.harness.command_timeout_seconds));
    const last = results.at(-1);
    if (last?.exit_code === 0 && !last.timed_out) {
      continue;
    }
    if (config.verification.targeted_tests_first) break;
  }
  const passed = results.every((result) => result.exit_code === 0 && !result.timed_out);
  return {
    passed,
    results,
    summary: passed ? "all verifier commands passed" : summarizeFailure(results),
  };
}

export function runCommand(cwd: string, command: string, timeoutSeconds: number): Promise<CommandResult> {
  const started_at = new Date().toISOString();
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timed_out = false;
    const timeout = setTimeout(() => {
      timed_out = true;
      killProcessGroup(child.pid, "SIGTERM");
      setTimeout(() => killProcessGroup(child.pid, "SIGKILL"), 500).unref();
    }, timeoutSeconds * 1000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        command,
        exit_code: code,
        timed_out,
        stdout: redact(stdout),
        stderr: redact(stderr),
        started_at,
        ended_at: new Date().toISOString(),
      });
    });
  });
}

function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Process already exited.
    }
  }
}

function summarizeFailure(results: CommandResult[]): string {
  const failed = results.find((result) => result.exit_code !== 0 || result.timed_out);
  if (!failed) return "verification failed";
  return `${failed.command} failed with exit=${failed.exit_code}${failed.timed_out ? " timeout=true" : ""}`;
}

export function redact(value: string): string {
  return value
    .replaceAll(/(api[_-]?key|token|secret|password)=([^\s]+)/gi, "$1=[REDACTED]")
    .replaceAll(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_OPENAI_KEY]")
    .replaceAll(/[A-Za-z0-9_=-]{20,}\.[A-Za-z0-9_=-]{20,}\.[A-Za-z0-9_=-]{20,}/g, "[REDACTED_JWT]");
}
