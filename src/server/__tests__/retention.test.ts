import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET as getRetentionHandler, PATCH as patchRetentionHandler } from '../../pages/api/settings/retention';
import { POST as postCleanupRetentionHandler } from '../../pages/api/internal/pinterest/cleanup-retention';
import { dbClients } from '../db/clients';
import { assertWorkspaceAccess } from '../auth/workspace-guard';
import { getEffectiveSecret } from '../services/webhook-secrets';

vi.mock('../auth/workspace-guard', () => ({
  assertWorkspaceAccess: vi.fn().mockResolvedValue({ id: 'mem-1', role: 'admin', isAdmin: true, isOwner: true }),
}));

vi.mock('../services/webhook-secrets', () => ({
  getEffectiveSecret: vi.fn().mockResolvedValue({ value: 'valid_ingest_secret_123', source: 'global' }),
}));

describe('Full Per-Workspace Data-Lifecycle Control Suite (P1/P2/P3)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. GET /api/settings/retention', () => {
    it('returns full default disabled schema when no row exists in DB', async () => {
      const mockAdminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      };
      vi.spyOn(dbClients, 'getSchedulingAdmin').mockReturnValue(mockAdminClient as any);

      const locals = {
        user: { id: 'u1' },
        supabase: {},
        activeWorkspaceId: workspaceId,
      };

      const res = await getRetentionHandler({
        request: new Request(`http://localhost/api/settings/retention?workspace_id=${workspaceId}`),
        locals,
      } as any);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        workspace_id: workspaceId,
        auto_prune_enabled: false,
        retention_posted_days: 30,
        retention_terminal_days: 90,
        retention_logs_days: 14,
        import_sessions_days: 30,
        processing_timeout_minutes: 45,
        p2_prune_enabled: false,
        competitor_snapshots_days: 90,
        competitor_jobs_days: 30,
        p3_prune_enabled: false,
        ingestion_runs_days: 30,
        top_pins_raw_days: 180,
        top_pins_downsample_enabled: false,
        analytics_daily_keep_days: null,
        is_default: true,
      });
    });

    it('returns saved row fields with is_default: false when row exists', async () => {
      const mockAdminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  workspace_id: workspaceId,
                  auto_prune_enabled: true,
                  retention_posted_days: 60,
                  retention_terminal_days: 120,
                  retention_logs_days: 30,
                  import_sessions_days: 45,
                  processing_timeout_minutes: 60,
                  p2_prune_enabled: true,
                  competitor_snapshots_days: 180,
                  competitor_jobs_days: 60,
                  p3_prune_enabled: true,
                  ingestion_runs_days: 60,
                  top_pins_raw_days: 365,
                  top_pins_downsample_enabled: true,
                  analytics_daily_keep_days: 365,
                  updated_at: '2026-08-21T00:00:00.000Z',
                },
                error: null,
              }),
            }),
          }),
        }),
      };
      vi.spyOn(dbClients, 'getSchedulingAdmin').mockReturnValue(mockAdminClient as any);

      const locals = {
        user: { id: 'u1' },
        supabase: {},
        activeWorkspaceId: workspaceId,
      };

      const res = await getRetentionHandler({
        request: new Request(`http://localhost/api/settings/retention?workspace_id=${workspaceId}`),
        locals,
      } as any);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.is_default).toBe(false);
      expect(json.auto_prune_enabled).toBe(true);
      expect(json.retention_posted_days).toBe(60);
      expect(json.p2_prune_enabled).toBe(true);
      expect(json.p3_prune_enabled).toBe(true);
      expect(json.analytics_daily_keep_days).toBe(365);
    });
  });

  describe('2. PATCH /api/settings/retention', () => {
    it('clamps values and saves successfully with admin access check', async () => {
      let savedPayload: any = null;
      const mockAdminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
          upsert: vi.fn().mockImplementation((payload) => {
            savedPayload = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { ...payload, updated_at: '2026-08-21T01:00:00.000Z' },
                  error: null,
                }),
              }),
            };
          }),
        }),
      };
      vi.spyOn(dbClients, 'getSchedulingAdmin').mockReturnValue(mockAdminClient as any);

      const locals = {
        user: { id: 'u1' },
        supabase: {},
        activeWorkspaceId: workspaceId,
      };

      const res = await patchRetentionHandler({
        request: new Request('http://localhost/api/settings/retention', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            auto_prune_enabled: true,
            retention_posted_days: 999, // Should clamp to 365
            retention_terminal_days: 0, // Should clamp to 1
            retention_logs_days: 200, // Should clamp to 180
            import_sessions_days: -5, // Should clamp to 1
            processing_timeout_minutes: 500, // Should clamp to 240
            p2_prune_enabled: true,
            competitor_snapshots_days: 500, // Clamps to 365
            competitor_jobs_days: 300, // Clamps to 180
            p3_prune_enabled: true,
            ingestion_runs_days: 400, // Clamps to 365
            top_pins_raw_days: 1000, // Clamps to 730
            top_pins_downsample_enabled: true,
            analytics_daily_keep_days: '90', // Parses to 90
          }),
        }),
        locals,
      } as any);

      expect(res.status).toBe(200);
      expect(assertWorkspaceAccess).toHaveBeenCalledWith(expect.anything(), workspaceId, 'u1', 'admin');
      expect(savedPayload.retention_posted_days).toBe(365);
      expect(savedPayload.retention_terminal_days).toBe(1);
      expect(savedPayload.retention_logs_days).toBe(180);
      expect(savedPayload.import_sessions_days).toBe(1);
      expect(savedPayload.processing_timeout_minutes).toBe(240);
      expect(savedPayload.competitor_snapshots_days).toBe(365);
      expect(savedPayload.competitor_jobs_days).toBe(180);
      expect(savedPayload.ingestion_runs_days).toBe(365);
      expect(savedPayload.top_pins_raw_days).toBe(730);
      expect(savedPayload.analytics_daily_keep_days).toBe(90);
    });
  });

  describe('3. POST /api/internal/pinterest/cleanup-retention', () => {
    it('executes only recovery sweep when all pruning toggles are disabled', async () => {
      const mockSchedulingAdmin = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'workspace_retention_settings') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      workspace_id: workspaceId,
                      auto_prune_enabled: false,
                      p2_prune_enabled: false,
                      p3_prune_enabled: false,
                      processing_timeout_minutes: 45,
                      retention_posted_days: 30,
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'pins') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    lt: vi.fn().mockReturnValue({
                      lt: vi.fn().mockResolvedValue({ count: 2, error: null }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(dbClients, 'getSchedulingAdmin').mockReturnValue(mockSchedulingAdmin as any);

      const res = await postCleanupRetentionHandler({
        request: new Request('http://localhost/api/internal/pinterest/cleanup-retention', {
          method: 'POST',
          headers: {
            'x-workspace-id': workspaceId,
            'x-ingest-secret': 'valid_ingest_secret_123',
          },
        }),
        locals: {},
      } as any);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.auto_prune_enabled).toBe(false);
      expect(json.p2_prune_enabled).toBe(false);
      expect(json.p3_prune_enabled).toBe(false);
      expect(json.deleted_pins_count).toBe(0);
      expect(json.swept_pins_count).toBe(2);
      expect(json.message).toBe('All pruning disabled. Only orphan recovery sweep ran.');
      expect(json.warnings).toEqual([]);
    });
  });
});
