export interface PostingSchedule {
  id: string;
  account_id: string;
  workspace_id: string;
  label?: string | null;
  status: 'active' | 'paused' | 'error' | string;
  interval_minutes: number;
  random_delay_minutes: number;
  window_start: string;
  window_end: string;
  active_days: string[];
  timezone: string;
  cron_expression?: string | null;
  fastcron_job_id?: number | null;
  fastcron_token_id?: string | null;
  fastcron_token_encrypted?: string | null;
  dispatch_token: string;
  started_at?: string | null;
  last_dispatched_at?: string | null;
  batch?: number | null;
  webhook_id?: string | null;
  created_at?: string;
  updated_at?: string;
}
