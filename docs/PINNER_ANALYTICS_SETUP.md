# Pinner Analytics — Operational Setup & Orchestration Guide (V11/V12 Locked)

This guide documents the production orchestration architecture, FastCron scheduling configuration, Make.com scenario blueprint, and Astro SSR ingestion pipeline for PinOrbit's multi-tenant Pinterest analytics system.

---

## 1. System Architecture Overview

```
FastCron (04:00 UTC)
    ↓ POST { job_type: "daily_sync", triggered_at: "..." }
Make.com Custom Webhook Trigger
    ↓ Computes start_date (t - 7d) & end_date (t - 1d)
    ↓ Pinterest Native Module: /v5/user_account/analytics (7-day window)
    ↓ Pinterest Native Module × 5: /v5/user_account/analytics/top_pins (5 sort modes)
    ↓ (Handles 429 Too Many Requests & rate limit backoffs inside Make.com)
    ↓ HTTP POST /api/internal/pinterest/ingest (Astro SSR with x-ingest-secret)
Astro SSR Ingestion Engine
    ├── Validates secret, identity & context
    ├── Project 1 (eygdoetdwqllvsxpvoex): Records operational import_sessions status
    ├── Project 1: On 401 UNAUTHORIZED → automatically deactivates account (is_active = false)
    ├── Project 3 (jxdkbwnwtjelznmauwpc): Persists account_analytics_daily & summaries
    ├── Project 3: Persists top_pins_snapshots (rank_position 1..50 derived from array index)
    ├── Project 3: Persists derived daily_workspace_metrics (filters data_status = 'READY')
    ├── Edge Cache: Rebuilds/invalidates Cloudflare KV cache post-persistence
    └── Dead Man's Snitch: Fires alert webhook on 2+ consecutive ingestion failures
```

---

## 2. FastCron Configuration

FastCron acts as a simple, reliable cron scheduler and does not perform date math.

### Job Specification
- **Schedule**: `0 4 * * *` (4:00 AM UTC daily)
- **HTTP Method**: `POST`
- **URL**: `https://hook.make.com/YOUR_CUSTOM_WEBHOOK_URL`
- **Headers**:
  ```http
  Content-Type: application/json
  x-fastcron-secret: YOUR_FASTCRON_SECRET
  ```
- **JSON Payload**:
  ```json
  {
    "job_type": "daily_sync",
    "workspace_id": "00000000-0000-0000-0000-000000000001",
    "connection_id": "a1b2c3d4-e5f6-7890-1234-56789abcdef0",
    "triggered_at": "{{now}}"
  }
  ```

---

## 3. Make.com Scenario Blueprint

### Module Execution Order

```
[1. Custom Webhook]
       ↓
[2. Date Math / Set Variables]
       ↓
[3. Pinterest: Make an API Call] (Account Analytics 7-day)
       ↓
[4. Pinterest: Make an API Call] (Top Pins: IMPRESSION)
       ↓
[5. Pinterest: Make an API Call] (Top Pins: OUTBOUND_CLICK)
       ↓
[6. Pinterest: Make an API Call] (Top Pins: SAVE)
       ↓
[7. Pinterest: Make an API Call] (Top Pins: ENGAGEMENT)
       ↓
[8. Pinterest: Make an API Call] (Top Pins: PIN_CLICK)
       ↓
[9. HTTP Request → PinOrbit Ingest API]
```

### Module Configurations

#### Module 2: Date Math & Request Context
- **Variable `start_date`**: `formatDate(addDays(1.triggered_at; -7); "YYYY-MM-DD")`
- **Variable `end_date`**: `formatDate(addDays(1.triggered_at; -1); "YYYY-MM-DD")`

#### Module 3: Account Analytics (7-Day Batch Fetch)
- **Module Type**: `Pinterest: Make an API Call` (Native OAuth connection)
- **URL**: `/v5/user_account/analytics`
- **Method**: `GET`
- **Query Parameters**:
  - `start_date`: `{{2.start_date}}`
  - `end_date`: `{{2.end_date}}`
- *Note: `metric_types` is omitted so Pinterest returns all 15 metrics by default.*

#### Modules 4–8: Top Pins Snapshots (5 Sort Modes)
- **Module Type**: `Pinterest: Make an API Call`
- **URL**: `/v5/user_account/analytics/top_pins`
- **Method**: `GET`
- **Query Parameters**:
  - `start_date`: `{{2.start_date}}`
  - `end_date`: `{{2.end_date}}`
  - `sort_by`: `IMPRESSION` (Module 4), `OUTBOUND_CLICK` (Module 5), `SAVE` (Module 6), `ENGAGEMENT` (Module 7), `PIN_CLICK` (Module 8)

#### Module 9: PinOrbit Ingestion Webhook Dispatch
- **Module Type**: `HTTP: Make a request`
- **URL**: `https://your-domain.com/api/internal/pinterest/ingest`
- **Method**: `POST`
- **Headers**:
  ```http
  Content-Type: application/json
  x-ingest-secret: YOUR_INGEST_SECRET_KEY
  ```
- **Body**:
  ```json
  {
    "success": true,
    "request_id": "{{1.request_id}}",
    "workspace_id": "{{1.workspace_id}}",
    "connection_id": "{{1.connection_id}}",
    "request_context": {
      "start_date": "{{2.start_date}}",
      "end_date": "{{2.end_date}}",
      "job_type": "{{1.job_type}}"
    },
    "account_analytics": {{3.body}},
    "top_pins_analytics": {
      "IMPRESSION": {{4.body}},
      "OUTBOUND_CLICK": {{5.body}},
      "SAVE": {{6.body}},
      "ENGAGEMENT": {{7.body}},
      "PIN_CLICK": {{8.body}}
    },
    "raw_headers": {
      "x-ratelimit-limit": "{{3.headers.`x-ratelimit-limit`}}",
      "x-ratelimit-remaining": "{{3.headers.`x-ratelimit-remaining`}}",
      "x-ratelimit-reset": "{{3.headers.`x-ratelimit-reset`}}"
    }
  }
  ```

---

## 4. Make.com Rate Limiting & Error Directives

1. **HTTP 429 Handling**: Configure Make.com scenario error directives on each Pinterest module:
   - Attach an **Error handler route** with **Break** (retry with exponential backoff: 3 attempts with 60s, 120s, 300s delays).
2. **HTTP 401 Failure Route**: If a Pinterest module returns HTTP 401, route directly to Module 9 with:
   ```json
   {
     "success": false,
     "workspace_id": "{{1.workspace_id}}",
     "connection_id": "{{1.connection_id}}",
     "error_details": {
       "http_status": 401,
       "error_code": "UNAUTHORIZED",
       "error_message": "Pinterest token expired or authorization revoked",
       "failed_module": "Pinterest: Make an API Call"
     }
   }
   ```
   Astro SSR will automatically deactivate the account in Project 1 (`is_active = false`) and log an audit event.

---

## 5. Historical 90-Day Backfill Workflow

For newly connected Pinterest accounts, historical backfills are executed in sequential 7-day chunks to prevent rate limits:

1. **Call Backfill Helper** in `pinnerAnalyticsService.generateHistoricalBackfillChunks(...)`.
2. This generates 13 consecutive 7-day windows:
   - Chunk 1: Days -1 to -7
   - Chunk 2: Days -8 to -14
   - Chunk 3: Days -15 to -21
   - ...
   - Chunk 13: Days -85 to -90
3. Make.com executes chunks sequentially with a 2-second sleep between requests.

---

## 6. Dead Man's Snitch Monitoring

If ingestion fails for **2 consecutive days/runs** for any workspace:
- Astro SSR dispatches an alert to `SNITCH_WEBHOOK_URL` (Slack / Discord / PagerDuty).
- On the next successful ingestion, the failure streak counter automatically resets to 0.
