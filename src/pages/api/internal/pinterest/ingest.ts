export const prerender = false;

import type { APIRoute } from 'astro';
import { dbClients, isKnownDefaultIngestSecret, isProductionEnv } from '../../../../server/db/clients';
import { getEffectiveSecret } from '../../../../server/services/webhook-secrets';
import { pinnerETL } from '../../../../server/services/pinner-etl';
import type { PinnerIngestPayload } from '../../../../lib/types';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = (locals as { runtime?: { env?: Record<string, any> }; runtimeEnv?: Record<string, any> })?.runtime?.env || (locals as { runtimeEnv?: Record<string, any> })?.runtimeEnv || {};

  // 1. Parse JSON body
  let payload: any;
  try {
    const text = await request.text();
    if (!text || text.trim().length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Empty request payload.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    payload = JSON.parse(text);
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: 'Malformed JSON payload.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // 2. Engine events branch (pin.posted / board.created) BEFORE connection_id requirement
  if (payload && (payload.event === 'pin.posted' || payload.event === 'board.created')) {
    const ev = payload.event as string;
    const wsId = payload.workspace_id;
    if (!wsId) return new Response(JSON.stringify({ success: false, error: 'workspace_id required for engine events.' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
    const eff = await getEffectiveSecret(wsId, runtimeEnv);
    if (isProductionEnv(runtimeEnv) && eff.source === 'env' && isKnownDefaultIngestSecret(eff.value)) {
      return new Response(JSON.stringify({ success: false, error: 'Service unavailable: ingest secret not configured on server.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    const prov = request.headers.get('x-ingest-secret') || (typeof payload.ingest_secret === 'string' ? payload.ingest_secret : null);
    if (!prov || !eff.value || prov !== eff.value) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: missing or invalid x-ingest-secret header.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const admin = dbClients.getSchedulingAdmin(runtimeEnv);

    if (ev === 'pin.posted') {
      const internalId = payload.pin_id;
      if (!internalId) return new Response(JSON.stringify({ success: false, error: 'pin_id required.' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
      const { data: pin } = await admin.from('pins').select('*').eq('id', internalId).maybeSingle();
      if (!pin) return new Response(JSON.stringify({ success: false, error: 'Pin not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      if (payload.success === false) {
        const rc = (pin.retry_count ?? 0) + 1;
        const exhausted = rc >= (pin.max_retries ?? 2);
        await admin.from('pins').update({
          status: exhausted ? 'failed' : 'pending',
          processing_started_at: null,
          retry_count: rc,
          failure_type: 'permanent',
          last_failure_reason: payload.error || 'Make reported failure',
          last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', internalId);
        await admin.from('pin_delivery_logs').insert({ pin_id: internalId, attempt_no: pin.attempts, event_type: 'dispatch_failed', error_message: payload.error || null, metadata: { source: 'make_callback' } }).then(() => {});
        return new Response(JSON.stringify({ success: true, handled: 'pin_failed', exhausted }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      await admin.from('pins').update({
        status: 'posted',
        posted_at: payload.created_at || new Date().toISOString(),
        pinterest_pin_id: payload.id || null,
        pinterest_pin_created_at: payload.created_at || null,
        processing_started_at: null,
        last_error_message: null,
        updated_at: new Date().toISOString(),
      }).eq('id', internalId);
      await admin.from('pin_delivery_logs').insert({ pin_id: internalId, attempt_no: pin.attempts, event_type: 'dispatch_success', provider: 'pinterest', metadata: { pinterest_pin_id: payload.id, board_id: payload.board_id, source: 'make_callback' } }).then(() => {});
      return new Response(JSON.stringify({ success: true, handled: 'pin_posted' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // board.created
    const accId = payload.account_id;
    const bId = payload.board_id;
    const bName = payload.board_name;
    if (!accId || !bId || !bName) return new Response(JSON.stringify({ success: false, error: 'account_id, board_id, board_name required.' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
    const { data: acc } = await admin.from('accounts').select('workspace_id').eq('id', accId).maybeSingle();
    if (!acc) return new Response(JSON.stringify({ success: false, error: 'Account not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    const { error: insErr } = await admin.from('boards').insert({ account_id: accId, workspace_id: acc.workspace_id, board_name: bName, board_id: bId, pinterest_board_id: bId, created_via: 'webhook_auto_create' }).select('id').single();
    await admin.from('board_provisioning_requests').update({ status: insErr ? 'failed' : 'completed', error_message: insErr?.message || null, completed_at: new Date().toISOString() }).eq('idempotency_key', `board.create:${accId}:${String(bName).toLowerCase()}`).then(() => {});
    return new Response(JSON.stringify({ success: !insErr, handled: 'board_created', error: insErr?.message || null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // 3. Require connection_id
  if (!payload || !payload.connection_id) {
    return new Response(JSON.stringify({ success: false, error: 'Validation Error: connection_id is required in payload.' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
  }

  // 4. Authenticate BEFORE connection lookup (generic errors only)
  const preEff = await getEffectiveSecret(payload.workspace_id || '', runtimeEnv);
  if (isProductionEnv(runtimeEnv) && preEff.source === 'env' && isKnownDefaultIngestSecret(preEff.value)) {
    return new Response(JSON.stringify({ success: false, error: 'Service unavailable: ingest secret not configured on server.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  const providedSecret = request.headers.get('x-ingest-secret');
  if (!providedSecret || !preEff.value || providedSecret !== preEff.value) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized: missing or invalid x-ingest-secret header.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  // 5. Load connection (authenticated) — generic errors, no enumeration
  let connection: any = null;
  try {
    const analyticsClient = dbClients.getAnalytics(runtimeEnv);
    const { data, error } = await analyticsClient
      .from('analytics_connections')
      .select('id, workspace_id, display_name, analytics_enabled, deleted_at')
      .eq('id', payload.connection_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error || !data) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid connection or unauthorized.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    connection = data;
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: 'Internal server error.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // 6. Tenant boundary check & server-side injection
  if (payload.workspace_id && payload.workspace_id !== connection.workspace_id) {
    console.warn('[IngestAPI] Client workspace_id mismatch — using connection.workspace_id', { client_ws: payload.workspace_id, connection_ws: connection.workspace_id });
  }
  payload.workspace_id = connection.workspace_id;

  // 7. DEFAULT-LOCKED
  if (connection.analytics_enabled === false) {
    return new Response(JSON.stringify({ success: false, error: 'connection_disabled' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  // 8. Rate limit headers
  const rawHeaders: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    if (key.startsWith('x-ratelimit') || key.startsWith('x-pinterest')) rawHeaders[key] = value;
  }
  if (!payload.raw_headers || Object.keys(payload.raw_headers).length === 0) payload.raw_headers = rawHeaders;

  // 9. Execute ETL
  try {
    const kvNamespace = runtimeEnv?.ANALYTICS_KV;
    const result = await pinnerETL.processIngestionPayload(payload, kvNamespace, runtimeEnv);
    const isNotFound = result.error?.includes('not registered');
    const isValidation = result.error?.includes('Validation Error');
    const statusCode = result.success ? 200 : isNotFound ? 404 : isValidation ? 422 : 502;
    return new Response(JSON.stringify(result), { status: statusCode, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[IngestAPI] Fatal ETL processing error in Project 3:', err);
    return new Response(JSON.stringify({ success: false, error: 'Internal server error.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
