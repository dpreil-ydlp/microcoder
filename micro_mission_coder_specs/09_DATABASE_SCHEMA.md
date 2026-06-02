# 09 — Database Schema

Recommended storage: SQLite for metadata plus filesystem for large artifacts.

## Tables

### missions

```sql
CREATE TABLE missions (
  mission_id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  current_task_id TEXT
);
```

### specs

```sql
CREATE TABLE specs (
  spec_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### tasks

```sql
CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  depends_on_json TEXT NOT NULL,
  acceptance_ids_json TEXT NOT NULL,
  allowed_files_json TEXT,
  risk_flags_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### repo_index

```sql
CREATE TABLE repo_index (
  index_sha TEXT PRIMARY KEY,
  repo_sha TEXT NOT NULL,
  status TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  dirty_files_json TEXT NOT NULL
);
```

### evidence_packets

```sql
CREATE TABLE evidence_packets (
  packet_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  repo_sha TEXT NOT NULL,
  index_sha TEXT NOT NULL,
  packet_json TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
```

### attempts

```sql
CREATE TABLE attempts (
  attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  model_id TEXT,
  status TEXT NOT NULL,
  patch_path TEXT,
  confidence_score REAL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
```

### events

```sql
CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  mission_id TEXT,
  task_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### artifacts

```sql
CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  attempt_id TEXT,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL
);
```
