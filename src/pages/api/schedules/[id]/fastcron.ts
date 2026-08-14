export const prerender = false;

import type { APIRoute } from 'astro';
import { validateUserSession } from '../../../../server/auth/session';
import { assertWorkspaceAccess } from '../../../../server/auth/workspace-guard';
import { dbClients } from '../../../../server/db/clients';
import { fastcronService } from '../../../../server/services/fastcron-service';
import { getServerEnv } from '../../../../server/db/clients';
import { decryptToken } from '../../../../server/lib/token-crypto';

export const GET: APIRoute = async ({ url, params, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};
  const { id } = params;
  const view = url.searchParams.get('view') || 'logs';

  if (!user || !schedulingClient || !workspaceId) {
    return new Response(JSON.stringify({ error: 'Unauthorized or missing workspace' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);
    const adminClient = dbClients.getSchedulingAdmin(runtimeEnv);
    const { data: schedule } = await adminClient.from('posting_schedules').select('fastcron_job_id, fastcron_token_encrypted').eq('id', id).single();
    if (!schedule || !schedule.fastcron_job_id) {
      return new Response(JSON.stringify({ error: 'Job not configured' }), { status: 400 });
    }

    const env = getServerEnv(runtimeEnv);
    let token: string | undefined;
    if (schedule.fastcron_token_encrypted) {
      const dec = await decryptToken(schedule.fastcron_token_encrypted, env.TOKEN_KEK);
      if (dec) token = dec.trim();
    }
    if (!token && env.FASTCRON_API_TOKEN) token = env.FASTCRON_API_TOKEN.trim();
    if (!token) return new Response(JSON.stringify({ error: 'Token not configured' }), { status: 400 });

    let action = 'cron_logs';
    if (view === 'failures') action = 'cron_failures';
    else if (view === 'next') action = 'cron_next';

    const res = await fastcronService.fastcronCall(action, { id: schedule.fastcron_job_id }, token);
    if (!res.success) return new Response(JSON.stringify({ error: res.error }), { status: 500 });
    const data = res.data?.logs || res.data?.data?.logs || res.data?.data || (Array.isArray(res.data) ? res.data : []);
    return new Response(JSON.stringify(Array.isArray(data) ? data : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to fetch FastCron data' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
