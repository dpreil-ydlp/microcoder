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

describe("Micro Mission Coder runtime - config, spec, and repo", () => {
it("validates all authoritative schema fixtures", () => {
    const validator = createValidator();
    for (const [name, fixture] of Object.entries(schemaFixtures)) {
      const result = validator.validate(name as Parameters<typeof validator.validate>[0], fixture);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

it("mmc init creates config, mission directory, and idempotent SQLite schema", async () => {
    const cwd = tempWorkspace();
    const cap = capture();
    expect(await runCli(["init"], { cwd, io: cap.io })).toBe(0);
    expect(fs.existsSync(path.join(cwd, ".micro-mission-coder.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, ".mission"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, ".mission", "mmc.sqlite"))).toBe(true);

    const loaded = loadConfig(cwd);
    initializeDatabase(cwd, loaded.config);
    initializeDatabase(cwd, loaded.config);
    expect(fs.statSync(databasePath(cwd, loaded.config)).size).toBeGreaterThan(0);
  });

it("missing config uses defaults and invalid config reports errors", () => {
    const cwd = tempWorkspace();
    const loaded = loadConfig(cwd);
    expect(loaded.source).toBe("default");
    expect(loaded.config.hardware.profile).toBe("middle_32gb");
    expect(validateConfig({ hardware: { profile: "tiny" }, context: {}, harness: {}, design: { open_design: {} } })).toContain(
      "project.mission_dir is required",
    );
    expect(validateConfig(null)).toEqual(["config must be an object"]);
  });

it("invalid config errors are reported once in CLI and TUI surfaces", async () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(
      path.join(cwd, ".micro-mission-coder.yaml"),
      ["hardware:", "  profile: tiny", "context:", "  no_global_tool_catalog: false", ""].join("\n"),
    );

    const cliCap = capture();
    expect(await runCli(["repo", "status"], { cwd, io: cliCap.io })).toBe(1);
    expect(countOccurrences(cliCap.stderr.join("\n"), "hardware.profile must be one of")).toBe(1);
    expect(countOccurrences(cliCap.stderr.join("\n"), "context.no_global_tool_catalog must stay true")).toBe(1);

    const tuiCap = capture();
    expect(await runCli(["tui", "--snapshot"], { cwd, io: tuiCap.io })).toBe(0);
    expect(countOccurrences(tuiCap.stdout.join("\n"), "hardware.profile must be one of")).toBe(1);
    expect(countOccurrences(tuiCap.stdout.join("\n"), "context.no_global_tool_catalog must stay true")).toBe(1);
  });

it("spec create blocks vague dashboard request with specific questions", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const cap = capture();
    const code = await runCli(["spec", "create", "make the dashboard better"], { cwd, io: cap.io });
    const output = cap.stdout.join("\n");
    expect(code).toBe(2);
    expect(output).toContain("status needs_clarification");
    expect(output).toContain("What measurable acceptance criteria");
    expect(output).toContain("Which dashboard data");
  });

it("mission start refuses a spec with missing acceptance criteria", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    await runCli(["spec", "create", "make the dashboard better"], { cwd, io: capture().io });
    const cap = capture();
    const code = await runCli(["mission", "start"], { cwd, io: cap.io });
    expect(code).toBe(2);
    expect(cap.stdout.join("\n")).toContain("blocked_by_spec_ambiguity");
  });

it("valid JSON spec produces an acyclic task graph and starts a build", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const specFile = path.join(cwd, "valid-spec.json");
    fs.writeFileSync(
      specFile,
      JSON.stringify({
        goal: "Add invoice dashboard",
        requirements: ["Show recent invoices"],
        acceptance_criteria: [{ text: "Recent invoices render in the dashboard", verification: "npm test" }],
        non_goals: [],
        risk_flags: ["billing"],
      }),
    );
    const compileCap = capture();
    expect(await runCli(["spec", "compile", "valid-spec.json"], { cwd, io: compileCap.io })).toBe(0);
    expect(compileCap.stdout.join("\n")).toContain('"tasks"');

    const startCap = capture();
    expect(await runCli(["build", "start"], { cwd, io: startCap.io })).toBe(0);
    expect(startCap.stdout.join("\n")).toContain("build_id");
    expect(startCap.stdout.join("\n")).toContain("status active");
    expect(fs.existsSync(path.join(cwd, ".mission", "mission.json"))).toBe(true);
  });

it("repo brain detects stale index after a file change", async () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
    fs.mkdirSync(path.join(cwd, "src"));
    fs.writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 1;\n");
    await runCli(["init"], { cwd, io: capture().io });
    expect(await runCli(["repo", "index"], { cwd, io: capture().io })).toBe(0);
    fs.writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 2;\n");
    const cap = capture();
    expect(await runCli(["repo", "status"], { cwd, io: cap.io })).toBe(3);
    expect(cap.stdout.join("\n")).toContain("status stale");
  });

it("repo brain ignores generated gauntlet artifacts", async () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
    fs.mkdirSync(path.join(cwd, "src"));
    fs.writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 1;\n");
    await runCli(["init"], { cwd, io: capture().io });
    expect(await runCli(["repo", "index"], { cwd, io: capture().io })).toBe(0);
    fs.mkdirSync(path.join(cwd, ".gauntlet", "logs"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".gauntlet", "logs", "lint.log"), "generated proof log\n");
    fs.writeFileSync(path.join(cwd, "gauntlet-report.md"), "# Generated proof report\n");
    const cap = capture();
    expect(await runCli(["repo", "status"], { cwd, io: cap.io })).toBe(0);
    expect(cap.stdout.join("\n")).toContain("status fresh");
    expect(cap.stdout.join("\n")).toContain("dirty_files []");
  });

it("hardware profile downgrade changes runtime policy", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const cap = capture();
    expect(await runCli(["config", "profile", "constrained_16gb"], { cwd, io: cap.io })).toBe(0);
    const loaded = loadConfig(cwd);
    expect(loaded.config.hardware.profile).toBe("constrained_16gb");
    expect(loaded.config.vision.enabled).toBe(false);
    expect(loaded.config.hardware.max_parallel_test_jobs).toBe(0);
  });

it("compiles markdown acceptance criteria into linked tasks", () => {
    const result = compileSpecInput(`# Add dashboard

## Requirements
- Show recent invoices

## Acceptance
- Recent invoices render and tests pass
`, "markdown");
    expect(result.status).toBe("compiled");
    expect(result.task_graph.tasks[0].acceptance_ids).toEqual(["AC1"]);
  });

it("plain prompt browser app goals compile without generic acceptance blocking", () => {
    const result = compileSpecInput("build a snake game that I can run in my browser");
    expect(result.status).toBe("compiled");
    expect(result.blocking_questions).toEqual([]);
    expect(result.spec.acceptance_criteria.map((criterion) => criterion.id)).toEqual(["AC1", "AC2"]);
    expect(result.task_graph.tasks[0].status).toBe("ready");
    expect(result.task_graph.tasks[0].description).toContain("Acceptance criteria:");
    expect(result.task_graph.tasks[0].description).toContain("Verification commands must pass: npm test.");
    expect(result.task_graph.tasks[0].description).toContain("do not use the default failing npm test placeholder");
    expect(result.task_graph.tasks[0].description).toContain("node --check src/main.js");
    expect(result.task_graph.tasks[0].allowed_files).toEqual(["package.json", "index.html", "src/main.js", "src/styles.css", "README.md"]);
    expect(result.task_graph.tasks[0].verification_commands).toEqual(["npm test"]);
  });
});
