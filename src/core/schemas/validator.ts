import fs from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { findPackageRoot } from "../utils/paths.js";

export type SchemaName =
  | "Attempt"
  | "ConfidenceReport"
  | "DesignPacketV2"
  | "EvidencePacket"
  | "HardwareProfile"
  | "Mission"
  | "ModelRegistry"
  | "PhasePacket"
  | "CompiledSpec"
  | "TaskGraph";

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

const SCHEMA_FILES: Record<SchemaName, string> = {
  Attempt: "attempt.schema.json",
  ConfidenceReport: "confidence.schema.json",
  DesignPacketV2: "design_packet.v2.schema.json",
  EvidencePacket: "evidence_packet.schema.json",
  HardwareProfile: "hardware_profile.schema.json",
  Mission: "mission.schema.json",
  ModelRegistry: "model_registry.schema.json",
  PhasePacket: "phase_packet.schema.json",
  CompiledSpec: "spec.schema.json",
  TaskGraph: "task_graph.schema.json",
};

export class SchemaValidator {
  private readonly validators = new Map<SchemaName, ValidateFunction>();

  constructor(schemaRoot = path.join(findPackageRoot(), "micro_mission_coder_specs", "07_SCHEMAS")) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    for (const [name, file] of Object.entries(SCHEMA_FILES) as [SchemaName, string][]) {
      const schema = JSON.parse(fs.readFileSync(path.join(schemaRoot, file), "utf8"));
      this.validators.set(name, ajv.compile(schema));
    }
  }

  validate(name: SchemaName, value: unknown): ValidationResult {
    const validate = this.validators.get(name);
    if (!validate) return { valid: false, errors: [`unknown schema ${name}`] };
    const valid = validate(value);
    return {
      valid,
      errors: valid
        ? []
        : (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`),
    };
  }

  assert(name: SchemaName, value: unknown): void {
    const result = this.validate(name, value);
    if (!result.valid) {
      throw new Error(`${name} schema validation failed: ${result.errors.join("; ")}`);
    }
  }
}

export function createValidator(): SchemaValidator {
  return new SchemaValidator();
}
