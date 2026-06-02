import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MmcConfig } from "../config/defaults.js";
import { databasePath, missionDir, runSqlite, sqlJson, sqlString } from "../storage/sqlite.js";

export type TraceEvent = {
  event_id: string;
  mission_id?: string | null;
  task_id?: string | null;
  event_type: string;
  payload: unknown;
  created_at: string;
};

export function appendEvent(
  cwd: string,
  config: MmcConfig,
  event: Omit<TraceEvent, "event_id" | "created_at">,
): TraceEvent {
  const full: TraceEvent = {
    event_id: randomUUID(),
    created_at: new Date().toISOString(),
    ...event,
  };
  const jsonl = path.join(missionDir(cwd, config), "events.jsonl");
  fs.appendFileSync(jsonl, `${JSON.stringify(full)}\n`, "utf8");

  const db = databasePath(cwd, config);
  if (fs.existsSync(db)) {
    runSqlite(
      db,
      `INSERT OR REPLACE INTO events (event_id, mission_id, task_id, event_type, payload_json, created_at)
       VALUES (${sqlString(full.event_id)}, ${sqlString(full.mission_id)}, ${sqlString(full.task_id)},
       ${sqlString(full.event_type)}, ${sqlJson(full.payload)}, ${sqlString(full.created_at)});`,
    );
  }
  return full;
}
