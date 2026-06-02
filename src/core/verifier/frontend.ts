import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { MmcConfig } from "../config/defaults.js";
import { missionDir } from "../storage/sqlite.js";
import { recordArtifact } from "../artifacts/store.js";
import type { DesignPacketV2 } from "../design/brain.js";

export type FrontendVerificationResult = {
  status: "passed" | "failed" | "blocked";
  summary: string;
  artifacts: string[];
};

export async function runFrontendVerification(
  cwd: string,
  config: MmcConfig,
  designPacket: DesignPacketV2,
  appCwd = cwd,
): Promise<FrontendVerificationResult> {
  const artifactDir = path.join(missionDir(cwd, config), "artifacts", "visual");
  fs.mkdirSync(artifactDir, { recursive: true });
  const logPath = path.join(artifactDir, `${designPacket.task_id}-frontend-verification.json`);

  if (!config.verification.playwright_enabled) {
    return writeResult(cwd, config, logPath, {
      status: "blocked",
      summary: "Playwright disabled by hardware/config policy",
      artifacts: [],
    });
  }

  if (!config.verification.app_url || !config.verification.app_start_command) {
    return writeResult(cwd, config, logPath, {
      status: "blocked",
      summary: "Playwright verification requires verification.app_start_command and verification.app_url",
      artifacts: [],
    });
  }

  let appProcess: ChildProcess | null = null;
  let browser: BrowserLike | null = null;
  try {
    assertSafeStartCommand(config.verification.app_start_command);
    appProcess = spawn(config.verification.app_start_command, {
      cwd: appCwd,
      shell: true,
      stdio: "ignore",
      detached: true,
    });
    await waitForUrl(config.verification.app_url, 8000);

    const playwright = await (import("playwright") as Promise<{
      chromium: { launch: (options?: Record<string, unknown>) => Promise<BrowserLike> };
    }>);
    browser = await launchBrowser(playwright.chromium);
    const page = await browser.newPage({ viewport: parseViewport(designPacket.viewports[0] ?? "390x844") });
    const consoleErrors: string[] = [];
    page.on("console", (message: ConsoleMessageLike) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const response = await page.goto(config.verification.app_url, { waitUntil: "domcontentloaded", timeout: 10000 });
    const screenshot = path.join(artifactDir, `${designPacket.task_id}-390x844.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await closeBrowser(browser);
    browser = null;
    stopProcess(appProcess);
    appProcess = null;
    const status = response?.ok() && consoleErrors.length === 0 ? "passed" : "failed";
    return writeResult(cwd, config, logPath, {
      status,
      summary: status === "passed" ? "route loaded without console errors" : `route failed or console errors: ${consoleErrors.join("; ")}`,
      artifacts: [screenshot],
    });
  } catch (error) {
    if (browser) await closeBrowser(browser);
    if (appProcess) stopProcess(appProcess);
    return writeResult(cwd, config, logPath, {
      status: "blocked",
      summary: `Playwright unavailable or failed to run: ${(error as Error).message}`,
      artifacts: [],
    });
  }
}

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`app did not become ready at ${url}: ${lastError}`);
}

function stopProcess(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
    setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // Already stopped.
      }
    }, 500).unref();
  } catch {
    if (!child.killed) child.kill("SIGTERM");
  }
}

async function closeBrowser(browser: BrowserLike): Promise<void> {
  try {
    await browser.close();
  } catch {
    // Verification cleanup should not mask the verification result.
  }
}

function assertSafeStartCommand(command: string): void {
  const blocked = [
    /\bnpm\s+install\b/,
    /\bpnpm\s+(add|install)\b/,
    /\byarn\s+add\b/,
    /\brm\s+-rf\b/,
    /\bgit\s+push\b/,
    /\bdeploy\b/,
    /\bcurl\b.*\|\s*(sh|bash)\b/,
  ];
  const hit = blocked.find((pattern) => pattern.test(command));
  if (hit) throw new Error(`blocked app_start_command: ${command}`);
}

type BrowserLike = {
  newPage(options: { viewport: { width: number; height: number } }): Promise<PageLike>;
  close(): Promise<void>;
};

async function launchBrowser(chromium: { launch: (options?: Record<string, unknown>) => Promise<BrowserLike> }): Promise<BrowserLike> {
  const attempts: Array<{ label: string; options: Record<string, unknown> }> = [
    { label: "playwright-chromium", options: {} },
    { label: "msedge", options: { channel: "msedge" } },
    { label: "chrome", options: { channel: "chrome" } },
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launch(attempt.options);
    } catch (error) {
      errors.push(`${attempt.label}: ${(error as Error).message}`);
    }
  }
  throw new Error(`could not launch a Playwright browser; install one with npx playwright install chromium or install Microsoft Edge/Chrome\n${errors.join("\n")}`);
}

type PageLike = {
  on(event: "console", handler: (message: ConsoleMessageLike) => void): void;
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<{ ok(): boolean } | null>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<void>;
};

type ConsoleMessageLike = {
  type(): string;
  text(): string;
};

function writeResult(
  cwd: string,
  config: MmcConfig,
  logPath: string,
  result: FrontendVerificationResult,
): FrontendVerificationResult {
  fs.writeFileSync(logPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  recordArtifact(cwd, config, {
    attempt_id: null,
    type: "frontend_verification",
    path: logPath,
    summary: result.summary,
  });
  return { ...result, artifacts: [...result.artifacts, logPath] };
}

function parseViewport(value: string): { width: number; height: number } {
  const [width, height] = value.split("x").map((part) => Number.parseInt(part, 10));
  return { width: width || 390, height: height || 844 };
}
