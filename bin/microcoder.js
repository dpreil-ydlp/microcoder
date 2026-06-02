#!/usr/bin/env node
import { runCli } from "../dist/src/cli/run.js";

const args = process.argv.slice(2);
const argv = args.length === 0
  ? ["tui"]
  : args[0] === "web" && (!args[1] || args[1].startsWith("--"))
    ? ["tui", ...args]
    : args;

const code = await runCli(argv);
process.exitCode = code;
