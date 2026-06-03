import {
  applyPatchInWorktree,
  buildDocsPacket,
  buildPhasePacket,
  capture,
  coerceToUnifiedDiff,
  compileSpecInput,
  countOccurrences,
  createValidator,
  databasePath,
  describe,
  expect,
  freePort,
  fs,
  handleInternalApi,
  initializeDatabase,
  it,
  loadConfig,
  parseTuiCommand,
  probeModelProvider,
  path,
  routeModel,
  runCli,
  runVerificationPlan,
  saveConfig,
  schemaFixtures,
  selectOpenDesignAssets,
  spawn,
  startFakeLlamaHttpServer,
  startFakeSearchServer,
  tempWorkspace,
  validateCommandAllowed,
  validateConfig,
  validatePatchScope,
  vi,
  writeFakeLlamaServer,
} from "./support.js";
import { buildStartupMessage, buildStartupResumePrompt } from "../../src/cli/tui.js";

describe("Micro Mission Coder runtime - chat and TUI", () => {
async function configureFakeChatSearch(cwd: string): Promise<{ requests: string[]; close: () => Promise<void> }> {
  const fake = await startFakeSearchServer();
  const loaded = loadConfig(cwd);
  loaded.config.web_research.enabled = true;
  loaded.config.web_research.auto_include_in_chat = true;
  loaded.config.web_research.provider = "custom_json";
  loaded.config.web_research.search_url = fake.url;
  loaded.config.web_research.max_results = 3;
  loaded.config.web_research.timeout_seconds = 2;
  saveConfig(cwd, loaded.config);
  return fake;
}

async function configureFakeCodeWriter(cwd: string, options: { delayMs?: number } = {}): Promise<{ close: () => Promise<void> }> {
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
  fs.writeFileSync(path.join(cwd, "model.gguf"), "fake model placeholder\n");
  const fake = await startFakeLlamaHttpServer(
    [
      "diff --git a/README.md b/README.md",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/README.md",
      "@@ -0,0 +1,2 @@",
      "+# Snake",
      "+Local browser game scaffold.",
      "",
    ].join("\n"),
    { delayMs: options.delayMs },
  );
  const loaded = loadConfig(cwd);
  loaded.config.models.provider_default = "llamacpp";
  loaded.config.models.llamacpp.host = "127.0.0.1";
  loaded.config.models.llamacpp.port = fake.port;
  loaded.config.models.llamacpp.timeout_seconds = 2;
  loaded.config.models.llamacpp.auto_start = false;
  loaded.config.models.llamacpp.model_paths.code_writer = "model.gguf";
  saveConfig(cwd, loaded.config);
  return fake;
}

async function configureFakeInterfaceModel(cwd: string, responseText: string): Promise<{ requests: string[]; close: () => Promise<void> }> {
  fs.writeFileSync(path.join(cwd, "interface.gguf"), "fake interface model placeholder\n");
  const fake = await startFakeLlamaHttpServer(responseText);
  const loaded = loadConfig(cwd);
  loaded.config.models.role_overrides = { ...(loaded.config.models.role_overrides ?? {}), interface: "liquid-lfm2-1.2b" };
  loaded.config.models.llamacpp.host = "127.0.0.1";
  loaded.config.models.llamacpp.port = fake.port;
  loaded.config.models.llamacpp.timeout_seconds = 2;
  loaded.config.models.llamacpp.auto_start = false;
  loaded.config.models.llamacpp.model_paths.interface = "interface.gguf";
  loaded.config.web_research.enabled = false;
  loaded.config.web_research.auto_include_in_chat = false;
  loaded.config.web_research.auto_include_in_docs = false;
  (loaded.config as typeof loaded.config & {
    chat: {
      interface_model: {
        enabled: boolean;
        require_explicit_route: boolean;
        timeout_seconds: number;
        fallback_to_heuristics: boolean;
        minimum_confidence: number;
      };
    };
  }).chat = {
    interface_model: {
      enabled: true,
      require_explicit_route: true,
      timeout_seconds: 2,
      fallback_to_heuristics: true,
      minimum_confidence: 0.55,
    },
  };
  saveConfig(cwd, loaded.config);
  return fake;
}

async function configureFakeInterfaceAndCodeWriter(
  cwd: string,
  interfaceResponseText: string,
): Promise<{ requests: string[]; close: () => Promise<void> }> {
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
  fs.writeFileSync(path.join(cwd, "model.gguf"), "fake code model placeholder\n");
  fs.writeFileSync(path.join(cwd, "interface.gguf"), "fake interface model placeholder\n");
  const codePatch = [
    "diff --git a/README.md b/README.md",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/README.md",
    "@@ -0,0 +1,2 @@",
    "+# Snake",
    "+Local browser game scaffold.",
    "",
  ].join("\n");
  const fake = await startFakeLlamaHttpServer((requestBody) => {
    if (requestBody.includes("COMPILED_PLAN_CONTROL") || requestBody.includes("compiled_plan_control")) {
      return interfaceResponseText;
    }
    return codePatch;
  });
  const loaded = loadConfig(cwd);
  loaded.config.models.provider_default = "llamacpp";
  loaded.config.models.role_overrides = { ...(loaded.config.models.role_overrides ?? {}), interface: "liquid-lfm2-1.2b" };
  loaded.config.models.llamacpp.host = "127.0.0.1";
  loaded.config.models.llamacpp.port = fake.port;
  loaded.config.models.llamacpp.timeout_seconds = 2;
  loaded.config.models.llamacpp.auto_start = false;
  loaded.config.models.llamacpp.model_paths.code_writer = "model.gguf";
  loaded.config.models.llamacpp.model_paths.interface = "interface.gguf";
  loaded.config.web_research.enabled = false;
  loaded.config.web_research.auto_include_in_chat = false;
  loaded.config.web_research.auto_include_in_docs = false;
  loaded.config.chat.interface_model.enabled = true;
  loaded.config.chat.interface_model.require_explicit_route = false;
  loaded.config.chat.interface_model.timeout_seconds = 2;
  loaded.config.chat.interface_model.fallback_to_heuristics = true;
  loaded.config.chat.interface_model.minimum_confidence = 0.55;
  saveConfig(cwd, loaded.config);
  return fake;
}

function shrinkCompiledSpecToOneTask(cwd: string): void {
  const specPath = path.join(cwd, ".mission", "spec.json");
  const result = JSON.parse(fs.readFileSync(specPath, "utf8")) as {
    task_graph: { tasks: Array<{ id: string; status: string; depends_on: string[]; allowed_files?: string[]; verification_commands?: string[] }> };
  };
  const first = result.task_graph.tasks[0];
  result.task_graph.tasks = [
    {
      ...first,
      status: "ready",
      depends_on: [],
      allowed_files: ["README.md"],
      verification_commands: ["npm test"],
    },
  ];
  fs.writeFileSync(specPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function shrinkActiveTaskGraphToOneTask(cwd: string): void {
  const graphPath = path.join(cwd, ".mission", "task_graph.json");
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as {
    tasks: Array<{ id: string; status: string; depends_on: string[]; allowed_files?: string[]; verification_commands?: string[] }>;
  };
  const first = graph.tasks[0];
  graph.tasks = [
    {
      ...first,
      status: "ready",
      depends_on: [],
      allowed_files: ["README.md"],
      verification_commands: ["npm test"],
    },
  ];
  fs.writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

function hideActiveBuildAsCompleted(cwd: string, goal: string): void {
  const missionPath = path.join(cwd, ".mission", "mission.json");
  const graphPath = path.join(cwd, ".mission", "task_graph.json");
  const mission = JSON.parse(fs.readFileSync(missionPath, "utf8")) as { goal: string; current_task_id?: string | null };
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as { tasks: Array<{ status: string }> };
  mission.goal = goal;
  mission.current_task_id = null;
  graph.tasks = graph.tasks.map((task) => ({ ...task, status: "complete" }));
  fs.writeFileSync(missionPath, `${JSON.stringify(mission, null, 2)}\n`, "utf8");
  fs.writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

it("help shows the single-word launcher", async () => {
    const cwd = tempWorkspace();
    const cap = capture();
    const code = await runCli(["--help"], { cwd, io: cap.io });
    expect(code).toBe(0);
    expect(cap.stdout.join("\n")).toContain("microcoder");
    expect(cap.stdout.join("\n")).toContain("microcoder web [--port 4180]");
    expect(cap.stdout.join("\n")).toContain("microcoder eval validate");
    expect(cap.stdout.join("\n")).toContain("Alias:");
    expect(cap.stdout.join("\n")).toContain("mmc <command>");
  });

it("tui snapshot renders build console without requiring an interactive terminal", async () => {
    const cwd = tempWorkspace();
    const cap = capture();
    expect(await runCli(["tui", "--snapshot"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("Microcoder Build Console");
    expect(output).toContain("/build run");
    expect(output).not.toContain("Mission Console");
  });

it("tui startup stays conversational instead of dumping the dashboard", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    expect(buildStartupMessage(cwd)).toBe("Hey. What do you want to build?");

    const emptyLaunch = capture();
    expect(await runCli(["tui"], { cwd, io: emptyLaunch.io })).toBe(0);
    const emptyOutput = emptyLaunch.stdout.join("\n");
    expect(emptyOutput).toBe("Hey. What do you want to build?");
    expect(emptyOutput).not.toContain("Microcoder Build Console");
    expect(emptyOutput).not.toContain("Routes");
    expect(emptyOutput).not.toContain("Commands:");

    const fake = await configureFakeChatSearch(cwd);
    try {
      expect(await runCli(["tui", "--command", "build me a todo list"], { cwd, io: capture().io })).toBe(0);
      const startup = buildStartupMessage(cwd);
      expect(startup).toContain("I have a build plan from earlier: Build a local todo list app.");
      expect(startup).toContain("Say `build it` to start");
      expect(startup).not.toContain("Microcoder Build Console");
      expect(startup).not.toContain("Routes");
      expect(startup).not.toContain("Commands:");

      const reset = capture();
      expect(await runCli(["tui", "--command", "let's start over."], { cwd, io: reset.io })).toBe(0);
      const resetOutput = reset.stdout.join("\n");
      expect(resetOutput).toContain("Okay. Starting fresh.");
      expect(resetOutput).toContain("What do you want to build?");
      expect(resetOutput).not.toContain("I already have the build plan.");
      expect(buildStartupMessage(cwd)).toBe("Hey. What do you want to build?");
      expect(fs.existsSync(path.join(cwd, ".mission", "spec.json"))).toBe(false);
      const staleStart = capture();
      expect(await runCli(["build", "start"], { cwd, io: staleStart.io })).toBe(1);
      expect(staleStart.stderr.join("\n")).toContain("compiled spec not found");

      expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
      const restartWithGoal = capture();
      expect(await runCli(["tui", "--command", "start over and build a todo list"], { cwd, io: restartWithGoal.io })).toBe(0);
      const restartOutput = restartWithGoal.stdout.join("\n");
      expect(restartOutput).toContain("Okay. Starting fresh.");
      expect(restartOutput).toContain("I have a build plan.");
      const spec = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8")) as { spec: { goal: string } };
      expect(spec.spec.goal).toBe("Build a local todo list app");
    } finally {
      await fake.close();
    }
  });

it("tui command parser maps build commands and legacy mission aliases to mmc commands", () => {
    expect(parseTuiCommand("/build step")).toEqual(expect.objectContaining({
      kind: "run",
      argv: ["build", "step"],
      refreshAfter: true,
    }));
    expect(parseTuiCommand("/build run 3")).toEqual(expect.objectContaining({
      kind: "run",
      argv: ["build", "run", "3"],
      refreshAfter: true,
    }));
    expect(parseTuiCommand("/build start")).toEqual(expect.objectContaining({
      kind: "run",
      argv: ["build", "start"],
      refreshAfter: false,
    }));
    expect(parseTuiCommand("/mission step")).toEqual(expect.objectContaining({ argv: ["build", "step"] }));
    expect(parseTuiCommand("/probe test_writer")).toEqual({
      kind: "run",
      argv: ["models", "probe", "test_writer"],
      refreshAfter: false,
    });
    expect(parseTuiCommand("/models")).toEqual({
      kind: "run",
      argv: ["models", "status"],
      refreshAfter: false,
    });
    expect(parseTuiCommand("/models set code_writer qwen2.5-coder:3b")).toEqual({
      kind: "run",
      argv: ["models", "set", "code_writer", "qwen2.5-coder:3b"],
      refreshAfter: true,
    });
    expect(parseTuiCommand("/models profile constrained_16gb")).toEqual({
      kind: "run",
      argv: ["models", "profile", "constrained_16gb"],
      refreshAfter: true,
    });
    expect(parseTuiCommand("build a snake game that I can run in my browser")).toEqual({
      kind: "run",
      argv: ["chat", "--interactive", "build a snake game that I can run in my browser"],
      refreshAfter: false,
      echo: false,
    });
    expect(parseTuiCommand("hi")).toEqual({
      kind: "message",
      message: "Hey. What do you want to build?",
    });
    expect(parseTuiCommand("h")).toEqual({
      kind: "message",
      message: "Hey. What do you want to build?",
    });
    expect(parseTuiCommand("build it")).toEqual({
      kind: "run",
      argv: ["chat", "--interactive", "build it"],
      refreshAfter: false,
      echo: false,
    });
    expect(parseTuiCommand("/chat status")).toEqual({
      kind: "run",
      argv: ["chat", "status"],
      refreshAfter: false,
    });
    expect(parseTuiCommand("/chat I need a CRM for sales reps")).toEqual({
      kind: "run",
      argv: ["chat", "--interactive", "I need a CRM for sales reps"],
      refreshAfter: false,
      echo: false,
    });
    expect(parseTuiCommand("/patch apply A-123")).toEqual({
      kind: "run",
      argv: ["patch", "apply", "--attempt", "A-123"],
      refreshAfter: true,
    });
    expect(() => parseTuiCommand("/probe-extra test_writer")).toThrow("Unknown TUI command");
    expect(() => parseTuiCommand("/build run nope")).toThrow("Invalid /build run max-tasks");
    expect(() => parseTuiCommand("/build run 0")).toThrow("Invalid /build run max-tasks");
    expect(() => parseTuiCommand("/build run 1 extra")).toThrow("Invalid /build run usage");
  });

it("tui command mode executes commands and refreshes the dashboard", async () => {
    const cwd = tempWorkspace();
    const cap = capture();
    expect(await runCli(["tui", "--command", "/init"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("initialized");
    expect(output).toContain("Microcoder Build Console");
    expect(fs.existsSync(path.join(cwd, ".mission"))).toBe(true);
  });

it("tui startup asks whether to resume an unfinished build", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(buildStartupResumePrompt(cwd)).toBe(null);
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    const prompt = buildStartupResumePrompt(cwd);
    expect(prompt).toContain("I found a paused build: Build a browser Snake game.");
    expect(prompt).toContain("Progress: 0/5 done");
    expect(prompt).toContain("Do you want to continue building it or start fresh?");
    expect(prompt).not.toContain("..");
    } finally {
      await fake.close();
    }
  });

it("tui continues a paused build from normal language", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fakeSearch = await configureFakeChatSearch(cwd);
    let fakeModel: Awaited<ReturnType<typeof configureFakeCodeWriter>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    shrinkCompiledSpecToOneTask(cwd);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    fakeModel = await configureFakeCodeWriter(cwd);
    const cap = capture();
    expect(await runCli(["tui", "--command", "continue"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("Continuing build: Build a browser Snake game.");
    expect(output).toContain("build_task_start T1");
    expect(output).toContain("verification passed");
    expect(output).toContain("build_complete completed_tasks=1");
    expect(output).toContain("Build finished.");
    expect(output).not.toContain("Microcoder Build Console");
    expect(buildStartupResumePrompt(cwd)).toBe(null);
    } finally {
      if (fakeModel) await fakeModel.close();
      await fakeSearch.close();
    }
  });

it("tui start fresh archives a paused build and resets the brief", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    const mission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };

    const cap = capture();
    expect(await runCli(["tui", "--command", "start fresh"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("Okay. I set aside the paused build: Build a browser Snake game.");
    expect(output).toContain("What do you want to build?");
    expect(fs.existsSync(path.join(cwd, ".mission", "mission.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".mission", "task_graph.json"))).toBe(false);
    const archivedMission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "archived_builds", mission.mission_id, "mission.json"), "utf8")) as { status: string };
    expect(archivedMission.status).toBe("archived");
    const status = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "current_state.json"), "utf8")) as { status: string };
    expect(status.status).toBe("initialized");
    expect(buildStartupResumePrompt(cwd)).toBe(null);
    } finally {
      await fake.close();
    }
  });

it("tui cancel all paused builds archives the visible paused build", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    let fakeInterface: Awaited<ReturnType<typeof configureFakeInterfaceModel>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    const mission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };
    fakeInterface = await configureFakeInterfaceModel(
      cwd,
      JSON.stringify({
        kind: "discard-build",
        reply: "Okay. I will cancel the paused build.",
        reason: "User asked to cancel all paused builds.",
      }),
    );

    const cap = capture();
    expect(await runCli(["tui", "--command", "cancel all paused builds"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("Okay. I will cancel the paused build.");
    expect(output).toContain("Okay. I set aside the paused build: Build a browser Snake game.");
    expect(output).toContain("What do you want to build?");
    expect(output).not.toContain("Build in progress:");
    expect(output).not.toContain("Say `continue`");
    expect(fs.existsSync(path.join(cwd, ".mission", "mission.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".mission", "archived_builds", mission.mission_id, "mission.json"))).toBe(true);
    expect(buildStartupResumePrompt(cwd)).toBe(null);
    expect(fakeInterface.requests.join("\n")).toContain("COMPILED_PLAN_CONTROL");
    expect(fakeInterface.requests.join("\n")).toContain("cancel all paused builds");
    } finally {
      if (fakeInterface) await fakeInterface.close();
      await fake.close();
    }
  });

it("compiled-plan controls ask the interface model before heuristic phrases", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fakeSearch = await configureFakeChatSearch(cwd);
    let fakeInterface: Awaited<ReturnType<typeof configureFakeInterfaceModel>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    fakeInterface = await configureFakeInterfaceModel(
      cwd,
      JSON.stringify({
        kind: "reset",
        reply: "I will set that plan aside.",
        reason: "The user wants to start fresh.",
      }),
    );

    const cap = capture();
    expect(await runCli(["tui", "--command", "start over"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I will set that plan aside.");
    expect(output).toContain("Okay. Starting fresh.");
    expect(output).toContain("What do you want to build?");
    expect(fs.existsSync(path.join(cwd, ".mission", "spec.json"))).toBe(false);
    expect(fakeInterface.requests.join("\n")).toContain("COMPILED_PLAN_CONTROL");
    expect(fakeInterface.requests.join("\n")).toContain("start over");
    } finally {
      if (fakeInterface) await fakeInterface.close();
      await fakeSearch.close();
    }
  });

it("tui start fresh for a visible compiled plan does not archive a hidden completed build", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    const missionBefore = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };
    hideActiveBuildAsCompleted(cwd, "Update dashboard frontend copy");

    expect(buildStartupResumePrompt(cwd)).toBe(null);
    const startup = buildStartupMessage(cwd);
    expect(startup).toContain("I have a build plan from earlier: Build a browser Snake game.");
    expect(startup).not.toContain("Update dashboard frontend copy");

    const cap = capture();
    expect(await runCli(["tui", "--command", "no"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("Okay. Starting fresh.");
    expect(output).toContain("What do you want to build?");
    expect(output).not.toContain("set aside");
    expect(output).not.toContain("Update dashboard frontend copy");

    const missionAfter = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string; goal: string };
    expect(missionAfter.mission_id).toBe(missionBefore.mission_id);
    expect(missionAfter.goal).toBe("Update dashboard frontend copy");
    expect(fs.existsSync(path.join(cwd, ".mission", "archived_builds", missionBefore.mission_id, "mission.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".mission", "spec.json"))).toBe(false);
    expect(buildStartupMessage(cwd)).toBe("Hey. What do you want to build?");
    } finally {
      await fake.close();
    }
  });

it("tui conversational start-over phrasing archives a paused build", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    const mission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };

    const cap = capture();
    expect(await runCli(["tui", "--command", "let's start over"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("Okay. I set aside the paused build: Build a browser Snake game.");
    expect(output).toContain("What do you want to build?");
    expect(output).not.toContain("Build already active.");
    expect(fs.existsSync(path.join(cwd, ".mission", "mission.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".mission", "archived_builds", mission.mission_id, "mission.json"))).toBe(true);
    } finally {
      await fake.close();
    }
  });

it("chat treats short approvals as build starts only after a plan exists", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });

    const cap = capture();
    expect(await runCli(["tui", "--command", "go"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I don't have a build plan yet. What do you want to build?");
    expect(output).not.toContain("Starting build from the compiled spec.");
    expect(fs.existsSync(path.join(cwd, ".mission", "spec.json"))).toBe(false);
  });

it("chat refuses build-start language before a plan exists", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });

    const cap = capture();
    expect(await runCli(["tui", "--command", "build it"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I don't have a build plan yet. What do you want to build?");
    expect(output).not.toContain("I have a build plan.");
    expect(output).not.toContain("Starting build from the compiled spec.");
    expect(fs.existsSync(path.join(cwd, ".mission", "spec.json"))).toBe(false);
  });

it("chat collects an app brief before compiling a buildable spec", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    const first = capture();
    expect(await runCli(["chat", "I want to build a custom client workflow app for freelance designers"], { cwd, io: first.io })).toBe(2);
    expect(first.stdout.join("\n")).toContain("I need a little more before I can build it well");
    expect(first.stdout.join("\n")).toContain("Tell me:");
    expect(fs.existsSync(path.join(cwd, ".mission", "chat", "spec-chat.json"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, ".mission", "chat", "spec-chat.md"))).toBe(true);

    const second = capture();
    expect(
      await runCli(
        [
          "chat",
          [
            "Users are solo designers who need to track leads and projects.",
            "Workflows: create a client, add project notes, filter active leads.",
            "Acceptance: npm test passes and the browser app shows a client list with empty and populated states.",
          ].join(" "),
        ],
        { cwd, io: second.io },
      ),
    ).toBe(0);
    const output = second.stdout.join("\n");
    expect(output).toContain("I have a build plan.");
    expect(output).toContain("I checked current web references and saved the source notes with it.");
    expect(output).toContain("compiled_spec");
    expect(fake.requests.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(cwd, ".mission", "spec.json"))).toBe(true);
    const compiled = fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8");
    expect(compiled).toContain("custom client workflow app");
    expect(compiled).toContain("client list");
    expect(fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.md"), "utf8")).toContain("## Standards Context");
    } finally {
      await fake.close();
    }
  });

it("chat handles a simple Snake game with useful defaults instead of generic data questions", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    const cap = capture();
    expect(await runCli(["tui", "--command", "let's build a snake game"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).not.toContain("$ microcoder chat");
    expect(output).toContain("I have a build plan.");
    expect(output).toContain("I checked current web references and saved the source notes with it.");
    expect(output).not.toContain("spec_id");
    expect(output).not.toContain("compiled_spec");
    expect(output).not.toContain("chat_status");
    expect(output).not.toContain("What data does it store");
    expect(fake.requests.length).toBe(1);
    const spec = fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8");
    expect(spec).toContain("Play Snake on a grid with keyboard controls");
    expect(spec).toContain("No accounts, backend, or persistent storage unless requested");
    expect(fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.md"), "utf8")).toContain("https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API");
    const compiled = JSON.parse(spec) as { task_graph: { tasks: Array<{ title: string }> } };
    expect(compiled.task_graph.tasks[0]?.title).toMatch(/\b(Create|Build|Implement)\b/i);
    expect(compiled.task_graph.tasks[0]?.title).toMatch(/\bSnake\b/i);
    expect(compiled.task_graph.tasks[0]?.title).not.toMatch(/^Serve\b/i);
    } finally {
      await fake.close();
    }
  });

it("chat handles a todo list with useful defaults instead of weird clarification questions", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    const cap = capture();
    expect(await runCli(["tui", "--command", "build me a todo list"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I have a build plan.");
    expect(output).not.toContain("Which exact user-visible behavior should change?");
    expect(output).not.toContain("What proves it is done?");
    expect(fake.requests.length).toBe(1);
    const spec = fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8");
    expect(spec).toContain("Build a local todo list app");
    expect(spec).toContain("Add a todo item with a title");
    expect(spec).toContain("Mark todos complete or active again");
    expect(spec).toContain("Todo items stored locally with title and completion state");
    } finally {
      await fake.close();
    }
  });

it("tui startup resumes a partial brief conversationally", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });

    const vague = capture();
    expect(await runCli(["tui", "--command", "make the dashboard better"], { cwd, io: vague.io })).toBe(0);
    expect(vague.stdout.join("\n")).toContain("I need a little more before I can build it well.");

    const startup = buildStartupMessage(cwd);
    expect(startup).toContain("We're shaping: make the dashboard better");
    expect(startup).toContain("Which exact user-visible behavior should change?");
    expect(startup).not.toContain("Microcoder Build Console");
    expect(startup).not.toContain("Routes");
  });

it("chat handles natural app requests without exact bare-name matching", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    const cap = capture();
    expect(await runCli(["tui", "--command", "I need a todo app"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I have a build plan.");
    expect(output).not.toContain("What proves it is done?");
    const spec = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8")) as {
      spec: { goal: string; requirements: Array<{ text: string }> };
    };
    expect(spec.spec.goal).toContain("todo list");
    expect(spec.spec.requirements.map((item) => item.text).join("\n")).toContain("Mark todos complete or active again");
    } finally {
      await fake.close();
    }
  });

it("chat understands natural habit logging as a tracker request", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    const cap = capture();
    expect(await runCli(["tui", "--command", "I want to log my habits"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I have a build plan.");
    const spec = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8")) as {
      spec: { goal: string; requirements: Array<{ text: string }> };
    };
    expect(spec.spec.goal).toContain("habit tracker");
    expect(spec.spec.requirements.map((item) => item.text).join("\n")).toContain("Check off habits for the current day");
    } finally {
      await fake.close();
    }
  });

it("chat can use the interface model for non-catalog build understanding", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeInterfaceModel(
      cwd,
      JSON.stringify({
        kind: "build",
        reply: "I can shape that into a local grant-review app.",
        goal: "Build a grant application reviewer for nonprofits",
        users: "Nonprofit grant reviewers",
        workflows: [
          "Create grant applications with applicant, amount, and requested program",
          "Score applications against review criteria",
          "Filter applications by review status",
        ],
        data: ["Local grant applications with applicant, amount, score, and review status"],
        acceptance: ["The browser app can add, score, and filter grant applications, and npm test passes"],
        constraints: ["No accounts, backend, or cloud sync unless requested"],
        risk_flags: ["frontend"],
        unresolved_risks: [],
      }),
    );
    try {
    const cap = capture();
    expect(await runCli(["tui", "--command", "build a grant application reviewer for nonprofits"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I can shape that into a local grant-review app.");
    expect(output).toContain("I have a build plan.");
    expect(output).not.toContain("I need a little more before I can build it well.");
    const spec = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8")) as {
      spec: { goal: string; requirements: Array<{ text: string }> };
    };
    expect(spec.spec.goal).toContain("grant application reviewer");
    expect(spec.spec.requirements.map((item) => item.text).join("\n")).toContain("Score applications against review criteria");
    } finally {
      await fake.close();
    }
  });

it("chat lets scratch-that follow-ups replace a compiled plan", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    const cap = capture();
    expect(await runCli(["tui", "--command", "wait, scratch that, build a memory matching card game"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I have a build plan.");
    expect(output).not.toContain("I already have the build plan.");
    const spec = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8")) as {
      spec: { goal: string; requirements: Array<{ text: string }>; risk_flags: string[] };
    };
    expect(spec.spec.goal).toBe("Build a memory matching card game");
    expect(spec.spec.risk_flags).not.toContain("billing");
    expect(spec.spec.requirements.map((item) => item.text).join("\n")).toContain("Flip two cards at a time");
    } finally {
      await fake.close();
    }
  });

it("chat lets no-prefixed replacement follow-ups replace a compiled plan", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    const cap = capture();
    expect(await runCli(["tui", "--command", "no, build a todo list"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I have a build plan.");
    expect(output).not.toContain("I already have the build plan.");
    const spec = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8")) as { spec: { goal: string } };
    expect(spec.spec.goal).toBe("Build a local todo list app");
    } finally {
      await fake.close();
    }
  });

it("direct chat start-over with a new goal resets the old compiled plan before compiling", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    const cap = capture();
    expect(await runCli(["chat", "--interactive", "start over and build a todo list"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("Okay. Starting fresh.");
    expect(output).toContain("I have a build plan.");
    expect(output).not.toContain("I already have the build plan.");
    const spec = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8")) as { spec: { goal: string } };
    expect(spec.spec.goal).toBe("Build a local todo list app");
    } finally {
      await fake.close();
    }
  });

it("chat lets scratch-that follow-ups use the interface model for non-catalog plans", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeInterfaceModel(
      cwd,
      JSON.stringify({
        kind: "create app",
        reply: "Switching this to a grant-review app.",
        goal: "Build a grant application reviewer for nonprofits",
        users: "Nonprofit grant reviewers",
        workflows: [
          "Create grant applications with applicant, amount, and requested program",
          "Score applications against review criteria",
          "Filter applications by review status",
        ],
        data: ["Local grant applications with applicant, amount, score, and review status"],
        acceptance: ["The browser app can add, score, and filter grant applications, and npm test passes"],
        constraints: ["No accounts, backend, or cloud sync unless requested"],
        risk_flags: ["frontend"],
        unresolved_risks: [],
      }),
    );
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    const cap = capture();
    expect(await runCli(["tui", "--command", "wait, scratch that, build a grant application reviewer for nonprofits"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("Switching this to a grant-review app.");
    expect(output).toContain("I have a build plan.");
    expect(output).not.toContain("I already have the build plan.");
    const spec = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8")) as {
      spec: { goal: string; requirements: Array<{ text: string }> };
    };
    expect(spec.spec.goal).toBe("Build a grant application reviewer for nonprofits");
    expect(spec.spec.requirements.map((item) => item.text).join("\n")).toContain("Score applications against review criteria");
    } finally {
      await fake.close();
    }
  });

it("chat preserves user-stated modifiers when applying intent defaults", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    const cap = capture();
    expect(await runCli(["tui", "--command", "build a habit tracker with weekly summaries, streak view, and categories"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I have a build plan.");
    const state = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.json"), "utf8")) as {
      brief: { goal?: string; workflows: string[]; data: string[]; acceptance: string[] };
    };
    expect(state.brief.goal).toMatch(/weekly summaries/i);
    expect(state.brief.goal).toMatch(/streak view/i);
    expect(state.brief.goal).toMatch(/categories/i);
    const briefText = JSON.stringify(state.brief);
    expect(briefText).toMatch(/weekly summaries/i);
    expect(briefText).toMatch(/streak view/i);
    expect(briefText).toMatch(/categories/i);
    const compiled = fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8");
    expect(compiled).toMatch(/weekly summaries/i);
    expect(compiled).toMatch(/streak view/i);
    expect(compiled).toMatch(/categories/i);
    expect(fake.requests.length).toBe(1);
    } finally {
      await fake.close();
    }
  });

it("chat keeps security and external service risks fail-closed even with acceptance text", async () => {
    for (const prompt of [
      "build a password manager with acceptance: npm test passes and the browser app works",
      "build a weather app using a live weather API with acceptance: npm test passes and the browser app works",
    ]) {
      const cwd = tempWorkspace();
      await runCli(["init"], { cwd, io: capture().io });
      const cap = capture();
      expect(await runCli(["chat", prompt], { cwd, io: cap.io })).toBe(2);
      const output = cap.stdout.join("\n");
      expect(output).toContain("I need a little more before I can build it well.");
      expect(output).toContain("Tell me:");
      expect(fs.existsSync(path.join(cwd, ".mission", "spec.json"))).toBe(false);
      const state = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.json"), "utf8")) as {
        brief: { unresolved_risks?: string[]; risk_flags?: string[] };
      };
      expect(state.brief.unresolved_risks?.length ?? 0).toBeGreaterThan(0);
      expect(state.brief.risk_flags?.length ?? 0).toBeGreaterThan(0);
    }
  });

it("chat does not misclassify build-pipeline tracker requests as canned app trackers", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const cap = capture();
    expect(
      await runCli(["chat", "build a build pipeline tracker with stage status, logs, and retry history"], { cwd, io: cap.io }),
    ).toBe(0);
    const state = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.json"), "utf8")) as {
      brief: { goal?: string; workflows: string[]; data: string[] };
    };
    const briefText = JSON.stringify(state.brief);
    expect(state.brief.goal).toMatch(/build pipeline tracker/i);
    expect(briefText).toMatch(/stage status/i);
    expect(briefText).toMatch(/retry history/i);
    expect(briefText).not.toMatch(/habit tracker/i);
    expect(briefText).not.toMatch(/workout tracker/i);
    expect(briefText).not.toMatch(/inventory tracker/i);
  });

it("chat does not treat score/player trackers as games", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const cap = capture();
    expect(await runCli(["chat", "build a player score tracker with teams and history"], { cwd, io: cap.io })).toBe(0);
    const state = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.json"), "utf8")) as {
      brief: { goal?: string; workflows: string[]; data: string[] };
    };
    const briefText = JSON.stringify(state.brief);
    expect(state.brief.goal).toMatch(/player score tracker/i);
    expect(briefText).toMatch(/teams/i);
    expect(briefText).toMatch(/history/i);
    expect(briefText).not.toMatch(/browser game/i);
    expect(briefText).not.toMatch(/Start and play the game/i);
  });

it("chat keeps bare tracker domains specific instead of generic tracker goals", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const cap = capture();
    expect(await runCli(["chat", "habit tracker"], { cwd, io: cap.io })).toBe(0);
    const state = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.json"), "utf8")) as {
      brief: { goal?: string; workflows: string[]; data: string[] };
    };
    const briefText = JSON.stringify(state.brief);
    expect(state.brief.goal).toBe("Build a habit tracker");
    expect(briefText).toMatch(/Check off habits/i);
    expect(briefText).toMatch(/streak/i);
    expect(briefText).not.toMatch(/Build a local tracker app/i);
  });

it("chat does not turn generic reading lists into todo apps", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const cap = capture();
    expect(await runCli(["chat", "build a reading list app"], { cwd, io: cap.io })).toBe(2);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I need a little more before I can build it well.");
    expect(output).not.toContain("I have a build plan.");
    expect(fs.existsSync(path.join(cwd, ".mission", "spec.json"))).toBe(false);
    const state = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.json"), "utf8")) as {
      brief: { goal?: string; workflows: string[] };
    };
    expect(state.brief.goal).toMatch(/reading list app/i);
    expect(JSON.stringify(state.brief)).not.toMatch(/todo list app/i);
  });

it("chat keeps user workflow clauses when intent defaults also apply", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const cap = capture();
    expect(await runCli(["chat", "build a todo list that supports recurring tasks and archive view"], { cwd, io: cap.io })).toBe(0);
    const compiled = fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8");
    expect(compiled).toContain("Support recurring tasks");
    expect(compiled).toContain("Support archive view");
  });

it("chat replaces stale vague collecting state when the user gives a standard app request", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    const vague = capture();
    expect(await runCli(["tui", "--command", "make the dashboard better"], { cwd, io: vague.io })).toBe(0);
    expect(vague.stdout.join("\n")).toContain("I need a little more before I can build it well.");

    const cap = capture();
    expect(await runCli(["tui", "--command", "build me a todo list"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I have a build plan.");
    expect(output).not.toContain("Which exact user-visible behavior should change?");
    const state = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.json"), "utf8")) as { brief: { goal?: string } };
    expect(state.brief.goal).toBe("Build a local todo list app");
    expect(fake.requests.length).toBe(2);
    } finally {
      await fake.close();
    }
  });

it("tui keeps normal chat conversational before a build brief exists", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });

    const cap = capture();
    expect(await runCli(["tui", "--command", "what can you do?"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("Tell me what you want to build in plain English");
    expect(output).not.toContain("spec_id");
    expect(output).not.toContain("chat_status");
    expect(fs.existsSync(path.join(cwd, ".mission", "chat", "spec-chat.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".mission", "spec.json"))).toBe(false);
  });

it("tui handles first-minute meta and idea requests without creating chat state", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });

    for (const prompt of [
      "what is this?",
      "what's microcoder?",
      "how do I use you?",
      "what does this do?",
      "what can you help with?",
      "who are you?",
      "are you a chatbot?",
      "what can you do for me?",
      "help me",
      "what is this tool?",
    ]) {
      const cap = capture();
      expect(await runCli(["tui", "--command", prompt], { cwd, io: cap.io })).toBe(0);
      const output = cap.stdout.join("\n");
      expect(output).toContain("Tell me what you want to build in plain English");
      expect(output).not.toContain("What are we building");
    }

    const ideas = capture();
    expect(await runCli(["tui", "--command", "I don't know"], { cwd, io: ideas.io })).toBe(0);
    expect(ideas.stdout.join("\n")).toContain("Try one of these:");
    expect(fs.existsSync(path.join(cwd, ".mission", "chat", "spec-chat.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".mission", "spec.json"))).toBe(false);
  });

it("meta questions do not contaminate the next compiled spec", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "what can you help with?"], { cwd, io: capture().io })).toBe(0);
    expect(fs.existsSync(path.join(cwd, ".mission", "chat", "spec-chat.json"))).toBe(false);

    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    const spec = fs.readFileSync(path.join(cwd, ".mission", "spec.json"), "utf8");
    expect(spec).toContain("Build a browser Snake game");
    expect(spec).not.toContain("what can you help with");
    } finally {
      await fake.close();
    }
  });

it("direct chat start-over resets compiled and active state instead of starting a build", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    const compiledReset = capture();
    expect(await runCli(["chat", "--interactive", "start over"], { cwd, io: compiledReset.io })).toBe(0);
    expect(compiledReset.stdout.join("\n")).toContain("Okay. Starting fresh.");
    expect(compiledReset.stdout.join("\n")).toContain("What do you want to build?");
    expect(compiledReset.stdout.join("\n")).not.toContain("Starting build from the compiled spec.");
    expect(fs.existsSync(path.join(cwd, ".mission", "spec.json"))).toBe(false);

    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    const mission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };
    const activeReset = capture();
    expect(await runCli(["chat", "--interactive", "start over"], { cwd, io: activeReset.io })).toBe(0);
    expect(activeReset.stdout.join("\n")).toContain("Okay. I set aside the paused build: Build a browser Snake game.");
    expect(fs.existsSync(path.join(cwd, ".mission", "mission.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".mission", "archived_builds", mission.mission_id, "mission.json"))).toBe(true);
    } finally {
      await fake.close();
    }
  });

it("direct chat uses the interface model to cancel a paused build from normal language", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fakeSearch = await configureFakeChatSearch(cwd);
    let fakeInterface: Awaited<ReturnType<typeof configureFakeInterfaceModel>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    const mission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };
    fakeInterface = await configureFakeInterfaceModel(
      cwd,
      JSON.stringify({
        kind: "cancel_build",
        reply: "Okay. I will cancel the paused build.",
        reason: "User asked to cancel all paused builds.",
      }),
    );

    const cap = capture();
    expect(await runCli(["chat", "--interactive", "cancel all paused builds"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("Okay. I will cancel the paused build.");
    expect(output).toContain("Okay. I set aside the paused build: Build a browser Snake game.");
    expect(output).toContain("What do you want to build?");
    expect(output).not.toContain("Build in progress:");
    expect(fs.existsSync(path.join(cwd, ".mission", "mission.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".mission", "archived_builds", mission.mission_id, "mission.json"))).toBe(true);
    expect(fakeInterface.requests.join("\n")).toContain("COMPILED_PLAN_CONTROL");
    expect(fakeInterface.requests.join("\n")).toContain("cancel all paused builds");
    } finally {
      if (fakeInterface) await fakeInterface.close();
      await fakeSearch.close();
    }
  });

it("chat does not recompile an already compiled spec on confused follow-up text", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    const firstState = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.json"), "utf8")) as {
      compiled_spec_path: string;
    };
    const specsBefore = fs.readdirSync(path.join(cwd, ".mission", "specs"));

    const followUp = capture();
    expect(await runCli(["tui", "--command", "??"], { cwd, io: followUp.io })).toBe(0);
    const output = followUp.stdout.join("\n");
    expect(output).toContain("I already have the build plan.");
    expect(output).toContain("say `build it` to start");
    expect(output).not.toContain("I have a build plan.\nI checked current web references");
    const secondState = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "chat", "spec-chat.json"), "utf8")) as {
      compiled_spec_path: string;
    };
    expect(secondState.compiled_spec_path).toBe(firstState.compiled_spec_path);
    expect(fs.readdirSync(path.join(cwd, ".mission", "specs"))).toEqual(specsBefore);
    expect(fake.requests.length).toBe(1);
    } finally {
      await fake.close();
    }
  });

it("chat shows the compiled spec when asked what the spec is", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    const specsBefore = fs.readdirSync(path.join(cwd, ".mission", "specs"));

    const cap = capture();
    expect(await runCli(["tui", "--command", "what is the spec?"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("Build plan");
    expect(output).toContain("Goal: Build a browser Snake game");
    expect(output).toContain("What it will do:");
    expect(output).toContain("- Play Snake on a grid with keyboard controls");
    expect(output).toContain("Done when:");
    expect(output).not.toContain("compiled_spec");
    expect(output).not.toContain("To change the spec, run `/chat reset`");
    expect(fs.readdirSync(path.join(cwd, ".mission", "specs"))).toEqual(specsBefore);

    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    const activeCap = capture();
    expect(await runCli(["tui", "--command", "what is the spec?"], { cwd, io: activeCap.io })).toBe(0);
    expect(activeCap.stdout.join("\n")).toContain("Next: run `/build step` or `/build run`.");
    expect(activeCap.stdout.join("\n")).not.toContain("Next: run `/build start`.");
    expect(fake.requests.length).toBe(1);
    } finally {
      await fake.close();
    }
  });

it("chat answers natural plan questions after compile without recompiling", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
      expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
      const specsBefore = fs.readdirSync(path.join(cwd, ".mission", "specs"));

      for (const question of ["what are we building?", "what's the plan?", "show me the plan", "what's in scope?"]) {
        const cap = capture();
        expect(await runCli(["tui", "--command", question], { cwd, io: cap.io })).toBe(0);
        const output = cap.stdout.join("\n");
        expect(output).toContain("Build plan");
        expect(output).toContain("Build a browser Snake game");
      }

      expect(fs.readdirSync(path.join(cwd, ".mission", "specs"))).toEqual(specsBefore);
      expect(fake.requests.length).toBe(1);
    } finally {
      await fake.close();
    }
  });

it("chat treats conversational approval as build intent", async () => {
    for (const phrase of ["go", "let's go", "looks good, build it"]) {
      const cwd = tempWorkspace();
      await runCli(["init"], { cwd, io: capture().io });
      const fakeSearch = await configureFakeChatSearch(cwd);
      let fakeModel: Awaited<ReturnType<typeof configureFakeCodeWriter>> | null = null;
      try {
        expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
        shrinkCompiledSpecToOneTask(cwd);
        fakeModel = await configureFakeCodeWriter(cwd);
        const specsBefore = fs.readdirSync(path.join(cwd, ".mission", "specs"));
        const cap = capture();
        expect(await runCli(["tui", "--command", phrase], { cwd, io: cap.io })).toBe(0);
        const output = cap.stdout.join("\n");
        expect(output).toContain("Starting build from the compiled spec.");
        expect(output).toContain("build_task_start T1");
        expect(output).toContain("verification passed");
        expect(output).toContain("Build finished.");
        expect(fs.readdirSync(path.join(cwd, ".mission", "specs"))).toEqual(specsBefore);
        expect(fakeSearch.requests.length).toBe(2);
      } finally {
        if (fakeModel) await fakeModel.close();
        await fakeSearch.close();
      }
    }
  }, 20_000);

it("chat starts the current compiled plan from contextual continue language", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fakeSearch = await configureFakeChatSearch(cwd);
    let fakeModel: Awaited<ReturnType<typeof configureFakeCodeWriter>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    shrinkCompiledSpecToOneTask(cwd);
    fakeModel = await configureFakeCodeWriter(cwd);

    const build = capture();
    expect(await runCli(["tui", "--command", "let's continue that one"], { cwd, io: build.io })).toBe(0);
    const output = build.stdout.join("\n");
    expect(output).toContain("Starting build from the compiled spec.");
    expect(output).toContain("build_task_start T1");
    expect(output).toContain("verification passed");
    expect(output).toContain("Build finished.");
    expect(output).not.toContain("I already have the build plan.");
    } finally {
      if (fakeModel) await fakeModel.close();
      await fakeSearch.close();
    }
  }, 20_000);

it("chat asks the interface model to classify compiled-plan follow-up intent", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fakeSearch = await configureFakeChatSearch(cwd);
    let fakeModel: Awaited<ReturnType<typeof configureFakeInterfaceAndCodeWriter>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    shrinkCompiledSpecToOneTask(cwd);
    fakeModel = await configureFakeInterfaceAndCodeWriter(
      cwd,
      JSON.stringify({
        kind: "start_current_plan",
        confidence: 0.94,
        reply: "Yep, I will continue the Snake build.",
        reason: "The user accepts the existing compiled plan.",
      }),
    );

    const build = capture();
    expect(await runCli(["tui", "--command", "the previous plan is fine"], { cwd, io: build.io })).toBe(0);
    const output = build.stdout.join("\n");
    expect(output).toContain("Yep, I will continue the Snake build.");
    expect(output).toContain("Starting build from the compiled spec.");
    expect(output).toContain("build_task_start T1");
    expect(output).toContain("Build finished.");
    expect(output).not.toContain("I already have the build plan.");
    expect(fakeModel.requests.some((request) => request.includes("COMPILED_PLAN_CONTROL"))).toBe(true);
    } finally {
      if (fakeModel) await fakeModel.close();
      await fakeSearch.close();
    }
  }, 20_000);

it("chat starts a Tetris plan when the user says let's go", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fakeSearch = await configureFakeChatSearch(cwd);
    let fakeModel: Awaited<ReturnType<typeof configureFakeCodeWriter>> | null = null;
    try {
    const plan = capture();
    expect(await runCli(["tui", "--command", "a tetris game"], { cwd, io: plan.io })).toBe(0);
    expect(plan.stdout.join("\n")).toContain("I have a build plan.");
    expect(plan.stdout.join("\n")).toContain("I broke it into 4 build steps.");
    shrinkCompiledSpecToOneTask(cwd);
    fakeModel = await configureFakeCodeWriter(cwd);

    const build = capture();
    expect(await runCli(["tui", "--command", "let's go"], { cwd, io: build.io })).toBe(0);
    const output = build.stdout.join("\n");
    expect(output).toContain("Starting build from the compiled spec.");
    expect(output).toContain("build_task_start T1");
    expect(output).toContain("verification passed");
    expect(output).toContain("Build finished.");
    expect(output).not.toContain("I already have the build plan.");
    } finally {
      if (fakeModel) await fakeModel.close();
      await fakeSearch.close();
    }
  }, 20_000);

it("chat reports heartbeat while model patch generation is still running", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fakeSearch = await configureFakeChatSearch(cwd);
    let fakeModel: Awaited<ReturnType<typeof configureFakeCodeWriter>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    shrinkCompiledSpecToOneTask(cwd);
    fakeModel = await configureFakeCodeWriter(cwd, { delayMs: 1_200 });

    const build = capture();
    expect(await runCli(["tui", "--command", "build it"], { cwd, io: build.io })).toBe(0);
    const output = build.stdout.join("\n");
    expect(output).toContain("build_progress generating_patch task_id=T1 model=qwen2.5-coder:7b provider=llamacpp timeout_seconds=2");
    expect(output).toContain("build_progress generating_patch_wait task_id=T1 elapsed_seconds=1 timeout_seconds=2");
    expect(output).toContain("build_progress generated_patch task_id=T1 model=qwen2.5-coder:7b provider=llamacpp latency_ms=");
    expect(output).toContain("Build finished.");
    } finally {
      if (fakeModel) await fakeModel.close();
      await fakeSearch.close();
    }
  }, 20_000);

it("chat starts the compiled build when the user says build it", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fakeSearch = await configureFakeChatSearch(cwd);
    let fakeModel: Awaited<ReturnType<typeof configureFakeCodeWriter>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    shrinkCompiledSpecToOneTask(cwd);
    fakeModel = await configureFakeCodeWriter(cwd);
    const specsBefore = fs.readdirSync(path.join(cwd, ".mission", "specs"));

    const build = capture();
    expect(await runCli(["tui", "--command", "build it"], { cwd, io: build.io })).toBe(0);
    const output = build.stdout.join("\n");
    expect(output).toContain("Starting build from the compiled spec.");
    expect(output).toContain("build_id");
    expect(output).toContain("status active");
    expect(output).toContain("Build running. Each task will show progress, verification, and confidence.");
    expect(output).toContain("build_task_start T1");
    expect(output).toContain("build_progress preparing task_id=T1");
    expect(output).toContain("build_progress generating_patch task_id=T1");
    expect(output).toContain("patch_status applied");
    expect(output).toContain("verification passed");
    expect(output).toContain("build_complete completed_tasks=1");
    expect(output).toContain("Build finished.");
    expect(output).not.toContain("Microcoder Build Console");
    expect(output).not.toContain("Routes");
    expect(output).not.toContain("Latest Attempts");
    expect(output).not.toContain("I already turned this into a buildable spec.");
    expect(fs.readdirSync(path.join(cwd, ".mission", "specs"))).toEqual(specsBefore);
    expect(fs.existsSync(path.join(cwd, ".mission", "mission.json"))).toBe(true);
    const firstMission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };

    const secondBuild = capture();
    expect(await runCli(["tui", "--command", "build it"], { cwd, io: secondBuild.io })).toBe(0);
    expect(secondBuild.stdout.join("\n")).toContain("Build already complete.");
    const secondMission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };
    expect(secondMission.mission_id).toBe(firstMission.mission_id);

    const confused = capture();
    expect(await runCli(["tui", "--command", "??"], { cwd, io: confused.io })).toBe(0);
    expect(confused.stdout.join("\n")).toContain("Build already complete.");
    expect(confused.stdout.join("\n")).not.toContain("Next: run `/build start`.");
    expect(fakeSearch.requests.length).toBe(2);
    } finally {
      if (fakeModel) await fakeModel.close();
      await fakeSearch.close();
    }
  }, 20_000);

it("chat treats different object-bearing make requests as a new goal even when a build is active", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    const mission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };

    const cap = capture();
    expect(await runCli(["tui", "--command", "make a todo tracker"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I have a build plan.");
    expect(output).toContain("Your current build is still paused: Build a browser Snake game.");
    expect(output).not.toContain("Build already active.");
    expect(output).not.toContain(`Existing build still active: ${mission.mission_id}`);
    expect(output).not.toContain("Finish it with `/build step` or `/build run`");
    expect(fake.requests.length).toBe(2);
    } finally {
      await fake.close();
    }
  });

it("chat lets a fresh brief supersede an old paused build without contradictory output", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fakeSearch = await configureFakeChatSearch(cwd);
    let fakeModel: Awaited<ReturnType<typeof configureFakeCodeWriter>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    const oldMission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };

    const newBrief = capture();
    expect(await runCli(["tui", "--command", "let's build a todo list."], { cwd, io: newBrief.io })).toBe(0);
    const briefOutput = newBrief.stdout.join("\n");
    expect(briefOutput).toContain("I have a build plan.");
    expect(briefOutput).toContain("Next: say `build it`");
    expect(briefOutput).toContain("Your current build is still paused: Build a browser Snake game.");
    expect(briefOutput).not.toContain("Existing build still active");
    expect(briefOutput).not.toContain("Finish it with `/build step` or `/build run`");

    shrinkCompiledSpecToOneTask(cwd);
    fakeModel = await configureFakeCodeWriter(cwd);
    const build = capture();
    expect(await runCli(["tui", "--command", "build it"], { cwd, io: build.io })).toBe(5);
    const buildOutput = build.stdout.join("\n");
    expect(buildOutput).toContain("Starting build from the compiled spec.");
    expect(buildOutput).not.toContain("Build already active.");
    expect(buildOutput).toContain("Set aside active build: Build a browser Snake game.");
    expect(buildOutput).toContain("Build stopped with exit code 5.");
    const newMission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string; status: string; goal: string };
    expect(newMission.mission_id).not.toBe(oldMission.mission_id);
    expect(newMission.goal).toBe("Build a local todo list app");
    expect(fs.existsSync(path.join(cwd, ".mission", "archived_builds", oldMission.mission_id, "mission.json"))).toBe(true);
    } finally {
      if (fakeModel) await fakeModel.close();
      await fakeSearch.close();
    }
  });

it("chat archives an active build before starting a different compiled plan", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fakeSearch = await configureFakeChatSearch(cwd);
    let fakeModel: Awaited<ReturnType<typeof configureFakeCodeWriter>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    const oldMission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string; goal: string };

    const newBrief = capture();
    expect(await runCli(["tui", "--command", "make a todo tracker"], { cwd, io: newBrief.io })).toBe(0);
    expect(newBrief.stdout.join("\n")).toContain("I have a build plan.");
    expect(newBrief.stdout.join("\n")).toContain("Your current build is still paused: Build a browser Snake game.");
    const stillOld = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };
    expect(stillOld.mission_id).toBe(oldMission.mission_id);

    shrinkCompiledSpecToOneTask(cwd);
    fakeModel = await configureFakeCodeWriter(cwd);
    const build = capture();
    expect(await runCli(["tui", "--command", "build it"], { cwd, io: build.io })).toBe(5);
    const output = build.stdout.join("\n");
    expect(output).toContain("Set aside active build: Build a browser Snake game.");
    expect(output).toContain("Starting build from the compiled spec.");
    expect(output).toContain("Build stopped with exit code 5.");
    const newMission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string; goal: string };
    expect(newMission.mission_id).not.toBe(oldMission.mission_id);
    expect(newMission.goal).toBe("Build a local todo list app");
    expect(fs.existsSync(path.join(cwd, ".mission", "archived_builds", oldMission.mission_id, "mission.json"))).toBe(true);
    } finally {
      if (fakeModel) await fakeModel.close();
      await fakeSearch.close();
    }
  }, 20_000);

it("same-goal phrasing during an active build does not replace the active build", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fakeSearch = await configureFakeChatSearch(cwd);
    let fakeModel: Awaited<ReturnType<typeof configureFakeCodeWriter>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);
    shrinkActiveTaskGraphToOneTask(cwd);
    fakeModel = await configureFakeCodeWriter(cwd);
    const mission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };
    const specBefore = fs.statSync(path.join(cwd, ".mission", "spec.json")).mtimeMs;

    const sameGoal = capture();
    expect(await runCli(["tui", "--command", "build snake"], { cwd, io: sameGoal.io })).toBe(0);
    const output = sameGoal.stdout.join("\n");
    expect(output).toContain(`Continuing build ${mission.mission_id}.`);
    expect(output).not.toContain("I have a build plan.");
    expect(output).not.toContain("Set aside active build:");
    expect(fs.statSync(path.join(cwd, ".mission", "spec.json")).mtimeMs).toBe(specBefore);
    const after = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };
    expect(after.mission_id).toBe(mission.mission_id);

    const build = capture();
    expect(await runCli(["tui", "--command", "build it"], { cwd, io: build.io })).toBe(0);
    expect(build.stdout.join("\n")).toContain("Build already complete.");
    expect(build.stdout.join("\n")).not.toContain("Set aside active build:");
    const finalMission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };
    expect(finalMission.mission_id).toBe(mission.mission_id);
    } finally {
      if (fakeModel) await fakeModel.close();
      await fakeSearch.close();
    }
  }, 20_000);

it("build start does not overwrite an already active build for the same plan", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    const first = capture();
    expect(await runCli(["build", "start"], { cwd, io: first.io })).toBe(0);
    const mission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };

    const second = capture();
    expect(await runCli(["build", "start"], { cwd, io: second.io })).toBe(0);
    const output = second.stdout.join("\n");
    expect(output).toContain("build_already_active");
    expect(output).toContain(`build_id ${mission.mission_id}`);
    const after = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };
    expect(after.mission_id).toBe(mission.mission_id);
    } finally {
      await fake.close();
    }
  });

it("active build conversational controls answer with resume, pause, and progress context", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "/build start"], { cwd, io: capture().io })).toBe(0);

    for (const prompt of ["??", "???", "huh", "what?"]) {
      const item = capture();
      expect(await runCli(["tui", "--command", prompt], { cwd, io: item.io })).toBe(0);
      expect(item.stdout.join("\n")).toContain("I found a paused build: Build a browser Snake game.");
      expect(item.stdout.join("\n")).toContain("Do you want to continue building it or start fresh?");
    }

    const progress = capture();
    expect(await runCli(["tui", "--command", "what's next?"], { cwd, io: progress.io })).toBe(0);
    expect(progress.stdout.join("\n")).toContain("Build in progress: Build a browser Snake game.");
    expect(progress.stdout.join("\n")).toContain("Progress: 0/5 done");

    const pause = capture();
    expect(await runCli(["tui", "--command", "stop"], { cwd, io: pause.io })).toBe(0);
    expect(pause.stdout.join("\n")).toContain("Okay. I paused the build: Build a browser Snake game.");
    expect(pause.stdout.join("\n")).not.toContain("Build already active.");

    const thanks = capture();
    expect(await runCli(["tui", "--command", "thanks"], { cwd, io: thanks.io })).toBe(0);
    expect(thanks.stdout.join("\n")).toContain("Say `continue` to keep building");
    } finally {
      await fake.close();
    }
  });

it("stop before any build stays conversational and stateless", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });

    const cap = capture();
    expect(await runCli(["tui", "--command", "stop"], { cwd, io: cap.io })).toBe(0);
    expect(cap.stdout.join("\n")).toContain("Nothing is building right now. What do you want to build?");
    expect(cap.stdout.join("\n")).not.toContain("I need a little more before I can build it well.");
    expect(fs.existsSync(path.join(cwd, ".mission", "chat", "spec-chat.json"))).toBe(false);
  });

it("completed builds answer continue as complete instead of showing the compiled-plan nudge", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fakeSearch = await configureFakeChatSearch(cwd);
    let fakeModel: Awaited<ReturnType<typeof configureFakeCodeWriter>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    shrinkCompiledSpecToOneTask(cwd);
    fakeModel = await configureFakeCodeWriter(cwd);
    expect(await runCli(["tui", "--command", "build it"], { cwd, io: capture().io })).toBe(0);

    const cap = capture();
    expect(await runCli(["tui", "--command", "continue"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("Build already complete.");
    expect(output).not.toContain("I already have the build plan.");
    } finally {
      if (fakeModel) await fakeModel.close();
      await fakeSearch.close();
    }
  }, 20_000);

it("build step without an active build gives a useful error", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });

    const cap = capture();
    expect(await runCli(["build", "step"], { cwd, io: cap.io })).toBe(1);
    expect(cap.stderr.join("\n")).toContain("No build is active. Tell me what to build first, then say `build it`.");
  });

it("chat starts the compiled build from natural build follow-up text", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    let fakeModel: Awaited<ReturnType<typeof configureFakeCodeWriter>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    shrinkCompiledSpecToOneTask(cwd);
    fakeModel = await configureFakeCodeWriter(cwd);

    const buildSnake = capture();
    expect(await runCli(["tui", "--command", "build snake"], { cwd, io: buildSnake.io })).toBe(0);
    expect(buildSnake.stdout.join("\n")).toContain("Starting build from the compiled spec.");
    expect(buildSnake.stdout.join("\n")).toContain("Build finished.");
    expect(buildSnake.stdout.join("\n")).not.toContain("I already turned this into a buildable spec.");
    expect(fake.requests.length).toBe(2);
    } finally {
      if (fakeModel) await fakeModel.close();
      await fake.close();
    }

    const cwdWithPoliteFollowUp = tempWorkspace();
    await runCli(["init"], { cwd: cwdWithPoliteFollowUp, io: capture().io });
    const politeFake = await configureFakeChatSearch(cwdWithPoliteFollowUp);
    let politeFakeModel: Awaited<ReturnType<typeof configureFakeCodeWriter>> | null = null;
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd: cwdWithPoliteFollowUp, io: capture().io })).toBe(0);
    shrinkCompiledSpecToOneTask(cwdWithPoliteFollowUp);
    politeFakeModel = await configureFakeCodeWriter(cwdWithPoliteFollowUp);
    const polite = capture();
    expect(await runCli(["tui", "--command", "ok. so build it"], { cwd: cwdWithPoliteFollowUp, io: polite.io })).toBe(0);
    expect(polite.stdout.join("\n")).toContain("Starting build from the compiled spec.");
    expect(polite.stdout.join("\n")).toContain("Build finished.");
    expect(polite.stdout.join("\n")).not.toContain("I already turned this into a buildable spec.");
    expect(politeFake.requests.length).toBe(2);
    } finally {
      if (politeFakeModel) await politeFakeModel.close();
      await politeFake.close();
    }
  }, 60_000);

it("chat reset clears the persisted conversation brief", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["chat", "Build a custom coaching portal for runners"], { cwd, io: capture().io })).toBe(2);
    const reset = capture();
    expect(await runCli(["chat", "reset"], { cwd, io: reset.io })).toBe(0);
    expect(reset.stdout.join("\n")).toContain("message reset");
    const status = capture();
    expect(await runCli(["chat", "status"], { cwd, io: status.io })).toBe(0);
    expect(status.stdout.join("\n")).toContain("goal none");
    expect(fake.requests.length).toBe(1);
    } finally {
      await fake.close();
    }
  });
});
