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

describe("Micro Mission Coder runtime - mission execution", () => {
it("run --task applies a mock patch in an isolated worktree and verifier-gates acceptance", async () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
    fs.mkdirSync(path.join(cwd, "src"));
    fs.writeFileSync(path.join(cwd, "src", "hello.ts"), "export const hello = 'old';\n");
    await runCli(["init"], { cwd, io: capture().io });
    fs.writeFileSync(
      path.join(cwd, "valid-spec.json"),
      JSON.stringify({
        goal: "Update greeting copy",
        requirements: ["Update greeting copy"],
        acceptance_criteria: [{ text: "Tests pass after greeting copy update", verification: "npm test" }],
        non_goals: [],
        risk_flags: [],
      }),
    );
    await runCli(["spec", "compile", "valid-spec.json"], { cwd, io: capture().io });
    await runCli(["mission", "start"], { cwd, io: capture().io });
    const graphPath = path.join(cwd, ".mission", "task_graph.json");
    const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as {
      tasks: Array<{ allowed_files: string[]; verification_commands: string[] }>;
    };
    graph.tasks[0].allowed_files = ["src/hello.ts"];
    graph.tasks[0].verification_commands = ["npm test"];
    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
    const patchFile = path.join(cwd, "change.patch");
    fs.writeFileSync(
      patchFile,
      `diff --git a/src/hello.ts b/src/hello.ts
--- a/src/hello.ts
+++ b/src/hello.ts
@@ -1 +1 @@
-export const hello = 'old';
+export const hello = 'new';
`,
    );

    const cap = capture();
    const code = await runCli(["run", "--task", "T1", "--mock-patch", "change.patch"], { cwd, io: cap.io });
    expect(code).toBe(0);
    const output = cap.stdout.join("\n");
    expect(output).toContain("patch_status applied");
    expect(output).toContain("verification passed");
    expect(output).toContain("confidence");
    expect(fs.readdirSync(path.join(cwd, ".mission", "worktrees")).length).toBe(1);
    const attempts = fs.readFileSync(path.join(cwd, ".mission", "attempts.jsonl"), "utf8");
    expect(attempts).toContain('"status":"accepted"');
    const attemptId = JSON.parse(attempts.trim()).attempt_id as string;
    const applyCap = capture();
    expect(await runCli(["patch", "apply", "--attempt", attemptId], { cwd, io: applyCap.io })).toBe(0);
    expect(fs.readFileSync(path.join(cwd, "src", "hello.ts"), "utf8")).toContain("'new'");
    expect(applyCap.stdout.join("\n")).toContain(`applied_attempt ${attemptId}`);
    const artifactCap = capture();
    expect(await runCli(["artifacts", "list"], { cwd, io: artifactCap.io })).toBe(0);
    expect(artifactCap.stdout.join("\n")).toContain("patch");
  });

it("run --task exits nonzero when frontend verification blocks acceptance", async () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
    fs.mkdirSync(path.join(cwd, "src"));
    fs.writeFileSync(path.join(cwd, "src", "dashboard.ts"), "export const copy = 'old';\n");
    await runCli(["init"], { cwd, io: capture().io });
    fs.writeFileSync(
      path.join(cwd, "valid-spec.json"),
      JSON.stringify({
        goal: "Update dashboard frontend copy",
        requirements: ["Update dashboard frontend copy"],
        acceptance_criteria: [{ text: "Tests pass after dashboard copy update", verification: "npm test" }],
        non_goals: [],
        risk_flags: ["frontend"],
      }),
    );
    await runCli(["spec", "compile", "valid-spec.json"], { cwd, io: capture().io });
    await runCli(["mission", "start"], { cwd, io: capture().io });
    const graphPath = path.join(cwd, ".mission", "task_graph.json");
    const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as {
      tasks: Array<{ allowed_files: string[]; verification_commands: string[]; status: string }>;
    };
    graph.tasks[0].allowed_files = ["src/dashboard.ts"];
    graph.tasks[0].verification_commands = ["npm test"];
    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
    fs.writeFileSync(
      path.join(cwd, "change.patch"),
      `diff --git a/src/dashboard.ts b/src/dashboard.ts
--- a/src/dashboard.ts
+++ b/src/dashboard.ts
@@ -1 +1 @@
-export const copy = 'old';
+export const copy = 'new';
`,
    );

    const cap = capture();
    expect(await runCli(["run", "--task", "T1", "--mock-patch", "change.patch"], { cwd, io: cap.io })).toBe(5);
    const output = cap.stdout.join("\n");
    expect(output).toContain("verification passed");
    expect(output).toContain("confidence");
    expect(output).toContain("task_not_accepted");
    const updated = JSON.parse(fs.readFileSync(graphPath, "utf8")) as { tasks: Array<{ status: string }> };
    expect(updated.tasks[0].status).toBe("ready");
  });

it("run --mission rejects invalid max-tasks arguments", async () => {
    const cwd = tempWorkspace();
    const invalidArgv = [
      ["run", "--mission", "--max-tasks", "nope"],
      ["run", "--mission", "--max-tasks", "0"],
      ["run", "--mission", "--max-tasks", "-1"],
      ["run", "--mission", "--max-tasks", "2x"],
      ["run", "--mission", "nope"],
    ];
    for (const argv of invalidArgv) {
      const cap = capture();
      expect(await runCli(argv, { cwd, io: cap.io })).toBe(1);
      expect(cap.stderr.join("\n")).toMatch(/positive integer|unexpected run --mission argument/);
      expect(cap.stdout.join("\n")).not.toContain("mission_stopped max_tasks=NaN");
    }
  });

it("build run rejects invalid max-tasks arguments with build wording", async () => {
    const cwd = tempWorkspace();
    const invalidArgv = [
      ["build", "run", "nope"],
      ["build", "run", "0"],
      ["build", "run", "1", "extra"],
    ];
    for (const argv of invalidArgv) {
      const cap = capture();
      expect(await runCli(argv, { cwd, io: cap.io })).toBe(1);
      expect(cap.stderr.join("\n")).toMatch(/positive integer|build run accepts/);
      expect(cap.stdout.join("\n")).not.toContain("build_stopped max_tasks=NaN");
    }
  });

it("run --task rejects out-of-scope model patches through the CLI", async () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
    fs.mkdirSync(path.join(cwd, "src"));
    fs.writeFileSync(path.join(cwd, "src", "allowed.ts"), "export const value = 'old';\n");
    fs.writeFileSync(path.join(cwd, "src", "other.ts"), "export const other = 'old';\n");
    await runCli(["init"], { cwd, io: capture().io });
    fs.writeFileSync(
      path.join(cwd, "valid-spec.json"),
      JSON.stringify({
        goal: "Update allowed file",
        requirements: ["Update allowed file"],
        acceptance_criteria: ["Tests pass"],
        non_goals: [],
        risk_flags: [],
      }),
    );
    await runCli(["spec", "compile", "valid-spec.json"], { cwd, io: capture().io });
    await runCli(["mission", "start"], { cwd, io: capture().io });
    const graphPath = path.join(cwd, ".mission", "task_graph.json");
    const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as {
      tasks: Array<{ allowed_files: string[]; verification_commands: string[] }>;
    };
    graph.tasks[0].allowed_files = ["src/allowed.ts"];
    graph.tasks[0].verification_commands = ["npm test"];
    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
    fs.writeFileSync(
      path.join(cwd, "bad.patch"),
      `diff --git a/src/other.ts b/src/other.ts
--- a/src/other.ts
+++ b/src/other.ts
@@ -1 +1 @@
-export const other = 'old';
+export const other = 'new';
`,
    );

    const cap = capture();
    expect(await runCli(["run", "--task", "T1", "--mock-patch", "bad.patch"], { cwd, io: cap.io })).toBe(5);
    expect(cap.stdout.join("\n")).toContain("patch_status failed_scope");
    expect(fs.readFileSync(path.join(cwd, ".mission", "attempts.jsonl"), "utf8")).toContain('"status":"failed"');
  });

it("verification failure prevents task completion", async () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(1)\"" } }));
    fs.mkdirSync(path.join(cwd, "src"));
    fs.writeFileSync(path.join(cwd, "src", "hello.ts"), "export const hello = 'old';\n");
    await runCli(["init"], { cwd, io: capture().io });
    fs.writeFileSync(
      path.join(cwd, "valid-spec.json"),
      JSON.stringify({
        goal: "Update greeting",
        requirements: ["Update greeting"],
        acceptance_criteria: ["Tests pass"],
        non_goals: [],
        risk_flags: [],
      }),
    );
    await runCli(["spec", "compile", "valid-spec.json"], { cwd, io: capture().io });
    await runCli(["mission", "start"], { cwd, io: capture().io });
    const graphPath = path.join(cwd, ".mission", "task_graph.json");
    const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as {
      tasks: Array<{ allowed_files: string[]; verification_commands: string[]; status: string }>;
    };
    graph.tasks[0].allowed_files = ["src/hello.ts"];
    graph.tasks[0].verification_commands = ["npm test"];
    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
    fs.writeFileSync(
      path.join(cwd, "change.patch"),
      `diff --git a/src/hello.ts b/src/hello.ts
--- a/src/hello.ts
+++ b/src/hello.ts
@@ -1 +1 @@
-export const hello = 'old';
+export const hello = 'new';
`,
    );

    const cap = capture();
    expect(await runCli(["run", "--task", "T1", "--mock-patch", "change.patch"], { cwd, io: cap.io })).toBe(5);
    expect(cap.stdout.join("\n")).toContain("verification failed");
    expect(fs.readFileSync(path.join(cwd, ".mission", "attempts.jsonl"), "utf8")).toContain('"status":"failed"');
    const updated = JSON.parse(fs.readFileSync(graphPath, "utf8")) as { tasks: Array<{ status: string }> };
    expect(updated.tasks[0].status).not.toBe("complete");
  });

it("mission resume selects the next unblocked task without chat history", async () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
    fs.mkdirSync(path.join(cwd, "src"));
    fs.writeFileSync(path.join(cwd, "src", "one.ts"), "export const one = 'old';\n");
    await runCli(["init"], { cwd, io: capture().io });
    fs.writeFileSync(
      path.join(cwd, "valid-spec.json"),
      JSON.stringify({
        goal: "Two task mission",
        requirements: ["Update first file", "Update second file"],
        acceptance_criteria: ["Tests pass"],
        non_goals: [],
        risk_flags: [],
      }),
    );
    await runCli(["spec", "compile", "valid-spec.json"], { cwd, io: capture().io });
    await runCli(["mission", "start"], { cwd, io: capture().io });
    const graphPath = path.join(cwd, ".mission", "task_graph.json");
    const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as {
      tasks: Array<{ allowed_files: string[]; verification_commands: string[] }>;
    };
    graph.tasks[0].allowed_files = ["src/one.ts"];
    graph.tasks[0].verification_commands = ["npm test"];
    graph.tasks[1].verification_commands = ["npm test"];
    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
    fs.writeFileSync(
      path.join(cwd, "one.patch"),
      `diff --git a/src/one.ts b/src/one.ts
--- a/src/one.ts
+++ b/src/one.ts
@@ -1 +1 @@
-export const one = 'old';
+export const one = 'new';
`,
    );
    expect(await runCli(["run", "--task", "T1", "--mock-patch", "one.patch"], { cwd, io: capture().io })).toBe(0);
    const cap = capture();
    expect(await runCli(["task", "next"], { cwd, io: cap.io })).toBe(0);
    expect(cap.stdout.join("\n")).toContain('"id": "T2"');
  });
});
