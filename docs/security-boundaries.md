# Security Boundaries & Access Control

## Mandatory Security Directives

### 1. Environment Variable & Secret Isolation
- `SCHEDULING_SUPABASE_URL`: Publicly accessible API host for Project 1.
- `SCHEDULING_SUPABASE_PUBLISHABLE_KEY`: Browser-safe modern publishable key for client-side auth helpers where required.
- `SCHEDULING_SUPABASE_SECRET_KEY`: Server-only secret key with elevated backend privileges.
- `COMPETITORS_SUPABASE_URL` & `COMPETITORS_SUPABASE_SECRET_KEY`: Server-only. NEVER exposed to client.
- `ANALYTICS_SUPABASE_URL` & `ANALYTICS_SUPABASE_SECRET_KEY`: Server-only. NEVER exposed to client.

### 2. Tenant Isolation Standard (`workspace_id`)
- Every table containing tenant data across ALL projects MUST have `workspace_id` as a foreign key or primary partitioning column.
- Row-Level Security (RLS) is enabled on all tables in exposed schemas.
- In Project 1, RLS policies enforce `workspace_id` membership via `is_workspace_member(workspace_id)`.
- In Project 2 and Project 3, all queries constructed by Astro SSR server clients explicitly append `WHERE workspace_id = ?` matching the verified session workspace.

### 3. Server Client Factory (`src/server/db/clients.ts`)
- All database clients are instantiated exclusively through `src/server/db/clients.ts` and `src/server/db/client-factory.ts`.
- Project 2 and Project 3 clients are unreachable by frontend code and cannot be imported by client-side Astro islands.

### 4. Function Execution Hardening
- Functions created in Postgres MUST use `SECURITY INVOKER` by default.
- If `SECURITY DEFINER` is required for administrative lookup functions, execute permissions (`EXECUTE ON FUNCTION`) are explicitly revoked from `PUBLIC` and `anon` roles.
- Functions are placed in isolated schemas or guarded with explicit `auth.uid()` checks.
