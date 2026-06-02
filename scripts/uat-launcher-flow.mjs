import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "microcoder-uat-"));
const userShell = process.env.SHELL ?? "/bin/zsh";
const command = process.env.MICROCODER_UAT_CMD ?? "microcoder";
const nodeBin = path.dirname(process.execPath);
const testEnv = { ...process.env, PATH: `${nodeBin}:${process.env.PATH ?? ""}` };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    encoding: "utf8",
    env: testEnv,
    ...options,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}\n${output}`);
  }
  return output;
}

function assertIncludes(output, text, label) {
  if (!output.includes(text)) throw new Error(`${label} missing ${JSON.stringify(text)}\n${output}`);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function runMicrocoder(args, options = {}) {
  const line = [command, ...args.map(shellQuote)].join(" ");
  return run(userShell, ["-lc", line], options);
}

fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
fs.mkdirSync(path.join(workspace, "src"));
fs.writeFileSync(path.join(workspace, "src", "hello.ts"), "export const hello = 'old';\n");

const resolved = run(userShell, ["-lc", `command -v ${command}`]).trim();
if (!resolved) throw new Error(`${command} is not on PATH; run npm link from ${root}`);

const init = runMicrocoder(["init"]);
assertIncludes(init, "initialized", "init");
if (!fs.existsSync(path.join(workspace, ".mission", "mmc.sqlite"))) {
  throw new Error("init did not create .mission/mmc.sqlite");
}

const help = runMicrocoder(["--help"]);
assertIncludes(help, "microcoder", "help");

const dashboard = runMicrocoder([], { input: "/build status\n/exit\n" });
assertIncludes(dashboard, "Microcoder Build Console", "dashboard");
assertIncludes(dashboard, "Build", "dashboard");
assertIncludes(runMicrocoder(["models", "list"]), "qwen2.5-coder:7b", "packaged model registry");

const spec = {
  goal: "Update hello copy",
  requirements: ["Update hello copy"],
  acceptance_criteria: ["Tests pass"],
  non_goals: [],
  risk_flags: [],
};
fs.writeFileSync(path.join(workspace, "valid-spec.json"), JSON.stringify(spec));
assertIncludes(runMicrocoder(["spec", "compile", "valid-spec.json"]), "status compiled", "spec compile");
assertIncludes(runMicrocoder(["build", "start"]), "status active", "build start");
assertIncludes(runMicrocoder(["task", "next"]), "\"id\": \"T1\"", "task next");

console.log(`fresh-user microcoder UAT passed with ${command} at ${resolved}`);
