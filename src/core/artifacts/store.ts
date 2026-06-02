import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MmcConfig } from "../config/defaults.js";
import { databasePath, executeStatements, missionDir, sqlString } from "../storage/sqlite.js";

export type ArtifactRecord = {
  artifact_id: string;
  attempt_id?: string | null;
  type: string;
  path: string;
  summary?: string | null;
  created_at: string;
};

export function recordArtifact(
  cwd: string,
  config: MmcConfig,
  artifact: Omit<ArtifactRecord, "artifact_id" | "created_at">,
): ArtifactRecord {
  const record: ArtifactRecord = {
    artifact_id: `ART-${randomUUID().slice(0, 8)}`,
    created_at: new Date().toISOString(),
    ...artifact,
    path: path.isAbsolute(artifact.path) ? path.relative(missionDir(cwd, config), artifact.path) : artifact.path,
  };
  executeStatements(databasePath(cwd, config), [
    `INSERT OR REPLACE INTO artifacts (artifact_id, attempt_id, type, path, summary, created_at)
     VALUES (${sqlString(record.artifact_id)}, ${sqlString(record.attempt_id)}, ${sqlString(record.type)},
     ${sqlString(record.path)}, ${sqlString(record.summary)}, ${sqlString(record.created_at)});`,
  ]);
  return record;
}
