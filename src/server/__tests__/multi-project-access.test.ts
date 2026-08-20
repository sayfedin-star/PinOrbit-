import { describe, it, expect, vi, beforeEach } from 'vitest';
import { competitorsService } from '../services/competitors-service';
import { analyticsService } from '../services/analytics-service';
import { queueService } from '../services/queue-service';
import { competitorsDb } from '../db/competitors';
import { analyticsDb } from '../db/analytics';

describe('Phase 3 — Server-Only Multi-Project Access & Authorization Guards', () => {
  const validWsId = '11111111-1111-4111-8111-111111111111';
  const validUserId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('competitorsService.getCompetitors rejects unauthorized user with error', async () => {
    const mockSchedulingClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Membership not found' },
              }),
            }),
          }),
        }),
      }),
    } as any;

    await expect(
      competitorsService.getCompetitors(mockSchedulingClient, validUserId, validWsId)
    ).rejects.toThrow('Forbidden: Access Denied.');
  });

  it('competitorsService.getCompetitors passes workspaceId to competitorsDb when authorized', async () => {
    const mockSchedulingClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { workspace_id: validWsId, user_id: validUserId, role: 'member' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as any;

    const listCompetitorsSpy = vi.spyOn(competitorsDb, 'listCompetitors').mockResolvedValue({
      competitors: [
        {
          id: 'c-1',
          workspace_id: validWsId,
          username: 'competitor_test',
          full_name: 'Test Competitor',
          niche: 'recipes',
          profile_reach: 1000,
          profile_views: 500,
          follower_count: 200,
          pin_count: 50,
          avatar_url: null,
          website_url: null,
          domain_verified: false,
          notes: null,
          tags: [],
          account_type: 'competitor',
          last_checked_at: null,
          last_pin_at: null,
          created_at: new Date().toISOString(),
        },
      ],
      count: 1,
    });

    const result = await competitorsService.getCompetitors(
      mockSchedulingClient,
      validUserId,
      validWsId
    );

    expect(listCompetitorsSpy).toHaveBeenCalledWith(validWsId, undefined);
    expect(result.competitors.length).toBe(1);
    expect(result.competitors[0].workspace_id).toBe(validWsId);
  });

  it('analyticsService.getImportHistory rejects unauthorized workspace access', async () => {
    const mockSchedulingClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Row not found' },
              }),
            }),
          }),
        }),
      }),
    } as any;

    await expect(
      analyticsService.getImportHistory(mockSchedulingClient, validUserId, validWsId)
    ).rejects.toThrow('Forbidden: Access Denied.');
  });

  it('analyticsService.getImportHistory passes workspaceId when membership is validated', async () => {
    const mockSchedulingClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { workspace_id: validWsId, user_id: validUserId, role: 'owner' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as any;

    const listImportsSpy = vi.spyOn(analyticsDb, 'listIngestionRuns').mockResolvedValue([
      {
        id: 'run-1',
        workspace_id: validWsId,
        connection_id: 'acc-1',
        channel: 'account_analytics',
        job_type: 'daily_sync',
        status: 'completed',
        rows_processed: 100,
        started_at: new Date().toISOString(),
      },
    ]);

    const result = await analyticsService.getImportHistory(
      mockSchedulingClient,
      validUserId,
      validWsId,
      'acc-1'
    );

    expect(listImportsSpy).toHaveBeenCalledWith(validWsId, 'acc-1');
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('run-1');
  });

  it('queueService enforces Project 1 authorization before modifying pin status', async () => {
    const mockSchedulingClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Forbidden' },
              }),
            }),
          }),
        }),
      }),
    } as any;

    await expect(
      queueService.cancelPin(mockSchedulingClient, validUserId, validWsId, 'pin-999')
    ).rejects.toThrow('Forbidden: Access Denied.');
  });
});
