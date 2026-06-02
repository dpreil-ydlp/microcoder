import fs from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli/run.js";
import { loadConfig, saveConfig, validateConfig } from "../../src/core/config/config.js";
import { databasePath, initializeDatabase } from "../../src/core/storage/sqlite.js";
import { createValidator } from "../../src/core/schemas/validator.js";
import { schemaFixtures } from "../../src/core/schemas/fixtures.js";
import { compileSpecInput } from "../../src/core/spec/compiler.js";
import { applyPatchInWorktree, coerceToUnifiedDiff, validatePatchScope } from "../../src/core/harness/patch.js";
import { runVerificationPlan, validateCommandAllowed } from "../../src/core/verifier/runner.js";
import { handleInternalApi } from "../../src/core/api/handlers.js";
import { selectOpenDesignAssets } from "../../src/core/design-brain/adapters/open-design/adapter.js";
import { generateFromModel, probeModelProvider, routeModel } from "../../src/core/models/orchestrator.js";
import { buildPhasePacket } from "../../src/core/context/phase-packet.js";
import { buildDocsPacket } from "../../src/core/docs/brain.js";
import { buildEvidencePacket } from "../../src/core/repo/brain.js";
import { parseTuiCommand } from "../../src/cli/tui.js";

export {
  applyPatchInWorktree,
  buildDocsPacket,
  buildEvidencePacket,
  buildPhasePacket,
  coerceToUnifiedDiff,
  compileSpecInput,
  createValidator,
  databasePath,
  describe,
  expect,
  fs,
  generateFromModel,
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
  validateCommandAllowed,
  validateConfig,
  validatePatchScope,
  vi,
};

export function tempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mmc-test-"));
}

export function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    stdout,
    stderr,
  };
}

export function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

export async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

export async function startFakeLlamaHttpServer(responseText = "FAKE_LLAMA_OK"): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    if (request.url === "/health" || request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", data: [] }));
      return;
    }
    if (request.url === "/v1/chat/completions" && request.method === "POST") {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: responseText } }] }));
      });
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export async function startFakeSearchServer(): Promise<{ url: string; requests: string[]; close: () => Promise<void> }> {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url?.startsWith("/search")) {
      const url = new URL(request.url, "http://127.0.0.1");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          results: [
            {
              title: `Docs for ${url.searchParams.get("q")}`,
              url: "https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API",
              snippet: "Canvas API reference with better keyboard-friendly browser game examples.",
            },
          ],
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/search?q={q}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export function writeFakeLlamaServer(cwd: string): string {
  const file = path.join(cwd, "fake-llama-server.mjs");
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node
import http from "node:http";
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const host = valueAfter("--host", "127.0.0.1");
const port = Number(valueAfter("--port", "0"));
const server = http.createServer((request, response) => {
  if (request.url === "/health" || request.url === "/v1/models") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", data: [] }));
    return;
  }
  if (request.url === "/v1/chat/completions" && request.method === "POST") {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "FAKE_LLAMACPP_PROCESS_OK" } }] }));
    });
    return;
  }
  response.writeHead(404);
  response.end("not found");
});
server.listen(port, host);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
    "utf8",
  );
  fs.chmodSync(file, 0o755);
  return file;
}
