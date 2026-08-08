-- ==============================================================================
-- Migration: 20260809000000_add_pinner_analytics_tables.sql
-- Project: Project 3 (Analytics - Server-Only Database)
-- Target Ref: jxdkbwnwtjelznmauwpc
-- Domain: Pinner Top Pins Snapshots, Account Analytics Daily & Summaries, and Daily Workspace Metrics
-- ==============================================================================

-- 1. Top Pins Snapshots Table (Ranked 1-50 Top Pins per Ingestion Window & Sort Mode)
CREATE TABLE IF NOT EXISTS public.top_pins_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    connection_id UUID NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    sort_by TEXT NOT NULL,
    rank_position INTEGER NOT NULL CHECK (rank_position >= 1 AND rank_position <= 50),
    pin_id TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Core Counts (Pinterest BIGINT >= 0)
    impressions BIGINT NOT NULL DEFAULT 0 CHECK (impressions >= 0),
    engagement BIGINT NOT NULL DEFAULT 0 CHECK (engagement >= 0),
    outbound_clicks BIGINT NOT NULL DEFAULT 0 CHECK (outbound_clicks >= 0),
    pin_clicks BIGINT NOT NULL DEFAULT 0 CHECK (pin_clicks >= 0),
    saves BIGINT NOT NULL DEFAULT 0 CHECK (saves >= 0),
    video_10s_view BIGINT NOT NULL DEFAULT 0 CHECK (video_10s_view >= 0),
    video_mrc_view BIGINT NOT NULL DEFAULT 0 CHECK (video_mrc_view >= 0),
    video_start BIGINT NOT NULL DEFAULT 0 CHECK (video_start >= 0),
    quartile_95_percent_view BIGINT NOT NULL DEFAULT 0 CHECK (quartile_95_percent_view >= 0),
    -- Core Rates (NUMERIC(8,6) for 0.0-1.0 floats)
    engagement_rate NUMERIC(8,6) NOT NULL DEFAULT 0.0,
    outbound_click_rate NUMERIC(8,6) NOT NULL DEFAULT 0.0,
    pin_click_rate NUMERIC(8,6) NOT NULL DEFAULT 0.0,
    save_rate NUMERIC(8,6) NOT NULL DEFAULT 0.0,
    -- Video Timing (Milliseconds/Seconds float)
    video_avg_watch_time NUMERIC(12,3) NOT NULL DEFAULT 0.0,
    video_v50_watch_time NUMERIC(12,3) NOT NULL DEFAULT 0.0,
    -- Status & Metadata
    data_status JSONB NOT NULL DEFAULT '{}'::jsonb,
    date_availability JSONB,
    title TEXT,
    destination_url TEXT,
    image_url TEXT,
    pin_metadata JSONB,
    raw_metrics JSONB,
    raw_pin JSONB,
    raw_headers JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_top_pins_snapshots UNIQUE (workspace_id, connection_id, pin_id, window_start, window_end, sort_by)
);

-- 2. Account Analytics Daily Table (Canonical per-day account metrics)
CREATE TABLE IF NOT EXISTS public.account_analytics_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    connection_id UUID NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    metric_date DATE NOT NULL,
    data_status TEXT NOT NULL DEFAULT 'READY',
    -- Core Counts
    impressions BIGINT NOT NULL DEFAULT 0 CHECK (impressions >= 0),
    engagements BIGINT NOT NULL DEFAULT 0 CHECK (engagements >= 0),
    outbound_clicks BIGINT NOT NULL DEFAULT 0 CHECK (outbound_clicks >= 0),
    pin_clicks BIGINT NOT NULL DEFAULT 0 CHECK (pin_clicks >= 0),
    saves BIGINT NOT NULL DEFAULT 0 CHECK (saves >= 0),
    video_10s_view BIGINT NOT NULL DEFAULT 0 CHECK (video_10s_view >= 0),
    video_mrc_view BIGINT NOT NULL DEFAULT 0 CHECK (video_mrc_view >= 0),
    video_start BIGINT NOT NULL DEFAULT 0 CHECK (video_start >= 0),
    quartile_95_percent_view BIGINT NOT NULL DEFAULT 0 CHECK (quartile_95_percent_view >= 0),
    -- Core Rates
    engagement_rate NUMERIC(8,6) NOT NULL DEFAULT 0.0,
    outbound_click_rate NUMERIC(8,6) NOT NULL DEFAULT 0.0,
    pin_click_rate NUMERIC(8,6) NOT NULL DEFAULT 0.0,
    save_rate NUMERIC(8,6) NOT NULL DEFAULT 0.0,
    -- Nullable Video Timing & Legacy metrics
    video_avg_watch_time NUMERIC(12,3),
    video_v50_watch_time NUMERIC(12,3),
    profile_visits BIGINT,
    closeups BIGINT,
    raw_metrics JSONB,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_account_analytics_daily UNIQUE (workspace_id, connection_id, metric_date)
);

-- 3. Account Analytics Summaries Table (Aggregated 7-day or rolling window summary)
CREATE TABLE IF NOT EXISTS public.account_analytics_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    connection_id UUID NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    -- Summary Counts
    summary_impressions BIGINT NOT NULL DEFAULT 0 CHECK (summary_impressions >= 0),
    summary_engagements BIGINT NOT NULL DEFAULT 0 CHECK (summary_engagements >= 0),
    summary_outbound_clicks BIGINT NOT NULL DEFAULT 0 CHECK (summary_outbound_clicks >= 0),
    summary_pin_clicks BIGINT NOT NULL DEFAULT 0 CHECK (summary_pin_clicks >= 0),
    summary_saves BIGINT NOT NULL DEFAULT 0 CHECK (summary_saves >= 0),
    summary_video_10s_view BIGINT NOT NULL DEFAULT 0 CHECK (summary_video_10s_view >= 0),
    summary_video_mrc_view BIGINT NOT NULL DEFAULT 0 CHECK (summary_video_mrc_view >= 0),
    summary_video_start BIGINT NOT NULL DEFAULT 0 CHECK (summary_video_start >= 0),
    summary_quartile_95_percent_view BIGINT NOT NULL DEFAULT 0 CHECK (summary_quartile_95_percent_view >= 0),
    -- Summary Rates
    summary_engagement_rate NUMERIC(8,6) NOT NULL DEFAULT 0.0,
    summary_outbound_click_rate NUMERIC(8,6) NOT NULL DEFAULT 0.0,
    summary_pin_click_rate NUMERIC(8,6) NOT NULL DEFAULT 0.0,
    summary_save_rate NUMERIC(8,6) NOT NULL DEFAULT 0.0,
    -- Nullable Summary Video Timing & Legacy metrics
    summary_profile_visits BIGINT,
    summary_closeups BIGINT,
    summary_video_avg_watch_time NUMERIC(12,3),
    summary_video_v50_watch_time NUMERIC(12,3),
    raw_summary JSONB,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_account_analytics_summaries UNIQUE (workspace_id, connection_id, window_start, window_end)
);

-- 4. Daily Workspace Metrics Table (Tenant-level daily aggregated rollup)
CREATE TABLE IF NOT EXISTS public.daily_workspace_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    metric_date DATE NOT NULL,
    total_impressions BIGINT NOT NULL DEFAULT 0 CHECK (total_impressions >= 0),
    total_engagements BIGINT NOT NULL DEFAULT 0 CHECK (total_engagements >= 0),
    total_saves BIGINT NOT NULL DEFAULT 0 CHECK (total_saves >= 0),
    total_outbound_clicks BIGINT NOT NULL DEFAULT 0 CHECK (total_outbound_clicks >= 0),
    total_pin_clicks BIGINT NOT NULL DEFAULT 0 CHECK (total_pin_clicks >= 0),
    total_profile_visits BIGINT NOT NULL DEFAULT 0 CHECK (total_profile_visits >= 0),
    top_pin_impressions BIGINT NOT NULL DEFAULT 0 CHECK (top_pin_impressions >= 0),
    top_pin_outbound_clicks BIGINT NOT NULL DEFAULT 0 CHECK (top_pin_outbound_clicks >= 0),
    top_pin_saves BIGINT NOT NULL DEFAULT 0 CHECK (top_pin_saves >= 0),
    active_top_pins_count INTEGER NOT NULL DEFAULT 0 CHECK (active_top_pins_count >= 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_daily_workspace_metrics UNIQUE (workspace_id, metric_date)
);

-- 5. Query-Optimized Covering Indexes
CREATE INDEX IF NOT EXISTS idx_top_pins_workspace_connection_sort_window 
    ON public.top_pins_snapshots (workspace_id, connection_id, sort_by, window_end DESC);

CREATE INDEX IF NOT EXISTS idx_top_pins_workspace_pin_recorded 
    ON public.top_pins_snapshots (workspace_id, pin_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_daily_workspace_connection_date 
    ON public.account_analytics_daily (workspace_id, connection_id, metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_account_summaries_workspace_connection_window 
    ON public.account_analytics_summaries (workspace_id, connection_id, window_end DESC);

CREATE INDEX IF NOT EXISTS idx_daily_workspace_metrics_workspace_date 
    ON public.daily_workspace_metrics (workspace_id, metric_date DESC);

-- 6. Enable Row Level Security (RLS) & Server-Only Service Role Policies
ALTER TABLE public.top_pins_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_analytics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_analytics_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_workspace_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service_role full access on top_pins_snapshots"
    ON public.top_pins_snapshots
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service_role full access on account_analytics_daily"
    ON public.account_analytics_daily
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service_role full access on account_analytics_summaries"
    ON public.account_analytics_summaries
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service_role full access on daily_workspace_metrics"
    ON public.daily_workspace_metrics
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
