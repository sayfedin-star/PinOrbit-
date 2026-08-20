# 🚀 PinOrbit-v2 Deployment & Release Runbook

This runbook documents the deployment, migration, edge function rollout, and verification steps for the 52 security, performance, logic, and storage audit fixes.

---

## 1. Summary of Applied Live Migrations

| Project | Ref ID | Migrations Status | Live Verification |
|---|---|---|---|
| **P1 Scheduling** | `eygdoetdwqllvsxpvoex` | **APPLIED** via Supabase MCP | `purge_system_logs_and_old_pins` (status='posted'), `purge_old_pin_delivery_logs` (p_workspace_id) verified. |
| **P2 Competitors** | `guycnhvwfzdzbpgsnavg` | **APPLIED** via Supabase MCP | `competitor_pipeline_settings` (PK=workspace_id), `purge_competitor_retention` verified. |
| **P3 Analytics** | `jxdkbwnwtjelznmauwpc` | **BLOCKED-FOR-USER** (Network timeout via MCP) | Run manual SQL / CLI push below. |

---

## 2. Phase 2: Pending Migrations (P3 Analytics)

If deploying via Supabase CLI:
```bash
# Link and push migrations to P3 Analytics
supabase link --project-ref jxdkbwnwtjelznmauwpc
supabase db push
```

Or execute the following SQL files directly in the Supabase SQL Editor for **P3 Analytics (`jxdkbwnwtjelznmauwpc`)**:

### 1) Harden Purge Log RLS (`supabase/analytics-migrations/20260825000000_harden_analytics_purge_log_rls.sql`)
```sql
DROP POLICY IF EXISTS "allow_all_analytics_purge_log" ON public.analytics_purge_log;
DROP POLICY IF EXISTS "sr_analytics_purge_log" ON public.analytics_purge_log;

CREATE POLICY "sr_analytics_purge_log"
  ON public.analytics_purge_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.analytics_purge_log FROM anon, authenticated;
GRANT ALL ON public.analytics_purge_log TO service_role;
```

### 2) Ingestion Runs Pruning Function (`supabase/analytics-migrations/20260825000001_add_ingestion_runs_pruning.sql`)
```sql
CREATE OR REPLACE FUNCTION public.purge_old_analytics_ingestion_runs(
  p_keep_days INT DEFAULT 60,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_del_count INT := 0;
  v_cutoff TIMESTAMPTZ := NOW() - (p_keep_days || ' days')::INTERVAL;
BEGIN
  WITH del AS (
    DELETE FROM public.analytics_ingestion_runs
    WHERE created_at < v_cutoff
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    RETURNING id
  )
  SELECT count(*) INTO v_del_count FROM del;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_runs', v_del_count,
    'workspace_id', p_workspace_id,
    'executed_at', NOW()
  );
END;
$$;
```

---

## 3. Phase 3: Supabase Edge Functions Deployment — ✅ DEPLOYED VIA MCP

The 3 hardened Edge Functions have been **deployed directly to live Supabase projects** via Supabase MCP with `verify_jwt: false` (auth enforced via `CRON_SECRET` Bearer header):

| Function | Project Ref | Version | Status | Live Auth Test |
|---|---|---|---|---|
| `create-board-webhook` | `eygdoetdwqllvsxpvoex` (P1) | v1 | **ACTIVE** | `curl` -> `401 Unauthorized` (Verified) |
| `process-pending-pins` | `eygdoetdwqllvsxpvoex` (P1) | v1 | **ACTIVE** | Protected by Bearer check |
| `update-competitors` | `guycnhvwfzdzbpgsnavg` (P2) | v1 | **ACTIVE** | `curl` -> `401 Unauthorized` (Verified) |

---

## 4. Phase 4: Cloudflare Workers Deployment

Build and deploy the Astro SSR application to Cloudflare Workers via Wrangler:

```bash
# 1. Build production bundles
npm run build

# 2. Authenticate Wrangler (if not already logged in)
npx wrangler login

# 3. Deploy to Cloudflare Workers
npx wrangler deploy
```

---

## 5. Phase 5: Post-Deployment Smoke Tests

Run the included automated smoke test suite:

```bash
chmod +x scripts/smoke-test.sh
BASE_URL="https://pinorbit.com" \
EDGE_FN_URL="https://eygdoetdwqllvsxpvoex.supabase.co/functions/v1" \
INGEST_SECRET="<YOUR_INGEST_SECRET>" \
WORKSPACE_ID="<TEST_WORKSPACE_ID>" \
./scripts/smoke-test.sh
```

Tests executed:
1. **Edge Function Auth Rejection:** Verifies `POST /create-board-webhook` returns `401 Unauthorized` without valid Bearer token.
2. **Tenant Isolation:** Verifies `POST /api/internal/pinterest/ingest` prevents cross-tenant access.
3. **Retention Cleanup:** Verifies `POST /api/internal/pinterest/cleanup-retention` executes bounded batch deletes.
4. **Cache Bypass Restriction:** Verifies non-admin requests cannot trigger cache bypass on analytics endpoints.
