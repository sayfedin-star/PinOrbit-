// Node 22. Secrets: reuses EXISTING GitHub secrets only (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
// KEK: self-provisioned in DB table competitor_kek. Cookies: vault-only + ONE-TIME legacy auto-import.
// Workspaces: auto-discovered. Jobs: per-workspace daily jobs + queued-job adoption (poller).
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const enc = new TextEncoder(); const dec = new TextDecoder();
const b64 = b => btoa(String.fromCharCode(...(b instanceof Uint8Array ? b : new Uint8Array(b))));
const ub64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// ── AES-GCM (same format as token-crypto.ts: v1:iv:ct, key=SHA-256(kek)) ──
async function aesKey(kek, usage) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(kek));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);
}
export async function encryptCookieValue(plain, kek) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(kek, 'encrypt'), enc.encode(plain));
  return `v1:${b64(iv)}:${b64(ct)}`;
}
export async function decryptCookieValue(stored, kek) {
  if (!stored || typeof stored !== 'string') return null;
  if (!stored.startsWith('v1:')) return stored;
  const [, ivB64, ctB64] = stored.split(':');
  if (!ivB64 || !ctB64) return null;
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64(ivB64) }, await aesKey(kek, 'decrypt'), ub64(ctB64)));
  } catch { return null; }
}

// ── KEK: read-or-self-provision from DB ──
async function resolveKek(db) {
  const { data } = await db.from('competitor_kek').select('kek').limit(1).maybeSingle();
  if (data?.kek) return data.kek;
  const hex = crypto.randomBytes(32).toString('hex');
  await db.from('competitor_kek').upsert({ id: true, kek: hex }, { onConflict: 'id' });
  const { data: d2 } = await db.from('competitor_kek').select('kek').limit(1).maybeSingle();
  return d2?.kek || null;
}

export function getPinterestHeaders(u, cookie) {
  return {
    accept: 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'en-US,en;q=0.9',
    'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin',
    'x-requested-with': 'XMLHttpRequest',
    referer: `https://www.pinterest.com/${u}/`,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    cookie: cookie || '',
  };
}

export async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let attempt = 0;
  for (;;) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt >= maxRetries) return res;
        await new Promise(r => setTimeout(r, 2 ** attempt * 1000 + Math.random() * 500)); attempt++; continue;
      }
      return res;
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      await new Promise(r => setTimeout(r, 2 ** attempt * 500)); attempt++;
    }
  }
}

const resourceUrl = (u, res, options) =>
  `https://www.pinterest.com/resource/${res}/get/?source_url=%2F${u}%2F&data=${encodeURIComponent(JSON.stringify({ options, context: {} }))}&_=${Date.now()}`;

export async function fetchProfile(u, cookie, mr) {
  const res = await fetchWithRetry(resourceUrl(u, 'UserResource', { username: u, field_set_key: 'profile' }), { headers: getPinterestHeaders(u, cookie) }, mr);
  if (!res.ok) throw new Error(`UserResource HTTP ${res.status}`);
  const d = (await res.json())?.resource_response?.data;
  if (!d) throw new Error('UserResource empty payload');
  return {
    reach: Number(d.profile_reach || d.monthly_views || 0),
    views: Number(d.profile_views || d.monthly_views || 0),
    followers: Number(d.follower_count || 0),
    pins: Number(d.pin_count || 0),
    fullName: d.full_name || u,
    avatar: d.image_xlarge_url || d.image_medium_url || null,
    website: d.website_url || (d.domain_url ? `https://${d.domain_url}` : null),
    domainVerified: Boolean(d.domain_verified),
    lastPinAt: d.last_pin_save_time ? new Date(d.last_pin_save_time).toISOString() : null,
  };
}

export async function fetchBoards(u, cookie, mr) {
  const out = []; let bookmark = null, pages = 0;
  while (pages < 20) {
    pages++;
    const opts = { username: u, field_set_key: 'profile_grid_item', privacy_filter: 'all', sort: 'last_pinned_to', filter_stories: false, page_size: 50, include_archived: true };
    if (bookmark) opts.bookmarks = [bookmark];
    const res = await fetchWithRetry(resourceUrl(u, 'BoardsResource', opts), { headers: getPinterestHeaders(u, cookie) }, mr);
    if (!res.ok) break;
    const rd = (await res.json())?.resource_response;
    const list = rd?.data || [];
    out.push(...list.filter(b => b.type === 'board' || !b.type));
    if (rd?.bookmark && rd.bookmark !== '-end-' && list.length) bookmark = rd.bookmark; else break;
  }
  return out;
}

export async function fetchTopPins(u, cookie, mr) {
  const out = []; let bookmark = null, pages = 0;
  while (pages < 10) {
    pages++;
    const opts = { username: u, field_set_key: 'detailed', page_size: 25 };
    if (bookmark) opts.bookmarks = [bookmark];
    try {
      const res = await fetchWithRetry(resourceUrl(u, 'UserPinsResource', opts), { headers: getPinterestHeaders(u, cookie) }, mr);
      if (!res.ok) break;
      const rd = (await res.json())?.resource_response;
      const list = rd?.data || [];
      out.push(...list.filter(p => p?.id));
      if (rd?.bookmark && rd.bookmark !== '-end-' && list.length) bookmark = rd.bookmark; else break;
    } catch { break; }
  }
  return out;
}

// ── Vault cookie per workspace + ONE-TIME legacy auto-import ──
async function getWorkspaceCookie(db, wsId, kek) {
  const { data } = await db.from('pinterest_cookies').select('id, cookie_value')
    .eq('workspace_id', wsId).eq('is_active', true)
    .order('last_used_at', { ascending: true, nullsFirst: true }).limit(5);
  for (const c of data || []) {
    const plain = await decryptCookieValue(c.cookie_value, kek);
    if (plain) {
      await db.from('pinterest_cookies').update({ last_used_at: new Date().toISOString() }).eq('id', c.id);
      return plain;
    }
  }
  // ONE-TIME migration: vault empty + legacy env present → encrypt & store, then use.
  const legacy = process.env.PINTEREST_COOKIE;
  if (legacy && legacy.trim().length >= 20) {
    const encrypted = await encryptCookieValue(legacy.trim(), kek);
    await db.from('pinterest_cookies').insert({ workspace_id: wsId, cookie_value: encrypted, is_active: true });
    console.log(`🔐 Legacy PINTEREST_COOKIE auto-imported into vault for ws ${wsId}. You may now delete that GitHub secret.`);
    return legacy.trim();
  }
  return null;
}

async function processWorkspace(db, wsId, opts) {
  const { kek, dryRun, maxRetries, now, today, targetCompetitorId, targetUsername } = opts;
  const cookie = await getWorkspaceCookie(db, wsId, kek);
  if (!cookie) {
    return { ok: false, error: 'No Pinterest cookie available in vault for this workspace' };
  }

  let q = db.from('competitors').select('id, workspace_id, username').eq('workspace_id', wsId);
  if (targetUsername) q = q.ilike('username', targetUsername);
  else if (targetCompetitorId) q = q.eq('id', targetCompetitorId);
  else q = q.eq('is_active', true);
  const { data: comps, error } = await q;
  if (error || !comps) return { ok: false, error: error?.message || 'fetch failed' };
  if (comps.length === 0) return { ok: true, processed: 0, errors: [], total: 0 };

  const errors = []; let success = 0;
  for (const c of comps) {
    const u = c.username.trim();
    console.log(`\n🔍 [${wsId.slice(0, 8)}] @${u}`);
    try {
      const p = await fetchProfile(u, cookie, maxRetries);
      const boards = await fetchBoards(u, cookie, maxRetries);
      const pins = await fetchTopPins(u, cookie, maxRetries);
      if (!dryRun) {
        await db.from('competitors').update({
          profile_reach: p.reach, profile_views: p.views, follower_count: p.followers, pin_count: p.pins,
          full_name: p.fullName, avatar_url: p.avatar, website_url: p.website,
          domain_verified: p.domainVerified, last_pin_at: p.lastPinAt, last_checked_at: now,
        }).eq('id', c.id);
        await db.from('competitor_snapshots').insert({ competitor_id: c.id, profile_reach: p.reach, profile_views: p.views, follower_count: p.followers, pin_count: p.pins, recorded_at: now });
        await db.from('competitor_daily_snapshots').upsert({ competitor_id: c.id, snapshot_date: today, profile_reach: p.reach, profile_views: p.views, follower_count: p.followers, pin_count: p.pins }, { onConflict: 'competitor_id,snapshot_date' });
        if (boards.length) await db.from('competitor_boards').upsert(boards.map(b => ({
          competitor_id: c.id, workspace_id: c.workspace_id, board_id: String(b.id || b.node_id),
          name: b.name || 'Untitled', description: b.description || '',
          pin_count: Number(b.pin_count || 0), follower_count: Number(b.follower_count || 0),
          url: b.url?.startsWith('http') ? b.url : (b.url ? `https://www.pinterest.com${b.url}` : null),
          board_created_at: b.created_at ? new Date(b.created_at).toISOString() : null,
          last_pinned_at: b.board_order_modified_at ? new Date(b.board_order_modified_at).toISOString() : null,
          updated_at: now,
        })), { onConflict: 'competitor_id,board_id' });
        if (pins.length) await db.from('competitor_top_pins').upsert(pins.slice(0, 10).map(pn => ({
          competitor_id: c.id, pin_id: String(pn.id), title: pn.title || pn.grid_title || null,
          description: pn.description || null,
          image_url: pn.images?.orig?.url || pn.images?.['736x']?.url || null,
          save_count: Number(pn.aggregated_pin_data?.aggregated_stats?.saves || pn.repin_count || 0),
          comment_count: Number(pn.aggregated_pin_data?.aggregated_stats?.comments || pn.comment_count || 0),
          link: pn.link || null, captured_at: now,
        })), { onConflict: 'competitor_id,pin_id' });
      } else {
        console.log(`   [DRY-RUN] would write reach=${p.reach} boards=${boards.length} pins=${pins.length}`);
      }
      success++;
    } catch (e) { console.error(`   ❌ ${e.message}`); errors.push(`@${u}: ${e.message}`); }
  }
  return { ok: true, processed: success, errors, total: comps.length };
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) { console.error('❌ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const kek = await resolveKek(db);
  if (!kek) { console.error('❌ KEK unavailable'); process.exit(1); }

  const pipe = (await db.from('competitor_pipeline_settings').select('*').limit(1).maybeSingle()).data;
  if (pipe && pipe.is_enabled === false && !process.env.FORCE_RUN) { console.log('⏸️ Pipeline disabled from dashboard.'); process.exit(0); }
  const DRY_RUN = process.env.DRY_RUN === 'true' || pipe?.dry_run === true;
  const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || String(pipe?.max_retries ?? 3), 10);
  const now = new Date().toISOString(); const today = now.slice(0, 10);
  const targetUsername = process.env.TARGET_USERNAME?.trim() || null;

  // ── Mode A: adopt queued job (poller / dashboard button) ──
  if (process.env.POLL_QUEUED === 'true' && !process.env.JOB_ID) {
    const { data: q } = await db.from('competitor_ingestion_jobs')
      .select('id, competitor_id, workspace_id').eq('status', 'queued')
      .order('created_at', { ascending: true }).limit(1);
    if (!q || q.length === 0) { console.log('🕐 No queued jobs.'); process.exit(0); }
    const job = q[0];
    await db.from('competitor_ingestion_jobs').update({ status: 'running', started_at: now }).eq('id', job.id);
    const r = await processWorkspace(db, job.workspace_id, { kek, dryRun: DRY_RUN, maxRetries: MAX_RETRIES, now, today, targetCompetitorId: job.competitor_id, targetUsername });
    await db.from('competitor_ingestion_jobs').update({
      status: !r.ok || (r.total > 0 && r.processed === 0) ? 'failed' : 'completed',
      items_processed: DRY_RUN ? 0 : (r.processed || 0),
      error_message: r.ok ? (r.errors.length ? r.errors.join(' | ').slice(0, 2000) : null) : r.error,
      completed_at: new Date().toISOString(),
    }).eq('id', job.id);
    process.exit(!r.ok ? 1 : 0);
  }

  // ── Mode B: daily / manual full run across all active workspaces ──
  const { data: wsRows } = await db.from('competitors').select('workspace_id').eq('is_active', true);
  const workspaces = [...new Set((wsRows || []).map(r => r.workspace_id))];
  console.log(`🚀 Full run: ${workspaces.length} workspace(s) | DRY_RUN=${DRY_RUN}`);

  let anyFatal = false; let grandProcessed = 0;
  for (const wsId of workspaces) {
    const { data: job } = await db.from('competitor_ingestion_jobs')
      .insert({ workspace_id: wsId, status: 'running', started_at: now }).select('id').single();
    const r = await processWorkspace(db, wsId, { kek, dryRun: DRY_RUN, maxRetries: MAX_RETRIES, now, today, targetCompetitorId: null, targetUsername });
    if (job) await db.from('competitor_ingestion_jobs').update({
      status: !r.ok || (r.total > 0 && r.processed === 0) ? 'failed' : 'completed',
      items_processed: DRY_RUN ? 0 : (r.processed || 0),
      error_message: r.ok ? (r.errors.length ? r.errors.join(' | ').slice(0, 2000) : null) : r.error,
      completed_at: new Date().toISOString(),
    }).eq('id', job.id);
    if (!r.ok) { anyFatal = true; console.error(`❌ ws ${wsId}: ${r.error}`); }
    grandProcessed += r.processed || 0;
  }
  console.log(`\n🎉 Full run done: ${grandProcessed} profile(s) across ${workspaces.length} workspace(s).`);
  process.exit(anyFatal && grandProcessed === 0 ? 1 : 0);
}

main().catch(e => { console.error('💥 Fatal:', e); process.exit(1); });
