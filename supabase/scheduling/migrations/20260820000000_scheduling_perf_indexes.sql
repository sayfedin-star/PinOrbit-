-- Migration: 20260820000000_scheduling_perf_indexes.sql
-- Description: Performance indexes for posting_schedules and board_provisioning_requests

CREATE INDEX IF NOT EXISTS idx_ps_workspace ON public.posting_schedules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ps_account ON public.posting_schedules(account_id);
CREATE INDEX IF NOT EXISTS idx_ps_status ON public.posting_schedules(status);
CREATE INDEX IF NOT EXISTS idx_bpr_account_status ON public.board_provisioning_requests(account_id, status);
