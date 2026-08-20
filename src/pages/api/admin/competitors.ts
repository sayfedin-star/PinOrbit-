export const prerender = false;
import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../server/auth/workspace-guard';
import { dbClients } from '../../../server/db/clients';
import { errorStatus } from '../../../server/lib/http-error';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

async function guard(locals: any, explicitWs?: string, role: 'member' | 'admin' = 'admin') {
  const user = locals.user, schedulingClient = locals.supabase;
  if (!user || !schedulingClient) return { err: json({ error: 'Unauthorized: missing session' }, 401) };
  const workspaceId = explicitWs || locals.activeWorkspaceId;
  if (!workspaceId) return { err: json({ error: 'Unauthorized: missing workspace identifier' }, 401) };
  try {
    const wsCtx = await assertWorkspaceAccess(schedulingClient, workspaceId, user.id, role);
    return { ok: { ws: wsCtx.workspaceId, db: dbClients.getCompetitors(locals.runtime?.env) } };
  } catch (e: any) { return { err: json({ error: e.message || 'Forbidden' }, errorStatus(e)) }; }
}

// GET: list all (no id) OR detail with snapshots/boards (with id)
export const GET: APIRoute = async ({ request, locals }) => {
  const g = await guard(locals, undefined, 'member'); if (g.err) return g.err;
  const searchParams = new URL(request.url).searchParams;
  const id = searchParams.get('id');
  const lite = searchParams.get('lite');
  const boardsOnly = searchParams.get('boards_only');

  // Flags must be exactly "1" if present
  if (lite && lite !== '1') {
    return json({ success: false, error: 'Invalid lite flag value.' }, 400);
  }
  if (boardsOnly && boardsOnly !== '1') {
    return json({ success: false, error: 'Invalid boards_only flag value.' }, 400);
  }

  if (!id) {
    const { data, error } = await g.ok!.db.from('competitors').select('*')
      .eq('workspace_id', g.ok!.ws).order('created_at', { ascending: false });
    if (error) return json({ error: error.message }, 500);
    const comps = data || [];
    const ids = comps.map((c: any) => c.id);
    const countMap: Record<string, number> = {};
    if (ids.length) {
      const { data: bRows } = await g.ok!.db.from('competitor_boards')
        .select('competitor_id').in('competitor_id', ids);
      for (const b of (bRows || []) as any[]) countMap[b.competitor_id] = (countMap[b.competitor_id] || 0) + 1;
    }
    return json({ success: true, competitors: comps.map((c: any) => ({ ...c, boards_count: countMap[c.id] || 0 })) });
  }

  // Validate ID format before querying
  if (id && !UUID_REGEX.test(id)) {
    return json({ success: false, error: 'Invalid competitor ID format.' }, 400);
  }

  const db = g.ok!.db;

  if (boardsOnly === '1') {
    const boards = await db.from('competitor_boards').select('*').eq('competitor_id', id).order('pin_count', { ascending: false });
    return json({ success: true, boards: boards.data || [] });
  }

  const comp = await db.from('competitors').select('*').eq('id', id).eq('workspace_id', g.ok!.ws).maybeSingle();
  if (!comp.data) return json({ error: 'Not found in workspace' }, 404);

  if (lite === '1') {
    const [snaps, topPins] = await Promise.all([
      db.from('competitor_snapshots').select('*').eq('competitor_id', id).order('recorded_at', { ascending: true }),
      db.from('competitor_top_pins').select('*').eq('competitor_id', id).order('save_count', { ascending: false }).limit(10),
    ]);
    const snapsList = snaps.data || [];
    let deltas: any = null;
    if (snapsList.length >= 2) {
      const curr = snapsList[snapsList.length - 1];
      const prev = snapsList[snapsList.length - 2];
      const calc = (c: number, p: number) => ({
        change: c - p,
        percent: p > 0 ? Number((((c - p) / p) * 100).toFixed(1)) : 0,
      });
      deltas = {
        reachChange: calc(curr.profile_reach || 0, prev.profile_reach || 0).change,
        reachPercent: calc(curr.profile_reach || 0, prev.profile_reach || 0).percent,
        viewsChange: calc(curr.profile_views || 0, prev.profile_views || 0).change,
        viewsPercent: calc(curr.profile_views || 0, prev.profile_views || 0).percent,
        followersChange: calc(curr.follower_count || 0, prev.follower_count || 0).change,
        followersPercent: calc(curr.follower_count || 0, prev.follower_count || 0).percent,
        pinsChange: calc(curr.pin_count || 0, prev.pin_count || 0).change,
        pinsPercent: calc(curr.pin_count || 0, prev.pin_count || 0).percent,
      };
    }
    return json({ success: true, competitor: comp.data, snapshots: snapsList, boards: [], topPins: topPins.data || [], deltas });
  }

  const [snaps, boards, topPins] = await Promise.all([
    db.from('competitor_snapshots').select('*').eq('competitor_id', id).order('recorded_at', { ascending: true }),
    db.from('competitor_boards').select('*').eq('competitor_id', id).order('pin_count', { ascending: false }),
    db.from('competitor_top_pins').select('*').eq('competitor_id', id).order('save_count', { ascending: false }).limit(10),
  ]);
  const snapsList = snaps.data || [];
  let deltas: any = null;
  if (snapsList.length >= 2) {
    const curr = snapsList[snapsList.length - 1];
    const prev = snapsList[snapsList.length - 2];
    const calc = (c: number, p: number) => ({
      change: c - p,
      percent: p > 0 ? Number((((c - p) / p) * 100).toFixed(1)) : 0,
    });
    deltas = {
      reachChange: calc(curr.profile_reach || 0, prev.profile_reach || 0).change,
      reachPercent: calc(curr.profile_reach || 0, prev.profile_reach || 0).percent,
      viewsChange: calc(curr.profile_views || 0, prev.profile_views || 0).change,
      viewsPercent: calc(curr.profile_views || 0, prev.profile_views || 0).percent,
      followersChange: calc(curr.follower_count || 0, prev.follower_count || 0).change,
      followersPercent: calc(curr.follower_count || 0, prev.follower_count || 0).percent,
      pinsChange: calc(curr.pin_count || 0, prev.pin_count || 0).change,
      pinsPercent: calc(curr.pin_count || 0, prev.pin_count || 0).percent,
    };
  }
  return json({ success: true, competitor: comp.data, snapshots: snapsList, boards: boards.data || [], topPins: topPins.data || [], deltas });
};

// POST: add new competitor to Competitors DB
export const POST: APIRoute = async ({ request, locals }) => {
  let body: any = {}; try { body = JSON.parse(await request.text() || '{}'); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const g = await guard(locals, body.workspace_id); if (g.err) return g.err;
  const username = String(body.username || '').trim().replace(/^@/, '');
  if (!username) return json({ error: 'username required' }, 400);
  const { data, error } = await g.ok!.db.from('competitors').insert({
    workspace_id: g.ok!.ws, username,
    full_name: body.full_name || username,
    niche: body.niche || null, notes: body.notes || null,
    tags: Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
    account_type: body.account_type || 'competitor', is_active: true,
  }).select().single();
  return error ? json({ error: error.message }, 500) : json({ success: true, competitor: data }, 201);
};

// PATCH: update one competitor
export const PATCH: APIRoute = async ({ request, locals }) => {
  let body: any = {}; try { body = JSON.parse(await request.text() || '{}'); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const g = await guard(locals, body.workspace_id); if (g.err) return g.err;
  if (!body.id) return json({ error: 'id required' }, 400);
  if (!UUID_REGEX.test(body.id)) {
    return json({ success: false, error: 'Invalid competitor ID format.' }, 400);
  }
  const patch: any = {};
  if (body.full_name !== undefined) patch.full_name = body.full_name;
  if (body.username !== undefined) patch.username = String(body.username).replace(/^@/, '');
  if (body.niche !== undefined) patch.niche = body.niche;
  if (body.account_type !== undefined) patch.account_type = body.account_type;
  if (body.tags !== undefined) patch.tags = body.tags;
  if (body.notes !== undefined) patch.notes = body.notes;
  const { data, error } = await g.ok!.db.from('competitors').update(patch).eq('id', body.id).eq('workspace_id', g.ok!.ws).select().single();
  return error ? json({ error: error.message }, 500) : json({ success: true, competitor: data });
};

// DELETE
export const DELETE: APIRoute = async ({ request, locals }) => {
  let body: any = {}; try { body = JSON.parse(await request.text() || '{}'); } catch { /* ok */ }
  const g = await guard(locals, body.workspace_id); if (g.err) return g.err;
  if (!body.id) return json({ error: 'id required' }, 400);
  if (!UUID_REGEX.test(body.id)) {
    return json({ success: false, error: 'Invalid competitor ID format.' }, 400);
  }
  const { error } = await g.ok!.db.from('competitors').delete().eq('id', body.id).eq('workspace_id', g.ok!.ws);
  return error ? json({ error: error.message }, 500) : json({ success: true });
};

