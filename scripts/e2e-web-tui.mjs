import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const port = 4300 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const root = process.cwd();
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "microcoder-web-e2e-"));
const proofDir = path.join(workspace, ".mission", "proof", "web-pty");
const launcher = path.join(root, "bin", "microcoder.js");
fs.mkdirSync(proofDir, { recursive: true });

function runSetup(args) {
  const result = spawnSync(process.execPath, [launcher, ...args], {
    cwd: workspace,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) throw new Error(`setup command failed: microcoder ${args.join(" ")}\n${output}`);
  return output;
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) throw new Error(`${label} missing ${JSON.stringify(expected)}\n${value}`);
}

function assertNotIncludes(value, unexpected, label) {
  if (value.includes(unexpected)) throw new Error(`${label} unexpectedly included ${JSON.stringify(unexpected)}\n${value}`);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function launchBrowser() {
  const attempts = [
    { label: "playwright-chromium", options: { headless: true } },
    { label: "msedge", options: { channel: "msedge", headless: true } },
    { label: "chrome", options: { channel: "chrome", headless: true } },
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launch(attempt.options);
    } catch (error) {
      errors.push(`${attempt.label}: ${error.message}`);
    }
  }
  throw new Error(`could not launch a Playwright browser; install one with npx playwright install chromium or install Microsoft Edge/Chrome\n${errors.join("\n")}`);
}

fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
runSetup(["init"]);
runSetup(["setup", "web", "--enabled", "false", "--auto", "false", "--chat", "false"]);

const child = spawn(process.execPath, [launcher, "web", "--port", String(port)], {
  cwd: workspace,
  env: { ...process.env, MMC_WEB_TUI_PROOF_DIR: proofDir },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString("utf8");
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString("utf8");
});

async function getJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
  return await response.json();
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`web TUI exited early with ${child.exitCode}\n${output}`);
    try {
      const health = await getJson("/health");
      if (health.ok) return health;
      lastError = JSON.stringify(health);
    } catch (error) {
      lastError = error.message;
    }
    await delay(200);
  }
  throw new Error(`web TUI did not start: ${lastError}\n${output}`);
}

async function waitForOutput(expected) {
  const deadline = Date.now() + 15000;
  let latest = "";
  while (Date.now() < deadline) {
    const data = await getJson("/output");
    latest = data.output ?? "";
    if (latest.includes(expected)) return data;
    await delay(200);
  }
  throw new Error(`timed out waiting for ${JSON.stringify(expected)}\n${latest}`);
}

async function sendBrowserCommand(page, text) {
  await page.getByLabel("command").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

async function shutdown() {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await delay(250);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

try {
  const health = await waitForServer();
  if (!output.includes(`Microcoder PTY Console ${baseUrl}`)) {
    throw new Error(`server banner did not advertise ${baseUrl}\n${output}`);
  }

  const forbidden = await fetch(`${baseUrl}/send`, { method: "POST", body: "/build status\n" });
  if (forbidden.status !== 403) throw new Error(`unauthenticated /send returned ${forbidden.status}, expected 403`);

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Microcoder PTY Console" }).waitFor();
  const startup = await waitForOutput("Hey. What do you want to build?");
  assertNotIncludes(startup.output, "Microcoder Build Console", "startup");
  assertNotIncludes(startup.output, "Routes", "startup");
  assertNotIncludes(startup.output, "Commands:", "startup");

  await sendBrowserCommand(page, "what can you do?");
  await waitForOutput("Tell me what you want to build in plain English");

  await sendBrowserCommand(page, "snake game");
  const planned = await waitForOutput("I have a build plan.");
  assertIncludes(planned.output, "Next: say `build it`", "chat plan");
  assertNotIncludes(planned.output, "spec_id", "interactive chat plan");
  assertNotIncludes(planned.output, "compiled_spec", "interactive chat plan");

  await sendBrowserCommand(page, "what are we building?");
  const planDetails = await waitForOutput("Goal: Build a browser Snake game");
  assertIncludes(planDetails.output, "What it will do:", "plan details");
  assertIncludes(planDetails.output, "Done when:", "plan details");

  const artifactState = await getJson("/artifacts");
  const artifactPaths = artifactState.artifacts.map((item) => item.path);
  for (const required of ["spec.json", "chat/spec-chat.md", "chat/spec-chat.json"]) {
    if (!artifactPaths.includes(required)) throw new Error(`artifact endpoint missed ${required}: ${JSON.stringify(artifactPaths)}`);
  }

  await sendBrowserCommand(page, "/build start");
  const buildOutput = await waitForOutput("status active");
  assertIncludes(buildOutput.output, "Starting build from the compiled spec.", "build start");
  assertIncludes(buildOutput.output, "build_id", "build start");

  await page.screenshot({ path: path.join(proofDir, "web-pty-final.png"), fullPage: true });
  await page.getByRole("button", { name: "Exit" }).click();
  await browser.close();

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && child.exitCode === null) await delay(200);
  if (child.exitCode !== 0) throw new Error(`web TUI did not exit cleanly; code=${child.exitCode}\n${output}`);
  if (processIsAlive(health.pid)) throw new Error(`inner TUI process is still alive: pid ${health.pid}`);

  const proofJson = path.join(proofDir, "web-pty-proof.json");
  const proofTranscript = path.join(proofDir, "web-pty-transcript.txt");
  const proofScreenshot = path.join(proofDir, "web-pty-final.png");
  for (const file of [proofJson, proofTranscript, proofScreenshot]) {
    if (!fs.existsSync(file)) throw new Error(`missing proof artifact ${file}`);
  }
  const proof = JSON.parse(fs.readFileSync(proofJson, "utf8"));
  const proofArtifacts = proof.artifacts.map((item) => item.path);
  for (const required of ["spec.json", "mission.json", "task_graph.json", "chat/spec-chat.md"]) {
    if (!proofArtifacts.includes(required)) throw new Error(`proof artifact manifest missed ${required}: ${JSON.stringify(proofArtifacts)}`);
  }
  if (!proof.transcript.some((event) => event.event === "input" && event.text.includes("snake game"))) {
    throw new Error("proof transcript did not record browser-driven input");
  }

  console.log(`browser web TUI e2e passed; proof_dir=${proofDir}`);
} finally {
  await shutdown();
}
