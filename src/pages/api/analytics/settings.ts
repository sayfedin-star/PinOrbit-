export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../server/auth/workspace-guard';
import { analyticsDb } from '../../../server/db/analytics';
import { getServerEnv } from '../../../server/db/clients';
import { encryptToken } from '../../../server/lib/token-crypto';
import type { WorkspaceAnalyticsSettingsResponse } from '../../../lib/types';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;

  if (!user || !schedulingClient) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: authentication required.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (!workspaceId) {
    return new Response(
      JSON.stringify({ error: 'Active workspace not found in session.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);
    const settings = await analyticsDb.getWorkspaceAnalyticsSettings(workspaceId);
    const env = getServerEnv();

    const hasFastcronToken = Boolean(
      settings?.fastcron_token || env.FASTCRON_API_TOKEN
    );

    const responseData: WorkspaceAnalyticsSettingsResponse = {
      fastcron_token_configured: hasFastcronToken,
      timezone: settings?.timezone || 'UTC',
      is_sync_enabled: settings?.is_sync_enabled ?? true,
      auto_backfill_on_connect: settings?.auto_backfill_on_connect ?? false,
    };

    return new Response(JSON.stringify({ success: true, data: responseData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    const isAuth = err.message?.includes('Forbidden') || err.message?.includes('Unauthorized');
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to get settings.' }),
      {
        status: isAuth ? 403 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;

  if (!user || !schedulingClient) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: authentication required.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (!workspaceId) {
    return new Response(
      JSON.stringify({ success: false, error: 'Active workspace not found in session.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  let body: any = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid JSON body.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const access = await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);
    if (!access.isAdmin && !access.isOwner) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Forbidden: Admin or Owner role required to edit workspace settings.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const existing = await analyticsDb.getWorkspaceAnalyticsSettings(workspaceId);

    // Handle FastCron token write-only input (if non-empty -> validate; if empty string -> keep existing)
    let tokenToSave: string | undefined | null = existing?.fastcron_token;
    if (body.fastcron_token !== undefined && body.fastcron_token !== null) {
      const rawToken = String(body.fastcron_token).trim();
      if (rawToken.length > 0) {
        if (rawToken.length < 16) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'FastCron token must be at least 16 characters.',
            }),
            { status: 422, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (!rawToken.startsWith('v1:')) {
          const env = getServerEnv();
          tokenToSave = await encryptToken(rawToken, env.TOKEN_KEK);
        } else {
          tokenToSave = rawToken;
        }
      }
    }

    const updates: any = {
      workspace_id: workspaceId,
      timezone: body.timezone || existing?.timezone || 'UTC',
      is_sync_enabled:
        body.is_sync_enabled !== undefined
          ? Boolean(body.is_sync_enabled)
          : (existing?.is_sync_enabled ?? true),
      auto_backfill_on_connect:
        body.auto_backfill_on_connect !== undefined
          ? Boolean(body.auto_backfill_on_connect)
          : (existing?.auto_backfill_on_connect ?? false),
      fastcron_token: tokenToSave,
    };

    const saved = await analyticsDb.upsertWorkspaceAnalyticsSettings(workspaceId, updates);
    const env = getServerEnv();
    const hasFastcronToken = Boolean(saved.fastcron_token || env.FASTCRON_API_TOKEN);

    const responseData: WorkspaceAnalyticsSettingsResponse = {
      fastcron_token_configured: hasFastcronToken,
      timezone: saved.timezone,
      is_sync_enabled: saved.is_sync_enabled,
      auto_backfill_on_connect: saved.auto_backfill_on_connect,
    };

    return new Response(JSON.stringify({ success: true, data: responseData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to save settings.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
