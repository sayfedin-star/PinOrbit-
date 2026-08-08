import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST as ingestHandler } from '../../pages/api/internal/pinterest/ingest';
import { pinnerAnalyticsService } from '../services/pinner-analytics-service';

vi.mock('../services/pinner-etl', () => ({
  pinnerETL: {
    processIngestionPayload: vi.fn().mockResolvedValue({
      success: true,
      persisted: true,
      dailyRowsIngested: 7,
      topPinsIngested: 50,
      workspaceRollupsUpdated: 7,
    }),
  },
}));

vi.mock('../db/clients', () => ({
  getServerEnv: vi.fn().mockReturnValue({
    INGEST_SECRET_KEY: 'correct_secret_key_123',
  }),
  dbClients: {
    getConfig: vi.fn().mockReturnValue({
      INGEST_SECRET_KEY: 'correct_secret_key_123',
    }),
    getSchedulingAdmin: vi.fn(),
    getAnalytics: vi.fn(),
  },
}));

describe('Pinner Analytics API & Ingest Endpoint Security Suite', () => {
  it('rejects POST /api/internal/pinterest/ingest with 401 when x-ingest-secret is missing or invalid', async () => {
    const req = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: {
        'x-ingest-secret': 'wrong_secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspace_id: '00000000-0000-0000-0000-000000000001',
        connection_id: 'a1b2c3d4-e5f6-7890-1234-56789abcdef0',
      }),
    });

    const response = await ingestHandler({ request: req, locals: {} } as any);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('x-ingest-secret');
  });

  it('accepts POST /api/internal/pinterest/ingest with valid secret and processes payload', async () => {
    const req = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: {
        'x-ingest-secret': 'correct_secret_key_123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        workspace_id: '00000000-0000-0000-0000-000000000001',
        connection_id: 'a1b2c3d4-e5f6-7890-1234-56789abcdef0',
        account_analytics: {},
        top_pins_analytics: {},
      }),
    });

    const response = await ingestHandler({ request: req, locals: {} } as any);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.persisted).toBe(true);
  });

  it('generates 90-day backfill chunks with 7-day windows', async () => {
    const mockScheduling = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'm1', workspace_id: 'ws-1', user_id: 'u-1', role: 'owner' },
          error: null,
        }),
      })),
    };

    const chunks = await pinnerAnalyticsService.generateHistoricalBackfillChunks(
      mockScheduling as any,
      'u-1',
      'ws-1',
      'conn-1',
      90
    );

    expect(chunks.length).toBeGreaterThanOrEqual(12);
    expect(chunks[0].chunkIndex).toBe(1);
    expect(chunks[0].startDate).toBeDefined();
    expect(chunks[0].endDate).toBeDefined();
  });
});
