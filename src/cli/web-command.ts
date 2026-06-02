import { saveConfig, validateConfig } from "../core/config/config.js";
import type { MmcConfig } from "../core/config/defaults.js";
import { runWebSearch } from "../core/web/research.js";
import type { CliIO } from "./run.js";
import { parseOptionalBoolean, parseOptionalInteger, validateFlagArgs, valueAfter, valuesAfter } from "./args.js";

export async function runWebSearchCommand(config: MmcConfig, io: CliIO, query: string): Promise<number> {
  if (!query.trim()) {
    io.stderr('web search requires a query, for example: microcoder web search "MDN canvas keyboard events"');
    return 1;
  }
  const packet = await runWebSearch(config, query.trim());
  io.stdout(`web_status ${packet.status}`);
  io.stdout(`provider ${packet.provider}`);
  io.stdout(`query ${packet.query}`);
  if (packet.error) io.stdout(`error ${packet.error}`);
  io.stdout(`results ${packet.results.length}`);
  packet.results.forEach((result, index) => {
    io.stdout(`result ${index + 1}`);
    io.stdout(`title ${result.title}`);
    io.stdout(`url ${result.url}`);
    if (result.snippet) io.stdout(`snippet ${result.snippet}`);
  });
  if (packet.status === "DISABLED") return 2;
  return packet.status === "READY" ? 0 : 7;
}

export function runSetupWebResearchCommand(cwd: string, config: MmcConfig, io: CliIO, args: string[]): number {
  const flagError = validateFlagArgs(args, {
    valueFlags: [
      "--enabled",
      "--auto",
      "--chat",
      "--provider",
      "--url",
      "--search-url",
      "--timeout",
      "--max-results",
      "--max-result-chars",
      "--user-agent",
      "--allow-domain",
    ],
  });
  if (flagError) {
    io.stderr(flagError);
    return 1;
  }
  const enabled = parseOptionalBoolean(valueAfter(args, "--enabled"), "--enabled");
  if (typeof enabled === "string") {
    io.stderr(enabled);
    return 1;
  }
  if (enabled !== undefined) config.web_research.enabled = enabled;
  const auto = parseOptionalBoolean(valueAfter(args, "--auto"), "--auto");
  if (typeof auto === "string") {
    io.stderr(auto);
    return 1;
  }
  if (auto !== undefined) config.web_research.auto_include_in_docs = auto;
  const chat = parseOptionalBoolean(valueAfter(args, "--chat"), "--chat");
  if (typeof chat === "string") {
    io.stderr(chat);
    return 1;
  }
  if (chat !== undefined) config.web_research.auto_include_in_chat = chat;
  const provider = valueAfter(args, "--provider");
  if (provider && !["duckduckgo_html", "custom_json"].includes(provider)) {
    io.stderr("--provider must be duckduckgo_html or custom_json");
    return 1;
  }
  if (provider) config.web_research.provider = provider as "duckduckgo_html" | "custom_json";
  const searchUrl = valueAfter(args, "--url") ?? valueAfter(args, "--search-url");
  if (searchUrl) config.web_research.search_url = searchUrl;
  const timeout = parseOptionalInteger(valueAfter(args, "--timeout"), "--timeout");
  if (typeof timeout === "string") {
    io.stderr(timeout);
    return 1;
  }
  if (timeout !== undefined) config.web_research.timeout_seconds = timeout;
  const maxResults = parseOptionalInteger(valueAfter(args, "--max-results"), "--max-results");
  if (typeof maxResults === "string") {
    io.stderr(maxResults);
    return 1;
  }
  if (maxResults !== undefined) config.web_research.max_results = maxResults;
  const maxResultChars = parseOptionalInteger(valueAfter(args, "--max-result-chars"), "--max-result-chars");
  if (typeof maxResultChars === "string") {
    io.stderr(maxResultChars);
    return 1;
  }
  if (maxResultChars !== undefined) config.web_research.max_result_chars = maxResultChars;
  const userAgent = valueAfter(args, "--user-agent");
  if (userAgent) config.web_research.user_agent = userAgent;
  const allowedDomains = valuesAfter(args, "--allow-domain");
  if (allowedDomains.length) config.web_research.allowed_domains = allowedDomains;

  const errors = validateConfig(config);
  if (errors.length) {
    io.stderr(`config validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    return 1;
  }
  saveConfig(cwd, config);
  io.stdout("web research configured");
  io.stdout(`enabled ${config.web_research.enabled}`);
  io.stdout(`auto_include_in_docs ${config.web_research.auto_include_in_docs}`);
  io.stdout(`auto_include_in_chat ${config.web_research.auto_include_in_chat}`);
  io.stdout(`provider ${config.web_research.provider}`);
  io.stdout(`search_url ${config.web_research.search_url}`);
  io.stdout(`timeout_seconds ${config.web_research.timeout_seconds}`);
  io.stdout(`max_results ${config.web_research.max_results}`);
  io.stdout(`max_result_chars ${config.web_research.max_result_chars}`);
  io.stdout(`allowed_domains ${JSON.stringify(config.web_research.allowed_domains)}`);
  return 0;
}
