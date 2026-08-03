export interface Account {
  id: string;
  account_name: string;
  webhook_url: string;
  max_pins_per_day: number;
  is_active: boolean;
  created_at: string;
  boards_count?: number;
}

export interface Board {
  id: string;
  account_id: string;
  board_name: string;
  board_id: string;
  created_at: string;
  account_name?: string;
}

export interface Pin {
  id: string;
  account_id: string;
  title: string;
  description: string | null;
  image_url: string;
  board_name: string | null;
  link: string | null;
  status: 'pending' | 'posted' | 'failed';
  source: string;
  posted_at: string | null;
  created_at: string;
  account_name?: string;
}

export interface Log {
  id: string;
  pin_id: string | null;
  account_id: string | null;
  status: 'success' | 'error';
  message: string | null;
  webhook_used: string | null;
  created_at: string;
  account_name?: string;
  pin_title?: string;
}

export interface DashboardKPIs {
  totalAccounts: number;
  activeAccounts: number;
  pendingPins: number;
  postedPins: number;
  failedPins: number;
  totalLogs: number;
}
