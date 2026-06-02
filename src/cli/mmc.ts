#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./run.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const code = await runCli(argv);
  process.exitCode = code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
