# PinOrbit Architecture & System Specification

## 1. System Layer Diagram

```mermaid
flowchart TD
    subgraph UI_Layer [UI Layer: Astro SSR + Tailwind]
        AccountsPage[Accounts Overview /accounts]
        AccountDetails[Account Details /accounts/details?id=...]
        AccountPins[Account Pins /accounts/pins?id=...]
        AccountBoards[Account Boards /accounts/boards?id=...]
        PipelineKit[Board Pipeline Kit /accounts/board-pipeline]
    end

    subgraph API_Funnels [API Funnels: Server-Side Astro Endpoints]
        SchedulesAPI[/api/schedules & /api/schedules/bulk]
        BoardsAPI[/api/boards/action]
        TokensAPI[/api/fastcron-tokens]
        RetentionAPI[/api/internal/pinterest/cleanup-retention]
    end

    subgraph Dispatch_Engine [Dispatch Engine with Strict Guards]
        DispatchEndpoint[/api/internal/pinterest/dispatch-due-pin]
        ScheduleGuard[Window, Timezone & Day-Off Validator]
        AccountCapGuard[Daily Max Pins Cap Checker]
        AtomicClaim[claim_due_pins_simple RPC with SKIP LOCKED]
        OrphanSweep[Per-Workspace Timeout Stale Lock Sweep]
    end

    subgraph FastCron_Engine [FastCron Portable Cron Trigger]
        FastCronExternal[FastCron External Service]
        SelfContainedCron[Portable Cron Expressions / URL Dispatch Tokens]
    end

    subgraph Bridge_Layer [Make.com: Stateless Pinterest Bridge]
        MakeScenario1[Make Scenario 1: Pin Publisher]
        MakeScenario2[Make Scenario 2: Board Provisioner]
        MakeScenario3[Make Scenario 3: Boards Synchronizer]
        PinterestAPI[Pinterest Official API v5]
    end

    subgraph Ingest_Layer [Ingest Callbacks]
        IngestEndpoint[/api/internal/pinterest/ingest]
        SecretAuth[x-ingest-secret Authenticator]
        IdempotencyDedupe[Idempotency Key Deduplication]
    end

    subgraph Database_Layer [Supabase Postgres (P1) + Tenant Isolation]
        RLSPolicies[Row Level Security auth.uid in workspace_memberships]
        Tables[pins, boards, posting_schedules, account_webhooks, workspace_retention_settings, fastcron_tokens, audit_log]
    end

    UI_Layer --> API_Funnels
    FastCronExternal -->|GET with dispatch_token| DispatchEndpoint
    API_Funnels --> Database_Layer
    DispatchEndpoint --> ScheduleGuard --> AccountCapGuard --> OrphanSweep --> AtomicClaim
    AtomicClaim -->|Ticket Push application/json| Bridge_Layer
    Bridge_Layer --> PinterestAPI
    Bridge_Layer -->|Callback event: pin.posted / board.created| IngestEndpoint
    IngestEndpoint --> SecretAuth --> IdempotencyDedupe --> Database_Layer
```

---

## 2. Decision Log (Decision log)

### 1. Make.com as Stateless Bridge Only
- **Context:** PinOrbit avoids executing heavy direct OAuth token management or unvetted external SDKs directly inside serverless edge workers.
- **Decision:** Make.com scenarios act strictly as stateless connectors / API proxies to Pinterest. All orchestration logic, queue management, retry scheduling, pacing, state machines, and data stores reside solely in PinOrbit (Supabase + Cloudflare/Astro). Scenarios parse incoming tickets, call Pinterest, and dispatch standard callback events back to `/api/internal/pinterest/ingest`.

### 2. Portable, Self-Contained Cron Expressions & Triggers
- **Context:** FastCron triggers must work reliably without shared server state or tight coupling to local cron processes.
- **Decision:** Schedules generate deterministic, self-contained cron expressions calculated from `window_start`, `window_end`, `interval_minutes`, `active_days`, and `timezone`. When dispatched, FastCron calls the endpoint with unique UUID `dispatch_token` credentials so execution requires zero pre-warmed sessions.

### 3. Write-Only Secrets with Auto-Seeded `TOKEN_KEK`
- **Context:** API tokens (FastCron API tokens, ingest secrets) must never leak to client JavaScript or browser logs.
- **Decision:** Tokens are encrypted at rest using AES-GCM via a cryptographically secure Key Encryption Key (`TOKEN_KEK`). Read endpoints never return decrypted tokens; UI inputs are write-only overrides. Default tokens cascade cleanly: Schedule Token $\rightarrow$ Workspace Token $\rightarrow$ Environment Default.

### 4. Deterministic Idempotency Keys
- **Context:** Network retries, webhook deliveries, and concurrency can cause duplicate pins or boards.
- **Decision:** Every dispatched ticket and callback payload carries an explicit `idempotency_key` (e.g., `pin.post:<pin_id>:<attempt>`, `create:<account_id>:<board_name>`). Supabase upsert rules and ingest handlers deduplicate on this key, preventing race conditions.

### 5. Account-Centric Navigation Architecture & Sidebar Cleanup
- **Context:** Global multi-tenant lists for pins, boards, and schedules created cognitive overload and routing ambiguities.
- **Decision:** Management was reorganized strictly per-account (`/accounts/details?id=...`, `/accounts/pins?id=...`, `/accounts/boards?id=...`). Global `/boards`, `/pins`, and `/schedules` issue 302 redirects to `/accounts`. Sidebar surface was streamlined to 6 primary roots: Dashboard, Accounts, Logs, Competitors, Analytics, Settings.

### 6. Strict Board Retention & Pagination Safety
- **Context:** Pinterest accounts with large numbers of boards (>50) might suffer silent deletion if syncer callbacks pagination failed.
- **Decision:** PinOrbit never automatically deletes boards that are absent from a remote Pinterest sync. Deletion is either explicit Pinterest API delete with confirmation or local row detachment via `delete_local`.

---

## 3. Database Migrations & Versioning

All migrations must be applied sequentially in chronological order matching the filenames in `supabase/migrations/`:

| Order | Migration Filename | Core Responsibilities |
|---|---|---|
| 1 | `20260803000000_create_pinorbit_schema.sql` | Baseline PinOrbit schema, accounts, pins, boards, logs |
| 2 | `20260803_account_scheduling.sql` | Account schedule interval & window baseline |
| 3 | `20260803_add_scheduled_for_to_pins.sql` | `scheduled_for` column on pins table |
| 4 | `20260803_audit_logging.sql` | `audit_log` table with RLS |
| 5 | `20260803_multi_webhooks.sql` | `account_webhooks` multi-channel table |
| 6 | `20260803_secure_admin_actions.sql` | Secure admin functions and permissions |
| 7 | `20260804_account_active_days.sql` | Active days array for scheduling |
| 8 | `20260804_account_posting_interval.sql` | Pacing intervals |
| 9 | `20260804_account_random_delay.sql` | Random delay jitter for scheduling |
| 10 | `20260804_board_auto_provisioning.sql` | `board_provisioning_requests` table |
| 11 | `20260804_performance_indexes_and_relationships.sql` | Foreign key performance indexes |
| 12 | `20260804_pins_retry_system.sql` | `retry_count`, `next_retry_at`, `max_retries` |
| 13 | `20260804_scheduler_mvp_schema.sql` | Scheduler queue constraints |
| 14 | `20260804_setup_pg_cron.sql` | pg_cron scheduling foundations |
| 15 | `20260805_competitor_intelligence.sql` | Competitor tracking & snapshot tables |
| 16 | `20260805_fix_pacing_engine.sql` | Pacing calculation logic fixes |
| 17 | `20260805_optimize_cron_logs_indexes.sql` | Log index optimizations |
| 18 | `20260805_precomputed_pacing_engine.sql` | Fast pacing precomputation |
| 19 | `20260805_setup_competitor_cron.sql` | Competitor daily ingestion job |
| 20 | `20260806190000_production_master_security_and_rollups.sql` | Master RLS policies & rollup views |
| 21 | `20260806194000_add_workspaces_mvp.sql` | Multi-tenant `workspaces` and `workspace_memberships` |
| 22 | `20260807040000_db_retention_and_queue_cleanup.sql` | Queue cleanup procedures |
| 23 | `20260807050000_account_timezones_and_posting_slots.sql` | Account timezone definitions |
| 24 | `20260807060000_pins_slimming_and_pin_delivery_logs.sql` | Pin record slimming and delivery logs |
| 25 | `20260809233000_add_fastcron_token_to_analytics_connections.sql` | Analytics connection token fields |
| 26 | `20260818000000_fastcron_tokens_and_schedule_meta.sql` | `fastcron_tokens` table & `posting_schedules` meta |
| 27 | `20260822000000_boards_enrichment.sql` | Board metrics: `pin_count`, `follower_count`, `last_synced_at` |
| 28 | `20260823000000_webhook_execution_counters.sql` | `executions_used` counters for webhook rate monitoring |
| 29 | `20260824000000_pins_claimed_at_and_ws_timeouts.sql` | `claimed_at`, `workspace_retention_settings`, timeout sweep |

---

## 4. Live Make Specification Source

> [!NOTE]
> **Board Pipeline Kit Page:** The interactive page at `/accounts/board-pipeline` (`src/pages/accounts/board-pipeline.astro`) serves as the definitive, executable live specification for all Make.com scenarios.
>
> It dynamically renders verbatim JSON templates for:
> - **Route 1 (Board Creation):** `board.created`
> - **Route 2 (Board Listing & Sync):** `board.created` (per-item bundle iterator)
> - **Route 3 (Board Deletion):** `board.deleted`
> - **Publish Webhooks (Pin Posting):** `pin.posted` (success) & `pin.failed` (error handler route)

---

## 5. Accepted Risks & Architectural Trade-offs

1. **No Rate-Limiter Middleware on Dispatch Endpoints:**
   - *Risk:* Ingestion and dispatch routes receive unthrottled requests.
   - *Mitigation:* Dispatch endpoints require secret UUID tokens (`dispatch_token`) and ingest routes validate `x-ingest-secret`. Invalid calls immediately terminate with lightweight HTTP 401/403/404 responses before running database operations.
2. **FastCron Free-Tier GET Query String Identity:**
   - *Risk:* Free-tier cron runners only trigger HTTP GET requests without custom request headers.
   - *Mitigation:* Dispatch endpoints accept authenticated credentials via query string (`schedule_id` + `dispatch_token`) matching server-stored values.
3. **External Network Timeouts:**
   - *Risk:* Downstream Make.com or Pinterest latency could block worker threads.
   - *Mitigation:* All outgoing HTTP requests employ strict `AbortSignal.timeout(8000)` timeouts wrapped in `try/catch` fallbacks to ensure fail-safe operation.
