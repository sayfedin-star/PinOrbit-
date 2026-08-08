export const prerender = false;

import type { APIRoute } from 'astro';
import { getServerEnv } from '../../../../server/db/clients';
import { pinnerETL } from '../../../../server/services/pinner-etl';
import type { PinnerIngestPayload } from '../../../../lib/types';

/**
 * Server-Only Internal Ingestion Endpoint.
 * Ingests normalized Pinterest API v5 data dispatched by Make.com proxy.
 * Security: Strictly requires x-ingest-secret header matching INGEST_SECRET_KEY.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = (locals as any)?.runtime?.env || {};
  const serverConfig = getServerEnv(runtimeEnv);
  const expectedSecret = serverConfig.INGEST_SECRET_KEY;

  const providedSecret =
    request.headers.get('x-ingest-secret') ||
    request.headers.get('x-ingest-key') ||
    request.headers.get('x-make-secret');

  if (!providedSecret || providedSecret !== expectedSecret) {
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

  // Parse rate limit headers from incoming request if present
  const rawHeaders: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    if (key.startsWith('x-ratelimit') || key.startsWith('x-pinterest')) {
      rawHeaders[key] = value;
    }
  }

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

  if (!payload.workspace_id || !payload.connection_id) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Validation Error: workspace_id and connection_id are required in payload.',
      }),
      {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Merge headers into payload if not already provided
  if (!payload.raw_headers || Object.keys(payload.raw_headers).length === 0) {
    payload.raw_headers = rawHeaders;
  }

  try {
    const kvNamespace = (locals as any)?.runtime?.env?.ANALYTICS_KV;
    const result = await pinnerETL.processIngestionPayload(payload, kvNamespace);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[IngestAPI] Fatal ETL processing error:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Internal server error during ingestion processing.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
