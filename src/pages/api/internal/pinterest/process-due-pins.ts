export const prerender = false;
import type { APIRoute } from 'astro';
import { dbClients, hasSchedulingSecretKey, isKnownDefaultIngestSecret, isProductionEnv } from '../../../../server/db/clients';
import { getEffectiveSecret } from '../../../../server/services/webhook-secrets';

const json = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};
  let body: any = {};
  try { body = JSON.parse((await request.text()) || '{}'); } catch { return json({ success: false, error: 'Malformed JSON payload.' }, 400); }

  const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id : '';
  const perTick = Math.min(Number(body.batch) || 1, 10);

  const provided = request.headers.get('x-ingest-secret') || (typeof body.ingest_secret === 'string' ? body.ingest_secret : null);
  const expected = await getEffectiveSecret(workspaceId, runtimeEnv);
  if (isProductionEnv(runtimeEnv) && expected.source === 'env' && isKnownDefaultIngestSecret(expected.value)) return json({ success: false, error: 'Service unavailable: ingest secret not configured.' }, 503);
  if (!provided || !expected.value || provided !== expected.value) return json({ success: false, error: 'Unauthorized: invalid or missing ingest secret.' }, 401);
  if (!hasSchedulingSecretKey(runtimeEnv)) return json({ success: false, error: 'SCHEDULING_SUPABASE_SECRET_KEY not configured; dispatch disabled.' }, 503);

  const admin = dbClients.getSchedulingAdmin(runtimeEnv);

  // 1) Stale lock recovery
  const staleCut = new Date(Date.now() - 10 * 60000).toISOString();
  await admin.from('pins').update({ status: 'pending', processing_started_at: null, updated_at: new Date().toISOString() })
    .eq('status', 'processing').lt('processing_started_at', staleCut).then(() => {});

  // 2) Per active account: daily cap then atomic claim
  const { data: accounts } = await admin.from('accounts').select('*').eq('is_active', true);
  const list = (accounts || []).filter((a: any) => !workspaceId || a.workspace_id === workspaceId);
  const summary = { dispatched: 0, skipped_cap: 0, skipped_hook: 0, accounts: list.length };

  for (const acc of list) {
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const { count: postedToday } = await admin.from('pins').select('*', { count: 'exact', head: true })
      .eq('account_id', acc.id).eq('status', 'posted').gte('posted_at', todayStart.toISOString());
    if ((postedToday ?? 0) >= (acc.max_pins_per_day ?? 20)) { summary.skipped_cap++; continue; }

    const { data: claimed } = await admin.rpc('claim_due_pins_simple', { p_account_id: acc.id, p_limit: perTick });
    for (const c of claimed ?? []) {
      const { data: pin } = await admin.from('pins').select('*').eq('id', c.id).single();
      const { data: hooks } = await admin.from('account_webhooks').select('*').eq('account_id', acc.id).eq('is_active', true).order('priority', { ascending: true });
      const hook = (hooks || []).find((h: any) => (h.remaining_capacity ?? 0) > 0);
      if (!hook?.webhook_url) {
        await admin.from('pins').update({ status: 'pending', processing_started_at: null, next_retry_at: new Date(Date.now() + 5 * 60000).toISOString() }).eq('id', c.id);
        summary.skipped_hook++; continue;
      }
      await fetch(hook.webhook_url, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          event: 'pin.post', idempotency_key: `pin.post:${pin.id}:${pin.attempts}`,
          pin_id: pin.id, workspace_id: c.workspace_id, account_id: acc.id,
          title: pin.title, description: pin.description, image_url: pin.image_url, link: pin.link, board_name: pin.board_name,
        }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
      summary.dispatched++;
    }
  }
  return json({ success: true, ...summary });
};
