# Security Architecture & Access Control

## Key Management & Key Hygiene

This starter adheres to modern Supabase key naming conventions and strict operational separation between client and server credentials.

| Key Type | Variable Name | Scope | Safe for Client? | Purpose |
|---|---|---|---|---|
| **Publishable Key** | `SCHEDULING_SUPABASE_PUBLISHABLE_KEY` | Project 1 | **Yes** (Browser-safe) | Authenticating user sessions via PKCE cookies and reading public schemas guarded by RLS. |
| **Secret Key (Project 1)** | `SCHEDULING_SUPABASE_SECRET_KEY` | Project 1 | **NO** (Server-Only) | Platform background processes, admin queues, and system audit logs. |
| **Secret Key (Project 2)** | `COMPETITORS_SUPABASE_SECRET_KEY` | Project 2 | **NO** (Server-Only) | Server-side competitor intelligence querying and scraping ingestion. |
| **Secret Key (Project 3)** | `ANALYTICS_SUPABASE_SECRET_KEY` | Project 3 | **NO** (Server-Only) | Server-side analytical rollups, time-series ingestion, and reporting. |

---

## Why Secret Keys Must Remain Server-Only

1. **Bypass of RLS**: The Supabase service role secret key bypasses all Row-Level Security rules. Exposing a secret key to the browser grants unconstrained read and write access to the entire database.
2. **Blast Radius Containment**: By ensuring Projects 2 and 3 have no publishable keys, malicious actors cannot attempt direct browser-based exploitation against competitor or analytics infrastructure.
3. **Auditability**: All actions against backend databases are channeled through validated Astro SSR endpoints (`src/server/db/clients.ts`), guaranteeing all inputs are scrubbed and authenticated.

---

## Mandatory Row-Level Security (RLS) Expectations

Every SQL table created in this codebase or added by developers must comply with the following standards:

### 1. RLS Enabled by Default
```sql
ALTER TABLE public.your_new_table ENABLE ROW LEVEL SECURITY;
```

### 2. Tenant Isolation Policies
Every tenant table must filter records based on workspace membership:
```sql
CREATE POLICY "Users can view workspace data"
    ON public.your_new_table
    FOR SELECT
    TO authenticated
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Users can insert workspace data"
    ON public.your_new_table
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_workspace_member(workspace_id));
```

### 3. Service Role Bypass Explicit Grant
```sql
CREATE POLICY "Allow service_role full access on your_new_table"
    ON public.your_new_table
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
```

### 4. Cascade Deletes on Foreign Keys
Always declare `ON DELETE CASCADE` on all `workspace_id` foreign keys to prevent orphan rows upon workspace termination:
```sql
workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE
```

### 5. Function Security Hardening
- Functions created in Postgres default to `SECURITY INVOKER`.
- Any helper requiring `SECURITY DEFINER` (such as `is_workspace_member`) explicitly sets `search_path = public, pg_temp` and revokes execution rights from `PUBLIC` and `anon`.
