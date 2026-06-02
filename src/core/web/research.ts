import type { MmcConfig } from "../config/defaults.js";
import type { RuntimeTask } from "../spec/compiler.js";

export type WebResearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type WebResearchPacket = {
  status: "DISABLED" | "READY" | "SEARCH_FAILED";
  provider: MmcConfig["web_research"]["provider"];
  query: string;
  generated_at: string;
  results: WebResearchResult[];
  error?: string;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function buildWebResearchQuery(task: RuntimeTask, packageVersions: Record<string, string>): string {
  const libraries = Object.keys(packageVersions)
    .filter((name) => taskMatchesLibrary(task, name))
    .slice(0, 4)
    .join(" ");
  return [task.title, task.description, libraries, "official documentation examples"]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function runWebSearch(config: MmcConfig, query: string, fetchImpl: FetchLike = fetch): Promise<WebResearchPacket> {
  const base = {
    provider: config.web_research.provider,
    query,
    generated_at: new Date().toISOString(),
    results: [],
  };
  if (!config.web_research.enabled) return { ...base, status: "DISABLED" };
  if (!query.trim()) return { ...base, status: "SEARCH_FAILED", error: "search query is empty" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.web_research.timeout_seconds * 1000);
  try {
    const url = buildSearchUrl(config.web_research.search_url, query);
    const response = await fetchImpl(url, {
      headers: { "user-agent": config.web_research.user_agent, accept: config.web_research.provider === "custom_json" ? "application/json" : "text/html" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ...base, status: "SEARCH_FAILED", error: `search endpoint returned HTTP ${response.status}` };
    }
    const text = await response.text();
    const parsed =
      config.web_research.provider === "custom_json"
        ? parseCustomJsonResults(text, config.web_research.max_result_chars)
        : parseDuckDuckGoHtmlResults(text, config.web_research.max_result_chars);
    const results = filterResultsByDomain(parsed, config.web_research.allowed_domains).slice(0, config.web_research.max_results);
    return { ...base, status: "READY", results };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "search timed out" : (error as Error).message;
    return { ...base, status: "SEARCH_FAILED", error: message };
  } finally {
    clearTimeout(timeout);
  }
}

function taskMatchesLibrary(task: RuntimeTask, library: string): boolean {
  const haystack = `${task.title} ${task.description ?? ""} ${(task.allowed_files ?? []).join(" ")}`.toLowerCase();
  return haystack.includes(library.toLowerCase().split("/").pop() ?? library.toLowerCase());
}

function buildSearchUrl(template: string, query: string): string {
  if (template.includes("{q}")) return template.replaceAll("{q}", encodeURIComponent(query));
  const url = new URL(template);
  url.searchParams.set("q", query);
  return url.toString();
}

function parseCustomJsonResults(text: string, maxChars: number): WebResearchResult[] {
  const parsed = JSON.parse(text) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.results)
      ? parsed.results
      : isRecord(parsed) && Array.isArray(parsed.data)
        ? parsed.data
        : [];
  return rows.map((row) => normalizeResult(row, maxChars)).filter((row): row is WebResearchResult => Boolean(row));
}

function parseDuckDuckGoHtmlResults(html: string, maxChars: number): WebResearchResult[] {
  const results: WebResearchResult[] = [];
  const anchorRegex = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) && results.length < 20) {
    const afterAnchor = html.slice(anchorRegex.lastIndex, anchorRegex.lastIndex + 2400);
    const snippet =
      afterAnchor.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i)?.[1] ?? "";
    const result = normalizeResult(
      {
        title: stripHtml(match[2]),
        url: normalizeDuckDuckGoUrl(match[1]),
        snippet: stripHtml(snippet),
      },
      maxChars,
    );
    if (result) results.push(result);
  }
  return results;
}

function normalizeResult(value: unknown, maxChars: number): WebResearchResult | null {
  if (!isRecord(value)) return null;
  const title = trimField(String(value.title ?? ""), 240);
  const url = String(value.url ?? value.href ?? "");
  const snippet = trimField(String(value.snippet ?? value.description ?? value.body ?? ""), maxChars);
  if (!title || !isHttpUrl(url)) return null;
  return { title, url, snippet };
}

function normalizeDuckDuckGoUrl(raw: string): string {
  const decoded = decodeEntities(raw);
  try {
    const parsed = new URL(decoded, "https://duckduckgo.com");
    const target = parsed.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : parsed.toString();
  } catch {
    return decoded;
  }
}

function filterResultsByDomain(results: WebResearchResult[], allowedDomains: string[]): WebResearchResult[] {
  const allowed = allowedDomains.map((domain) => domain.toLowerCase());
  if (!allowed.length) return results;
  return results.filter((result) => {
    try {
      const host = new URL(result.url).hostname.toLowerCase();
      return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  });
}

function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function trimField(value: string, maxChars: number): string {
  const stripped = stripHtml(value);
  return stripped.length > maxChars ? `${stripped.slice(0, maxChars - 1)}...` : stripped;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
