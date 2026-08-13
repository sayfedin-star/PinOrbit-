export const prerender = false;

import type { APIRoute } from 'astro';
import { validateUserSession } from '../../../server/auth/session';
import { assertWorkspaceAccess } from '../../../server/auth/workspace-guard';
import { dbClients } from '../../../server/db/clients';
import { syncPublishingSchedule, deletePublishingSchedule } from '../../../server/services/fastcron-service';

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};
  const { id } = params;

  if (!user || !schedulingClient || !workspaceId) {
    return new Response(JSON.stringify({ error: 'Unauthorized or missing workspace' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id, 'admin');
    const adminClient = dbClients.getSchedulingAdmin(runtimeEnv);
    const updateFields: Record<string, any> = {};
    const allowedFields = ['label', 'webhook_id', 'timezone', 'window_start', 'window_end', 'interval_minutes', 'random_delay_minutes', 'active_days', 'started_at', 'batch', 'status'];
    for (const field of allowedFields) {
      if (body[field] !== undefined) updateFields[field] = body[field];
    }
    if (Object.keys(updateFields).length === 0) {
      return new Response(JSON.stringify({ error: 'No valid fields to update' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const { data: updated, error: updateErr } = await adminClient.from('posting_schedules').update(updateFields).eq('id', id).select().single();
    if (updateErr || !updated) throw updateErr || new Error('Update failed');
    const syncResult = await syncPublishingSchedule(updated, runtimeEnv);
    return new Response(JSON.stringify({ ...updated, job_id: syncResult.job_id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to update schedule' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};
  const { id } = params;

  if (!user || !schedulingClient || !workspaceId) {
    return new Response(JSON.stringify({ error: 'Unauthorized or missing workspace' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id, 'admin');
    const adminClient = dbClients.getSchedulingAdmin(runtimeEnv);
    const { data: schedule } = await adminClient.from('posting_schedules').select('fastcron_job_id').eq('id', id).single();
    const result = await deletePublishingSchedule(id, schedule?.fastcron_job_id, runtimeEnv);
    if (!result.success) throw new Error(result.error);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to delete schedule' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
