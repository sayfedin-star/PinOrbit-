import { createClient } from '@supabase/supabase-js';
import type { Account, Board, Pin, Log, AuditLog, AccountWebhook, ImportSession, DashboardKPIs, AccountPinStats, AccountWebhookSummary } from './types';

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
    pinning_started_at: new Date(Date.now() - 86400000 * 15).toISOString(),
    posting_window_start: '09:00',
    posting_window_end: '21:00',
    timezone: 'America/New_York',
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
    pinning_started_at: new Date(Date.now() - 86400000 * 30).toISOString(),
    posting_window_start: '10:00',
    posting_window_end: '22:00',
    timezone: 'Europe/London',
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
    pinning_started_at: null,
    posting_window_start: '08:00',
    posting_window_end: '20:00',
    timezone: 'UTC',
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
    scheduled_for: null,
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
    scheduled_for: null,
    created_at: new Date(Date.now() - 3600000 * 3).toISOString(),
    account_name: 'HealthyBites_US',
  },
];

let mockLogs: Log[] = [];
let mockAuditLogs: AuditLog[] = [];
let mockImportSessions: ImportSession[] = [];

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

// Fetch Boards for specific account
export async function getBoardsForAccount(accountId: string): Promise<Board[]> {
  if (!supabase) {
    return mockBoards.filter((b) => b.account_id === accountId);
  }
  try {
    const { data, error } = await supabase
      .from('boards')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as Board[]) || [];
  } catch (err) {
    console.warn('Supabase fetch boards for account error, using fallback:', err);
    return mockBoards.filter((b) => b.account_id === accountId);
  }
}

// 4. Fetch Pins
export async function getPins(statusFilter?: string, accountIdFilter?: string): Promise<Pin[]> {
  if (!supabase) {
    let pins = mockPins;
    if (statusFilter && statusFilter !== 'all') {
      pins = pins.filter((p) => p.status === statusFilter);
    }
    if (accountIdFilter && accountIdFilter !== 'all') {
      pins = pins.filter((p) => p.account_id === accountIdFilter);
    }
    return pins;
  }
  try {
    let query = supabase
      .from('pins')
      .select('*, accounts(account_name)')
      .order('created_at', { ascending: false });

    if (statusFilter && statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }
    if (accountIdFilter && accountIdFilter !== 'all') {
      query = query.eq('account_id', accountIdFilter);
    }

    const { data, error } = await query;
    if (error) {
      let basicQuery = supabase.from('pins').select('*').order('created_at', { ascending: false });
      if (statusFilter && statusFilter !== 'all') {
        basicQuery = basicQuery.eq('status', statusFilter);
      }
      if (accountIdFilter && accountIdFilter !== 'all') {
        basicQuery = basicQuery.eq('account_id', accountIdFilter);
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
    let pins = mockPins;
    if (statusFilter && statusFilter !== 'all') {
      pins = pins.filter((p) => p.status === statusFilter);
    }
    if (accountIdFilter && accountIdFilter !== 'all') {
      pins = pins.filter((p) => p.account_id === accountIdFilter);
    }
    return pins;
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

// 7. Fetch Import Sessions History
export async function getImportSessions(limit = 10): Promise<ImportSession[]> {
  if (!supabase) return mockImportSessions.slice(0, limit);
  try {
    const { data, error } = await supabase
      .from('import_sessions')
      .select('*, accounts(account_name)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data as any[]).map((s) => ({
      ...s,
      account_name: s.accounts?.account_name || 'Account #' + s.account_id.slice(0, 6),
    }));
  } catch (err) {
    console.warn('Supabase fetch import_sessions error, using fallback:', err);
    return mockImportSessions.slice(0, limit);
  }
}

// 8. Fetch Dashboard KPIs
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

// 9. Admin Mutations & Webhook Operations

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
): Promise<{ data: Account | null; error: string | null; success: boolean }> {
  if (!supabase) {
    const target = mockAccounts.find((a) => a.id === id);
    if (target) {
      target.max_pins_per_day = max_pins_per_day;
      return { data: target, error: null, success: true };
    }
    return { data: null, error: 'Account not found', success: false };
  }

  const { data, error } = await supabase
    .from('accounts')
    .update({ max_pins_per_day })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return { data: null, error: error.message, success: false };
  }
  return { data: data as Account, error: null, success: true };
}

export async function toggleAccountActive(
  id: string,
  is_active: boolean
): Promise<{ data: Account | null; error: string | null; success: boolean }> {
  if (!supabase) {
    const target = mockAccounts.find((a) => a.id === id);
    if (target) {
      target.is_active = is_active;
      return { data: target, error: null, success: true };
    }
    return { data: null, error: 'Account not found', success: false };
  }

  const { data, error } = await supabase
    .from('accounts')
    .update({ is_active })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return { data: null, error: error.message, success: false };
  }
  return { data: data as Account, error: null, success: true };
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

// 10. Importer Bulk Pin Operations

export async function bulkInsertPins(
  pins: Partial<Pin>[],
  sessionMeta?: {
    account_id: string;
    source_type: string;
    source_label?: string;
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
  }
): Promise<{ count: number; error: string | null }> {
  if (!pins || pins.length === 0) {
    return { count: 0, error: null };
  }

  if (!supabase) {
    pins.forEach((p, idx) => {
      const newPin: Pin = {
        id: 'pin-imp-' + Date.now() + '-' + idx,
        account_id: p.account_id || 'acc-1',
        title: p.title || 'Untitled Pin',
        description: p.description || null,
        image_url: p.image_url || '',
        board_name: p.board_name || null,
        link: p.link || null,
        status: 'pending',
        source: p.source || 'csv_import',
        posted_at: null,
        scheduled_for: p.scheduled_for || null,
        created_at: new Date().toISOString(),
        account_name: 'Imported Account',
      };
      mockPins.unshift(newPin);
    });

    if (sessionMeta) {
      mockImportSessions.unshift({
        id: 'session-' + Date.now(),
        account_id: sessionMeta.account_id,
        source_type: sessionMeta.source_type,
        source_label: sessionMeta.source_label || null,
        total_rows: sessionMeta.total_rows,
        valid_rows: sessionMeta.valid_rows,
        invalid_rows: sessionMeta.invalid_rows,
        imported_rows: pins.length,
        created_at: new Date().toISOString(),
      });
    }

    return { count: pins.length, error: null };
  }

  try {
    const chunkSize = 50;
    let totalInserted = 0;

    for (let i = 0; i < pins.length; i += chunkSize) {
      const chunk = pins.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('pins')
        .insert(chunk)
        .select('id');

      if (error) {
        return { count: totalInserted, error: error.message };
      }
      totalInserted += (data ? data.length : chunk.length);
    }

    // Log import session if metadata provided
    if (sessionMeta) {
      const { data: userRes } = await supabase.auth.getUser();
      await supabase.from('import_sessions').insert({
        account_id: sessionMeta.account_id,
        source_type: sessionMeta.source_type,
        source_label: sessionMeta.source_label || null,
        total_rows: sessionMeta.total_rows,
        valid_rows: sessionMeta.valid_rows,
        invalid_rows: sessionMeta.invalid_rows,
        imported_rows: totalInserted,
        created_by: userRes?.user ? userRes.user.id : null,
      });
    }

    return { count: totalInserted, error: null };
  } catch (err: any) {
    return { count: 0, error: err.message || 'Bulk insert failed' };
  }
}

// 17. Fetch Single Account Details
export async function getAccountDetails(accountId: string): Promise<Account | null> {
  if (!supabase) {
    const acc = mockAccounts.find((a) => a.id === accountId);
    if (!acc) return null;
    const hooks = mockWebhooks.filter((w) => w.account_id === accountId);
    const primaryHook = hooks.find((h) => h.is_primary);
    const boards = mockBoards.filter((b) => b.account_id === accountId);
    const postedPins = mockPins.filter((p) => p.account_id === accountId && p.status === 'posted' && p.posted_at);
    const lastPublished = postedPins.length > 0
      ? [...postedPins].sort((a, b) => new Date(b.posted_at!).getTime() - new Date(a.posted_at!).getTime())[0].posted_at
      : null;

    return {
      ...acc,
      boards_count: boards.length,
      webhooks_count: hooks.length,
      active_webhooks_count: hooks.filter((h) => h.is_active).length,
      primary_webhook_label: primaryHook ? primaryHook.label : 'None',
      last_published_at: lastPublished || null,
    };
  }

  try {
    const { data: accData, error: accError } = await supabase
      .from('accounts')
      .select('*, boards(id), account_webhooks(id, label, is_active, is_primary)')
      .eq('id', accountId)
      .maybeSingle();

    if (accError || !accData) {
      return null;
    }

    const raw = accData as RawAccount;
    const hooks = raw.account_webhooks || [];
    const primaryHook = hooks.find((h) => h.is_primary);

    // Fetch last published pin timestamp for this account
    const { data: lastPin } = await supabase
      .from('pins')
      .select('posted_at')
      .eq('account_id', accountId)
      .eq('status', 'posted')
      .not('posted_at', 'is', null)
      .order('posted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      ...raw,
      boards_count: raw.boards ? raw.boards.length : 0,
      webhooks_count: hooks.length,
      active_webhooks_count: hooks.filter((h) => h.is_active).length,
      primary_webhook_label: primaryHook ? primaryHook.label : 'None',
      last_published_at: lastPin ? lastPin.posted_at : null,
    };
  } catch (err) {
    console.warn(`Supabase getAccountDetails error for ${accountId}:`, err);
    return mockAccounts.find((a) => a.id === accountId) || null;
  }
}

// 18. Fetch Account Pin Stats (Derived metrics)
// ⚡ Bolt Optimization: Parallelize pins count query and account max_pins_per_day query using Promise.all()
// Impact: Reduces sequential network latency by ~50% (from 2 Sequential DB Roundtrips -> 1 Parallel Batch)
export async function getAccountPinStats(accountId: string): Promise<AccountPinStats> {
  if (!supabase) {
    const accPins = mockPins.filter((p) => p.account_id === accountId);
    const total = accPins.length;
    const pending = accPins.filter((p) => p.status === 'pending').length;
    const posted = accPins.filter((p) => p.status === 'posted').length;
    const failed = accPins.filter((p) => p.status === 'failed').length;

    const acc = mockAccounts.find((a) => a.id === accountId);
    const maxDaily = acc ? acc.max_pins_per_day : 20;

    const todayStr = new Date().toISOString().slice(0, 10);
    const postedToday = accPins.filter(
      (p) => p.status === 'posted' && p.posted_at && p.posted_at.startsWith(todayStr)
    ).length;

    const remainingToday = Math.max(0, maxDaily - postedToday);

    return { total, pending, posted, failed, remainingToday };
  }

  try {
    // ⚡ Execute both queries in parallel to eliminate sequential network waterfall
    const [pinsResult, accResult] = await Promise.all([
      supabase.from('pins').select('status, posted_at').eq('account_id', accountId),
      supabase.from('accounts').select('max_pins_per_day').eq('id', accountId).maybeSingle(),
    ]);

    const pins = pinsResult.data || [];
    const acc = accResult.data;

    const total = pins.length;
    const pending = pins.filter((p) => p.status === 'pending').length;
    const posted = pins.filter((p) => p.status === 'posted').length;
    const failed = pins.filter((p) => p.status === 'failed').length;

    const maxDaily = acc ? acc.max_pins_per_day : 20;
    const todayStr = new Date().toISOString().slice(0, 10);
    const postedToday = pins.filter(
      (p) => p.status === 'posted' && p.posted_at && p.posted_at.startsWith(todayStr)
    ).length;

    const remainingToday = Math.max(0, maxDaily - postedToday);

    return { total, pending, posted, failed, remainingToday };
  } catch (err) {
    console.warn(`Supabase getAccountPinStats error for ${accountId}:`, err);
    return { total: 0, pending: 0, posted: 0, failed: 0, remainingToday: 0 };
  }
}

// 19. Fetch Account Recent Pins
export async function getAccountRecentPins(accountId: string, limit = 10): Promise<Pin[]> {
  if (!supabase) {
    return mockPins.filter((p) => p.account_id === accountId).slice(0, limit);
  }

  try {
    const { data, error } = await supabase
      .from('pins')
      .select('*, accounts(account_name)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return (data as RawPin[]).map((p) => ({
      ...p,
      account_name: p.accounts ? p.accounts.account_name : undefined,
    }));
  } catch (err) {
    console.warn(`Supabase getAccountRecentPins error for ${accountId}:`, err);
    return mockPins.filter((p) => p.account_id === accountId).slice(0, limit);
  }
}

// 20. Fetch Account Recent Logs
export async function getAccountRecentLogs(accountId: string, limit = 10): Promise<Log[]> {
  if (!supabase) {
    return mockLogs.filter((l) => l.account_id === accountId).slice(0, limit);
  }

  try {
    const { data, error } = await supabase
      .from('logs')
      .select('*, accounts(account_name), pins(title), account_webhooks(label)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return (data as RawLog[]).map((l) => ({
      ...l,
      account_name: l.accounts ? l.accounts.account_name : undefined,
      pin_title: l.pins ? l.pins.title : undefined,
      webhook_label: l.account_webhooks ? l.account_webhooks.label : undefined,
    }));
  } catch (err) {
    console.warn(`Supabase getAccountRecentLogs error for ${accountId}:`, err);
    return mockLogs.filter((l) => l.account_id === accountId).slice(0, limit);
  }
}

// 21. Fetch Account Webhook Summary
export async function getAccountWebhookSummary(accountId: string): Promise<AccountWebhookSummary> {
  const webhooks = await getAccountWebhooks(accountId);
  const totalWebhooks = webhooks.length;
  const activeWebhooks = webhooks.filter((w) => w.is_active).length;
  const primaryHook = webhooks.find((w) => w.is_primary);
  const primaryWebhookLabel = primaryHook ? primaryHook.label : 'None';
  const totalRemainingCapacity = webhooks
    .filter((w) => w.is_active)
    .reduce((sum, w) => sum + (w.remaining_capacity || 0), 0);

  return {
    totalWebhooks,
    activeWebhooks,
    primaryWebhookLabel,
    totalRemainingCapacity,
  };
}

// 22. Update Account Scheduling Information
export async function updateAccountScheduling(
  accountId: string,
  data: {
    posting_window_start?: string | null;
    posting_window_end?: string | null;
    timezone?: string;
    pinning_started_at?: string | null;
  }
): Promise<{ data: Partial<Account> | null; error: string | null; success: boolean }> {
  if (!supabase) {
    const acc = mockAccounts.find((a) => a.id === accountId);
    if (acc) {
      if (data.posting_window_start !== undefined) acc.posting_window_start = data.posting_window_start;
      if (data.posting_window_end !== undefined) acc.posting_window_end = data.posting_window_end;
      if (data.timezone !== undefined) acc.timezone = data.timezone;
      if (data.pinning_started_at !== undefined) acc.pinning_started_at = data.pinning_started_at;
    }
    return { data: acc || data, error: null, success: true };
  }

  try {
    const { data: updated, error } = await supabase
      .from('accounts')
      .update({
        ...(data.posting_window_start !== undefined && { posting_window_start: data.posting_window_start }),
        ...(data.posting_window_end !== undefined && { posting_window_end: data.posting_window_end }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
        ...(data.pinning_started_at !== undefined && { pinning_started_at: data.pinning_started_at }),
      })
      .eq('id', accountId)
      .select('*')
      .single();

    if (error) return { data: null, error: error.message, success: false };
    return { data: updated as Account, error: null, success: true };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to update account scheduling', success: false };
  }
}

