export const prerender = false;
import type { APIRoute } from 'astro';
import { dbClients } from '../../../server/db/clients';
import { validateUserSession } from '../../../server/auth/session';
import { assertWorkspaceAccess } from '../../../server/auth/workspace-guard';
import { triggerBoardAction } from '../../../server/services/fastcron-service';

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
  const { data: account } = await admin.from('accounts').select('id, workspace_id').eq('id', accountId).maybeSingle();
  if (!account) return json({ success: false, error: 'Account not found.' }, 404);
  await assertWorkspaceAccess(supabase, account.workspace_id, session.user.id);

  const result = await triggerBoardAction(
    accountId,
    'create',
    {
      board_name: boardName,
      webhook_id: body.webhook_id || null,
      workspace_id: account.workspace_id,
      idempotency_key: `create:${accountId}:${boardName.toLowerCase()}`,
    },
    runtimeEnv
  );

  return json(result, result.success ? 200 : (result.status || 500));
};
