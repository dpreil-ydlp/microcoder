import type { HardwareProfile } from "../hardware/profile.js";

export const missionFixture = {
  mission_id: "M-fixture",
  goal: "Add invoice dashboard",
  status: "active",
  created_at: "2026-05-29T00:00:00.000Z",
  updated_at: "2026-05-29T00:00:00.000Z",
  current_task_id: "T1",
  decision_ids: [],
  risk_flags: ["billing"],
};

export const compiledSpecFixture = {
  spec_id: "S-fixture",
  goal: "Add invoice dashboard",
  requirements: [{ id: "R1", text: "Show recent invoices" }],
  acceptance_criteria: [{ id: "AC1", text: "Recent invoices are visible", verification: "npm test" }],
  non_goals: [],
  risk_flags: ["billing"],
};

export const taskGraphFixture = {
  tasks: [
    {
      id: "T1",
      title: "Show recent invoices",
      status: "ready",
      depends_on: [],
      requirement_ids: ["R1"],
      acceptance_ids: ["AC1"],
      allowed_files: [],
      forbidden_files: [],
      verification_commands: ["npm test"],
      risk_flags: ["billing"],
    },
  ],
};

export const attemptFixture = {
  attempt_id: "A-fixture",
  task_id: "T1",
  phase: "code_patch",
  started_at: "2026-05-29T00:00:00.000Z",
  status: "started",
};

export const evidencePacketFixture = {
  packet_id: "E-fixture",
  task_id: "T1",
  repo_sha: "repo",
  index_sha: "index",
  generated_at: "2026-05-29T00:00:00.000Z",
  freshness: "fresh",
  items: [{ id: "EV1", type: "git", source: "repo-brain", summary: "clean tree" }],
};

export const phasePacketFixture = {
  phase: "code_patch",
  task_id: "T1",
  budget_tokens: 4096,
  allowed_actions: ["emit_unified_diff", "request_more_evidence", "decline"],
  allowed_files: ["src/components/InvoiceTable.tsx"],
  evidence_ids: ["EV1"],
  required_output: "unified_diff",
};

export const confidenceFixture = {
  score: 84,
  decision: "accept",
  signals: [
    { name: "tests_passed", value: 1, weight: 50 },
    { name: "scope_clean", value: 1, weight: 34 },
  ],
};

export const hardwareFixture: HardwareProfile = {
  name: "middle_32gb",
  ram_gb: 32,
  vram_gb: 8,
  ssd_gb: 1000,
  parallel_model_calls: 1,
  parallel_test_jobs: 1,
  context_budget_tokens: 8192,
  vision_enabled: false,
  playwright_enabled: true,
};

export const modelRegistryFixture = {
  models: [
    {
      id: "qwen2.5-coder-7b-q4",
      role: "code_writer",
      provider: "ollama",
      state_policy: "warm",
      hardware_min_ram_gb: 24,
      context_limit: 32768,
    },
  ],
};

export const designPacketFixture = {
  packet_version: "design-packet-v2",
  task_id: "T1",
  ui_surface: "dashboard",
  primary_design_source: "existing_repo",
  component_library: "existing",
  open_design: {
    enabled: false,
    selected_system: null,
    selected_skills: [],
    selected_template: null,
    brief_id: null,
  },
  tokens: {},
  allowed_components: [],
  forbidden_components: [],
  required_states: ["loading", "empty", "error", "success"],
  viewports: ["390x844", "768x1024", "1440x900"],
  accessibility_rules: [],
  interaction_rules: [],
  visual_references: [],
  anti_patterns: [],
  verification_questions: ["Does the dashboard avoid console errors?"],
};

export const schemaFixtures = {
  Mission: missionFixture,
  CompiledSpec: compiledSpecFixture,
  TaskGraph: taskGraphFixture,
  Attempt: attemptFixture,
  EvidencePacket: evidencePacketFixture,
  PhasePacket: phasePacketFixture,
  ConfidenceReport: confidenceFixture,
  HardwareProfile: hardwareFixture,
  ModelRegistry: modelRegistryFixture,
  DesignPacketV2: designPacketFixture,
} as const;
