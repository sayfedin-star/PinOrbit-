import { createClient } from '@supabase/supabase-js';
import type { Account, Board, Pin, Log, DashboardKPIs } from './types';

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
  },
  {
    id: 'acc-2',
    account_name: 'DessertLovers_Global',
    webhook_url: 'https://hook.make.com/def456dessert2',
    max_pins_per_day: 15,
    is_active: true,
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    boards_count: 2,
  },
  {
    id: 'acc-3',
    account_name: 'KetoRecipes_Hub',
    webhook_url: 'https://hook.make.com/ghi789keto3',
    max_pins_per_day: 25,
    is_active: false,
    created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
    boards_count: 4,
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
    status: 'success',
    message: 'Sent to Make successfully',
    webhook_used: 'https://hook.make.com/abc123healthy1',
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    account_name: 'HealthyBites_US',
    pin_title: '30-Minute Creamy Garlic Chicken',
  },
  {
    id: 'log-2',
    pin_id: 'pin-4',
    account_id: 'acc-3',
    status: 'error',
    message: 'Board not found for this account',
    webhook_used: null,
    created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    account_name: 'KetoRecipes_Hub',
    pin_title: 'Avocado Keto Salad',
  },
];

interface RawAccount extends Account {
  boards?: { id: string }[];
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
}

// 1. Fetch Accounts
export async function getAccounts(): Promise<Account[]> {
  if (!supabase) return mockAccounts;
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('*, boards(id)')
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
      }));
    }

    if (!data) return [];
    return (data as RawAccount[]).map((acc) => ({
      ...acc,
      boards_count: acc.boards ? acc.boards.length : 0,
    }));
  } catch (err) {
    console.warn('Supabase fetch accounts error, using fallback:', err);
    return mockAccounts;
  }
}

// 2. Fetch Boards
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

// 3. Fetch Pins
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

// 4. Fetch Logs
export async function getLogs(limit = 50): Promise<Log[]> {
  if (!supabase) return mockLogs.slice(0, limit);
  try {
    const { data, error } = await supabase
      .from('logs')
      .select('*, accounts(account_name), pins(title)')
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
    }));
  } catch (err) {
    console.warn('Supabase fetch logs error, using fallback:', err);
    return mockLogs.slice(0, limit);
  }
}

// 5. Fetch Dashboard KPIs
export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  const [accounts, pins, logs] = await Promise.all([
    getAccounts(),
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
  };
}

// 6. Admin Mutations

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
