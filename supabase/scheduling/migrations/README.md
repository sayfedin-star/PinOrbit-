# Project 1 (Scheduling) Database Migrations

This directory contains versioned SQL migrations for Project 1 (Scheduling & Authentication Authority: `eygdoetdwqllvsxpvoex`).

---

## ⚠️ Execution Rule
> **MANDATORY**: Always apply migrations in **strict alphanumeric / filename order** (`YYYYMMDDHHMMSS_*`).

---

## Ordered Migrations Registry

| # | Migration File | Target Area | Dependencies | Status on Live DB (`eygdoetdwqllvsxpvoex`) |
|---|---|---|---|---|
| 1 | `20260808000000_init_scheduling_tenants_and_auth.sql` | Workspaces, memberships, auth tables, RLS bootstrap | None (Base Schema) | Applied |
| 2 | `20260808000001_init_scheduling_accounts_boards_pins.sql` | Accounts, boards, pins, account_webhooks | 20260808000000 | Applied |
| 3 | `20260808000002_init_scheduling_delivery_audit_logs.sql` | Logs, delivery queue, audit records | 20260808000001 | Applied |
| 4 | `20260812000000_harden_membership_bootstrap_and_tier_config_writes.sql` | Membership RPCs, tier write security | 20260808000000 | Applied (Manually via Supabase MCP) |
| 5 | `20260814000000_workspace_retention_settings.sql` | Workspace retention configurations | 20260808000000 | Applied (Manually via Supabase MCP) |
| 6 | `20260815000000_publishing_engine_v2.sql` | Auto-board provisioning, atomic dispatch RPCs | 20260808000001 | Applied (Manually via Supabase MCP) |
| 7 | `20260816000000_posting_schedules.sql` | `posting_schedules` core table & RLS | 20260808000001 | Applied (Manually via Supabase MCP) |
| 8 | `20260817000000_posting_schedules_status_extend.sql` | Extend check constraints for statuses (`not_synced`, `error`) | 20260816000000 | Applied (Manually via Supabase MCP) |
| 9 | `20260818000000_fastcron_tokens_and_schedule_meta.sql` | `fastcron_tokens` table, 5 RLS policies, metadata columns | 20260816000000 | Applied (Manually via Supabase MCP) |
| 10 | `20260819000000_posting_schedules_cron_expression.sql` | `cron_expression` column on `posting_schedules` | 20260816000000 | Applied (Manually via Supabase MCP) |
| 11 | `20260820000000_scheduling_perf_indexes.sql` | Foreign key & status lookup performance indexes | 20260816000000, 20260815000000 | Applied (Manually via Supabase MCP) |
| 12 | `20260821000000_accounts_board_webhook.sql` | `board_webhook_id` on `accounts` table for dedicated board webhooks | 20260808000001 | Applied (Manually via Supabase MCP) |
| 13 | `20260826000000_boards_idempotency_and_purge_cleanup.sql` | Residual cleanup: `boards.created_via_idempotency_key` partial unique index, drop 2-arg purge function | 20260808000001 | Applied (Manually via Supabase MCP) |
| 14 | `20260828000000_retention_telemetry.sql` | `last_cleanup_at`, `last_cleanup_result` telemetry columns | 20260827000000 | Applied (Manually via Supabase MCP) |

---

## Migration Verification Commands

To verify migration states against the live Supabase instance (`eygdoetdwqllvsxpvoex`):

```sql
-- Verify table existence
SELECT to_regclass('public.posting_schedules') IS NOT NULL AS schedules_exists,
       to_regclass('public.fastcron_tokens') IS NOT NULL AS tokens_exists;

-- Verify columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'posting_schedules' 
  AND column_name IN ('cron_expression', 'last_dispatched_at', 'fastcron_token_id');

-- Verify performance indexes
SELECT indexname, tablename 
FROM pg_indexes 
WHERE tablename IN ('posting_schedules', 'board_provisioning_requests', 'fastcron_tokens');
```
