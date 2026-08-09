export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../server/auth/workspace-guard';
import { analyticsDb } from '../../../server/db/analytics';
import { getServerEnv } from '../../../server/db/clients';
import { fastcronService } from '../../../server/services/fastcron-service';
import type { WorkspaceAnalyticsSettingsResponse } from '../../../lib/types';

export const GET: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;

  if (!user || !schedulingClient) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: authentication required.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id') || locals.activeWorkspaceId;

  if (!workspaceId) {
    return new Response(
      JSON.stringify({ error: 'workspace_id query parameter is required.' }),
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
      workspace_id: workspaceId,
      analytics_webhook_url: settings?.analytics_webhook_url || null,
      top_pins_webhook_url: settings?.top_pins_webhook_url || null,
      analytics_sync_time: settings?.analytics_sync_time || '04:00',
      top_pins_sync_time: settings?.top_pins_sync_time || '04:30',
      timezone: settings?.timezone || 'UTC',
      analytics_enabled: settings?.analytics_enabled ?? true,
      top_pins_enabled: settings?.top_pins_enabled ?? true,
      auto_backfill_on_connect: settings?.auto_backfill_on_connect ?? false,
      has_fastcron_token: hasFastcronToken,
      fastcron_token_masked: hasFastcronToken ? '••••••••' : null,
      has_ingest_secret: Boolean(env.INGEST_SECRET_KEY),
      analytics_schedule_status: settings?.analytics_schedule_status || 'pending',
      top_pins_schedule_status: settings?.top_pins_schedule_status || 'pending',
      analytics_fastcron_job_id: settings?.analytics_fastcron_job_id || null,
      top_pins_fastcron_job_id: settings?.top_pins_fastcron_job_id || null,
      last_synced_at: settings?.last_synced_at || null,
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

  if (!user || !schedulingClient) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: authentication required.' }),
      {
        status: 401,
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

  const workspaceId = body.workspace_id || locals.activeWorkspaceId;
  if (!workspaceId) {
    return new Response(
      JSON.stringify({ success: false, error: 'workspace_id is required.' }),
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
        JSON.stringify({ success: false, error: 'Forbidden: Admin or Owner role required to edit analytics settings.' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const existing = await analyticsDb.getWorkspaceAnalyticsSettings(workspaceId);

    // Validate URLs if provided
    if (body.analytics_webhook_url) {
      const v = fastcronService.validateWebhookUrl(body.analytics_webhook_url);
      if (!v.valid) {
        return new Response(
          JSON.stringify({ success: false, error: `Analytics Webhook URL invalid: ${v.error}` }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (body.top_pins_webhook_url) {
      const v = fastcronService.validateWebhookUrl(body.top_pins_webhook_url);
      if (!v.valid) {
        return new Response(
          JSON.stringify({ success: false, error: `Top Pins Webhook URL invalid: ${v.error}` }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Validate sync times
    if (body.analytics_sync_time) {
      const c = fastcronService.parseTimeToCron(body.analytics_sync_time);
      if (!c.valid) {
        return new Response(
          JSON.stringify({ success: false, error: `Analytics sync time invalid: ${c.error}` }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (body.top_pins_sync_time) {
      const c = fastcronService.parseTimeToCron(body.top_pins_sync_time);
      if (!c.valid) {
        return new Response(
          JSON.stringify({ success: false, error: `Top Pins sync time invalid: ${c.error}` }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Handle token: write-only input (if empty string, keep existing)
    let tokenToSave: string | undefined | null = existing?.fastcron_token;
    if (body.fastcron_token !== undefined && body.fastcron_token !== null) {
      const rawToken = String(body.fastcron_token).trim();
      if (rawToken.length > 0) {
        if (rawToken.length < 16) {
          return new Response(
            JSON.stringify({ success: false, error: 'FastCron token must be at least 16 characters.' }),
            { status: 422, headers: { 'Content-Type': 'application/json' } }
          );
        }
        tokenToSave = rawToken;
      }
      // If empty string, retain existing token (don't overwrite with blank)
    }

    const updates: any = {
      workspace_id: workspaceId,
      analytics_webhook_url: body.analytics_webhook_url !== undefined ? body.analytics_webhook_url : existing?.analytics_webhook_url,
      top_pins_webhook_url: body.top_pins_webhook_url !== undefined ? body.top_pins_webhook_url : existing?.top_pins_webhook_url,
      analytics_sync_time: body.analytics_sync_time || existing?.analytics_sync_time || '04:00',
      top_pins_sync_time: body.top_pins_sync_time || existing?.top_pins_sync_time || '04:30',
      timezone: body.timezone || existing?.timezone || 'UTC',
      analytics_enabled: body.analytics_enabled !== undefined ? Boolean(body.analytics_enabled) : (existing?.analytics_enabled ?? true),
      top_pins_enabled: body.top_pins_enabled !== undefined ? Boolean(body.top_pins_enabled) : (existing?.top_pins_enabled ?? true),
      auto_backfill_on_connect: body.auto_backfill_on_connect !== undefined ? Boolean(body.auto_backfill_on_connect) : (existing?.auto_backfill_on_connect ?? false),
      fastcron_token: tokenToSave,
    };

    const saved = await analyticsDb.upsertWorkspaceAnalyticsSettings(workspaceId, updates);
    const env = getServerEnv();
    const hasFastcronToken = Boolean(saved.fastcron_token || env.FASTCRON_API_TOKEN);

    const responseData: WorkspaceAnalyticsSettingsResponse = {
      workspace_id: workspaceId,
      analytics_webhook_url: saved.analytics_webhook_url || null,
      top_pins_webhook_url: saved.top_pins_webhook_url || null,
      analytics_sync_time: saved.analytics_sync_time,
      top_pins_sync_time: saved.top_pins_sync_time,
      timezone: saved.timezone,
      analytics_enabled: saved.analytics_enabled,
      top_pins_enabled: saved.top_pins_enabled,
      auto_backfill_on_connect: saved.auto_backfill_on_connect,
      has_fastcron_token: hasFastcronToken,
      fastcron_token_masked: hasFastcronToken ? '••••••••' : null,
      has_ingest_secret: Boolean(env.INGEST_SECRET_KEY),
      analytics_schedule_status: saved.analytics_schedule_status,
      top_pins_schedule_status: saved.top_pins_schedule_status,
      analytics_fastcron_job_id: saved.analytics_fastcron_job_id || null,
      top_pins_fastcron_job_id: saved.top_pins_fastcron_job_id || null,
      last_synced_at: saved.last_synced_at || null,
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
