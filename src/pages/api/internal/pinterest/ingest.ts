export const prerender = false;

import type { APIRoute } from 'astro';
import { dbClients } from '../../../../server/db/clients';
import { getEffectiveSecret } from '../../../../server/services/webhook-secrets';
import { pinnerETL } from '../../../../server/services/pinner-etl';
import type { PinnerIngestPayload } from '../../../../lib/types';

/**
 * Server-Only Internal Ingestion Endpoint.
 * Ingests normalized Pinterest API v5 data dispatched by Make.com proxy.
 *
 * Exact Validation Sequence (V19 Strict Directive B3):
 * 1. Parse JSON body → 400 on empty/malformed JSON.
 * 2. Require connection_id → 422 on missing.
 * 3. Load connection from Project 3 (deleted_at IS NULL) → 404 if absent.
 * 4. DEFAULT-LOCKED: if analytics_enabled === false → 409 { success: false, error: 'connection_disabled' }.
 * 5. Resolve expected secret via getEffectiveSecret(connection.workspace_id, runtimeEnv).
 * 6. Compare x-ingest-secret header (strictly NO fallback headers) → 401 on mismatch.
 * 7. Execute pinnerETL.processIngestionPayload.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = (locals as { runtime?: { env?: Record<string, any> }; runtimeEnv?: Record<string, any> })?.runtime?.env || (locals as { runtimeEnv?: Record<string, any> })?.runtimeEnv || {};

  // 1. Parse JSON body
  let payload: PinnerIngestPayload;
  try {
    const text = await request.text();
    if (!text || text.trim().length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Empty request payload.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    payload = JSON.parse(text);
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

  // 2. Require connection_id
  if (!payload || !payload.connection_id) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Validation Error: connection_id is required in payload.',
      }),
      {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 3. Load connection from Project 3 (deleted_at IS NULL)
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
      return new Response(
        JSON.stringify({
          success: false,
          error: `Connection "${payload.connection_id}" not found or has been deleted.`,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    connection = data;
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Database lookup error: ${err.message}`,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 4. Tenant Boundary Check & Server-Side Injection (R7)
  if (payload.workspace_id && payload.workspace_id !== connection.workspace_id) {
    console.warn('[IngestAPI] Client workspace_id mismatch — using connection.workspace_id', {
      client_ws: payload.workspace_id,
      connection_ws: connection.workspace_id,
    });
  }
  payload.workspace_id = connection.workspace_id;

  // 5. DEFAULT-LOCKED check: if analytics_enabled is false -> 409
  if (connection.analytics_enabled === false) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'connection_disabled',
      }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 5. Resolve expected secret via B2 (ws -> global -> env)
  const effectiveSecretResult = await getEffectiveSecret(
    connection.workspace_id,
    runtimeEnv
  );
  const expectedSecret = effectiveSecretResult.value;

  // 6. Compare x-ingest-secret header (strictly only x-ingest-secret, NO fallback headers)
  const providedSecret = request.headers.get('x-ingest-secret');
  if (!providedSecret || !expectedSecret || providedSecret !== expectedSecret) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Unauthorized: missing or invalid x-ingest-secret header.',
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Parse rate limit headers if present
  const rawHeaders: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    if (key.startsWith('x-ratelimit') || key.startsWith('x-pinterest')) {
      rawHeaders[key] = value;
    }
  }

  if (!payload.raw_headers || Object.keys(payload.raw_headers).length === 0) {
    payload.raw_headers = rawHeaders;
  }

  // 7. Execute ETL Pipeline
  try {
    const kvNamespace = runtimeEnv?.ANALYTICS_KV;
    const result = await pinnerETL.processIngestionPayload(payload, kvNamespace);

    const isNotFound = result.error?.includes('not registered');
    const isValidation = result.error?.includes('Validation Error');
    const statusCode = result.success ? 200 : isNotFound ? 404 : isValidation ? 422 : 200;

    return new Response(JSON.stringify(result), {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[IngestAPI] Fatal ETL processing error in Project 3:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal ETL pipeline error: ' + (err.message || 'Unknown error'),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
