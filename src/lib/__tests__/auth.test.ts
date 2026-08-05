import { describe, it, expect } from 'vitest';
import { requireAuth } from '../auth';

describe('requireAuth test suite', () => {
  it('returns true when in non-window / server environment', async () => {
    const res = await requireAuth('/login');
    expect(res).toBe(true);
  });
});
