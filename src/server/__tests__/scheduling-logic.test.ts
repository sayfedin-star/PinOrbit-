import { describe, it, expect } from 'vitest';
import {
  buildPortableCron,
  checkScheduleWindow,
  evaluateTokenCandidates,
  buildPinPostIdempotencyKey,
  buildBoardCreateIdempotencyKey,
  buildBoardListIdempotencyKey,
  clampRetentionPostedDays,
  clampProcessingTimeoutMinutes,
  DEFAULT_RETENTION_POSTED_DAYS,
  DEFAULT_PROCESSING_TIMEOUT_MINUTES,
} from '../services/scheduling-logic';

describe('Pure Scheduling Logic Suite (scheduling-logic.ts)', () => {
  describe('1. buildPortableCron', () => {
    it('generates divisor minute intervals using */N syntax (interval = 20)', () => {
      const cron = buildPortableCron({
        interval_minutes: 20,
        window_start: '09:00',
        window_end: '17:00',
        active_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      });
      expect(cron).toBe('*/20 9,10,11,12,13,14,15,16,17 * * 1,2,3,4,5');
    });

    it('generates non-divisor minute intervals using explicit comma list (interval = 25)', () => {
      const cron = buildPortableCron({
        interval_minutes: 25,
        window_start: '09:00',
        window_end: '12:00',
        active_days: ['Mon', 'Wed', 'Fri'],
      });
      // 0, 25, 50
      expect(cron).toBe('0,25,50 9,10,11,12 * * 1,3,5');
    });

    it('handles overnight window (22:00 -> 06:00) with explicit comma-separated hours', () => {
      const cron = buildPortableCron({
        interval_minutes: 30,
        window_start: '22:00',
        window_end: '06:00',
        active_days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      });
      // All 7 days -> *
      // Hours from 22..23, 0..6: 22,23,0,1,2,3,4,5,6
      expect(cron).toBe('*/30 22,23,0,1,2,3,4,5,6 * * *');
    });

    it('handles hourly and multi-hour intervals (interval >= 60)', () => {
      const cron = buildPortableCron({
        interval_minutes: 120, // stepHours = 2
        window_start: '08:00',
        window_end: '16:00',
        active_days: ['Mon', 'Tue'],
      });
      // window: 8,9,10,11,12,13,14,15,16. Step 2: 8, 10, 12, 14, 16
      expect(cron).toBe('0 8,10,12,14,16 * * 1,2');
    });

    it('handles string active_days and single-day schedules', () => {
      const cron = buildPortableCron({
        interval_minutes: 15,
        window_start: '10:00',
        window_end: '11:00',
        active_days: 'Saturday, Sunday',
      });
      // 0=Sun, 6=Sat -> 0,6
      expect(cron).toBe('*/15 10,11 * * 0,6');
    });

    it('falls back to defaults when input is empty or partial', () => {
      const cron = buildPortableCron({});
      expect(cron).toBe('0,36 9,10,11,12,13,14,15,16,17,18,19,20,21 * * *');
    });
  });

  describe('2. checkScheduleWindow', () => {
    it('bypasses checks entirely when explicit cron_expression is configured', () => {
      const schedule = {
        timezone: 'America/New_York',
        active_days: ['Mon'],
        window_start: '09:00',
        window_end: '10:00',
        cron_expression: '0 12 * * *',
      };
      // Test at a time outside window on a non-active day (e.g. Sunday midnight)
      const sundayNight = new Date('2026-08-16T04:00:00Z');
      const res = checkScheduleWindow(schedule, sundayNight);
      expect(res).toEqual({ allowed: true });
    });

    it('blocks dispatch with reason "day_off" on inactive days', () => {
      const schedule = {
        timezone: 'UTC',
        active_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        window_start: '09:00',
        window_end: '21:00',
      };
      // 2026-08-16 is Sunday
      const sundayNoon = new Date('2026-08-16T12:00:00Z');
      const res = checkScheduleWindow(schedule, sundayNoon);
      expect(res).toEqual({ allowed: false, reason: 'day_off' });
    });

    it('blocks dispatch with reason "window_closed" outside standard window hours', () => {
      const schedule = {
        timezone: 'UTC',
        active_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        window_start: '09:00',
        window_end: '17:00',
      };
      // 2026-08-17 is Monday
      const mondayEarly = new Date('2026-08-17T08:30:00Z');
      const resEarly = checkScheduleWindow(schedule, mondayEarly);
      expect(resEarly).toEqual({ allowed: false, reason: 'window_closed' });

      const mondayLate = new Date('2026-08-17T17:30:00Z');
      const resLate = checkScheduleWindow(schedule, mondayLate);
      expect(resLate).toEqual({ allowed: false, reason: 'window_closed' });
    });

    it('allows dispatch inside standard window hours on active days', () => {
      const schedule = {
        timezone: 'UTC',
        active_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        window_start: '09:00',
        window_end: '17:00',
      };
      // 2026-08-17 is Monday at 14:30
      const mondayActive = new Date('2026-08-17T14:30:00Z');
      const res = checkScheduleWindow(schedule, mondayActive);
      expect(res).toEqual({ allowed: true });
    });

    it('correctly validates overnight windows (22:00 -> 06:00)', () => {
      const schedule = {
        timezone: 'UTC',
        active_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        window_start: '22:00',
        window_end: '06:00',
      };

      // Allowed inside evening part (23:15)
      const lateEvening = new Date('2026-08-17T23:15:00Z');
      expect(checkScheduleWindow(schedule, lateEvening)).toEqual({ allowed: true });

      // Allowed inside early morning part (04:30)
      const earlyMorning = new Date('2026-08-18T04:30:00Z');
      expect(checkScheduleWindow(schedule, earlyMorning)).toEqual({ allowed: true });

      // Blocked in daytime (12:00)
      const noon = new Date('2026-08-17T12:00:00Z');
      expect(checkScheduleWindow(schedule, noon)).toEqual({ allowed: false, reason: 'window_closed' });
    });
  });

  describe('3. evaluateTokenCandidates', () => {
    const validEmbedded = 'embedded_token_12345678';
    const validTokenId = 'token_id_val_123456789';
    const validWorkspaceDefault = 'workspace_default_token_123';
    const validEnvToken = 'env_fastcron_token_123456';

    it('resolves in priority: Embedded -> Token ID -> Workspace Default -> Env', () => {
      // 1. Embedded wins if present
      expect(
        evaluateTokenCandidates([validEmbedded, validTokenId, validWorkspaceDefault, validEnvToken])
      ).toBe(validEmbedded);

      // 2. Token ID wins if embedded is null/short
      expect(
        evaluateTokenCandidates([null, validTokenId, validWorkspaceDefault, validEnvToken])
      ).toBe(validTokenId);

      expect(
        evaluateTokenCandidates(['too_short', validTokenId, validWorkspaceDefault, validEnvToken])
      ).toBe(validTokenId);

      // 3. Workspace Default wins if previous are absent
      expect(
        evaluateTokenCandidates([undefined, null, validWorkspaceDefault, validEnvToken])
      ).toBe(validWorkspaceDefault);

      // 4. Env wins if only it is available
      expect(
        evaluateTokenCandidates(['', null, undefined, validEnvToken])
      ).toBe(validEnvToken);

      // 5. Returns null if all candidates missing or invalid (< 16 chars)
      expect(
        evaluateTokenCandidates([null, 'short', undefined, ''])
      ).toBeNull();
    });
  });

  describe('4. Deterministic Idempotency Key Builders', () => {
    it('builds pin post idempotency key with attempt count', () => {
      expect(buildPinPostIdempotencyKey('pin-1234', 0)).toBe('pin.post:pin-1234:0');
      expect(buildPinPostIdempotencyKey('pin-5678', 2)).toBe('pin.post:pin-5678:2');
    });

    it('builds board create idempotency key with lowercased board name', () => {
      expect(buildBoardCreateIdempotencyKey('acc-1', 'Summer Recipes')).toBe('create:acc-1:summer recipes');
      expect(buildBoardCreateIdempotencyKey('acc-2', 'DIy CRAFTS')).toBe('create:acc-2:diy crafts');
    });

    it('builds board list idempotency key', () => {
      expect(buildBoardListIdempotencyKey('acc-1', 'board-99')).toBe('list:acc-1:board-99');
    });
  });

  describe('5. Retention and Timeout Clamps', () => {
    it('clamps retention_posted_days to [1, 365] with default 30', () => {
      // Edge below min
      expect(clampRetentionPostedDays(0)).toBe(1);
      expect(clampRetentionPostedDays(-10)).toBe(1);

      // Exact boundaries
      expect(clampRetentionPostedDays(1)).toBe(1);
      expect(clampRetentionPostedDays(30)).toBe(30);
      expect(clampRetentionPostedDays(365)).toBe(365);

      // Edge above max
      expect(clampRetentionPostedDays(366)).toBe(365);
      expect(clampRetentionPostedDays(1000)).toBe(365);

      // Non-numeric / missing fallbacks
      expect(clampRetentionPostedDays(null)).toBe(DEFAULT_RETENTION_POSTED_DAYS);
      expect(clampRetentionPostedDays(undefined)).toBe(DEFAULT_RETENTION_POSTED_DAYS);
      expect(clampRetentionPostedDays('')).toBe(DEFAULT_RETENTION_POSTED_DAYS);
      expect(clampRetentionPostedDays('invalid')).toBe(DEFAULT_RETENTION_POSTED_DAYS);

      // Rounding
      expect(clampRetentionPostedDays(14.6)).toBe(15);
    });

    it('clamps processing_timeout_minutes to [5, 240] with default 45', () => {
      // Edge below min
      expect(clampProcessingTimeoutMinutes(0)).toBe(5);
      expect(clampProcessingTimeoutMinutes(4)).toBe(5);

      // Exact boundaries
      expect(clampProcessingTimeoutMinutes(5)).toBe(5);
      expect(clampProcessingTimeoutMinutes(45)).toBe(45);
      expect(clampProcessingTimeoutMinutes(240)).toBe(240);

      // Edge above max
      expect(clampProcessingTimeoutMinutes(241)).toBe(240);
      expect(clampProcessingTimeoutMinutes(500)).toBe(240);

      // Non-numeric / missing fallbacks
      expect(clampProcessingTimeoutMinutes(null)).toBe(DEFAULT_PROCESSING_TIMEOUT_MINUTES);
      expect(clampProcessingTimeoutMinutes(undefined)).toBe(DEFAULT_PROCESSING_TIMEOUT_MINUTES);
      expect(clampProcessingTimeoutMinutes('')).toBe(DEFAULT_PROCESSING_TIMEOUT_MINUTES);
      expect(clampProcessingTimeoutMinutes('invalid')).toBe(DEFAULT_PROCESSING_TIMEOUT_MINUTES);

      // Rounding
      expect(clampProcessingTimeoutMinutes(59.8)).toBe(60);
    });
  });
});
