export const prerender = false;

import type { APIRoute } from 'astro';
import { validateUserSession } from '../../../../server/auth/session';
import { assertWorkspaceAccess } from '../../../../server/auth/workspace-guard';
import { dbClients } from '../../../../server/db/clients';
import { pausePublishingSchedule, resumePublishingSchedule, clonePublishingSchedule, deletePublishingSchedule, fastcronService } from '../../../../server/services/fastcron-service';

export const POST: APIRoute = async ({ request, params, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};
  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Schedule ID is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

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

  const action = body.action;
  if (!action || !['pause', 'resume', 'run', 'clone', 'delete'].includes(action)) {
    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id, 'admin');
    const adminClient = dbClients.getSchedulingAdmin(runtimeEnv);
    const { data: schedule } = await adminClient.from('posting_schedules').select('*').eq('id', id).single();
    if (!schedule || schedule.workspace_id !== workspaceId) {
      return new Response(JSON.stringify({ error: 'Schedule not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (action === 'pause') {
      if (!schedule.fastcron_job_id) return new Response(JSON.stringify({ error: 'Job not configured' }), { status: 400 });
      const result = await pausePublishingSchedule(id, schedule.fastcron_job_id, runtimeEnv);
      if (!result.success) throw new Error(result.error);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (action === 'resume') {
      if (!schedule.fastcron_job_id) return new Response(JSON.stringify({ error: 'Job not configured' }), { status: 400 });
      const result = await resumePublishingSchedule(id, schedule.fastcron_job_id, runtimeEnv);
      if (!result.success) throw new Error(result.error);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (action === 'run') {
      if (schedule.fastcron_job_id) {
        const { getServerEnv } = await import('../../../../server/db/clients');
        const { decryptToken } = await import('../../../../server/lib/token-crypto');
        const env = getServerEnv(runtimeEnv);
        let token: string | undefined;
        if (schedule.fastcron_token_encrypted) {
          const dec = await decryptToken(schedule.fastcron_token_encrypted, env.TOKEN_KEK);
          if (dec) token = dec.trim();
        }
        if (!token && env.FASTCRON_API_TOKEN) token = env.FASTCRON_API_TOKEN.trim();
        if (token) {
          const res = await fastcronService.fastcronCall('cron_run', { id: schedule.fastcron_job_id }, token);
          if (!res.success) throw new Error(res.error);
          return new Response(JSON.stringify({ success: true, via: 'fastcron' }), { status: 200 });
        }
      }
      const base = (typeof process !== 'undefined' && process.env.DISPATCH_BASE_URL)
        ? process.env.DISPATCH_BASE_URL.replace(/\/$/, '')
        : 'https://pinorbit-v2.o-i.workers.dev';
      const dispatchUrl = `${base}/api/internal/pinterest/dispatch-due-pin`;
      const res = await fetch(dispatchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule_id: schedule.id, dispatch_token: schedule.dispatch_token }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ success: res.ok, via: 'direct', ...data }), { status: res.ok ? 200 : res.status || 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (action === 'clone') {
      const result = await clonePublishingSchedule(id, runtimeEnv);
      if (!result.success) throw new Error(result.error);
      return new Response(JSON.stringify({ success: true, new_schedule: result.new_schedule }), { status: 200 });
    }
    if (action === 'delete') {
      const result = await deletePublishingSchedule(id, schedule.fastcron_job_id, runtimeEnv);
      if (!result.success) throw new Error(result.error);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Action failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
};
