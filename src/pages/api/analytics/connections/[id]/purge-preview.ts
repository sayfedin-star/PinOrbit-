export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../../../server/auth/workspace-guard';
import { analyticsDb } from '../../../../../server/db/analytics';
import type { PurgeTarget } from '../../../../../lib/types';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TARGETS = new Set<PurgeTarget>(['daily', 'top_pins']);

export const GET: APIRoute = async ({ params, request, locals }) => {
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
        JSON.stringify({ success: false, error: 'Forbidden: only workspace owners and admins can preview or purge data.' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const url = new URL(request.url);
    const from = url.searchParams.get('from') || url.searchParams.get('from_date');
    const to = url.searchParams.get('to') || url.searchParams.get('to_date');
    const rawTargets = url.searchParams.get('targets') || url.searchParams.get('targets[]');

    if (!from || !DATE_REGEX.test(from)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid from date format. Expected YYYY-MM-DD.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!to || !DATE_REGEX.test(to)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid to date format. Expected YYYY-MM-DD.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T00:00:00Z`);
    const today = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00Z');

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid date values provided.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (fromDate > toDate) {
      return new Response(
        JSON.stringify({ success: false, error: 'from date cannot be after to date.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (toDate > today) {
      return new Response(
        JSON.stringify({ success: false, error: 'to date cannot be in the future.' }),
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

    if (!rawTargets) {
      return new Response(
        JSON.stringify({ success: false, error: 'targets parameter is required.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const targetList = rawTargets.split(',').map((t) => t.trim().toLowerCase()) as PurgeTarget[];
    const validTargetList = targetList.filter((t) => VALID_TARGETS.has(t));

    if (validTargetList.length === 0 || validTargetList.length !== targetList.length) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'targets must be a non-empty subset of: daily, top_pins.',
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const preview = await analyticsDb.previewPurge(
      workspaceId,
      connectionId,
      from,
      to,
      validTargetList
    );

    return new Response(
      JSON.stringify({
        success: true,
        preview,
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
        error: err.message || 'Failed to preview purge.',
      }),
      {
        status: isAuth ? 403 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
