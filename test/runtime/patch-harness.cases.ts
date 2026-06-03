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
import { spawnSync } from "node:child_process";

describe("Micro Mission Coder runtime - patch harness", () => {
it("patch harness rejects files outside allowed scope and test-disable patches", () => {
    const outside = `diff --git a/src/lib/auth.ts b/src/lib/auth.ts
--- a/src/lib/auth.ts
+++ b/src/lib/auth.ts
@@ -1 +1 @@
-export const ok = true;
+export const ok = false;
`;
    expect(validatePatchScope(outside, ["src/components/InvoiceTable.tsx"]).scope_clean).toBe(false);
    const skipped = `diff --git a/x.test.ts b/x.test.ts
--- a/x.test.ts
+++ b/x.test.ts
@@ -1 +1 @@
-test("x", () => {});
+test.skip("x", () => {});
`;
    expect(validatePatchScope(skipped, ["x.test.ts"]).rejected_reason).toContain("disable tests");
    const failingNpmTest = `diff --git a/package.json b/package.json
--- /dev/null
+++ b/package.json
@@ -0,0 +1,5 @@
+{
+  "scripts": {
+    "test": "echo \\"Error: no test specified\\" && exit 1"
+  }
+}
`;
    expect(validatePatchScope(failingNpmTest, ["package.json"]).rejected_reason).toContain("failing npm test placeholder");
    const noTestsYet = failingNpmTest.replace("Error: no test specified", "No tests yet").replace(" && exit 1", " && exit 0");
    expect(validatePatchScope(noTestsYet, ["package.json"]).rejected_reason).toContain("failing npm test placeholder");
    const createUnapproved = `diff --git a/new.ts b/new.ts
--- /dev/null
+++ b/new.ts
@@ -0,0 +1 @@
+export const x = 1;
`;
    expect(validatePatchScope(createUnapproved, []).rejected_reason).toContain("creates new file");
    const deletePatch = `diff --git a/old.ts b/old.ts
--- a/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-export const x = 1;
`;
    expect(validatePatchScope(deletePatch, ["old.ts"]).rejected_reason).toContain("deletes file");
  });

it("patch harness coerces single-file code block output into unified diff", () => {
    const cwd = tempWorkspace();
    fs.mkdirSync(path.join(cwd, "src"));
    fs.writeFileSync(path.join(cwd, "src", "x.ts"), "export const x = 'old';\n");
    const diff = coerceToUnifiedDiff("```ts\nexport const x = 'new';\n```", cwd, ["src/x.ts"]);
    expect(diff).toContain("--- a/src/x.ts");
    expect(diff).toContain("+++ b/src/x.ts");
    expect(diff).toContain("+export const x = 'new';");
  });

it("patch harness refuses to coerce partial code blocks for larger files", () => {
    const cwd = tempWorkspace();
    fs.mkdirSync(path.join(cwd, "src"));
    fs.writeFileSync(
      path.join(cwd, "src", "large.ts"),
      [
        "import path from 'node:path';",
        "export function buildName(input: string) {",
        "  const base = path.basename(input);",
        "  const safe = base.trim();",
        "  return safe.toUpperCase();",
        "}",
        "",
      ].join("\n"),
    );
    const output = "```ts\nupdated\n```";
    expect(coerceToUnifiedDiff(output, cwd, ["src/large.ts"])).toBe(output);
  });

it("patch harness unwraps fenced unified diffs", () => {
    const patch = `\`\`\`diff
diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1 +1 @@
-export const x = 'old';
+export const x = 'new';
\`\`\``;
    expect(coerceToUnifiedDiff(patch, "/tmp", ["src/x.ts"])).toContain("diff --git a/src/x.ts b/src/x.ts");
    expect(coerceToUnifiedDiff(patch, "/tmp", ["src/x.ts"])).not.toContain("```");
  });

it("patch harness unwraps incomplete fenced unified diffs", () => {
    const patch = `\`\`\`
diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1 +1 @@
-export const x = 'old';
+export const x = 'new';`;
    const normalized = coerceToUnifiedDiff(patch, "/tmp", ["src/x.ts"]);
    expect(normalized).toContain("diff --git a/src/x.ts b/src/x.ts");
    expect(normalized).not.toContain("```");
  });

it("patch harness recounts model diffs with invalid hunk lengths before applying", () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
    fs.mkdirSync(path.join(cwd, "src"));
    fs.writeFileSync(path.join(cwd, "src", "hello.ts"), "export const greeting = 'old';\n");
    const loaded = loadConfig(cwd);
    initializeDatabase(cwd, loaded.config);
    const patch = `diff --git a/src/hello.ts b/src/hello.ts
--- a/src/hello.ts
+++ b/src/hello.ts
@@ -1,2 +1,2 @@
-export const greeting = 'old';
+export const greeting = 'new';
`;
    const result = applyPatchInWorktree({
      cwd,
      config: loaded.config,
      taskId: "T1",
      patch,
      allowedFiles: ["src/hello.ts"],
    });
    expect(result.status).toBe("applied");
    expect(fs.readFileSync(path.join(result.worktree_path, "src", "hello.ts"), "utf8")).toContain("'new'");
  });

it("patch harness preflights multi-file patches without leaving partial changes or reject files", () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(path.join(cwd, "index.html"), "<main>Old</main>\n");
    fs.writeFileSync(path.join(cwd, "README.md"), "# New title\n");
    spawnSync("git", ["init"], { cwd });
    spawnSync("git", ["add", "index.html", "README.md"], { cwd });
    spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "initial"], { cwd });

    const loaded = loadConfig(cwd);
    initializeDatabase(cwd, loaded.config);
    const patch = `diff --git a/index.html b/index.html
--- a/index.html
+++ b/index.html
@@ -1 +1 @@
-<main>Old</main>
+<main>New</main>
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-# Old title
+# New title
`;
    const result = applyPatchInWorktree({
      cwd,
      config: loaded.config,
      taskId: "T1",
      patch,
      allowedFiles: ["index.html", "README.md"],
    });
    expect(result.status).toBe("failed_apply");
    expect(result.worktree_mode).toBe("git_worktree");
    expect(fs.readFileSync(path.join(result.worktree_path, "index.html"), "utf8")).toBe("<main>Old</main>\n");
    expect(fs.readFileSync(path.join(result.worktree_path, "README.md"), "utf8")).toBe("# New title\n");
    expect(fs.existsSync(path.join(result.worktree_path, "README.md.rej"))).toBe(false);
    expect(result.stderr).toMatch(/preflight|dry run|Reversed|previously applied|FAILED/i);
  });

it("patch harness repairs model-prefixed multi-file diff headers before applying", () => {
    const cwd = tempWorkspace();
    const loaded = loadConfig(cwd);
    initializeDatabase(cwd, loaded.config);
    const patch = `diff --git a/package.json b/package.json
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/package.json
@@ -0,0 +1,5 @@
+{
+  "scripts": {
+    "test": "node -e \\"process.exit(0)\\""
+  }
+}
+
+diff --git a/index.html b/index.html
+new file mode 100644
+index 0000000..2222222
+++ b/index.html
@@ -0,0 +1 @@
+<main>Snake</main>
`;
    const result = applyPatchInWorktree({
      cwd,
      config: loaded.config,
      taskId: "T1",
      patch,
      allowedFiles: ["package.json", "index.html"],
    });
    expect(result.status).toBe("applied");
    const packageJson = fs.readFileSync(path.join(result.worktree_path, "package.json"), "utf8");
    expect(JSON.parse(packageJson).scripts.test).toContain("process.exit");
    expect(packageJson).not.toContain("diff --git");
    expect(fs.readFileSync(path.join(result.worktree_path, "index.html"), "utf8")).toContain("Snake");
  });
});
