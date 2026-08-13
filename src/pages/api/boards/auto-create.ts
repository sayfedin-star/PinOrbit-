export const prerender = false;
import type { APIRoute } from 'astro';
import { dbClients } from '../../../server/db/clients';
import { validateUserSession } from '../../../server/auth/session';
import { assertWorkspaceAccess } from '../../../server/auth/workspace-guard';

const json = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};
  const supabase = (locals as any).supabase;
  const session = await validateUserSession(supabase);
  if (!session.isAuthenticated || !session.user) return json({ success: false, error: 'Unauthorized' }, 401);

  let body: any = {};
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON body.' }, 400); }

  const accountId = String(body.account_id || '');
  const boardName = String(body.board_name || '').trim();
  if (!accountId || !boardName) return json({ success: false, error: 'account_id and board_name are required.' }, 422);

  const admin = dbClients.getSchedulingAdmin(runtimeEnv);
  const { data: account } = await admin.from('accounts').select('*').eq('id', accountId).maybeSingle();
  if (!account) return json({ success: false, error: 'Account not found.' }, 404);
  await assertWorkspaceAccess(supabase, account.workspace_id, session.user.id);

  const { error: upsertError } = await admin.from('board_provisioning_requests')
    .upsert({
      workspace_id: account.workspace_id,
      account_id: accountId,
      board_name: boardName,
      idempotency_key: `board.create:${accountId}:${boardName.toLowerCase()}`,
      status: 'provisioning',
      webhook_id: body.webhook_id || null,
    }, { onConflict: 'idempotency_key' });
  if (upsertError) return json({ success: false, error: `Failed to create provisioning request: ${upsertError.message}` }, 500);

  const { data: hooks } = await admin.from('account_webhooks').select('*').eq('account_id', accountId).eq('is_active', true).order('priority', { ascending: true });
  const hook = (hooks || []).find((h: any) => h.id === body.webhook_id) || (hooks || []).find((h: any) => h.is_primary) || (hooks || [])[0];
  if (!hook?.webhook_url) return json({ success: false, error: 'No active webhook channel configured.' }, 409);

  await fetch(hook.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      event: 'board.create',
      idempotency_key: `board.create:${accountId}:${boardName.toLowerCase()}`,
      account_id: accountId,
      workspace_id: account.workspace_id,
      board_name: boardName,
      webhook_id: hook.id,
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});

  return json({ success: true, queued: true, status: 'provisioning', idempotency_key: `board.create:${accountId}:${boardName.toLowerCase()}` });
};
