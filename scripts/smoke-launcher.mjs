import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const launcher = path.join(root, "bin", "microcoder.js");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
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

if (!fs.existsSync(path.join(root, "dist", "src", "cli", "run.js"))) {
  throw new Error("dist build is missing; run npm run build before launcher smoke tests");
}

const pack = JSON.parse(run("npm", ["pack", "--dry-run", "--json"]));
const files = new Set(pack[0].files.map((file) => file.path));
for (const required of [
  "12_MODEL_PROFILES.yaml",
  "bin/microcoder.js",
  "bin/mmc.js",
  "dist/src/cli/run.js",
  "dist/src/cli/tui.js",
  "micro_mission_coder_specs/07_SCHEMAS/spec.schema.json",
  "tools/mmc-pty-web-console.py",
]) {
  if (!files.has(required)) throw new Error(`npm pack would omit ${required}`);
}
for (const forbidden of [".gauntlet/logs/smoke.log", "src/cli/run.ts", "test/runtime.test.ts", "dist/test/runtime.test.js"]) {
  if (files.has(forbidden)) throw new Error(`npm pack should not include ${forbidden}`);
}

const help = run(process.execPath, [launcher, "--help"]);
assertIncludes(help, "microcoder web [--port 4180]", "help");
assertIncludes(help, "Alias:", "help");

const snapshot = run(process.execPath, [launcher], { input: "/build status\n/exit\n" });
assertIncludes(snapshot, "Microcoder Build Console", "default launch");
assertIncludes(snapshot, "Fast Keys", "default launch");

const aliasHelp = run(process.execPath, [path.join(root, "bin", "mmc.js"), "--help"]);
assertIncludes(aliasHelp, "microcoder eval validate", "mmc alias help");

console.log("launcher smoke checks passed");
