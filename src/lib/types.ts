export interface AccountWebhook {
  id: string;
  account_id: string;
  label: string;
  webhook_url: string;
  monthly_capacity: number;
  monthly_usage: number;
  remaining_capacity: number;
  priority: number;
  is_active: boolean;
  is_primary: boolean;
  last_used_at: string | null;
  last_failed_at: string | null;
  last_failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  account_name: string;
  webhook_url?: string;
  max_pins_per_day: number;
  is_active: boolean;
  pinning_started_at?: string | null;
  posting_window_start?: string | null;
  posting_window_end?: string | null;
  posting_interval_minutes?: number;
  random_delay_minutes?: number;
  timezone?: string;
  created_at: string;
  boards_count?: number;
  webhooks_count?: number;
  active_webhooks_count?: number;
  primary_webhook_label?: string;
  last_published_at?: string | null;
  auto_create_missing_boards?: boolean;
  board_creation_webhook_id?: string | null;
  active_days?: string[] | string;
}

export interface AccountPinStats {
  total: number;
  pending: number;
  posted: number;
  failed: number;
  retrying: number;
  remainingToday: number;
}

export interface AccountWebhookSummary {
  totalWebhooks: number;
  activeWebhooks: number;
  primaryWebhookLabel: string;
  totalRemainingCapacity: number;
}

export interface Board {
  id: string;
  account_id: string;
  board_name: string;
  board_id: string;
  created_at: string;
  account_name?: string;
  pinterest_board_id?: string | null;
  created_via?: 'manual' | 'webhook_auto_create' | string;
  created_via_webhook_id?: string | null;
}

export interface Pin {
  id: string;
  account_id: string;
  title: string;
  description: string | null;
  image_url: string;
  board_name: string | null;
  link: string | null;
  status: 'pending' | 'processing' | 'posted' | 'failed';
  source: string;
  posted_at: string | null;
  scheduled_for?: string | null;
  processing_started_at?: string | null;
  created_at: string;
  account_name?: string;
  retry_count?: number;
  max_retries?: number;
  next_retry_at?: string | null;
  last_failure_reason?: string | null;
  last_attempt_at?: string | null;
  failure_type?: 'transient' | 'permanent' | 'rate_limited' | null;
}

export interface Log {
  id: string;
  pin_id: string | null;
  account_id: string | null;
  webhook_id?: string | null;
  status: 'success' | 'error';
  message: string | null;
  webhook_used: string | null;
  created_at: string;
  account_name?: string;
  pin_title?: string;
  webhook_label?: string;
}

export interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  old_data: Record<string, any> | null;
  new_data: Record<string, any> | null;
  changed_by: string | null;
  changed_at: string;
}

export interface ImportSession {
  id: string;
  account_id: string;
  source_type: 'csv_upload' | 'google_sheets' | string;
  source_label?: string | null;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  imported_rows: number;
  created_by?: string | null;
  created_at: string;
}

export interface DashboardKPIs {
  totalAccounts: number;
  activeAccounts: number;
  pendingPins: number;
  postedPins: number;
  failedPins: number;
  totalLogs: number;
  totalWebhooks: number;
  activeWebhooks: number;
  exhaustedWebhooks: number;
}

export interface Competitor {
  id: string;
  user_id?: string;
  username: string;
  full_name?: string | null;
  niche?: string | null;
  profile_reach: number;
  profile_views: number;
  follower_count: number;
  pin_count: number;
  avatar_url?: string | null;
  notes?: string | null;
  last_checked_at?: string | null;
  website_url?: string | null;
  domain_verified?: boolean;
  last_pin_at?: string | null;
  account_type?: 'own' | 'competitor' | string;
  tags?: string[];
  created_at: string;
  boards_count?: number;
  strategy_age_days?: number;
  oldest_board_date?: string | null;
}

export interface CompetitorSnapshot {
  id: string;
  competitor_id: string;
  profile_reach: number;
  profile_views: number;
  follower_count: number;
  pin_count: number;
  recorded_at: string;
}

export interface CompetitorBoard {
  id: string;
  competitor_id: string;
  board_id: string;
  name: string;
  description?: string | null;
  url?: string | null;
  pin_count: number;
  follower_count: number;
  board_created_at?: string | null;
  last_pinned_at?: string | null;
  updated_at: string;
}

export interface CompetitorDeltaStats {
  reachChange: number;
  reachPercent: number;
  viewsChange: number;
  viewsPercent: number;
  followersChange: number;
  followersPercent: number;
  pinsChange: number;
  pinsPercent: number;
}

export type PinterestPayloadType = 'user_profile' | 'user_boards' | 'unknown';

export interface ParsedPinterestPayload {
  type: PinterestPayloadType;
  username?: string;
  profileData?: {
    full_name?: string;
    profile_reach?: number;
    profile_views?: number;
    follower_count?: number;
    pin_count?: number;
    avatar_url?: string;
    about?: string;
    website_url?: string;
    domain_verified?: boolean;
    last_pin_at?: string;
  };
  boardsData?: Array<{
    board_id: string;
    name: string;
    description?: string;
    url?: string;
    pin_count: number;
    follower_count: number;
    board_created_at?: string;
    last_pinned_at?: string;
  }>;
  rawJson?: any;
}

