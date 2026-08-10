-- Migration: 20260813000000_pin_intelligence.sql
-- Description: Indexes and aggregation RPC for per-sort Pin Intelligence Leaderboard and Timeline

-- Index for per-sort leaderboard queries
CREATE INDEX IF NOT EXISTS idx_top_pins_pin_trend
  ON public.top_pins_snapshots 
  (connection_id, sort_by, pin_id, window_end DESC);

-- Index for pin timeline queries  
CREATE INDEX IF NOT EXISTS idx_top_pins_pin_timeline
  ON public.top_pins_snapshots 
  (connection_id, pin_id, sort_by, window_end ASC);

-- RPC for pin leaderboard aggregation
CREATE OR REPLACE FUNCTION public.get_pin_leaderboard(
  p_connection_id uuid,
  p_sort_by text,
  p_days int DEFAULT 30,
  p_limit int DEFAULT 25,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  pin_id text,
  title text,
  image_url text,
  destination_url text,
  appearances bigint,
  best_rank integer,
  total_impressions bigint,
  total_engagements bigint,
  total_saves bigint,
  total_outbound_clicks bigint,
  total_pin_clicks bigint,
  last_seen timestamptz,
  prev_rank integer
)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    t1.pin_id,
    MAX(t1.title) as title,
    MAX(t1.image_url) as image_url,
    MAX(t1.destination_url) as destination_url,
    COUNT(*)::bigint as appearances,
    MIN(t1.rank_position)::integer as best_rank,
    SUM(t1.impressions)::bigint as total_impressions,
    SUM(t1.engagement)::bigint as total_engagements,
    SUM(t1.saves)::bigint as total_saves,
    SUM(t1.outbound_clicks)::bigint as total_outbound_clicks,
    SUM(t1.pin_clicks)::bigint as total_pin_clicks,
    MAX(t1.window_end) as last_seen,
    (SELECT t2.rank_position FROM public.top_pins_snapshots t2 
     WHERE t2.connection_id = t1.connection_id 
       AND t2.sort_by = t1.sort_by 
       AND t2.pin_id = t1.pin_id 
       AND t2.window_end < (NOW() - INTERVAL '7 days')
     ORDER BY t2.window_end DESC LIMIT 1)::integer as prev_rank
  FROM public.top_pins_snapshots t1
  WHERE t1.connection_id = p_connection_id 
    AND t1.sort_by = p_sort_by
    AND t1.window_end >= (NOW() - (p_days || ' days')::INTERVAL)
    AND (
      p_search IS NULL 
      OR p_search = '' 
      OR t1.pin_id ILIKE ('%' || p_search || '%') 
      OR t1.title ILIKE ('%' || p_search || '%')
    )
  GROUP BY t1.pin_id, t1.sort_by, t1.connection_id
  ORDER BY 
    CASE WHEN p_sort_by = 'OUTBOUND_CLICK' THEN SUM(t1.outbound_clicks)
         WHEN p_sort_by = 'SAVE' THEN SUM(t1.saves)
         WHEN p_sort_by = 'ENGAGEMENT' THEN SUM(t1.engagement)
         WHEN p_sort_by = 'PIN_CLICK' THEN SUM(t1.pin_clicks)
         ELSE SUM(t1.impressions)
    END DESC
  LIMIT p_limit;
$$;
