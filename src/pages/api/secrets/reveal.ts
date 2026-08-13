export const prerender = false;

import type { APIRoute } from 'astro';
import { validateUserSession } from '../../../server/auth/session';
import { dbClients, isKnownDefaultIngestSecret, isProductionEnv } from '../../../server/db/clients';
import { getEffectiveSecret } from '../../../server/services/webhook-secrets';

/**
 * Admin-only endpoint to reveal the full ingest secret.
 * Requires admin role and returns the unmasked secret.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};
  const workspaceId = locals.activeWorkspaceId;

  // Require authenticated admin user
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  // Check admin role - SECRET_REVEAL requires admin
  const userRole = (user as any).role;
  if (userRole !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden: admin role required to reveal secrets' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  if (!workspaceId) {
    return new Response(JSON.stringify({ error: 'Active workspace not found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const effective = await getEffectiveSecret(workspaceId, runtimeEnv);
    
    // In production, reject if using default/known secret
    if (isProductionEnv(runtimeEnv) && effective.source === 'env' && isKnownDefaultIngestSecret(effective.value)) {
      return new Response(JSON.stringify({ error: 'Service unavailable: ingest secret not configured on server.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ secret: effective.value, source: effective.source }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to reveal secret' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
