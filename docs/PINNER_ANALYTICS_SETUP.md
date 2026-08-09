# Pinner Analytics Control Plane & Orchestration Guide (V15 Final Locked)

This guide documents the production orchestration architecture, FastCron automated scheduling integration, Make.com dual scenario blueprints, and Astro SSR ingestion pipeline for PinOrbit's multi-tenant Pinterest analytics system.

---

## 1. System Architecture Overview

```
FastCron Job A (04:00 UTC)                FastCron Job B (04:30 UTC)
    ↓                                          ↓
Make.com Scenario A (Account Analytics)    Make.com Scenario B (Top Pins Iterator)
    │                                          │
    ↓                                          ↓
Pinterest API: /v5/user_account/analytics  Pinterest API: /v5/user_account/analytics/top_pins
    │ (Handles 429 backoff in Make)            │ (Iterates 5 sort modes: IMPRESSION, OUTBOUND, etc.)
    │                                          │
    └────────────────────┬─────────────────────┘
                         ↓
   HTTP POST https://pinorbit-v2.o-i.workers.dev/api/internal/pinterest/ingest
                         │
               Astro SSR Ingestion Engine
       ├── Validates x-ingest-secret header
       ├── Project 1 (eygdoetdwqllvsxpvoex):
       │   ├── Records operational import_sessions status
       │   └── On 401 UNAUTHORIZED → deactivates account (is_active = false)
       ├── Project 3 (jxdkbwnwtjelznmauwpc):
       │   ├── Persists account_analytics_daily & summaries (Pipeline A)
       │   ├── Persists top_pins_snapshots (Pipeline B: rank_position 1..50)
       │   └── Updates derived daily_workspace_metrics
       ├── Edge Cache: Rebuilds Cloudflare KV cache post-persistence
       └── Dead Man's Snitch: Fires alert on 2+ consecutive ingestion failures
```

---

## 2. Hardcoded Ingestion Endpoint

Make.com scenarios must POST directly to this production endpoint:

```
https://pinorbit-v2.o-i.workers.dev/api/internal/pinterest/ingest
```

**Required Headers**:
```http
Content-Type: application/json
x-ingest-secret: YOUR_INGEST_SECRET_KEY
```

---

## 3. FastCron Automation & Token Security

- FastCron tokens are stored encrypted/RLS-protected in Project 1 `workspace_analytics_settings`.
- The `GET /api/analytics/settings` endpoint never returns raw tokens. It returns masked status (`has_fastcron_token: true`, `fastcron_token_masked: "••••••••"`).
- In the UI Settings Drawer, the token input is write-only with placeholder `••••••••` when configured.
- The server automatically creates (`/cron_add`) or edits (`/cron_edit`) FastCron jobs via the `POST /api/analytics/schedule/sync` API.

---

## 4. Make.com Scenario Blueprints

### Scenario A — Account Analytics (3 Modules)

1. **Custom Webhook Trigger**:
   - Listens for FastCron payload: `{ "job_type": "daily_sync", "channel": "account_analytics", "workspace_id": "...", "connection_id": "..." }`
2. **Pinterest: Make an API Call** (Native Pinterest OAuth Module):
   - **URL**: `/v5/user_account/analytics`
   - **Method**: `GET`
   - **Query Parameters**:
     - `start_date`: `{{ifempty(1.start_date; formatDate(addDays(now; -7); "YYYY-MM-DD"))}}`
     - `end_date`: `{{ifempty(1.end_date; formatDate(addDays(now; -1); "YYYY-MM-DD"))}}`
   - *Leave `metric_types` blank so Pinterest returns all 15 metrics.*
3. **HTTP Request** (`POST` to PinOrbit Ingest):
   - **URL**: `https://pinorbit-v2.o-i.workers.dev/api/internal/pinterest/ingest`
   - **Body**:
     ```json
     {
       "success": true,
       "channel": "account_analytics",
       "workspace_id": "{{1.workspace_id}}",
       "connection_id": "{{1.connection_id}}",
       "request_context": {
         "start_date": "{{ifempty(1.start_date; formatDate(addDays(now; -7); 'YYYY-MM-DD'))}}",
         "end_date": "{{ifempty(1.end_date; formatDate(addDays(now; -1); 'YYYY-MM-DD'))}}",
         "job_type": "{{ifempty(1.job_type; 'daily_sync')}}"
       },
       "account_analytics": {{2.body}},
       "raw_headers": {
         "x-ratelimit-limit": "{{2.headers.`x-ratelimit-limit`}}",
         "x-ratelimit-remaining": "{{2.headers.`x-ratelimit-remaining`}}",
         "x-ratelimit-reset": "{{2.headers.`x-ratelimit-reset`}}"
       }
     }
     ```

---

### Scenario B — Ranked Top Pins (Iterator, 3+ Modules)

1. **Custom Webhook Trigger**:
   - Listens for FastCron payload: `{ "job_type": "daily_sync", "channel": "top_pins", "workspace_id": "...", "sort_modes": ["IMPRESSION","OUTBOUND_CLICK","SAVE","ENGAGEMENT","PIN_CLICK"] }`
2. **Iterator**:
   - Iterates over `1.sort_modes`
3. **Pinterest: Make an API Call** (Native Pinterest OAuth Module):
   - **URL**: `/v5/user_account/analytics/top_pins`
   - **Method**: `GET`
   - **Query Parameters**:
     - `start_date`: `{{ifempty(1.start_date; formatDate(addDays(now; -7); "YYYY-MM-DD"))}}`
     - `end_date`: `{{ifempty(1.end_date; formatDate(addDays(now; -1); "YYYY-MM-DD"))}}`
     - `sort_by`: `{{2.value}}`
     - `num_of_pins`: `50`
4. **Array Aggregator / Map Builder**:
   - Collects responses into map: `{ "IMPRESSION": ..., "OUTBOUND_CLICK": ..., "SAVE": ..., "ENGAGEMENT": ..., "PIN_CLICK": ... }`
5. **HTTP Request** (`POST` to PinOrbit Ingest):
   - **URL**: `https://pinorbit-v2.o-i.workers.dev/api/internal/pinterest/ingest`
   - **Body**:
     ```json
     {
       "success": true,
       "channel": "top_pins",
       "workspace_id": "{{1.workspace_id}}",
       "connection_id": "{{1.connection_id}}",
       "request_context": {
         "start_date": "{{ifempty(1.start_date; formatDate(addDays(now; -7); 'YYYY-MM-DD'))}}",
         "end_date": "{{ifempty(1.end_date; formatDate(addDays(now; -1); 'YYYY-MM-DD'))}}",
         "job_type": "{{ifempty(1.job_type; 'daily_sync')}}"
       },
       "top_pins_analytics": {{4.map}},
       "raw_headers": {
         "x-ratelimit-remaining": "{{3.headers.`x-ratelimit-remaining`}}"
       }
     }
     ```

---

## 5. Connection CRUD & Soft-Delete Policy

- **Create**: Inserts account into Project 1 `accounts` with `analytics_enabled = true`.
- **Edit**: Updates display name and toggles `analytics_enabled`.
- **Delete**: Soft-deletes account (`is_active = false, deleted_at = now()`). Historical analytics in Project 3 are preserved.
