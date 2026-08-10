export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../../../server/auth/workspace-guard';
import { analyticsDb } from '../../../../../server/db/analytics';
import { edgeCache } from '../../../../../server/services/edge-cache';
import type { PurgeTarget } from '../../../../../lib/types';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TARGETS = new Set<PurgeTarget>(['daily', 'top_pins']);

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const connectionId = params.id;

  if (!user || !schedulingClient) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized: authentication required.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (!workspaceId || !connectionId) {
    return new Response(
      JSON.stringify({ success: false, error: 'workspace_id and connection_id are required.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const member = await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);
    if (!member.isAdmin && !member.isOwner) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Forbidden: only workspace owners and admins can execute data purge.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON request body.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { from_date, to_date, targets, confirm_name } = body || {};

    if (!from_date || !DATE_REGEX.test(from_date)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid from_date format. Expected YYYY-MM-DD.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!to_date || !DATE_REGEX.test(to_date)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid to_date format. Expected YYYY-MM-DD.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const fromDate = new Date(`${from_date}T00:00:00Z`);
    const toDate = new Date(`${to_date}T00:00:00Z`);
    const today = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00Z');

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid date values provided.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (fromDate > toDate) {
      return new Response(
        JSON.stringify({ success: false, error: 'from_date cannot be after to_date.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (toDate > today) {
      return new Response(
        JSON.stringify({ success: false, error: 'to_date cannot be in the future.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
    if (spanDays > 90) {
      return new Response(
        JSON.stringify({ success: false, error: 'Date range span cannot exceed 90 days.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!Array.isArray(targets) || targets.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'targets must be a non-empty array of: daily, top_pins.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const validTargets = targets.map((t: string) => String(t).trim().toLowerCase()) as PurgeTarget[];
    const isValidSubset = validTargets.every((t) => VALID_TARGETS.has(t));

    if (!isValidSubset) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'targets must only contain allowed values: daily, top_pins.',
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify connection exists and confirm_name strictly matches display_name
    const connection = await analyticsDb.getWorkspaceConnection(workspaceId, connectionId);
    if (!connection) {
      return new Response(
        JSON.stringify({ success: false, error: 'Connection not found in active workspace.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!confirm_name || confirm_name.trim() !== connection.display_name.trim()) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Confirmation name mismatch. Please type exactly "${connection.display_name}" to confirm permanent deletion.`,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Execute atomic data purge
    const result = await analyticsDb.purgeAnalyticsData(
      workspaceId,
      connectionId,
      from_date,
      to_date,
      validTargets,
      user.id
    );

    // Invalidate edge cache for this connection
    const runtimeKvNamespace = (locals as any)?.runtime?.env?.KV;
    await edgeCache.invalidateConnection(workspaceId, connectionId, runtimeKvNamespace);

    return new Response(
      JSON.stringify({
        success: true,
        purge_log_id: result.purge_log_id,
        counts: result.counts,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    const isAuth = err.message?.includes('Forbidden') || err.message?.includes('Unauthorized');
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Failed to execute data purge.',
      }),
      {
        status: isAuth ? 403 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
