export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../../server/auth/workspace-guard';
import { analyticsDb } from '../../../../server/db/analytics';
import { fastcronService } from '../../../../server/services/fastcron-service';

export const PATCH: APIRoute = async ({ params, request, locals }) => {
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
          error: 'Forbidden: Admin or Owner role required to modify connections.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Verify connection exists and belongs to this workspace
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
    const displayName = body.display_name !== undefined ? body.display_name : body.account_name;
    if (displayName !== undefined) {
      updates.display_name = displayName;
    }
    if (body.analytics_enabled !== undefined) {
      updates.analytics_enabled = Boolean(body.analytics_enabled);
    }

    const updated = await analyticsDb.updateWorkspaceConnection(
      workspaceId,
      connectionId,
      updates
    );

    return new Response(
      JSON.stringify({
        success: true,
        account: updated, // backward compatibility
        connection: updated,
        message: 'Pinterest connection updated successfully.',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to update connection.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
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
    const access = await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);
    if (!access.isAdmin && !access.isOwner) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Forbidden: Admin or Owner role required to delete connections.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Verify connection exists and belongs to this workspace
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

    // Best-effort: Delete FastCron jobs if present
    if (existing.analytics_fastcron_job_id) {
      await fastcronService.deleteFastCronJob(workspaceId, existing.analytics_fastcron_job_id);
    }
    if (existing.top_pins_fastcron_job_id) {
      await fastcronService.deleteFastCronJob(workspaceId, existing.top_pins_fastcron_job_id);
    }

    // Soft delete in Project 3: sets analytics_enabled = false, deleted_at = now()
    await analyticsDb.softDeleteWorkspaceConnection(workspaceId, connectionId);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Connection successfully soft-deleted. Historical analytics are preserved.',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to delete connection.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
