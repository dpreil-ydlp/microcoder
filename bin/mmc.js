#!/usr/bin/env node
import { runCli } from "../dist/src/cli/run.js";

const code = await runCli(process.argv.slice(2));
process.exitCode = code;
