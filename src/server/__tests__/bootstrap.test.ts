import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrapAdminUser, type BootstrapOptions } from '../auth/bootstrap';

describe('Server Admin Bootstrap Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fails fast with CONFIG_ERROR when missing bootstrap credentials', async () => {
    const result = await bootstrapAdminUser({
      supabaseUrl: 'https://test-project.supabase.co',
      supabaseSecretKey: 'test-secret-key',
      email: '',
      password: '',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('CONFIG_ERROR');
    expect(result.message).toContain('Missing BOOTSTRAP_ADMIN_EMAIL');
  });

  it('fails fast with CONFIG_ERROR when missing Supabase service credentials', async () => {
    const result = await bootstrapAdminUser({
      supabaseUrl: '',
      supabaseSecretKey: '',
      email: 'admin@pinorbit.internal',
      password: 'SuperSecretPassword123!',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('CONFIG_ERROR');
    expect(result.message).toContain('Missing SCHEDULING_SUPABASE_URL');
  });

  it('returns ALREADY_INITIALIZED if public.admin_users already contains active records', async () => {
    const mockClient: any = {
      from: vi.fn((table: string) => {
        if (table === 'admin_users') {
          return {
            select: vi.fn().mockResolvedValue({ count: 1, error: null }),
          };
        }
        return {};
      }),
      auth: {
        admin: {
          listUsers: vi.fn(),
          createUser: vi.fn(),
        },
      },
    };

    const result = await bootstrapAdminUser({
      client: mockClient,
      email: 'admin@pinorbit.internal',
      password: 'SuperSecretPassword123!',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('ALREADY_INITIALIZED');
    expect(result.message).toContain('already initialized');
    expect(mockClient.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('successfully creates auth user, admin_users row, default workspace, and owner membership', async () => {
    const createdUserId = 'usr_admin_001';
    const createdWsId = 'ws_default_001';

    const insertAdminUserMock = vi.fn().mockResolvedValue({ error: null });
    const insertWsMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: createdWsId }, error: null }),
      }),
    });
    const insertMembershipMock = vi.fn().mockResolvedValue({ error: null });
    const insertAuditMock = vi.fn().mockResolvedValue({ error: null });

    const mockClient: any = {
      from: vi.fn((table: string) => {
        if (table === 'admin_users') {
          return {
            select: vi.fn().mockResolvedValue({ count: 0, error: null }),
            upsert: insertAdminUserMock,
          };
        }
        if (table === 'workspaces') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
            insert: insertWsMock,
          };
        }
        if (table === 'workspace_memberships') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
            insert: insertMembershipMock,
          };
        }
        if (table === 'audit_log') {
          return {
            insert: insertAuditMock,
          };
        }
        return {};
      }),
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
          createUser: vi.fn().mockResolvedValue({
            data: { user: { id: createdUserId, email: 'admin@pinorbit.internal' } },
            error: null,
          }),
        },
      },
    };

    const result = await bootstrapAdminUser({
      client: mockClient,
      email: 'admin@pinorbit.internal',
      password: 'SuperSecretPassword123!',
      workspaceName: 'Primary Workspace',
      workspaceSlug: 'primary',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('SUCCESS');
    expect(result.userId).toBe(createdUserId);
    expect(result.workspaceId).toBe(createdWsId);
    expect(result.email).toBe('admin@pinorbit.internal');

    // Verify all steps were invoked
    expect(mockClient.auth.admin.createUser).toHaveBeenCalledWith({
      email: 'admin@pinorbit.internal',
      password: 'SuperSecretPassword123!',
      email_confirm: true,
      user_metadata: expect.objectContaining({ role: 'admin', bootstrapped: true }),
    });
    expect(insertAdminUserMock).toHaveBeenCalledWith(
      { user_id: createdUserId },
      { onConflict: 'user_id' }
    );
    expect(insertWsMock).toHaveBeenCalledWith({
      name: 'Primary Workspace',
      slug: 'primary',
    });
    expect(insertMembershipMock).toHaveBeenCalledWith({
      workspace_id: createdWsId,
      user_id: createdUserId,
      role: 'owner',
    });
    expect(insertAuditMock).toHaveBeenCalled();
  });

  it('handles partial failures cleanly if workspace insertion fails', async () => {
    const createdUserId = 'usr_admin_002';

    const mockClient: any = {
      from: vi.fn((table: string) => {
        if (table === 'admin_users') {
          return {
            select: vi.fn().mockResolvedValue({ count: 0, error: null }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === 'workspaces') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB connection dropped' } }),
              }),
            }),
          };
        }
        return {};
      }),
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
          createUser: vi.fn().mockResolvedValue({
            data: { user: { id: createdUserId, email: 'admin@pinorbit.internal' } },
            error: null,
          }),
        },
      },
    };

    const result = await bootstrapAdminUser({
      client: mockClient,
      email: 'admin@pinorbit.internal',
      password: 'SuperSecretPassword123!',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.message).toContain('Failed to provision default workspace');
  });
});
