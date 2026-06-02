import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function expectIncludes(relativePath, text) {
  const body = read(relativePath);
  if (!body.includes(text)) fail(`${relativePath} does not include ${JSON.stringify(text)}`);
}

function expectNotIncludes(relativePath, text) {
  const body = read(relativePath);
  if (body.includes(text)) fail(`${relativePath} still includes stale ${JSON.stringify(text)}`);
}

const pkg = readJson("package.json");
const expectedFiles = [
  "12_MODEL_PROFILES.yaml",
  "README.md",
  "bin/",
  "dist/",
  "micro_mission_coder_specs/07_SCHEMAS/",
  "tools/",
];
if (JSON.stringify(pkg.files) !== JSON.stringify(expectedFiles)) {
  fail("package.json files must explicitly include runtime assets and exclude generated proof logs");
}
if (!pkg.scripts?.build?.includes("tsconfig.build.json")) {
  fail("package.json build script must compile the runtime-only tsconfig");
}
expectIncludes("tsconfig.build.json", '"include": ["src/**/*.ts"]');
if (pkg.bin?.microcoder !== "./bin/microcoder.js") {
  fail("package.json must expose microcoder as ./bin/microcoder.js");
}
if (pkg.bin?.mmc !== "./bin/mmc.js") {
  fail("package.json must expose mmc as ./bin/mmc.js");
}

const lock = readJson("package-lock.json");
const rootPackage = lock.packages?.[""];
if (rootPackage?.bin?.microcoder !== "bin/microcoder.js") {
  fail("package-lock.json root bin must include microcoder");
}
if (rootPackage?.bin?.mmc !== "bin/mmc.js") {
  fail("package-lock.json root bin must include mmc alias");
}

for (const binFile of ["bin/microcoder.js", "bin/mmc.js"]) {
  const mode = fs.statSync(path.join(root, binFile)).mode;
  if ((mode & 0o111) === 0) fail(`${binFile} must be executable`);
}

expectIncludes("bin/microcoder.js", "#!/usr/bin/env node");
expectIncludes("bin/microcoder.js", '["tui"]');
expectIncludes("bin/microcoder.js", 'args[0] === "web"');
expectIncludes("bin/mmc.js", "#!/usr/bin/env node");
expectIncludes("bin/mmc.js", "runCli(process.argv.slice(2))");
expectNotIncludes("bin/mmc.js", "import { main }");
expectIncludes("src/cli/run.ts", "microcoder web [--port 4180]");
expectIncludes("src/cli/run.ts", "Alias:");
expectIncludes("src/cli/run.ts", "microcoder eval chat-lab");
expectIncludes("src/cli/run.ts", "microcoder eval build-lab");
expectIncludes("src/cli/run.ts", "chat_lab_status");
expectIncludes("src/cli/run.ts", "build_lab_status");
expectIncludes("src/cli/tui.ts", "microcoder> ");
expectIncludes("src/cli/tui.ts", "$ microcoder");
expectIncludes("src/cli/tui.ts", "const packageRoot = findPackageRoot()");
expectIncludes("src/cli/tui.ts", 'path.join(packageRoot, "dist", "src", "cli", "mmc.js")');
expectIncludes("src/cli/tui.ts", "signal ? 1 : code ?? 0");
expectIncludes("src/cli/mission-command.ts", "docsPacket");
expectIncludes("src/core/context/phase-packet.ts", "docs_slice");
expectIncludes("micro_mission_coder_specs/07_SCHEMAS/phase_packet.schema.json", '"docs_slice"');
expectIncludes("src/core/models/orchestrator.ts", "findPackageRoot()");
expectIncludes("src/core/models/orchestrator.ts", 'path.join(packageRoot, "12_MODEL_PROFILES.yaml")');
expectIncludes("src/core/config/defaults.ts", '"npm run typecheck"');
expectIncludes("src/core/config/defaults.ts", '"npx playwright test"');
expectIncludes("src/core/utils/ignore.ts", '".gauntlet"');
expectIncludes(".gitignore", ".gauntlet/");
expectIncludes(".gitignore", "gauntlet-report.md");
expectIncludes("src/core/repo/brain.ts", "shouldIgnoreWorkspaceEntry");
expectIncludes("src/core/evaluation/local-benchmark.ts", "pathContainsIgnoredWorkspaceDir");
expectIncludes("tools/mmc-pty-web-console.py", "Microcoder PTY Console");
expectIncludes("scripts/uat-conversation-gauntlet.mjs", "conversation UAT gauntlet passed");
expectIncludes("package.json", "scripts/uat-conversation-gauntlet.mjs");
expectIncludes("package.json", "test:uat:cli");
expectIncludes("package.json", "test:uat:browser");
expectIncludes("package.json", "chat:lab");
expectIncludes("package.json", "build:lab");
expectIncludes("README.md", "microcoder web --port 4180");
expectNotIncludes("README.md", "npm run mmc -- tui");
expectNotIncludes("src/cli/tui.ts", "mmc> ");
expectNotIncludes("src/cli/tui.ts", "$ mmc");
expectNotIncludes("tools/mmc-pty-web-console.py", "MMC PTY Console");

if (failures.length > 0) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log("static launcher/package/docs checks passed");
