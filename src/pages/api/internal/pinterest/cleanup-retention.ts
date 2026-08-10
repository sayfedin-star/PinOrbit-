export const prerender = false;

import type { APIRoute } from 'astro';
import { dbClients } from '../../../../server/db/clients';
import { getEffectiveSecret } from '../../../../server/services/webhook-secrets';

export const POST: APIRoute = async ({ request, locals }) => {
  const secret = request.headers.get('x-ingest-secret') || request.headers.get('x-dispatch-secret');
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};

  let workspaceId: string | undefined = undefined;
  try {
    const text = await request.clone().text();
    if (text) {
      const body = JSON.parse(text);
      if (body.workspace_id) workspaceId = body.workspace_id;
    }
  } catch {}

  const expected = await getEffectiveSecret(workspaceId, runtimeEnv);

  if (!secret || !expected.value || secret !== expected.value) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized: invalid or missing x-ingest-secret.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0];
    const client = dbClients.getAnalytics(runtimeEnv);

    let query = client
      .from('top_pins_snapshots')
      .delete()
      .lt('window_end', cutoff);

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }

    const { count, error } = await query;

    if (error) {
      throw error;
    }

    return new Response(
      JSON.stringify({
        success: true,
        deleted_count: count ?? 0,
        cutoff_date: cutoff,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Retention cleanup failed.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
