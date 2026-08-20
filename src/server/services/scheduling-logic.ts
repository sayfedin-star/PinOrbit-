/**
 * Pure Scheduling Logic & Calculations.
 *
 * Zero external side-effects; 100% deterministic and unit-testable.
 */

export const DEFAULT_RETENTION_POSTED_DAYS = 30;
export const MIN_RETENTION_POSTED_DAYS = 1;
export const MAX_RETENTION_POSTED_DAYS = 365;

export const DEFAULT_PROCESSING_TIMEOUT_MINUTES = 45;
export const MIN_PROCESSING_TIMEOUT_MINUTES = 5;
export const MAX_PROCESSING_TIMEOUT_MINUTES = 240;

export interface ScheduleConfig {
  interval_minutes?: number | null;
  window_start?: string | null;
  window_end?: string | null;
  active_days?: string[] | string | null;
  timezone?: string | null;
  cron_expression?: string | null;
}

export interface WindowCheckResult {
  allowed: boolean;
  reason?: 'day_off' | 'window_closed';
}

/**
 * 1. Portable Cron Expression Builder
 * Generates deterministic crontab format: minute hour day-of-month month day-of-week
 * - Minutes: divisor intervals use `* / N` (e.g. `* / 20`), non-divisors use explicit comma lists (e.g. `0,25,50`)
 * - Hours: explicit comma-separated list of window hours (handles overnight windows e.g. 22 to 06)
 * - Days: explicit 0-6 comma list based on active_days (0=Sun .. 6=Sat) or * if all 7 days
 */
export function buildPortableCron(s?: ScheduleConfig | null): string {
  const interval = Math.max(1, s?.interval_minutes || 36);
  const startH = parseInt(String(s?.window_start || '09:00').slice(0, 2), 10) || 0;
  const endH = parseInt(String(s?.window_end || '21:00').slice(0, 2), 10) || 0;

  // 1. Build window hours list (explicit comma list, NO / in hours)
  const windowHours: number[] = [];
  if (startH <= endH) {
    for (let h = startH; h <= endH; h++) windowHours.push(h);
  } else {
    for (let h = startH; h <= 23; h++) windowHours.push(h);
    for (let h = 0; h <= endH; h++) windowHours.push(h);
  }
  if (windowHours.length === 0) windowHours.push(startH);

  let minuteField = '0';
  let hourField = '';

  if (interval < 60) {
    if (60 % interval === 0) {
      minuteField = `*/${interval}`;
    } else {
      const mins: number[] = [];
      for (let m = 0; m < 60; m += interval) mins.push(m);
      minuteField = mins.join(',');
    }
    hourField = windowHours.join(',');
  } else {
    minuteField = '0';
    const stepHours = Math.max(1, Math.round(interval / 60));
    const selectedHours: number[] = [];
    for (let i = 0; i < windowHours.length; i += stepHours) {
      selectedHours.push(windowHours[i]);
    }
    hourField = selectedHours.join(',');
  }

  // 2. Active days (0=Sun .. 6=Sat)
  const dayMap: Record<string, number> = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tuesday: 2,
    wed: 3, wednesday: 3,
    thu: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };

  let activeDaysArr: string[] = [];
  if (Array.isArray(s?.active_days)) {
    activeDaysArr = s.active_days;
  } else if (typeof s?.active_days === 'string') {
    activeDaysArr = s.active_days.replace(/[{}"']/g, '').split(',').map((x) => x.trim()).filter(Boolean);
  }

  let dayField = '*';
  if (activeDaysArr.length > 0 && activeDaysArr.length < 7) {
    const dayNums = Array.from(
      new Set(
        activeDaysArr
          .map((d) => dayMap[d.toLowerCase()])
          .filter((n) => n !== undefined)
      )
    ).sort((a, b) => a - b);
    if (dayNums.length > 0 && dayNums.length < 7) {
      dayField = dayNums.join(',');
    }
  }

  return `${minuteField} ${hourField} * * ${dayField}`;
}

/**
 * 2. Timezone-Aware Schedule Window and Active-Day Check
 * Validates whether dispatch is permitted at the specified point in time (`now`).
 * - Skips check if schedule has an explicit custom `cron_expression`.
 * - Validates weekday in schedule's timezone against `active_days`.
 * - Validates local HH:MM against `[window_start, window_end]`, including overnight windows (e.g. 22:00 -> 06:00).
 */
export function checkScheduleWindow(
  schedule: ScheduleConfig,
  now: Date = new Date()
): WindowCheckResult {
  // Explicit cron expression skips window and active day server-side checks
  if (schedule.cron_expression && String(schedule.cron_expression).trim().length > 0) {
    return { allowed: true };
  }

  const tz = schedule.timezone || 'UTC';
  let day = '';
  let hm = '';

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);

    day = parts.find((p) => p.type === 'weekday')?.value || '';
    let hour = parts.find((p) => p.type === 'hour')?.value || '00';
    if (hour === '24') hour = '00';
    const minute = parts.find((p) => p.type === 'minute')?.value || '00';
    hm = `${hour}:${minute}`;
  } catch (tzError) {
    console.warn('[SchedulingLogic] Invalid timezone, falling back to UTC:', tzError);
    const utcParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);

    day = utcParts.find((p) => p.type === 'weekday')?.value || '';
    let utcHour = utcParts.find((p) => p.type === 'hour')?.value || '00';
    if (utcHour === '24') utcHour = '00';
    const utcMinute = utcParts.find((p) => p.type === 'minute')?.value || '00';
    hm = `${utcHour}:${utcMinute}`;
  }

  let activeDaysArr: string[] = [];
  if (Array.isArray(schedule.active_days)) {
    activeDaysArr = schedule.active_days;
  } else if (typeof schedule.active_days === 'string') {
    activeDaysArr = schedule.active_days.replace(/[{}"']/g, '').split(',').map((x) => x.trim()).filter(Boolean);
  }

  const normalizedDay = day.toLowerCase().slice(0, 3);
  const normalizedActiveDays = activeDaysArr.map((d) => String(d).toLowerCase().slice(0, 3));

  if (normalizedDay && normalizedActiveDays.length > 0 && !normalizedActiveDays.includes(normalizedDay)) {
    return { allowed: false, reason: 'day_off' };
  }

  const w0 = String(schedule.window_start || '09:00').slice(0, 5);
  const w1 = String(schedule.window_end || '21:00').slice(0, 5);

  if (hm) {
    const isClosed = w0 <= w1 ? (hm < w0 || hm > w1) : (hm < w0 && hm > w1);
    if (isClosed) {
      return { allowed: false, reason: 'window_closed' };
    }
  }

  return { allowed: true };
}

/**
 * 3. FastCron Token Resolution Hierarchy (Pure Candidate Filter)
 * Evaluates candidate tokens in priority order:
 * 1. Schedule embedded token (b64 decrypted / custom string)
 * 2. Schedule fastcron_token_id row value
 * 3. Workspace default token row value
 * 4. Environment default (FASTCRON_API_TOKEN)
 *
 * Valid token criteria: non-empty string with length >= 16.
 */
export function evaluateTokenCandidates(candidates: Array<string | null | undefined>): string | null {
  for (const tok of candidates) {
    if (tok && typeof tok === 'string' && tok.trim().length >= 16) {
      return tok.trim();
    }
  }
  return null;
}

/**
 * 4. Deterministic Idempotency Key Builders
 */
export function buildPinPostIdempotencyKey(pinId: string, attempts: number | string = 0): string {
  return `pin.post:${pinId}:${attempts}`;
}

export function buildBoardCreateIdempotencyKey(accountId: string, boardName: string): string {
  return `create:${accountId}:${String(boardName).toLowerCase()}`;
}

export function buildBoardListIdempotencyKey(accountId: string, boardId: string): string {
  return `list:${accountId}:${boardId}`;
}

/**
 * 5. Retention & Timeout Clamps
 */
export function clampRetentionPostedDays(rawDays?: any): number {
  if (rawDays === undefined || rawDays === null || rawDays === '') {
    return DEFAULT_RETENTION_POSTED_DAYS;
  }
  const num = Number(rawDays);
  if (isNaN(num)) {
    return DEFAULT_RETENTION_POSTED_DAYS;
  }
  return Math.max(MIN_RETENTION_POSTED_DAYS, Math.min(MAX_RETENTION_POSTED_DAYS, Math.round(num)));
}

export function clampProcessingTimeoutMinutes(rawMinutes?: any): number {
  if (rawMinutes === undefined || rawMinutes === null || rawMinutes === '') {
    return DEFAULT_PROCESSING_TIMEOUT_MINUTES;
  }
  const num = Number(rawMinutes);
  if (isNaN(num)) {
    return DEFAULT_PROCESSING_TIMEOUT_MINUTES;
  }
  return Math.max(MIN_PROCESSING_TIMEOUT_MINUTES, Math.min(MAX_PROCESSING_TIMEOUT_MINUTES, Math.round(num)));
}
