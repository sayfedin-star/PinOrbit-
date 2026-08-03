import { createClient } from '@supabase/supabase-js';
import type { Account, Board, Pin, Log, AuditLog, AccountWebhook, DashboardKPIs } from './types';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://your-project-id.supabase.co'
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Mock Data used only as preview fallback when Supabase env is not configured
let mockAccounts: Account[] = [
  {
    id: 'acc-1',
    account_name: 'HealthyBites_US',
    webhook_url: 'https://hook.make.com/abc123healthy1',
    max_pins_per_day: 20,
    is_active: true,
    created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
    boards_count: 3,
    webhooks_count: 2,
    active_webhooks_count: 2,
    primary_webhook_label: 'Primary Hook',
  },
  {
    id: 'acc-2',
    account_name: 'DessertLovers_Global',
    webhook_url: 'https://hook.make.com/def456dessert2',
    max_pins_per_day: 15,
    is_active: true,
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    boards_count: 2,
    webhooks_count: 1,
    active_webhooks_count: 1,
    primary_webhook_label: 'Primary',
  },
  {
    id: 'acc-3',
    account_name: 'KetoRecipes_Hub',
    webhook_url: 'https://hook.make.com/ghi789keto3',
    max_pins_per_day: 25,
    is_active: false,
    created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
    boards_count: 4,
    webhooks_count: 1,
    active_webhooks_count: 0,
    primary_webhook_label: 'Backup Hook',
  },
];

let mockWebhooks: AccountWebhook[] = [
  {
    id: 'hook-1',
    account_id: 'acc-1',
    label: 'Primary Hook',
    webhook_url: 'https://hook.make.com/abc123healthy1',
    monthly_capacity: 500,
    monthly_usage: 45,
    remaining_capacity: 455,
    priority: 1,
    is_active: true,
    is_primary: true,
    last_used_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    last_failed_at: null,
    last_failure_reason: null,
    created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 10).toISOString(),
  },
  {
    id: 'hook-2',
    account_id: 'acc-1',
    label: 'Secondary Channel',
    webhook_url: 'https://hook.make.com/abc123healthy2',
    monthly_capacity: 500,
    monthly_usage: 0,
    remaining_capacity: 500,
    priority: 2,
    is_active: true,
    is_primary: false,
    last_used_at: null,
    last_failed_at: null,
    last_failure_reason: null,
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: 'hook-3',
    account_id: 'acc-2',
    label: 'Primary',
    webhook_url: 'https://hook.make.com/def456dessert2',
    monthly_capacity: 500,
    monthly_usage: 120,
    remaining_capacity: 380,
    priority: 1,
    is_active: true,
    is_primary: true,
    last_used_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    last_failed_at: null,
    last_failure_reason: null,
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
  {
    id: 'hook-4',
    account_id: 'acc-3',
    label: 'Backup Hook',
    webhook_url: 'https://hook.make.com/ghi789keto3',
    monthly_capacity: 300,
    monthly_usage: 300,
    remaining_capacity: 0,
    priority: 1,
    is_active: false,
    is_primary: true,
    last_used_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    last_failed_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    last_failure_reason: 'HTTP 429 Too Many Requests',
    created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
];

let mockBoards: Board[] = [
  {
    id: 'board-1',
    account_id: 'acc-1',
    board_name: 'Quick Dinner Recipes',
    board_id: '1092837465',
    created_at: new Date(Date.now() - 86400000 * 9).toISOString(),
    account_name: 'HealthyBites_US',
  },
  {
    id: 'board-2',
    account_id: 'acc-1',
    board_name: 'Healthy Meal Prep',
    board_id: '1092837466',
    created_at: new Date(Date.now() - 86400000 * 9).toISOString(),
    account_name: 'HealthyBites_US',
  },
  {
    id: 'board-3',
    account_id: 'acc-2',
    board_name: 'Easy Chocolate Desserts',
    board_id: '2092837467',
    created_at: new Date(Date.now() - 86400000 * 6).toISOString(),
    account_name: 'DessertLovers_Global',
  },
];

let mockPins: Pin[] = [
  {
    id: 'pin-1',
    account_id: 'acc-1',
    title: '30-Minute Creamy Garlic Chicken',
    description: 'Easy and delicious one-pan creamy garlic chicken recipe perfect for busy weeknights.',
    image_url: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=600&q=80',
    board_name: 'Quick Dinner Recipes',
    link: 'https://myrecipeblog.com/creamy-garlic-chicken',
    status: 'posted',
    source: 'google_sheets',
    posted_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    account_name: 'HealthyBites_US',
  },
  {
    id: 'pin-2',
    account_id: 'acc-1',
    title: 'Keto Cauliflower Rice Bowl',
    description: 'Low carb cauliflower bowl with avocado, roasted chickpeas and tahini dressing.',
    image_url: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80',
    board_name: 'Healthy Meal Prep',
    link: 'https://myrecipeblog.com/cauliflower-bowl',
    status: 'pending',
    source: 'google_sheets',
    posted_at: null,
    created_at: new Date(Date.now() - 3600000 * 3).toISOString(),
    account_name: 'HealthyBites_US',
  },
  {
    id: 'pin-3',
    account_id: 'acc-2',
    title: 'Rich Molten Chocolate Lava Cake',
    description: 'Decadent chocolate lava cake with warm gooey fudge center in under 20 mins.',
    image_url: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=600&q=80',
    board_name: 'Easy Chocolate Desserts',
    link: 'https://myrecipeblog.com/chocolate-lava-cake',
    status: 'pending',
    source: 'google_sheets',
    posted_at: null,
    created_at: new Date(Date.now() - 3600000 * 1).toISOString(),
    account_name: 'DessertLovers_Global',
  },
  {
    id: 'pin-4',
    account_id: 'acc-3',
    title: 'Avocado Keto Salad',
    description: 'Fresh avocado salad with spinach, olive oil and chia seeds.',
    image_url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=600&q=80',
    board_name: 'Non-existent Board',
    link: 'https://myrecipeblog.com/avocado-salad',
    status: 'failed',
    source: 'google_sheets',
    posted_at: null,
    created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    account_name: 'KetoRecipes_Hub',
  },
];

let mockLogs: Log[] = [
  {
    id: 'log-1',
    pin_id: 'pin-1',
    account_id: 'acc-1',
    webhook_id: 'hook-1',
    status: 'success',
    message: 'Sent to Make successfully',
    webhook_used: 'https://hook.make.com/abc123healthy1',
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    account_name: 'HealthyBites_US',
    pin_title: '30-Minute Creamy Garlic Chicken',
    webhook_label: 'Primary Hook',
  },
  {
    id: 'log-2',
    pin_id: 'pin-4',
    account_id: 'acc-3',
    webhook_id: 'hook-4',
    status: 'error',
    message: 'Board not found for this account',
    webhook_used: null,
    created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    account_name: 'KetoRecipes_Hub',
    pin_title: 'Avocado Keto Salad',
    webhook_label: 'Backup Hook',
  },
];

let mockAuditLogs: AuditLog[] = [];

interface RawAccount extends Account {
  boards?: { id: string }[];
  account_webhooks?: {
    id: string;
    label: string;
    is_active: boolean;
    is_primary: boolean;
  }[];
}

interface RawBoard extends Board {
  accounts?: { account_name: string } | null;
}

interface RawPin extends Pin {
  accounts?: { account_name: string } | null;
}

interface RawLog extends Log {
  accounts?: { account_name: string } | null;
  pins?: { title: string } | null;
  account_webhooks?: { label: string } | null;
}

// 1. Fetch Accounts with Webhook Summary
export async function getAccounts(): Promise<Account[]> {
  if (!supabase) return mockAccounts;
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('*, boards(id), account_webhooks(id, label, is_active, is_primary)')
      .order('created_at', { ascending: false });

    if (error) {
      const { data: basicData, error: basicErr } = await supabase
        .from('accounts')
        .select('*')
        .order('created_at', { ascending: false });

      if (basicErr || !basicData) throw basicErr || new Error('No data');
      return (basicData as Account[]).map((acc) => ({
        ...acc,
        boards_count: 0,
        webhooks_count: 0,
        active_webhooks_count: 0,
        primary_webhook_label: 'None',
      }));
    }

    if (!data) return [];
    return (data as RawAccount[]).map((acc) => {
      const hooks = acc.account_webhooks || [];
      const primaryHook = hooks.find((h) => h.is_primary);

      return {
        ...acc,
        boards_count: acc.boards ? acc.boards.length : 0,
        webhooks_count: hooks.length,
        active_webhooks_count: hooks.filter((h) => h.is_active).length,
        primary_webhook_label: primaryHook ? primaryHook.label : 'None',
      };
    });
  } catch (err) {
    console.warn('Supabase fetch accounts error, using fallback:', err);
    return mockAccounts;
  }
}

// 2. Fetch Account Webhooks
export async function getAccountWebhooks(accountId?: string): Promise<AccountWebhook[]> {
  if (!supabase) {
    if (!accountId) return mockWebhooks;
    return mockWebhooks.filter((w) => w.account_id === accountId);
  }
  try {
    let query = supabase
      .from('account_webhooks')
      .select('*')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true });

    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as AccountWebhook[]) || [];
  } catch (err) {
    console.warn('Supabase fetch account_webhooks error, using fallback:', err);
    if (!accountId) return mockWebhooks;
    return mockWebhooks.filter((w) => w.account_id === accountId);
  }
}

// 3. Fetch Boards
export async function getBoards(): Promise<Board[]> {
  if (!supabase) return mockBoards;
  try {
    const { data, error } = await supabase
      .from('boards')
      .select('*, accounts(account_name)')
      .order('created_at', { ascending: false });

    if (error) {
      const { data: basicData, error: basicErr } = await supabase
        .from('boards')
        .select('*')
        .order('created_at', { ascending: false });

      if (basicErr || !basicData) throw basicErr || new Error('No data');
      return basicData as Board[];
    }

    if (!data) return [];
    return (data as RawBoard[]).map((b) => ({
      ...b,
      account_name: b.accounts?.account_name || 'Account #' + b.account_id.slice(0, 6),
    }));
  } catch (err) {
    console.warn('Supabase fetch boards error, using fallback:', err);
    return mockBoards;
  }
}

// 4. Fetch Pins
export async function getPins(statusFilter?: string): Promise<Pin[]> {
  if (!supabase) {
    if (!statusFilter || statusFilter === 'all') return mockPins;
    return mockPins.filter((p) => p.status === statusFilter);
  }
  try {
    let query = supabase
      .from('pins')
      .select('*, accounts(account_name)')
      .order('created_at', { ascending: false });

    if (statusFilter && statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      let basicQuery = supabase.from('pins').select('*').order('created_at', { ascending: false });
      if (statusFilter && statusFilter !== 'all') {
        basicQuery = basicQuery.eq('status', statusFilter);
      }
      const { data: basicData, error: basicErr } = await basicQuery;
      if (basicErr || !basicData) throw basicErr || new Error('No data');
      return basicData as Pin[];
    }

    if (!data) return [];
    return (data as RawPin[]).map((p) => ({
      ...p,
      account_name: p.accounts?.account_name || (p.account_id ? 'Account #' + p.account_id.slice(0, 6) : 'Unassigned'),
    }));
  } catch (err) {
    console.warn('Supabase fetch pins error, using fallback:', err);
    if (!statusFilter || statusFilter === 'all') return mockPins;
    return mockPins.filter((p) => p.status === statusFilter);
  }
}

// 5. Fetch Logs
export async function getLogs(limit = 50): Promise<Log[]> {
  if (!supabase) return mockLogs.slice(0, limit);
  try {
    const { data, error } = await supabase
      .from('logs')
      .select('*, accounts(account_name), pins(title), account_webhooks(label)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      const { data: basicData, error: basicErr } = await supabase
        .from('logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (basicErr || !basicData) throw basicErr || new Error('No data');
      return basicData as Log[];
    }

    if (!data) return [];
    return (data as RawLog[]).map((l) => ({
      ...l,
      account_name: l.accounts?.account_name || (l.account_id ? 'Account #' + l.account_id.slice(0, 6) : 'System'),
      pin_title: l.pins?.title || 'System Operation',
      webhook_label: l.account_webhooks?.label || 'Default Webhook',
    }));
  } catch (err) {
    console.warn('Supabase fetch logs error, using fallback:', err);
    return mockLogs.slice(0, limit);
  }
}

// 6. Fetch Audit Logs
export async function getAuditLogs(limit = 100): Promise<AuditLog[]> {
  if (!supabase) return mockAuditLogs.slice(0, limit);
  try {
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data as AuditLog[]) || [];
  } catch (err) {
    console.warn('Supabase fetch audit logs error, using fallback:', err);
    return mockAuditLogs.slice(0, limit);
  }
}

// 7. Fetch Dashboard KPIs
export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  const [accounts, webhooks, pins, logs] = await Promise.all([
    getAccounts(),
    getAccountWebhooks(),
    getPins(),
    getLogs(100),
  ]);

  return {
    totalAccounts: accounts.length,
    activeAccounts: accounts.filter((a) => a.is_active).length,
    pendingPins: pins.filter((p) => p.status === 'pending').length,
    postedPins: pins.filter((p) => p.status === 'posted').length,
    failedPins: pins.filter((p) => p.status === 'failed').length,
    totalLogs: logs.length,
    totalWebhooks: webhooks.length,
    activeWebhooks: webhooks.filter((w) => w.is_active).length,
    exhaustedWebhooks: webhooks.filter((w) => w.remaining_capacity <= 0).length,
  };
}

// 8. Admin Mutations & Webhook Operations

export async function createAccount(payload: {
  account_name: string;
  webhook_url: string;
  max_pins_per_day: number;
  is_active?: boolean;
}): Promise<{ data: Account | null; error: string | null }> {
  if (!supabase) {
    const newAcc: Account = {
      id: 'acc-' + Date.now(),
      account_name: payload.account_name,
      webhook_url: payload.webhook_url,
      max_pins_per_day: payload.max_pins_per_day,
      is_active: payload.is_active ?? true,
      created_at: new Date().toISOString(),
      boards_count: 0,
      webhooks_count: 1,
      active_webhooks_count: 1,
      primary_webhook_label: 'Primary',
    };
    mockAccounts.unshift(newAcc);
    mockWebhooks.unshift({
      id: 'hook-' + Date.now(),
      account_id: newAcc.id,
      label: 'Primary',
      webhook_url: payload.webhook_url,
      monthly_capacity: 500,
      monthly_usage: 0,
      remaining_capacity: 500,
      priority: 1,
      is_active: payload.is_active ?? true,
      is_primary: true,
      last_used_at: null,
      last_failed_at: null,
      last_failure_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { data: newAcc, error: null };
  }

  const { data, error } = await supabase
    .from('accounts')
    .insert({
      account_name: payload.account_name,
      webhook_url: payload.webhook_url,
      max_pins_per_day: payload.max_pins_per_day,
      is_active: payload.is_active ?? true,
    })
    .select('*')
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  // Also insert corresponding primary webhook in account_webhooks
  if (data) {
    await supabase.from('account_webhooks').insert({
      account_id: data.id,
      label: 'Primary',
      webhook_url: payload.webhook_url,
      monthly_capacity: 500,
      monthly_usage: 0,
      priority: 1,
      is_active: payload.is_active ?? true,
      is_primary: true,
    });
  }

  return { data: data as Account, error: null };
}

export async function updateAccountDailyLimit(
  id: string,
  max_pins_per_day: number
): Promise<{ data: Account | null; error: string | null }> {
  if (!supabase) {
    const target = mockAccounts.find((a) => a.id === id);
    if (target) {
      target.max_pins_per_day = max_pins_per_day;
      return { data: target, error: null };
    }
    return { data: null, error: 'Account not found' };
  }

  const { data, error } = await supabase
    .from('accounts')
    .update({ max_pins_per_day })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return { data: null, error: error.message };
  }
  return { data: data as Account, error: null };
}

export async function toggleAccountActive(
  id: string,
  is_active: boolean
): Promise<{ data: Account | null; error: string | null }> {
  if (!supabase) {
    const target = mockAccounts.find((a) => a.id === id);
    if (target) {
      target.is_active = is_active;
      return { data: target, error: null };
    }
    return { data: null, error: 'Account not found' };
  }

  const { data, error } = await supabase
    .from('accounts')
    .update({ is_active })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return { data: null, error: error.message };
  }
  return { data: data as Account, error: null };
}

export async function createBoard(payload: {
  account_id: string;
  board_name: string;
  board_id: string;
}): Promise<{ data: Board | null; error: string | null }> {
  if (!supabase) {
    const acc = mockAccounts.find((a) => a.id === payload.account_id);
    const newBoard: Board = {
      id: 'board-' + Date.now(),
      account_id: payload.account_id,
      board_name: payload.board_name,
      board_id: payload.board_id,
      created_at: new Date().toISOString(),
      account_name: acc?.account_name || 'Account',
    };
    mockBoards.unshift(newBoard);
    if (acc) {
      acc.boards_count = (acc.boards_count || 0) + 1;
    }
    return { data: newBoard, error: null };
  }

  const { data, error } = await supabase
    .from('boards')
    .insert({
      account_id: payload.account_id,
      board_name: payload.board_name,
      board_id: payload.board_id,
    })
    .select('*')
    .single();

  if (error) {
    return { data: null, error: error.message };
  }
  return { data: data as Board, error: null };
}

export async function updateBoard(
  id: string,
  payload: {
    board_name: string;
    board_id: string;
    account_id?: string;
  }
): Promise<{ data: Board | null; error: string | null }> {
  if (!supabase) {
    const target = mockBoards.find((b) => b.id === id);
    if (target) {
      target.board_name = payload.board_name;
      target.board_id = payload.board_id;
      if (payload.account_id) {
        target.account_id = payload.account_id;
        const acc = mockAccounts.find((a) => a.id === payload.account_id);
        if (acc) target.account_name = acc.account_name;
      }
      return { data: target, error: null };
    }
    return { data: null, error: 'Board not found' };
  }

  const updateData: { board_name: string; board_id: string; account_id?: string } = {
    board_name: payload.board_name,
    board_id: payload.board_id,
  };
  if (payload.account_id) {
    updateData.account_id = payload.account_id;
  }

  const { data, error } = await supabase
    .from('boards')
    .update(updateData)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return { data: null, error: error.message };
  }
  return { data: data as Board, error: null };
}

// 9. Multi-Webhook Specific Operations

export async function createAccountWebhook(payload: {
  account_id: string;
  label: string;
  webhook_url: string;
  monthly_capacity?: number;
  priority?: number;
  is_active?: boolean;
  is_primary?: boolean;
}): Promise<{ data: AccountWebhook | null; error: string | null }> {
  if (!supabase) {
    // If set as primary, unset other primaries for this account
    if (payload.is_primary) {
      mockWebhooks.forEach((w) => {
        if (w.account_id === payload.account_id) w.is_primary = false;
      });
    }

    const cap = payload.monthly_capacity ?? 500;
    const newHook: AccountWebhook = {
      id: 'hook-' + Date.now(),
      account_id: payload.account_id,
      label: payload.label,
      webhook_url: payload.webhook_url,
      monthly_capacity: cap,
      monthly_usage: 0,
      remaining_capacity: cap,
      priority: payload.priority ?? 1,
      is_active: payload.is_active ?? true,
      is_primary: payload.is_primary ?? false,
      last_used_at: null,
      last_failed_at: null,
      last_failure_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockWebhooks.unshift(newHook);
    return { data: newHook, error: null };
  }

  try {
    if (payload.is_primary) {
      await supabase
        .from('account_webhooks')
        .update({ is_primary: false })
        .eq('account_id', payload.account_id);
    }

    const { data, error } = await supabase
      .from('account_webhooks')
      .insert({
        account_id: payload.account_id,
        label: payload.label,
        webhook_url: payload.webhook_url,
        monthly_capacity: payload.monthly_capacity ?? 500,
        priority: payload.priority ?? 1,
        is_active: payload.is_active ?? true,
        is_primary: payload.is_primary ?? false,
      })
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as AccountWebhook, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Error creating webhook' };
  }
}

export async function updateAccountWebhook(
  id: string,
  payload: Partial<{
    label: string;
    webhook_url: string;
    monthly_capacity: number;
    monthly_usage: number;
    priority: number;
    is_active: boolean;
    is_primary: boolean;
    last_failure_reason: string | null;
  }>
): Promise<{ data: AccountWebhook | null; error: string | null }> {
  if (!supabase) {
    const target = mockWebhooks.find((w) => w.id === id);
    if (target) {
      if (payload.is_primary) {
        mockWebhooks.forEach((w) => {
          if (w.account_id === target.account_id) w.is_primary = false;
        });
      }
      Object.assign(target, payload);
      target.remaining_capacity = target.monthly_capacity - target.monthly_usage;
      target.updated_at = new Date().toISOString();
      return { data: target, error: null };
    }
    return { data: null, error: 'Webhook not found' };
  }

  try {
    if (payload.is_primary) {
      const { data: targetHook } = await supabase
        .from('account_webhooks')
        .select('account_id')
        .eq('id', id)
        .single();

      if (targetHook) {
        await supabase
          .from('account_webhooks')
          .update({ is_primary: false })
          .eq('account_id', targetHook.account_id);
      }
    }

    const { data, error } = await supabase
      .from('account_webhooks')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as AccountWebhook, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Error updating webhook' };
  }
}

export async function setPrimaryWebhook(
  id: string,
  accountId: string
): Promise<{ success: boolean; error: string | null }> {
  if (!supabase) {
    mockWebhooks.forEach((w) => {
      if (w.account_id === accountId) {
        w.is_primary = w.id === id;
      }
    });
    return { success: true, error: null };
  }

  try {
    await supabase
      .from('account_webhooks')
      .update({ is_primary: false })
      .eq('account_id', accountId);

    const { error } = await supabase
      .from('account_webhooks')
      .update({ is_primary: true })
      .eq('id', id);

    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed setting primary webhook' };
  }
}

export async function toggleAccountWebhookActive(
  id: string,
  is_active: boolean
): Promise<{ data: AccountWebhook | null; error: string | null }> {
  return updateAccountWebhook(id, { is_active });
}

// Selection strategy for backend execution engine
export async function selectOptimalWebhookForAccount(
  accountId: string
): Promise<{ webhook: AccountWebhook | null; error: string | null }> {
  const webhooks = await getAccountWebhooks(accountId);

  const eligible = webhooks.filter((w) => w.is_active && w.remaining_capacity > 0);

  if (eligible.length === 0) {
    return {
      webhook: null,
      error: 'No eligible webhook with remaining capacity for this account',
    };
  }

  // 1. Prefer Primary webhook if active and has remaining capacity
  const primary = eligible.find((w) => w.is_primary);
  if (primary) {
    return { webhook: primary, error: null };
  }

  // 2. Sort remaining eligible webhooks:
  //    - Lowest priority number first (1 is top priority)
  //    - Highest remaining_capacity
  //    - Oldest last_used_at (null first)
  eligible.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    if (a.remaining_capacity !== b.remaining_capacity) {
      return b.remaining_capacity - a.remaining_capacity;
    }
    if (!a.last_used_at) return -1;
    if (!b.last_used_at) return 1;
    return new Date(a.last_used_at).getTime() - new Date(b.last_used_at).getTime();
  });

  return { webhook: eligible[0], error: null };
}
