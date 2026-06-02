import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const launcher = path.join(root, "bin", "microcoder.js");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "microcoder-uat-gauntlet-"));
const artifactRoot = path.join(root, ".gauntlet", "uat", runId);
const caseRoot = path.join(artifactRoot, "cases");
const cases = [];
const failures = [];
const flags = new Set(process.argv.slice(2));
const runCliCases = !flags.has("--browser-only");
const runBrowserCases = !flags.has("--cli-only");
let activeCase = null;
let caseCounter = 0;

if (flags.has("--cli-only") && flags.has("--browser-only")) {
  throw new Error("--cli-only and --browser-only are mutually exclusive");
}

fs.mkdirSync(caseRoot, { recursive: true });

function record(name, status, detail = {}) {
  cases.push({ name, status, ...detail });
}

function fail(name, message, detail = {}) {
  failures.push({ name, message, ...detail });
  record(name, "fail", { message, ...detail });
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function makeWorkspace(name) {
  const cwd = path.join(suiteRoot, slug(name));
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
  return cwd;
}

function runMicrocoder(cwd, args, options = {}) {
  const result = spawnSync(process.execPath, [launcher, ...args], {
    cwd,
    encoding: "utf8",
    timeout: options.timeout ?? 30000,
    input: options.input,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  const commandResult = {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
  recordCommand(args, commandResult);
  return commandResult;
}

function recordCommand(args, result) {
  if (!activeCase) return;
  activeCase.commands.push({
    argv: ["microcoder", ...args],
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

function initWorkspace(cwd) {
  const init = runMicrocoder(cwd, ["init"]);
  if (init.status !== 0) throw new Error(`init failed\n${init.output}`);
  const setup = runMicrocoder(cwd, ["setup", "web", "--enabled", "false", "--auto", "false", "--chat", "false"]);
  if (setup.status !== 0) throw new Error(`setup web failed\n${setup.output}`);
}

function runTui(cwd, text) {
  return runMicrocoder(cwd, ["tui", "--command", text]);
}

function runMicrocoderAsync(cwd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [launcher, ...args], {
      cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeout ?? 30000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      const commandResult = {
        status,
        signal,
        stdout,
        stderr,
        output: `${stdout}${stderr}`,
      };
      recordCommand(args, commandResult);
      resolve(commandResult);
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function runTuiAsync(cwd, text) {
  return runMicrocoderAsync(cwd, ["tui", "--command", text]);
}

function assertStatus(name, result, expected) {
  if (result.status !== expected) {
    throw new Error(`${name} exit ${result.status}, expected ${expected}\n${result.output}`);
  }
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) throw new Error(`${label} missing ${JSON.stringify(expected)}\n${value}`);
}

function assertNotIncludes(value, unexpected, label) {
  if (value.includes(unexpected)) throw new Error(`${label} unexpectedly included ${JSON.stringify(unexpected)}\n${value}`);
}

function assertFile(cwd, relativePath) {
  const file = path.join(cwd, relativePath);
  if (!fs.existsSync(file)) throw new Error(`missing file ${relativePath}`);
  return file;
}

function specs(cwd) {
  const dir = path.join(cwd, ".mission", "specs");
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function readJson(cwd, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(cwd, relativePath), "utf8"));
}

async function caseRun(name, fn) {
  const caseId = `${String(++caseCounter).padStart(2, "0")}-${slug(name)}`;
  const cwd = makeWorkspace(caseId);
  const caseDir = path.join(caseRoot, caseId);
  fs.mkdirSync(caseDir, { recursive: true });
  const previousCase = activeCase;
  activeCase = { dir: caseDir, commands: [] };
  try {
    initWorkspace(cwd);
    await fn(cwd, { caseDir, caseId });
    record(name, "pass", { cwd, artifact_dir: path.relative(root, caseDir) });
  } catch (error) {
    fail(name, error.message, { cwd, artifact_dir: path.relative(root, caseDir) });
  } finally {
    const commands = activeCase.commands;
    fs.writeFileSync(path.join(caseDir, "commands.json"), `${JSON.stringify(commands, null, 2)}\n`);
    fs.writeFileSync(path.join(caseDir, "stdout.txt"), commands.map((command) => command.stdout).join("\n--- command ---\n"));
    fs.writeFileSync(path.join(caseDir, "stderr.txt"), commands.map((command) => command.stderr).join("\n--- command ---\n"));
    activeCase = previousCase;
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function startFakeSearchServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url?.startsWith("/search")) {
      const url = new URL(request.url, "http://127.0.0.1");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          results: [
            {
              title: `Browser game standards for ${url.searchParams.get("q")}`,
              url: "https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API",
              snippet: "Canvas games need keyboard controls, a visible score, restart behavior, and clear game-over state.",
            },
          ],
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/search?q={q}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
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

if (runCliCases) {
await caseRun("greeting stays short and stateless", (cwd) => {
  const result = runTui(cwd, "hi");
  assertStatus("greeting", result, 0);
  if (result.stdout.trim() !== "Hey. What do you want to build?") throw new Error(`bad greeting\n${result.output}`);
  if (fs.existsSync(path.join(cwd, ".mission", "chat", "spec-chat.json"))) throw new Error("greeting created chat state");
});

await caseRun("capability answer is conversational and stateless", (cwd) => {
  const result = runTui(cwd, "what can you do?");
  assertStatus("capability", result, 0);
  assertIncludes(result.stdout, "Tell me what you want to build in plain English", "capability");
  assertNotIncludes(result.stdout, "spec_id", "capability");
  assertNotIncludes(result.stdout, "chat_status", "capability");
  if (fs.existsSync(path.join(cwd, ".mission", "chat", "spec-chat.json"))) throw new Error("capability created chat state");
});

await caseRun("confused input before brief asks for the build", (cwd) => {
  for (const prompt of ["??", "what?", "huh"]) {
    const result = runTui(cwd, prompt);
    assertStatus(`confused ${prompt}`, result, 0);
    assertIncludes(result.stdout, "Tell me what you want to build, in one concrete sentence.", `confused ${prompt}`);
    if (fs.existsSync(path.join(cwd, ".mission", "chat", "spec-chat.json"))) throw new Error(`${prompt} created chat state`);
  }
});

await caseRun("vague dashboard request asks focused follow-up questions", (cwd) => {
  const result = runTui(cwd, "make the dashboard better");
  assertStatus("vague dashboard", result, 0);
  assertIncludes(result.stdout, "I need a little more before I can build it well.", "vague dashboard");
  assertIncludes(result.stdout, "What proves it is done?", "vague dashboard");
  assertNotIncludes(result.stdout, "I have a build plan.", "vague dashboard");
  if (fs.existsSync(path.join(cwd, ".mission", "spec.json"))) throw new Error("vague dashboard compiled a spec");
});

await caseRun("generic app request does not pretend it has enough detail", (cwd) => {
  const result = runTui(cwd, "build me an app");
  assertStatus("generic app", result, 0);
  assertIncludes(result.stdout, "I need a little more before I can build it well.", "generic app");
  assertIncludes(result.stdout, "What proves it is done?", "generic app");
  assertNotIncludes(result.stdout, "I have a build plan.", "generic app");
  if (fs.existsSync(path.join(cwd, ".mission", "spec.json"))) throw new Error("generic app request compiled a spec");
});

await caseRun("todo list request compiles with sane defaults", (cwd) => {
  const result = runTui(cwd, "build me a todo list");
  assertStatus("todo list", result, 0);
  assertIncludes(result.stdout, "I have a build plan.", "todo list");
  assertIncludes(result.stdout, "Next: say `build it`", "todo list");
  assertNotIncludes(result.stdout, "Which exact user-visible behavior should change?", "todo list");
  assertNotIncludes(result.stdout, "What proves it is done?", "todo list");
  const spec = fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8");
  assertIncludes(spec, "Add a todo item with a title", "todo list spec");
  assertIncludes(spec, "Mark todos complete or active again", "todo list spec");
  assertIncludes(spec, "Todo items stored locally", "todo list spec");
});

await caseRun("todo list request replaces stale vague collecting brief", (cwd) => {
  const vague = runTui(cwd, "make the dashboard better");
  assertStatus("stale vague", vague, 0);
  assertIncludes(vague.stdout, "I need a little more before I can build it well.", "stale vague");
  const result = runTui(cwd, "build me a todo list");
  assertStatus("todo after stale vague", result, 0);
  assertIncludes(result.stdout, "I have a build plan.", "todo after stale vague");
  assertNotIncludes(result.stdout, "Which exact user-visible behavior should change?", "todo after stale vague");
  const state = readJson(cwd, ".mission/chat/spec-chat.json");
  if (state.brief.goal !== "Build a local todo list app") throw new Error(`stale vague goal was not replaced: ${state.brief.goal}`);
});

await caseRun("simple snake request compiles cleanly without technical TUI leakage", (cwd) => {
  const result = runTui(cwd, "snake game");
  assertStatus("snake", result, 0);
  assertIncludes(result.stdout, "I have a build plan.", "snake");
  assertIncludes(result.stdout, "Next: say `build it`", "snake");
  for (const forbidden of ["spec_id", "compiled_spec", "chat_status", "$ microcoder chat"]) {
    assertNotIncludes(result.stdout, forbidden, "snake");
  }
  assertFile(cwd, ".mission/spec.json");
  const state = readJson(cwd, ".mission/chat/spec-chat.json");
  if (state.status !== "compiled") throw new Error(`snake state not compiled: ${state.status}`);
});

await caseRun("compiled plan questions inspect without recompiling", (cwd) => {
  const first = runTui(cwd, "snake game");
  assertStatus("compile snake", first, 0);
  const before = specs(cwd);
  for (const question of ["what are we building?", "show me the plan", "what is the spec?", "what's in scope?"]) {
    const result = runTui(cwd, question);
    assertStatus(question, result, 0);
    assertIncludes(result.stdout, "Build plan", question);
    assertIncludes(result.stdout, "Goal: Build a browser Snake game", question);
    assertNotIncludes(result.stdout, "compiled_spec", question);
  }
  const after = specs(cwd);
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`plan questions recompiled specs: ${before} -> ${after}`);
});

await caseRun("compiled confused follow-up stays helpful and does not recompile", (cwd) => {
  assertStatus("compile snake", runTui(cwd, "snake game"), 0);
  const before = specs(cwd);
  for (const prompt of ["??", "what?", "huh"]) {
    const result = runTui(cwd, prompt);
    assertStatus(`compiled confused ${prompt}`, result, 0);
    assertIncludes(result.stdout, "I already have the build plan.", `compiled confused ${prompt}`);
    assertIncludes(result.stdout, "say `build it` to start", `compiled confused ${prompt}`);
  }
  if (JSON.stringify(specs(cwd)) !== JSON.stringify(before)) throw new Error("compiled confused follow-up recompiled specs");
});

await caseRun("approval phrases start the existing build", (cwd) => {
  const phrases = ["go ahead", "yes, start building", "run with that", "looks good, build it"];
  for (const phrase of phrases) {
    const isolated = makeWorkspace(`approval ${phrase}`);
    initWorkspace(isolated);
    assertStatus("compile snake", runTui(isolated, "snake game"), 0);
    const before = specs(isolated);
    const result = runTui(isolated, phrase);
    assertStatus(phrase, result, 0);
    assertIncludes(result.stdout, "Starting build from the compiled spec.", phrase);
    assertIncludes(result.stdout, "status active", phrase);
    if (JSON.stringify(specs(isolated)) !== JSON.stringify(before)) throw new Error(`${phrase} recompiled specs`);
  }
});

await caseRun("active build status blocks confused drift", (cwd) => {
  assertStatus("compile snake", runTui(cwd, "snake game"), 0);
  assertStatus("build it", runTui(cwd, "build it"), 0);
  const result = runTui(cwd, "??");
  assertStatus("active confused", result, 0);
  assertIncludes(result.stdout, "Build already active.", "active confused");
  assertIncludes(result.stdout, "Next: run `/build step` or `/build run`.", "active confused");
});

await caseRun("new object-bearing goal during active build creates a separate brief", (cwd) => {
  assertStatus("compile snake", runTui(cwd, "snake game"), 0);
  assertStatus("build it", runTui(cwd, "build it"), 0);
  const mission = readJson(cwd, ".mission/mission.json");
  const result = runTui(cwd, "make a todo tracker");
  assertStatus("new goal active", result, 0);
  assertIncludes(result.stdout, "I have a build plan.", "new goal active");
  assertIncludes(result.stdout, "Existing build still active:", "new goal active");
  assertIncludes(result.stdout, mission.mission_id, "new goal active");
  const state = readJson(cwd, ".mission/chat/spec-chat.json");
  assertIncludes(state.brief.goal ?? "", "todo list", "new goal state");
});

await caseRun("new buildable goal during active build warns and does not overwrite active build", (cwd) => {
  assertStatus("compile snake", runTui(cwd, "snake game"), 0);
  assertStatus("build it", runTui(cwd, "build it"), 0);
  const mission = readJson(cwd, ".mission/mission.json");
  const result = runTui(cwd, "build snake");
  assertStatus("new buildable active", result, 0);
  assertIncludes(result.stdout, "Existing build still active:", "new buildable active");
  assertIncludes(result.stdout, mission.mission_id, "new buildable active");
  const after = readJson(cwd, ".mission/mission.json");
  if (after.mission_id !== mission.mission_id) throw new Error("new buildable goal overwrote active build");
});

await caseRun("chat reset clears the brief and does not touch active build", (cwd) => {
  assertStatus("compile snake", runTui(cwd, "snake game"), 0);
  assertStatus("build it", runTui(cwd, "build it"), 0);
  const mission = readJson(cwd, ".mission/mission.json");
  const reset = runMicrocoder(cwd, ["chat", "reset"]);
  assertStatus("chat reset", reset, 0);
  const status = runMicrocoder(cwd, ["chat", "status"]);
  assertStatus("chat status", status, 0);
  assertIncludes(status.stdout, "goal none", "chat reset status");
  const after = readJson(cwd, ".mission/mission.json");
  if (after.mission_id !== mission.mission_id) throw new Error("chat reset changed active build");
});

await caseRun("web research off does not create standards context", (cwd) => {
  const result = runTui(cwd, "snake game");
  assertStatus("web off", result, 0);
  const draft = fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.md"), "utf8");
  assertNotIncludes(draft, "## Standards Context", "web off draft");
});

await caseRun("web standards context uses deterministic fake search once", async (cwd) => {
  const fake = await startFakeSearchServer();
  try {
    const setup = runMicrocoder(cwd, [
      "setup",
      "web",
      "--enabled",
      "true",
      "--auto",
      "true",
      "--chat",
      "true",
      "--provider",
      "custom_json",
      "--url",
      fake.url,
      "--timeout",
      "2",
      "--max-results",
      "2",
    ]);
    assertStatus("setup fake search", setup, 0);
    const result = await runTuiAsync(cwd, "snake game");
    assertStatus("fake search snake", result, 0);
    assertIncludes(result.stdout, "I checked current web references and saved the source notes with it.", "fake search snake");
    const draft = fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.md"), "utf8");
    assertIncludes(draft, "## Standards Context", "fake search draft");
    assertIncludes(draft, "Browser game standards", "fake search draft");
    if (fake.requests.length !== 1) throw new Error(`expected one fake search request, got ${fake.requests.length}: ${fake.requests.join(", ")}`);
    const inspect = await runTuiAsync(cwd, "what are we building?");
    assertStatus("fake search inspect", inspect, 0);
    if (fake.requests.length !== 1) throw new Error(`inspection caused another fake search request: ${fake.requests.length}`);
  } finally {
    await fake.close();
  }
});

await caseRun("slash commands stay readable and scoped", (cwd) => {
  const status = runTui(cwd, "/chat status");
  assertStatus("slash chat status", status, 0);
  assertIncludes(status.stdout, "$ microcoder chat status", "slash chat status");
  assertIncludes(status.stdout, "goal none", "slash chat status");

  assertStatus("compile snake", runTui(cwd, "snake game"), 0);
  const reset = runTui(cwd, "/chat reset");
  assertStatus("slash chat reset", reset, 0);
  assertIncludes(reset.stdout, "$ microcoder chat reset", "slash chat reset");
  assertIncludes(reset.stdout, "Build", "slash chat reset snapshot");
  assertIncludes(reset.stdout, "Brief", "slash chat reset snapshot");

  const unknown = runTui(cwd, "/probe-extra test_writer");
  if (unknown.status === 0) throw new Error(`unknown slash command succeeded\n${unknown.output}`);
  assertIncludes(unknown.stderr, "Unknown TUI command. Use /help.", "unknown slash command");
});

await caseRun("scripted stdin session preserves interactive behavior", (cwd) => {
  const result = runMicrocoder(cwd, [], { input: "hi\nsnake game\nwhat are we building?\nbuild it\n/exit\n" });
  assertStatus("stdin session", result, 0);
  assertIncludes(result.stdout, "Hey. What do you want to build?", "stdin session");
  assertIncludes(result.stdout, "I have a build plan.", "stdin session");
  assertIncludes(result.stdout, "Goal: Build a browser Snake game", "stdin session");
  assertIncludes(result.stdout, "status active", "stdin session");
});
}

async function runBrowserPtyCase() {
  await caseRun("browser PTY proves the real interactive surface", async (cwd) => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proofDir = path.join(artifactRoot, "browser-pty");
    fs.mkdirSync(proofDir, { recursive: true });

    const child = spawn(process.execPath, [launcher, "web", "--port", String(port)], {
      cwd,
      env: { ...process.env, MMC_WEB_TUI_PROOF_DIR: proofDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverOutput = "";
    child.stdout.on("data", (chunk) => {
      serverOutput += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      serverOutput += chunk.toString("utf8");
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
        if (child.exitCode !== null) throw new Error(`web TUI exited early with ${child.exitCode}\n${serverOutput}`);
        try {
          const health = await getJson("/health");
          if (health.ok) return health;
          lastError = JSON.stringify(health);
        } catch (error) {
          lastError = error.message;
        }
        await delay(200);
      }
      throw new Error(`web TUI did not start: ${lastError}\n${serverOutput}`);
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

    let browser;
    try {
      const health = await waitForServer();
      if (!serverOutput.includes(`Microcoder PTY Console ${baseUrl}`)) {
        throw new Error(`server banner did not advertise ${baseUrl}\n${serverOutput}`);
      }

      const forbidden = await fetch(`${baseUrl}/send`, { method: "POST", body: "/build status\n" });
      if (forbidden.status !== 403) throw new Error(`unauthenticated /send returned ${forbidden.status}, expected 403`);

      browser = await launchBrowser();
      const page = await browser.newPage();
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Microcoder PTY Console" }).waitFor();
      await waitForOutput("Microcoder Build Console");

      await sendBrowserCommand(page, "what can you do?");
      await waitForOutput("Tell me what you want to build in plain English");

      await sendBrowserCommand(page, "snake game");
      const planned = await waitForOutput("I have a build plan.");
      assertIncludes(planned.output, "Next: say `build it`", "browser chat plan");
      assertNotIncludes(planned.output, "spec_id", "browser chat plan");
      assertNotIncludes(planned.output, "compiled_spec", "browser chat plan");

      await sendBrowserCommand(page, "what are we building?");
      const planDetails = await waitForOutput("Goal: Build a browser Snake game");
      assertIncludes(planDetails.output, "What it will do:", "browser plan details");
      assertIncludes(planDetails.output, "Done when:", "browser plan details");

      const artifactState = await getJson("/artifacts");
      const artifactPaths = artifactState.artifacts.map((item) => item.path);
      for (const required of ["spec.json", "chat/spec-chat.md", "chat/spec-chat.json"]) {
        if (!artifactPaths.includes(required)) throw new Error(`artifact endpoint missed ${required}: ${JSON.stringify(artifactPaths)}`);
      }

      await sendBrowserCommand(page, "build it");
      const buildOutput = await waitForOutput("status active");
      assertIncludes(buildOutput.output, "Starting build from the compiled spec.", "browser build start");
      assertIncludes(buildOutput.output, "build_id", "browser build start");

      await page.screenshot({ path: path.join(proofDir, "web-pty-final.png"), fullPage: true });
      await page.getByRole("button", { name: "Exit" }).click();
      await browser.close();
      browser = null;

      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && child.exitCode === null) await delay(200);
      if (child.exitCode !== 0) throw new Error(`web TUI did not exit cleanly; code=${child.exitCode}\n${serverOutput}`);
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
    } finally {
      if (browser) await browser.close();
      fs.writeFileSync(path.join(proofDir, "web-pty-server-output.txt"), serverOutput);
      await shutdown();
    }
  });
}

if (runBrowserCases) {
  await runBrowserPtyCase();
}

const report = {
  run_id: runId,
  generated_at: new Date().toISOString(),
  suite_root: suiteRoot,
  artifact_root: artifactRoot,
  case_count: cases.length,
  failure_count: failures.length,
  cases,
  failures,
};
fs.writeFileSync(path.join(artifactRoot, "conversation-uat-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(
  path.join(artifactRoot, "conversation-uat-report.md"),
  [
    "# Microcoder Conversation UAT Gauntlet",
    "",
    `Run: ${runId}`,
    `Cases: ${cases.length}`,
    `Failures: ${failures.length}`,
    `Workspace root: ${suiteRoot}`,
    "",
    ...cases.map((item) => `- ${item.status === "pass" ? "PASS" : "FAIL"} ${item.name}${item.message ? `: ${item.message}` : ""}`),
    "",
  ].join("\n"),
);

if (failures.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(`conversation UAT gauntlet passed: cases=${cases.length} artifacts=${artifactRoot}`);
