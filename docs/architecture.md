# PinOrbit v2 Architecture Specification

## Overview

PinOrbit v2 is built on an isolated three-project Supabase topology fronted by an Astro SSR application running on Cloudflare Pages.

```
                        ┌────────────────────────────────────────────────────────┐
                        │                   Astro SSR Application                │
                        │            (Cloudflare Pages / Edge Runtime)          │
                        └──────────────────────┬─────────────────────────────────┘
                                               │
               ┌───────────────────────────────┼───────────────────────────────┐
               │ 1. Verify Session & Workspace │ 2. Server-Only Query         │ 3. Server-Only Query
               ▼                               ▼                               ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐ ┌──────────────────────────────┐
│     Project 1: Scheduling    │ │    Project 2: Competitors    │ │     Project 3: Analytics     │
│   (Auth / Tenant Authority)  │ │      (Server-Only DB)        │ │      (Server-Only DB)        │
│          `us-west-2`         │ │         `eu-west-1`          │ │         `eu-west-2`          │
├──────────────────────────────┤ ├──────────────────────────────┤ ├──────────────────────────────┤
│ • auth.users                 │ │ • competitors                │ │ • import_sessions            │
│ • workspaces                 │ │ • competitor_boards          │ │ • pin_metrics_history        │
│ • workspace_memberships      │ │ • competitor_snapshots       │ │ • url_performance_history   │
│ • admin_users                │ │ • competitor_daily_snapshots │ │ • board_analytics_rollups   │
│ • accounts                   │ │ • competitor_ingestion_jobs  │ │ • daily_workspace_analytics │
│ • account_webhooks           │ └──────────────────────────────┘ └──────────────────────────────┘
│ • account_posting_windows    │
│ • boards (scheduler registry)│
│ • pins (operational queue)   │
│ • pin_delivery_logs          │
│ • audit_log & logs           │
└──────────────────────────────┘
```

## Architectural Tenets

### 1. Single Source of Truth for Identity & Workspaces
- **Project 1 (Scheduling)** is the sole authority for:
  - User authentication and sessions
  - Workspace boundaries (`workspaces`)
  - Workspace memberships and role-based access (`workspace_memberships`)
  - Platform administrator authorization (`admin_users`)
  - Pinterest account credentials, webhooks, and operational queues (`accounts`, `pins`, `pin_delivery_logs`)

### 2. Server-Only Data Projects (Project 2 & Project 3)
- **Project 2 (Competitors)** and **Project 3 (Analytics)** are strictly private, backend-only databases.
- The browser **never** connects directly to Project 2 or Project 3.
- No public/publishable keys are generated or distributed for Project 2 or 3.
- All operations are orchestrated via server-side Astro endpoints (`src/server/db/clients.ts`) guarded by Project 1 workspace resolution.

### 3. Astro SSR as the Central Security Gatekeeper
1. Every incoming request resolves the user identity and JWT via `@supabase/ssr` against Project 1.
2. The user's active workspace membership and permissions are verified in `middleware.ts` / `workspace-guard.ts`.
3. Only upon successful verification are downstream queries executed to Project 2 or Project 3 with explicit `workspace_id` scoping.

### 4. Cross-Region Latency Mitigation
- **Project 1:** `us-west-2`
- **Project 2:** `eu-west-1`
- **Project 3:** `eu-west-2`
- **Mitigation:**
  - Workspace verification is cached in request context (`Astro.locals`).
  - Downstream queries across projects run concurrently using `Promise.all` over persistent HTTPS keep-alive connections.
