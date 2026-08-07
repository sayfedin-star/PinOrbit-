# PinOrbit Production Migration Runbook & Parity Runbook (Phase 7 Draft)

> **Status:** DRAFT & AUDITED — NO PRODUCTION CUTOVER EXECUTED.  
> **Legacy Production Project (READ ONLY):** `zeryyrmhdueezzwyodhq` (US East / `us-east-1`)  
> **Target Production Projects:**
> - **Project 1 (Scheduling & Auth Authority):** `eygdoetdwqllvsxpvoex` (US West / `us-west-2`)
> - **Project 2 (Competitors - Server-Only):** `guycnhvwfzdzbpgsnavg` (Europe / `eu-west-1`)
> - **Project 3 (Analytics - Server-Only):** `jxdkbwnwtjelznmauwpc` (London / `eu-west-2`)

---

## 1. Executive Summary & Migration Principles

1. **Zero-Downtime Multi-Project Architecture:** The legacy single monolithic Supabase instance is partitioned into three isolated, purpose-built Supabase projects.
2. **Strict Read-Only Legacy Policy:** No writes, migrations, schema alterations, or key rotations shall ever be executed against `zeryyrmhdueezzwyodhq`.
3. **Deterministic UUID Preservation:** Primary keys (`id`), foreign keys (`workspace_id`, `account_id`, `pin_id`, `competitor_id`), and user references (`auth.users.id`) are preserved 1:1 during migration to ensure zero broken relations or media deadlinks.
4. **Asynchronous Aggregation:** All analytics summaries, time-series rollups, and competitor daily snapshots are generated asynchronously via background SQL routines / cron jobs—**never computed synchronously on Astro SSR request paths**.

---

## 2. Legacy-to-Target Table and Column Mappings

### Target Project 1: Scheduling & Auth Authority (`eygdoetdwqllvsxpvoex`)

| Legacy Table (`zeryyrmhdueezzwyodhq`) | Target Table (`eygdoetdwqllvsxpvoex`) | Column Transformations & Handling |
| :--- | :--- | :--- |
| `public.admin_users` | `public.admin_users` | Direct 1:1 migration (`user_id`, `created_at`). |
| `public.workspaces` (derived / synth) | `public.workspaces` | Default tenant generated per legacy owner; `slug` unique-indexed. |
| `public.workspace_memberships` (synth) | `public.workspace_memberships`| Mapped legacy `user_id` as `'owner'` role linked to tenant `workspace_id`. |
| `public.accounts` | `public.accounts` | `id`, `account_name`, `webhook_url`, `max_pins_per_day`, `is_active`, `workspace_id` assigned. |
| `public.account_webhooks` | `public.account_webhooks` | `id`, `account_id`, `webhook_url`, `monthly_capacity`, `priority`, `is_active`. |
| `public.account_posting_windows` | `public.account_posting_windows`| `id`, `account_id`, `day_of_week`, `posting_time`, `is_active`. |
| `public.boards` | `public.boards` | `id`, `workspace_id`, `account_id`, `board_name`, `board_id`, `created_at`. |
| `public.pins` | `public.pins` | `id`, `workspace_id`, `account_id`, `title`, `description`, `image_url`, `board_name`, `link`, `status`, `source`, `scheduled_for`, `attempts`. |
| `public.pin_delivery_logs` | `public.pin_delivery_logs` | `id`, `pin_id`, `attempt_no`, `event_type`, `provider`, `http_status`, `error_code`, `error_message`, `metadata`, `created_at`. |
| `public.logs` | `public.logs` | `id`, `pin_id`, `account_id`, `webhook_id`, `status`, `message`, `event_type`, `created_at`. |
| `public.audit_log` | `public.audit_log` | `id`, `table_name`, `record_id`, `action`, `old_data`, `new_data`, `changed_by`, `changed_at`. |

---

### Target Project 2: Competitors (`guycnhvwfzdzbpgsnavg`)

| Legacy Table (`zeryyrmhdueezzwyodhq`) | Target Table (`guycnhvwfzdzbpgsnavg`) | Column Transformations & Handling |
| :--- | :--- | :--- |
| `public.competitors` | `public.competitors` | `id`, `workspace_id`, `username`, `full_name`, `niche`, `profile_reach`, `profile_views`, `follower_count`, `pin_count`, `notes`, `tags`, `account_type`. |
| `public.competitor_boards` | `public.competitor_boards` | `id`, `workspace_id`, `competitor_id`, `board_id`, `name`, `description`, `url`, `pin_count`, `follower_count`, `last_pinned_at`. |
| `public.competitor_snapshots` | `public.competitor_snapshots` | `id`, `competitor_id`, `profile_reach`, `profile_views`, `follower_count`, `pin_count`, `recorded_at`. |
| `public.competitor_daily_snapshots` | `public.competitor_daily_snapshots`| `id`, `competitor_id`, `snapshot_date`, `profile_reach`, `profile_views`, `follower_count`, `pin_count`. Deduplicated on `(competitor_id, snapshot_date)`. |

---

### Target Project 3: Analytics (`jxdkbwnwtjelznmauwpc`)

| Legacy Table (`zeryyrmhdueezzwyodhq`) | Target Table (`jxdkbwnwtjelznmauwpc`) | Column Transformations & Handling |
| :--- | :--- | :--- |
| `public.import_sessions` | `public.import_sessions` | `id`, `workspace_id`, `account_id`, `source_type`, `total_rows`, `valid_rows`, `imported_rows`, `created_at`. |
| `public.pin_metrics_history` (synth) | `public.pin_metrics_history` | Historical pin metrics with `impressions >= 0`, `saves >= 0`, `clicks >= 0`. |
| `public.url_performance_history` (synth)| `public.url_performance_history`| Destination URLs deduplicated on `(workspace_id, destination_url, period_date)`. |
| `public.board_analytics_rollups` (synth)| `public.board_analytics_rollups`| Daily board impressions and saves deduplicated on `(workspace_id, board_id, period_date)`. |
| `public.daily_workspace_analytics` (synth)| `public.daily_workspace_analytics`| Daily tenant throughput rollups deduplicated on `(workspace_id, metric_date)`. |

---

## 3. ETL Sequencing & Pipeline Execution

```
                       [1. Extract from Legacy]
                     (Read-Only Streamed SELECT)
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   [2A. Project 1 ETL]     [2B. Project 2 ETL]     [2C. Project 3 ETL]
   - auth.users (Supabase) - competitors           - import_sessions
   - workspaces            - competitor_boards     - pin_metrics_history
   - memberships           - competitor_snapshots  - daily_workspace_analytics
   - accounts & webhooks   - daily_snapshots
   - boards & pins
   - delivery & audit logs
          │                       │                       │
          └───────────────────────┼───────────────────────┘
                                  ▼
                   [3. Delta Sync & Catch-up]
                                  │
                   [4. Parity & Checksum Audit]
                                  │
                   [5. Production Traffic Cutover]
```

### Execution Steps
1. **Auth & Identity Backfill (Project 1):** Export legacy users and import to Project 1 Auth Authority using Supabase Admin API.
2. **Tenancy Hierarchy Ingestion (Project 1):** Create `workspaces` and `workspace_memberships` matching user accounts.
3. **Core Entities Ingestion (Project 1):** Insert `accounts`, `account_webhooks`, `account_posting_windows`, `boards`, and `pins` preserving original UUIDs.
4. **Operational Logs Ingestion (Project 1):** Insert historical `pin_delivery_logs`, `logs`, and `audit_log`.
5. **Competitors Migration (Project 2):** Insert `competitors` (with mapped `workspace_id`), followed by `competitor_boards`, `competitor_snapshots`, and `competitor_daily_snapshots`.
6. **Analytics Migration (Project 3):** Ingest historical `import_sessions` and pre-seed initial rollups.

---

## 4. Parity Validation Queries & Checksums

### A. Row Count Verification Query
```sql
-- Execute on Legacy vs Target Project 1
SELECT 
    'accounts' AS table_name, count(*) AS total_rows FROM public.accounts
UNION ALL
SELECT 'boards', count(*) FROM public.boards
UNION ALL
SELECT 'pins', count(*) FROM public.pins
UNION ALL
SELECT 'account_webhooks', count(*) FROM public.account_webhooks
UNION ALL
SELECT 'pin_delivery_logs', count(*) FROM public.pin_delivery_logs;
```

### B. Min/Max Timestamp Consistency Check
```sql
SELECT 
    min(created_at) AS earliest_pin,
    max(created_at) AS latest_pin,
    min(scheduled_for) AS earliest_scheduled,
    max(scheduled_for) AS latest_scheduled
FROM public.pins;
```

### C. Deterministic Ordered Checksum Validation
```sql
-- Compute MD5 checksum of all active pins in exact primary key order
SELECT md5(string_agg(id::text || status || coalesce(image_url, '') || coalesce(scheduled_for::text, ''), ',' ORDER BY id)) AS pins_checksum
FROM public.pins;

-- Compute MD5 checksum of competitor records
SELECT md5(string_agg(id::text || username || profile_reach::text || follower_count::text, ',' ORDER BY id)) AS competitors_checksum
FROM public.competitors;
```

---

## 5. Write-Freeze, Cutover & Rollback Runbook

### Step 1: Pre-Cutover Freeze
- Set queue processor in maintenance mode on legacy worker.
- Drain in-flight queue jobs.
- Verify pending pins count remains static.

### Step 2: Final Delta Sync
- Execute delta ETL script querying `WHERE updated_at > :last_sync_timestamp`.
- Run Checksum queries across all three databases. Ensure 100% parity match.

### Step 3: DNS & Cloudflare Routing Switch
- Deploy Astro SSR application with updated production environment variables:
  * `PUBLIC_SUPABASE_URL` -> Project 1 URL (`eygdoetdwqllvsxpvoex`)
  * `PUBLIC_SUPABASE_ANON_KEY` -> Project 1 Publishable Key
  * `SCHEDULING_SUPABASE_SECRET_KEY` -> Project 1 Secret Key
  * `COMPETITORS_SUPABASE_SECRET_KEY` -> Project 2 Secret Key
  * `ANALYTICS_SUPABASE_SECRET_KEY` -> Project 3 Secret Key
- Activate Cloudflare Pages deployment.

### Step 4: Post-Cutover Health Check
- Verify login authentication on Project 1.
- Verify board and pin listing on Project 1.
- Verify competitor dashboard rendering on Project 2.
- Verify analytics ingestion on Project 3.

### Rollback & Emergency Recovery Protocol
If critical unresolvable data divergence occurs within the first 60 minutes of cutover:
1. Re-point Cloudflare Pages environmental routes to the legacy read-only endpoint.
2. Re-enable legacy worker dispatch.
3. No data loss occurs on legacy since legacy production database was never modified.
