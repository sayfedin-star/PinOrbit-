# PinOrbit v2 (Greenfield Production Build)

PinOrbit is an enterprise Pinterest scheduling, competitor intelligence, and performance analytics platform built on a modern multi-project Supabase architecture and Astro SSR.

## Architecture

PinOrbit v2 separates concerns across three dedicated Supabase projects:

1. **Project 1 — Scheduling / Auth Authority (`us-west-2`):**
   - Authentication, User Sessions, Multi-tenant Workspaces, Memberships, Pinterest Accounts, Board Mapping, Pin Operational Queue, Delivery Logs, and Audit Logs.
2. **Project 2 — Competitors (`eu-west-1`):**
   - Server-only intelligence database for Competitor Profiles, Boards, Time-series Snapshots, and Daily Rollups.
3. **Project 3 — Analytics (`eu-west-2`):**
   - Server-only performance database for Import Sessions, Pin Metric History, URL Aggregates, and Board Analytics.

## Directory Structure

```
├── docs/
│   ├── architecture.md
│   ├── security-boundaries.md
│   └── migration-plan.md
├── supabase/
│   ├── scheduling/migrations/
│   ├── competitors/migrations/
│   └── analytics/migrations/
├── src/
│   ├── lib/
│   ├── server/
│   │   ├── auth/
│   │   ├── db/
│   │   ├── repositories/
│   │   └── services/
│   ├── pages/
│   │   └── api/
│   └── middleware.ts
└── astro.config.mjs
```

## Setup & Local Development

1. Copy `.env.example` to `.env` and fill in your Supabase project keys.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run dev server:
   ```bash
   npm run dev
   ```
4. Run tests:
   ```bash
   npm test
   ```
5. Check types and build:
   ```bash
   npm run build
   ```
