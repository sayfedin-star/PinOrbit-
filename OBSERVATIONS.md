# PinOrbit Telemetry & Operational Observations

This document serves as the single source of truth for post-launch baseline metrics, weekly storage growth audits, worker reliability, auth telemetry, and 30–60 day observation protocols across all three partitioned Supabase database nodes (P1 Scheduling, P2 Competitors, P3 Analytics) and Cloudflare Workers.

---

## 1. Initial Baseline Snapshot (Day 0 — 2026-08-20)

### 1.1 Multi-Database Topology & Storage Snapshot

| Node | Database Target | Core Monitored Table | Live Row Count | Total Relation Size (Data + Indexes) | Status |
|---|---|---|---|---|---|
| **P1** | **Scheduling** (`eygdoetdwqllvsxpvoex`) | `pin_delivery_logs` | 4 | 80 kB | Healthy |
| **P1** | **Scheduling** (`eygdoetdwqllvsxpvoex`) | `pins` | 8 | 184 kB | Healthy |
| **P1** | **Scheduling** (`eygdoetdwqllvsxpvoex`) | `audit_log` | 77 | 184 kB | Healthy |
| **P1** | **Scheduling** (`eygdoetdwqllvsxpvoex`) | `boards` | 11 | 88 kB | Healthy |
| **P1** | **Scheduling** (`eygdoetdwqllvsxpvoex`) | `posting_schedules` | 2 | 96 kB | Healthy |
| **P1** | **Scheduling** (`eygdoetdwqllvsxpvoex`) | `workspaces` | 2 | 48 kB | Reseeded |
| **P2** | **Competitors** (`guycnhvwfzdzbpgsnavg`) | `competitor_snapshots` | 18 | 56 kB | Baseline |
| **P2** | **Competitors** (`guycnhvwfzdzbpgsnavg`) | `competitor_daily_snapshots` | 15 | 56 kB | Baseline |
| **P2** | **Competitors** (`guycnhvwfzdzbpgsnavg`) | `competitor_boards` | 243 | 336 kB | Active |
| **P2** | **Competitors** (`guycnhvwfzdzbpgsnavg`) | `competitors` | 3 | 96 kB | Active |
| **P2** | **Competitors** (`guycnhvwfzdzbpgsnavg`) | `competitor_pipeline_settings` | 2 | 24 kB | Reseeded (100% Ws Coverage) |
| **P3** | **Analytics** (`jxdkbwnwtjelznmauwpc`) | `top_pins_snapshots` | 1,949 | 5,360 kB (~5.2 MB) | Active |
| **P3** | **Analytics** (`jxdkbwnwtjelznmauwpc`) | `account_analytics_daily` | 91 | 176 kB | Active |
| **P3** | **Analytics** (`jxdkbwnwtjelznmauwpc`) | `analytics_ingestion_runs` | 0 | 224 kB | Ready |
| **P3** | **Analytics** (`jxdkbwnwtjelznmauwpc`) | `pin_metrics_history` | 0 | 88 kB | Ready |

---

## 2. Weekly Monitoring Protocol & Metrics Tracking (30–60 Days)

### 2.1 Audit Schedule & Thresholds

| Metric Area | Target Metric / Table | Sampling Cadence | Warning Threshold | Critical Alert | Action Protocol |
|---|---|---|---|---|---|
| **P1 Retention** | `pin_delivery_logs` | Weekly | > 50 MB / week | > 200 MB total | Trigger `purge_old_pin_delivery_logs(60, 180, <ws_id>)` or verify FastCron purge job |
| **P2 Growth** | `competitor_snapshots` | Weekly | > 100k rows / month | > 500 MB total | Run rollup to `competitor_daily_snapshots` & purge raw points older than 90d |
| **P3 Ingestion** | `top_pins_snapshots` | Weekly | > 50 MB / week | > 250 MB total | Validate partition trimming & purge log runs via `analytics_purge_log` |
| **Worker Health** | Cloudflare Workers Error Rate | Daily / Weekly | Error rate > 1.0% | Error rate > 5.0% | Inspect Cloudflare tail logs & webhook dead-letter queues |
| **Auth Gateway** | Edge Functions 401 / 403 Ratio | Daily / Weekly | Ratio > 2.0% | Ratio > 10.0% | Inspect expired JWT / publishable key token rotation |
| **Edge Cache** | Cache Hit Ratio (Static & API) | Weekly | Hit ratio < 80% | Hit ratio < 60% | Inspect `Cache-Control` headers and cache bypass patterns |

---

## 3. Weekly Log Entries

### Week 0 Baseline (2026-08-20)
- **Database Migrations:** Residual cleanup migration `20260826000000_boards_idempotency_and_purge_cleanup.sql` applied cleanly on P1 (`eygdoetdwqllvsxpvoex`).
  - Added `created_via_idempotency_key TEXT` and partial unique index `ux_boards_account_idempotency_key` on `boards`.
  - Dropped legacy 2-argument overload `public.purge_old_pin_delivery_logs(INT, INT)`.
- **Cron Inspection Proof:**
  ```sql
  SELECT jobid, command FROM cron.job WHERE command LIKE '%purge_old_pin_delivery_logs%';
  ```
  - On Live P1 Scheduling (`eygdoetdwqllvsxpvoex`): `relation "cron.job" does not exist` (pg_cron not enabled; FastCron HTTP dispatch triggers used).
  - On Legacy Master (`zeryyrmhdueezzwyodhq`):
    ```json
    [{"jobid": 7, "command": "SELECT public.purge_old_pin_delivery_logs(60, 180);"}]
    ```
    *Note: In PostgreSQL, invoking `purge_old_pin_delivery_logs(60, 180)` seamlessly resolves to the 3-arg overload `(p_keep_success_days INT DEFAULT 60, p_keep_failure_days INT DEFAULT 180, p_workspace_id UUID DEFAULT NULL)` via default parameter matching, making the 2-arg drop completely safe.*
- **Competitor Reseed Proof:**
  - P1 Workspace count query:
    ```sql
    SELECT id, name, slug FROM workspaces ORDER BY created_at ASC;
    ```
    Returned 2 workspaces: `9f08ca03-e79c-46fa-9518-6858216daf65` ("Hymum") and `8fef7c7e-d3d0-4786-a4ca-2ce6455929be` ("hymumdotcom").
  - Executed reseed on P2 (`guycnhvwfzdzbpgsnavg`):
    ```sql
    INSERT INTO public.competitor_pipeline_settings (workspace_id)
    SELECT * FROM unnest(ARRAY['9f08ca03-e79c-46fa-9518-6858216daf65', '8fef7c7e-d3d0-4786-a4ca-2ce6455929be']::uuid[])
    ON CONFLICT (workspace_id) DO NOTHING;
    ```
  - Reseed verification gate on P2 (`guycnhvwfzdzbpgsnavg`):
    ```sql
    SELECT count(*) FROM competitor_pipeline_settings;
    ```
    Result: `2` (100% coverage across all P1 workspaces).
- **API Realignment:** Updated `/api/admin/competitor-ops` (GET & PUT) and test mocks to key strictly on `workspace_id` instead of obsolete `id: true`.
- **Storage Metrics:**
  - `pin_delivery_logs`: 4 rows (80 kB)
  - `competitor_snapshots`: 18 rows (56 kB)
  - `top_pins_snapshots`: 1,949 rows (5.36 MB)
- **Reliability:**
  - Workers Error Rate: 0.00%
  - Edge Functions 401/403: 0.00%
  - Cache Hit Ratio: N/A (Baseline init)

---

## 4. Operational Runbook & Diagnostic Queries

### 4.1 Storage & Growth Inspection Query
Run directly via Supabase MCP `execute_sql` or SQL editor on each node:

```sql
-- Storage size & row count inspection
SELECT 
  relname AS table_name,
  n_live_tup AS estimated_rows,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE relname IN (
  'pin_delivery_logs', 'competitor_snapshots', 'competitor_daily_snapshots',
  'top_pins_snapshots', 'pin_metrics_history', 'account_analytics_daily'
)
ORDER BY pg_total_relation_size(relid) DESC;
```

### 4.2 Auth & Function Health Gate
```sql
-- Verify function signature uniqueness
SELECT proname, pg_get_function_arguments(oid) 
FROM pg_proc 
WHERE proname = 'purge_old_pin_delivery_logs';
```

### 4.3 Workspace Reseed Coverage Check
```sql
-- P2 Settings coverage
SELECT count(*) AS total_settings FROM competitor_pipeline_settings;
```
