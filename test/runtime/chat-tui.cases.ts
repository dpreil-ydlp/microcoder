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

    expect(await runCli(["tui", "--command", "build it"], { cwd, io: capture().io })).toBe(0);
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

      for (const question of ["what are we building?", "show me the plan", "what's in scope?"]) {
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
    for (const phrase of ["go ahead", "yes, start building", "run with that", "looks good, build it"]) {
      const cwd = tempWorkspace();
      await runCli(["init"], { cwd, io: capture().io });
      const fake = await configureFakeChatSearch(cwd);
      try {
        expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
        const specsBefore = fs.readdirSync(path.join(cwd, ".mission", "specs"));
        const cap = capture();
        expect(await runCli(["tui", "--command", phrase], { cwd, io: cap.io })).toBe(0);
        expect(cap.stdout.join("\n")).toContain("Starting build from the compiled spec.");
        expect(fs.readdirSync(path.join(cwd, ".mission", "specs"))).toEqual(specsBefore);
        expect(fake.requests.length).toBe(1);
      } finally {
        await fake.close();
      }
    }
  });

it("chat starts the compiled build when the user says build it", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    const specsBefore = fs.readdirSync(path.join(cwd, ".mission", "specs"));

    const build = capture();
    expect(await runCli(["tui", "--command", "build it"], { cwd, io: build.io })).toBe(0);
    const output = build.stdout.join("\n");
    expect(output).toContain("Starting build from the compiled spec.");
    expect(output).toContain("build_id");
    expect(output).toContain("status active");
    expect(output).not.toContain("I already turned this into a buildable spec.");
    expect(fs.readdirSync(path.join(cwd, ".mission", "specs"))).toEqual(specsBefore);
    expect(fs.existsSync(path.join(cwd, ".mission", "mission.json"))).toBe(true);
    const firstMission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };

    const secondBuild = capture();
    expect(await runCli(["tui", "--command", "build it"], { cwd, io: secondBuild.io })).toBe(0);
    expect(secondBuild.stdout.join("\n")).toContain("Build already active.");
    const secondMission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };
    expect(secondMission.mission_id).toBe(firstMission.mission_id);

    const confused = capture();
    expect(await runCli(["tui", "--command", "??"], { cwd, io: confused.io })).toBe(0);
    expect(confused.stdout.join("\n")).toContain("Build already active.");
    expect(confused.stdout.join("\n")).toContain("Next: run `/build step` or `/build run`.");
    expect(confused.stdout.join("\n")).not.toContain("Next: run `/build start`.");
    expect(fake.requests.length).toBe(1);
    } finally {
      await fake.close();
    }
  });

it("chat treats object-bearing make requests as a new goal even when a build is active", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);
    expect(await runCli(["tui", "--command", "build it"], { cwd, io: capture().io })).toBe(0);
    const mission = JSON.parse(fs.readFileSync(path.join(cwd, ".mission", "mission.json"), "utf8")) as { mission_id: string };

    const cap = capture();
    expect(await runCli(["tui", "--command", "make snake"], { cwd, io: cap.io })).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("I have a build plan.");
    expect(output).not.toContain("Build already active.");
    expect(output).toContain(`Existing build still active: ${mission.mission_id}`);
    expect(fake.requests.length).toBe(2);
    } finally {
      await fake.close();
    }
  });

it("chat starts the compiled build from natural build follow-up text", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await configureFakeChatSearch(cwd);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd, io: capture().io })).toBe(0);

    const buildSnake = capture();
    expect(await runCli(["tui", "--command", "build snake"], { cwd, io: buildSnake.io })).toBe(0);
    expect(buildSnake.stdout.join("\n")).toContain("Starting build from the compiled spec.");
    expect(buildSnake.stdout.join("\n")).not.toContain("I already turned this into a buildable spec.");
    expect(fake.requests.length).toBe(1);
    } finally {
      await fake.close();
    }

    const cwdWithPoliteFollowUp = tempWorkspace();
    await runCli(["init"], { cwd: cwdWithPoliteFollowUp, io: capture().io });
    const politeFake = await configureFakeChatSearch(cwdWithPoliteFollowUp);
    try {
    expect(await runCli(["tui", "--command", "snake game"], { cwd: cwdWithPoliteFollowUp, io: capture().io })).toBe(0);
    const polite = capture();
    expect(await runCli(["tui", "--command", "ok. so build it"], { cwd: cwdWithPoliteFollowUp, io: polite.io })).toBe(0);
    expect(polite.stdout.join("\n")).toContain("Starting build from the compiled spec.");
    expect(polite.stdout.join("\n")).not.toContain("I already turned this into a buildable spec.");
    expect(politeFake.requests.length).toBe(1);
    } finally {
      await politeFake.close();
    }
  });

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
