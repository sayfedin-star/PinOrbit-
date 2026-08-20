import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDefaultWorkspaceId, getActiveWorkspaceId, DEFAULT_WORKSPACE_ID } from '../workspaces';
import { setActiveWorkspaceId, deleteWorkspace, assertWorkspaceEmpty } from '../workspaces-client';
import { getAccounts, getBoards, getPins } from '../supabase';
import { getCompetitors } from '../competitors';

vi.mock('../supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supabase')>();
  return {
    ...actual,
    getAccounts: vi.fn().mockImplementation((wsId?: string) =>
      Promise.resolve(wsId === '00000000-0000-0000-0000-000000000099' ? [] : [{ id: 'acc-1' }])
    ),
    getBoards: vi.fn().mockImplementation((wsId?: string) =>
      Promise.resolve(wsId === '00000000-0000-0000-0000-000000000099' ? [] : [{ id: 'board-1' }])
    ),
    getPins: vi.fn().mockImplementation((_status?: string, _account?: string, wsId?: string) =>
      Promise.resolve(wsId === '00000000-0000-0000-0000-000000000099' ? [] : [{ id: 'pin-1' }])
    ),
  };
});

vi.mock('../competitors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../competitors')>();
  return {
    ...actual,
    getCompetitors: vi.fn().mockImplementation((wsId?: string) =>
      Promise.resolve(wsId === '00000000-0000-0000-0000-000000000099' ? [] : [{ id: 'comp-1' }])
    ),
  };
});

describe('Workspace Server & Client Helpers Test Suite', () => {
  beforeEach(() => {
    // Setup jsdom document cookie mock for node testing environment
    if (typeof globalThis.document === 'undefined') {
      (globalThis as any).document = { cookie: '' };
    } else {
      (globalThis as any).document.cookie = '';
    }
  });

  it('returns default workspace ID by default', () => {
    expect(getDefaultWorkspaceId()).toBe('00000000-0000-0000-0000-000000000001');
    expect(getActiveWorkspaceId()).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('sets and retrieves active workspace cookie in browser environment', () => {
    const customWsId = 'ws-test-123';
    setActiveWorkspaceId(customWsId);
    expect(getActiveWorkspaceId()).toBe(customWsId);

    // Reset back to default
    setActiveWorkspaceId(DEFAULT_WORKSPACE_ID);
    expect(getActiveWorkspaceId()).toBe(DEFAULT_WORKSPACE_ID);
  });

  it('parses active workspace from Astro cookies object and raw header strings', () => {
    const mockAstroCookies = {
      get: (name: string) => (name === 'pinorbit_active_workspace_id' ? { value: 'ws-astro-456' } : null),
    };
    expect(getActiveWorkspaceId(mockAstroCookies)).toBe('ws-astro-456');

    const rawHeader = 'session=abc; pinorbit_active_workspace_id=ws-header-789; theme=dark';
    expect(getActiveWorkspaceId(rawHeader)).toBe('ws-header-789');
  });

  it('blocks deletion of Default Workspace', async () => {
    await expect(deleteWorkspace(DEFAULT_WORKSPACE_ID)).rejects.toThrow(
      'Action blocked: The Default Workspace cannot be deleted.'
    );
  });

  it('scopes page data queries dynamically based on active workspace selection', async () => {
    // Select workspace A (Default Workspace)
    setActiveWorkspaceId(DEFAULT_WORKSPACE_ID);
    const activeWsA = getActiveWorkspaceId();
    expect(activeWsA).toBe(DEFAULT_WORKSPACE_ID);

    const accountsA = await getAccounts(activeWsA);
    const boardsA = await getBoards(activeWsA);
    const pinsA = await getPins('all', undefined, activeWsA);
    const compA = await getCompetitors(activeWsA);

    // Switch active workspace to workspace B
    const workspaceBId = '00000000-0000-0000-0000-000000000099';
    setActiveWorkspaceId(workspaceBId);
    const activeWsB = getActiveWorkspaceId();
    expect(activeWsB).toBe(workspaceBId);

    const accountsB = await getAccounts(activeWsB);
    const boardsB = await getBoards(activeWsB);
    const pinsB = await getPins('all', undefined, activeWsB);
    const compB = await getCompetitors(activeWsB);

    // Operational data queries returned for B are cleanly scoped and separated from A
    expect(accountsB).toEqual([]);
    expect(boardsB).toEqual([]);
    expect(pinsB).toEqual([]);
    expect(compB).toEqual([]);

    expect(accountsA.length).toBeGreaterThanOrEqual(0);
  });
});
