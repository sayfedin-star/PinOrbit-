export const prerender = false;

import type { APIRoute } from 'astro';
import { dbClients } from '../../../../server/db/clients';
import { getEffectiveSecret } from '../../../../server/services/webhook-secrets';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = (locals as { runtime?: { env?: Record<string, any> }; runtimeEnv?: Record<string, any> })?.runtime?.env || (locals as { runtimeEnv?: Record<string, any> })?.runtimeEnv || {};

  // 1. Extract and validate workspace_id from header or JSON body
  let workspaceId = request.headers.get('x-workspace-id')?.trim();

  const text = await request.text();
  if (text && text.trim().length > 0) {
    let body: Record<string, any>;
    try {
      body = JSON.parse(text);
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Malformed JSON payload: ' + err.message,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (body && typeof body.workspace_id === 'string' && body.workspace_id.trim().length > 0) {
      workspaceId = body.workspace_id.trim();
    }
  }

  if (!workspaceId) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'workspace_id is required in JSON body or x-workspace-id header.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 2. Authenticate
  const secret = request.headers.get('x-ingest-secret') || request.headers.get('x-dispatch-secret');
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

  // 3. Delete snapshots older than 180 days with strict tenant isolation
  try {
    const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0];
    const client = dbClients.getAnalytics(runtimeEnv);

    const { count, error } = await client
      .from('top_pins_snapshots')
      .delete()
      .eq('workspace_id', workspaceId)
      .lt('window_end', cutoff);

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
