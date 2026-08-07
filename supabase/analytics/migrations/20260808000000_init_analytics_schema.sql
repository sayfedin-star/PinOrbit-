-- ==============================================================================
-- Migration: 20260808000000_init_analytics_schema.sql
-- Project: Project 3 (Analytics - Server-Only Database) - Ref: jxdkbwnwtjelznmauwpc
-- Domain: Import Sessions, Pin Metrics, URL Performance, Board Analytics, and Daily Rollups
-- ==============================================================================

-- 1. Import Sessions Table (Tracking scheduling ingestion batches)
CREATE TABLE IF NOT EXISTS public.import_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    account_id UUID NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('google_sheets', 'csv_upload', 'api_sync', 'manual')),
    source_label TEXT,
    total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
    valid_rows INTEGER NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
    invalid_rows INTEGER NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
    imported_rows INTEGER NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Pin Metrics Time-Series History
CREATE TABLE IF NOT EXISTS public.pin_metrics_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    pin_id UUID NOT NULL,
    account_id UUID NOT NULL,
    impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0),
    saves INTEGER NOT NULL DEFAULT 0 CHECK (saves >= 0),
    clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
    engagement_rate NUMERIC(5, 4) DEFAULT 0.0 CHECK (engagement_rate >= 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_pin_metrics_history UNIQUE (workspace_id, pin_id, recorded_at)
);

-- 3. Destination URL Performance History
CREATE TABLE IF NOT EXISTS public.url_performance_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    destination_url TEXT NOT NULL,
    period_date DATE NOT NULL,
    total_clicks INTEGER NOT NULL DEFAULT 0 CHECK (total_clicks >= 0),
    total_impressions INTEGER NOT NULL DEFAULT 0 CHECK (total_impressions >= 0),
    total_pins_active INTEGER NOT NULL DEFAULT 0 CHECK (total_pins_active >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_url_performance_history UNIQUE (workspace_id, destination_url, period_date)
);

-- 4. Board Analytics Rollups
CREATE TABLE IF NOT EXISTS public.board_analytics_rollups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    board_id VARCHAR NOT NULL,
    account_id UUID NOT NULL,
    period_date DATE NOT NULL,
    total_pins INTEGER NOT NULL DEFAULT 0 CHECK (total_pins >= 0),
    impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0),
    saves INTEGER NOT NULL DEFAULT 0 CHECK (saves >= 0),
    clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_board_analytics_rollups UNIQUE (workspace_id, board_id, period_date)
);

-- 5. Daily Workspace Analytics (Tenant-level daily throughput and reach aggregates)
CREATE TABLE IF NOT EXISTS public.daily_workspace_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    metric_date DATE NOT NULL,
    pins_posted INTEGER NOT NULL DEFAULT 0 CHECK (pins_posted >= 0),
    pins_failed INTEGER NOT NULL DEFAULT 0 CHECK (pins_failed >= 0),
    total_impressions BIGINT NOT NULL DEFAULT 0 CHECK (total_impressions >= 0),
    total_saves INTEGER NOT NULL DEFAULT 0 CHECK (total_saves >= 0),
    total_clicks INTEGER NOT NULL DEFAULT 0 CHECK (total_clicks >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_daily_workspace_analytics UNIQUE (workspace_id, metric_date)
);

-- 6. Query-Shaped Composite Indexes
CREATE INDEX IF NOT EXISTS idx_import_sessions_workspace_created 
    ON public.import_sessions (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_sessions_account_created 
    ON public.import_sessions (workspace_id, account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pin_metrics_workspace_recorded 
    ON public.pin_metrics_history (workspace_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_pin_metrics_pin_recorded 
    ON public.pin_metrics_history (workspace_id, pin_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_pin_metrics_account_recorded 
    ON public.pin_metrics_history (workspace_id, account_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_url_performance_workspace_period 
    ON public.url_performance_history (workspace_id, period_date DESC);

CREATE INDEX IF NOT EXISTS idx_url_performance_dest_period 
    ON public.url_performance_history (workspace_id, destination_url, period_date DESC);

CREATE INDEX IF NOT EXISTS idx_board_analytics_workspace_period 
    ON public.board_analytics_rollups (workspace_id, period_date DESC);

CREATE INDEX IF NOT EXISTS idx_board_analytics_board_period 
    ON public.board_analytics_rollups (workspace_id, board_id, period_date DESC);

CREATE INDEX IF NOT EXISTS idx_board_analytics_account_period 
    ON public.board_analytics_rollups (workspace_id, account_id, period_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_workspace_analytics_date 
    ON public.daily_workspace_analytics (workspace_id, metric_date DESC);

-- 7. Enable Row Level Security (RLS) & Server-Only Grant Policy
ALTER TABLE public.import_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pin_metrics_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.url_performance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_analytics_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_workspace_analytics ENABLE ROW LEVEL SECURITY;

-- Server-only access policies (Project 3 is backend-accessed via service_role only)
CREATE POLICY "Allow service_role full access on import_sessions"
    ON public.import_sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service_role full access on pin_metrics_history"
    ON public.pin_metrics_history
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service_role full access on url_performance_history"
    ON public.url_performance_history
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service_role full access on board_analytics_rollups"
    ON public.board_analytics_rollups
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service_role full access on daily_workspace_analytics"
    ON public.daily_workspace_analytics
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
