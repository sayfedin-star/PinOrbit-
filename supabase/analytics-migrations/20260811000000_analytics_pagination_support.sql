-- 20260811000000_analytics_pagination_support.sql
CREATE INDEX IF NOT EXISTS idx_daily_conn_date
  ON public.account_analytics_daily (connection_id, metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_top_pins_windowed
  ON public.top_pins_snapshots (connection_id, sort_by, window_end DESC, recorded_at DESC, rank_position);

-- Range totals without client-side summation
CREATE OR REPLACE FUNCTION public.daily_totals(
  p_workspace uuid, p_connection uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL
) RETURNS TABLE (
  impressions bigint, engagements bigint, outbound_clicks bigint,
  pin_clicks bigint, saves bigint, ready_days integer, total_rows integer
) LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(impressions),0), COALESCE(SUM(engagements),0),
         COALESCE(SUM(outbound_clicks),0), COALESCE(SUM(pin_clicks),0),
         COALESCE(SUM(saves),0),
         COUNT(*) FILTER (WHERE data_status = 'READY'),
         COUNT(*)
  FROM public.account_analytics_daily
  WHERE workspace_id = p_workspace AND connection_id = p_connection
    AND (p_from IS NULL OR metric_date >= p_from)
    AND (p_to   IS NULL OR metric_date <= p_to);
$$;
