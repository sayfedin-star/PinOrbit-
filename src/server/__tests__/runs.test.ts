import { describe, it, expect } from 'vitest';
import { calculateConnectionHealth } from '../../lib/ui-helpers';

describe('Analytics Runs & Connection Health Strip Suite (V23.1)', () => {
  it('calculates consecutive failures starting from newest run until first success', () => {
    const runs = [
      { status: 'failed', started_at: '2026-08-09T20:00:00Z' },
      { status: 'failed', started_at: '2026-08-09T19:00:00Z' },
      { status: 'completed', started_at: '2026-08-09T18:00:00Z' },
      { status: 'failed', started_at: '2026-08-09T17:00:00Z' },
    ];

    const health = calculateConnectionHealth(runs);
    expect(health.consecutive_failures).toBe(2);
    expect(health.last_success_at).toBe('2026-08-09T18:00:00Z');
    expect(health.total_runs).toBe(4);
    expect(health.health_status).toBe('warning');
  });

  it('reports healthy when the most recent run was successful', () => {
    const runs = [
      { status: 'completed', started_at: '2026-08-09T20:00:00Z' },
      { status: 'failed', started_at: '2026-08-09T19:00:00Z' },
      { status: 'failed', started_at: '2026-08-09T18:00:00Z' },
    ];

    const health = calculateConnectionHealth(runs);
    expect(health.consecutive_failures).toBe(0);
    expect(health.last_success_at).toBe('2026-08-09T20:00:00Z');
    expect(health.total_runs).toBe(3);
    expect(health.health_status).toBe('healthy');
  });

  it('reports critical when consecutive failures reach 3 or more', () => {
    const runs = [
      { status: 'failed', started_at: '2026-08-09T21:00:00Z' },
      { status: 'failed', started_at: '2026-08-09T20:00:00Z' },
      { status: 'failed', started_at: '2026-08-09T19:00:00Z' },
      { status: 'completed', started_at: '2026-08-09T18:00:00Z' },
    ];

    const health = calculateConnectionHealth(runs);
    expect(health.consecutive_failures).toBe(3);
    expect(health.health_status).toBe('critical');
  });

  it('handles empty runs array gracefully', () => {
    const health = calculateConnectionHealth([]);
    expect(health.consecutive_failures).toBe(0);
    expect(health.last_success_at).toBeNull();
    expect(health.total_runs).toBe(0);
    expect(health.health_status).toBe('healthy');
  });

  it('flags revoked status when isRevoked is true', () => {
    const runs = [{ status: 'completed', started_at: '2026-08-09T20:00:00Z' }];
    const health = calculateConnectionHealth(runs, true);
    expect(health.health_status).toBe('revoked');
  });
});
