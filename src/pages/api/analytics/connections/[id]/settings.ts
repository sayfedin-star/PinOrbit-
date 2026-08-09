export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../../../server/auth/workspace-guard';
import { analyticsDb } from '../../../../../server/db/analytics';
import { fastcronService } from '../../../../../server/services/fastcron-service';
import type { AnalyticsConnectionSettingsResponse } from '../../../../../lib/types';

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const connectionId = params.id;

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

  if (!connectionId) {
    return new Response(
      JSON.stringify({ success: false, error: 'connection ID parameter is required.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);
    const connection = await analyticsDb.getWorkspaceConnection(workspaceId, connectionId);

    if (!connection) {
      return new Response(
        JSON.stringify({ success: false, error: 'Connection not found in this workspace.' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const responseData: AnalyticsConnectionSettingsResponse = {
      id: connection.id,
      display_name: connection.display_name,
      revoked_at: connection.revoked_at || null,
      analytics_webhook_url: connection.analytics_webhook_url || null,
      analytics_sync_time: connection.analytics_sync_time || '04:00',
      analytics_cron_expression: connection.analytics_cron_expression || '0 4 * * *',
      analytics_schedule_status: connection.analytics_schedule_status || 'pending',
      analytics_start_offset_days: connection.analytics_start_offset_days ?? 7,
      analytics_end_offset_days: connection.analytics_end_offset_days ?? 1,
      top_pins_webhook_url: connection.top_pins_webhook_url || null,
      top_pins_sync_time: connection.top_pins_sync_time || '04:30',
      top_pins_cron_expression: connection.top_pins_cron_expression || '30 4 * * *',
      top_pins_schedule_status: connection.top_pins_schedule_status || 'pending',
      top_pins_start_offset_days: connection.top_pins_start_offset_days ?? 7,
      top_pins_end_offset_days: connection.top_pins_end_offset_days ?? 2,
    };

    return new Response(JSON.stringify({ success: true, data: responseData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    const isAuth = err.message?.includes('Forbidden') || err.message?.includes('Unauthorized');
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to get connection settings.' }),
      {
        status: isAuth ? 403 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const connectionId = params.id;

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

  if (!connectionId) {
    return new Response(
      JSON.stringify({ success: false, error: 'connection ID parameter is required.' }),
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
          error: 'Forbidden: Admin or Owner role required to edit connection settings.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const existing = await analyticsDb.getWorkspaceConnection(workspaceId, connectionId);
    if (!existing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Connection not found in this workspace.' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const updates: any = {};

    // Validate and update Pipeline A (Account Analytics)
    if (body.analytics_webhook_url !== undefined) {
      if (body.analytics_webhook_url) {
        const v = fastcronService.validateWebhookUrl(body.analytics_webhook_url);
        if (!v.valid) {
          return new Response(
            JSON.stringify({ success: false, error: `Analytics Webhook URL invalid: ${v.error}` }),
            { status: 422, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
      updates.analytics_webhook_url = body.analytics_webhook_url || null;
      if (body.analytics_webhook_url !== existing.analytics_webhook_url) {
        updates.analytics_schedule_status = 'pending';
      }
    }

    if (body.analytics_sync_time) {
      const c = fastcronService.parseTimeToCron(body.analytics_sync_time);
      if (!c.valid || !c.cron) {
        return new Response(
          JSON.stringify({ success: false, error: `Analytics sync time invalid: ${c.error}` }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updates.analytics_sync_time = body.analytics_sync_time.trim();
      updates.analytics_cron_expression = c.cron;
      if (body.analytics_sync_time !== existing.analytics_sync_time) {
        updates.analytics_schedule_status = 'pending';
      }
    }

    // Validate Pipeline A Date Offsets (V20.1)
    const analyticsStart = body.analytics_start_offset_days !== undefined
      ? parseInt(String(body.analytics_start_offset_days), 10)
      : (existing.analytics_start_offset_days ?? 7);
    const analyticsEnd = body.analytics_end_offset_days !== undefined
      ? parseInt(String(body.analytics_end_offset_days), 10)
      : (existing.analytics_end_offset_days ?? 1);

    if (body.analytics_start_offset_days !== undefined || body.analytics_end_offset_days !== undefined) {
      if (isNaN(analyticsStart) || analyticsStart < 1 || analyticsStart > 90) {
        return new Response(
          JSON.stringify({ success: false, error: 'Pipeline A Start Offset must be an integer between 1 and 90.' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (isNaN(analyticsEnd) || analyticsEnd < 0 || analyticsEnd > 60) {
        return new Response(
          JSON.stringify({ success: false, error: 'Pipeline A End Offset must be an integer between 0 and 60.' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (analyticsEnd >= analyticsStart) {
        return new Response(
          JSON.stringify({ success: false, error: 'Pipeline A End Offset must be strictly less than Start Offset.' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }

      updates.analytics_start_offset_days = analyticsStart;
      updates.analytics_end_offset_days = analyticsEnd;

      if (
        analyticsStart !== existing.analytics_start_offset_days ||
        analyticsEnd !== existing.analytics_end_offset_days
      ) {
        updates.analytics_schedule_status = 'pending';
      }
    }

    // Validate and update Pipeline B (Top Pins)
    if (body.top_pins_webhook_url !== undefined) {
      if (body.top_pins_webhook_url) {
        const v = fastcronService.validateWebhookUrl(body.top_pins_webhook_url);
        if (!v.valid) {
          return new Response(
            JSON.stringify({ success: false, error: `Top Pins Webhook URL invalid: ${v.error}` }),
            { status: 422, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
      updates.top_pins_webhook_url = body.top_pins_webhook_url || null;
      if (body.top_pins_webhook_url !== existing.top_pins_webhook_url) {
        updates.top_pins_schedule_status = 'pending';
      }
    }

    if (body.top_pins_sync_time) {
      const c = fastcronService.parseTimeToCron(body.top_pins_sync_time);
      if (!c.valid || !c.cron) {
        return new Response(
          JSON.stringify({ success: false, error: `Top Pins sync time invalid: ${c.error}` }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updates.top_pins_sync_time = body.top_pins_sync_time.trim();
      updates.top_pins_cron_expression = c.cron;
      if (body.top_pins_sync_time !== existing.top_pins_sync_time) {
        updates.top_pins_schedule_status = 'pending';
      }
    }

    // Validate Pipeline B Date Offsets (V20.1)
    const topPinsStart = body.top_pins_start_offset_days !== undefined
      ? parseInt(String(body.top_pins_start_offset_days), 10)
      : (existing.top_pins_start_offset_days ?? 7);
    const topPinsEnd = body.top_pins_end_offset_days !== undefined
      ? parseInt(String(body.top_pins_end_offset_days), 10)
      : (existing.top_pins_end_offset_days ?? 2);

    if (body.top_pins_start_offset_days !== undefined || body.top_pins_end_offset_days !== undefined) {
      if (isNaN(topPinsStart) || topPinsStart < 1 || topPinsStart > 90) {
        return new Response(
          JSON.stringify({ success: false, error: 'Pipeline B Start Offset must be an integer between 1 and 90.' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (isNaN(topPinsEnd) || topPinsEnd < 0 || topPinsEnd > 60) {
        return new Response(
          JSON.stringify({ success: false, error: 'Pipeline B End Offset must be an integer between 0 and 60.' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (topPinsEnd >= topPinsStart) {
        return new Response(
          JSON.stringify({ success: false, error: 'Pipeline B End Offset must be strictly less than Start Offset.' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }

      updates.top_pins_start_offset_days = topPinsStart;
      updates.top_pins_end_offset_days = topPinsEnd;

      if (
        topPinsStart !== existing.top_pins_start_offset_days ||
        topPinsEnd !== existing.top_pins_end_offset_days
      ) {
        updates.top_pins_schedule_status = 'pending';
      }
    }

    const updated = await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, updates);

    const responseData: AnalyticsConnectionSettingsResponse = {
      id: updated.id,
      display_name: updated.display_name,
      revoked_at: updated.revoked_at || null,
      analytics_webhook_url: updated.analytics_webhook_url || null,
      analytics_sync_time: updated.analytics_sync_time,
      analytics_cron_expression: updated.analytics_cron_expression,
      analytics_schedule_status: updated.analytics_schedule_status,
      analytics_start_offset_days: updated.analytics_start_offset_days ?? 7,
      analytics_end_offset_days: updated.analytics_end_offset_days ?? 1,
      top_pins_webhook_url: updated.top_pins_webhook_url || null,
      top_pins_sync_time: updated.top_pins_sync_time,
      top_pins_cron_expression: updated.top_pins_cron_expression,
      top_pins_schedule_status: updated.top_pins_schedule_status,
      top_pins_start_offset_days: updated.top_pins_start_offset_days ?? 7,
      top_pins_end_offset_days: updated.top_pins_end_offset_days ?? 2,
    };

    return new Response(JSON.stringify({ success: true, data: responseData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to update connection settings.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
