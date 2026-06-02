import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MmcConfig } from "../config/defaults.js";
import { createValidator } from "../schemas/validator.js";
import { missionDir } from "../storage/sqlite.js";
import type { RuntimeTask } from "../spec/compiler.js";
import { recordArtifact } from "../artifacts/store.js";

export type UiSurface = "dashboard" | "landing" | "form" | "chat" | "settings" | "report" | "auth" | "other";

export type DesignPacketV2 = {
  packet_version: "design-packet-v2";
  task_id: string;
  ui_surface: UiSurface;
  primary_design_source: "existing_repo" | "shadcn_ui" | "chatcn" | "open_design" | "user_reference";
  component_library: string;
  open_design: {
    enabled: boolean;
    selected_system: string | null;
    selected_skills: string[];
    selected_template: string | null;
    brief_id: string | null;
  };
  tokens: Record<string, unknown>;
  allowed_components: string[];
  forbidden_components: string[];
  required_states: string[];
  viewports: string[];
  accessibility_rules: string[];
  interaction_rules: string[];
  visual_references: string[];
  anti_patterns: string[];
  verification_questions: string[];
};

export function isFrontendTask(task: RuntimeTask): boolean {
  return /\b(frontend|ui|screen|page|component|dashboard|form|chat|button|modal|view)\b/i.test(
    `${task.title} ${task.description ?? ""} ${(task.risk_flags ?? []).join(" ")}`,
  );
}

export function buildDesignPacketV2(cwd: string, config: MmcConfig, task: RuntimeTask): DesignPacketV2 {
  const surface = classifySurface(task);
  const hasDesignMd = fs.existsSync(path.join(cwd, "DESIGN.md"));
  const hasTailwind = ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.mjs"].some((file) =>
    fs.existsSync(path.join(cwd, file)),
  );
  const componentLibrary =
    surface === "chat" && hasTailwind ? "chatcn" :
    hasTailwind ? "shadcn/ui" :
    "existing";
  const packet: DesignPacketV2 = {
    packet_version: "design-packet-v2",
    task_id: task.id,
    ui_surface: surface,
    primary_design_source: hasDesignMd ? "existing_repo" : componentLibrary === "chatcn" ? "chatcn" : componentLibrary === "shadcn/ui" ? "shadcn_ui" : "existing_repo",
    component_library: componentLibrary,
    open_design: {
      enabled: false,
      selected_system: null,
      selected_skills: [],
      selected_template: null,
      brief_id: null,
    },
    tokens: extractDesignTokens(cwd),
    allowed_components: [],
    forbidden_components: [],
    required_states: ["loading", "empty", "error", "success"],
    viewports: ["390x844", "768x1024", "1440x900"],
    accessibility_rules: [
      "interactive elements must have accessible names",
      "keyboard focus must be visible",
      "content must not visibly overflow required viewports",
    ],
    interaction_rules: surface === "chat" ? ["messages wrap", "code blocks scroll", "failed sends can retry"] : [],
    visual_references: hasDesignMd ? ["DESIGN.md"] : [],
    anti_patterns: ["raw colors when tokens exist", "unverified generated prototype paste"],
    verification_questions: [
      "Does the route load without console or network errors?",
      "Do required states exist and avoid overflow on mobile and desktop?",
    ],
  };
  createValidator().assert("DesignPacketV2", packet);

  const target = path.join(missionDir(cwd, config), "artifacts", "design", `${task.id}-${randomUUID().slice(0, 8)}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  recordArtifact(cwd, config, {
    attempt_id: null,
    type: "design_packet_v2",
    path: target,
    summary: `DesignPacketV2 for ${task.id}`,
  });
  return packet;
}

function classifySurface(task: RuntimeTask): UiSurface {
  const text = `${task.title} ${task.description ?? ""}`.toLowerCase();
  if (text.includes("dashboard")) return "dashboard";
  if (text.includes("landing")) return "landing";
  if (text.includes("form")) return "form";
  if (text.includes("chat") || text.includes("message")) return "chat";
  if (text.includes("setting")) return "settings";
  if (text.includes("report")) return "report";
  if (text.includes("auth") || text.includes("login")) return "auth";
  return "other";
}

function extractDesignTokens(cwd: string): Record<string, unknown> {
  const designFile = path.join(cwd, "DESIGN.md");
  if (!fs.existsSync(designFile)) return {};
  const text = fs.readFileSync(designFile, "utf8");
  return {
    source: "DESIGN.md",
    excerpt: text.slice(0, 1200),
  };
}
