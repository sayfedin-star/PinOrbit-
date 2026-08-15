import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

// ─── Cryptographic Decryption ───────────────────────────────────────────────
export async function decryptCookieValue(stored, kek) {
  if (!stored || typeof stored !== 'string') return null;
  if (!stored.startsWith('v1:')) return stored; // Backward compatibility with raw cookies

  const parts = stored.split(':');
  if (parts.length !== 3) return null;
  const [, ivB64, ctB64] = parts;

  try {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const rawKey = await crypto.subtle.digest('SHA-256', enc.encode(kek));
    const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);

    const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct);
    return dec.decode(decrypted);
  } catch (err) {
    console.error('❌ Cookie decryption failed:', err.message);
    return null;
  }
}

// ─── Network Resiliency & Headers ───────────────────────────────────────────
export function getPinterestHeaders(username, cookie) {
  return {
    accept: 'application/json, text/javascript, */*, q=0.01',
    'accept-language': 'en-US,en;q=0.9',
    priority: 'u=1, i',
    'sec-ch-ua': '"Not=A?Brand";v="99", "Chromium";v="130"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'x-app-version': '9302641',
    'x-pinterest-appstate': 'background',
    'x-pinterest-pws-handler': 'www/[username].js',
    'x-pinterest-source-url': `/${username}/`,
    'x-requested-with': 'XMLHttpRequest',
    Referer: `https://www.pinterest.com/${username}/`,
    cookie: cookie || '',
  };
}

export async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt === maxRetries) return res;
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.warn(`⚠️ HTTP ${res.status} received. Retrying in ${Math.round(delay)}ms (Attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
        continue;
      }

      return res;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      console.warn(`⚠️ Network fetch error: ${err.message}. Retrying in ${Math.round(delay)}ms (Attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

// ─── Active Cookie Picker ───────────────────────────────────────────────────
export async function pickActiveCookie(db, wsId, kek) {
  let query = db
    .from('pinterest_cookies')
    .select('id, cookie_value, last_used_at')
    .eq('is_active', true)
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .limit(5);

  if (wsId) {
    query = query.eq('workspace_id', wsId);
  }

  const { data: candidates, error } = await query;

  if (!error && candidates && candidates.length > 0) {
    // Pick random among least recently used candidates
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const decrypted = await decryptCookieValue(chosen.cookie_value, kek);

    if (decrypted) {
      // Update last_used_at timestamp
      await db
        .from('pinterest_cookies')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', chosen.id);
      return decrypted;
    }
  }

  // Fallback to environment variable if configured
  if (process.env.PINTEREST_COOKIE) {
    console.log('ℹ️ Using fallback PINTEREST_COOKIE environment variable');
    return process.env.PINTEREST_COOKIE;
  }

  return null;
}

// ─── Pinterest Ingestion Handlers ───────────────────────────────────────────
export async function fetchProfile(username, cookie, maxRetries = 3) {
  const userUrl = `https://www.pinterest.com/resource/UserResource/get/?source_url=%2F${username}%2F&data=${encodeURIComponent(
    JSON.stringify({ options: { username, field_set_key: 'profile' }, context: {} })
  )}&_=${Date.now()}`;

  const res = await fetchWithRetry(userUrl, { method: 'GET', headers: getPinterestHeaders(username, cookie) }, maxRetries);
  if (!res.ok) {
    throw new Error(`UserResource HTTP ${res.status}`);
  }

  const payload = await res.json();
  const userData = payload?.resource_response?.data;
  if (!userData) {
    throw new Error('UserResource returned empty payload');
  }

  const profileViews = Number(userData.profile_views || userData.monthly_views || 0);
  const profileReach = Number(userData.profile_reach || userData.monthly_views || profileViews);
  const followerCount = Number(userData.follower_count || 0);
  const pinCount = Number(userData.pin_count || 0);
  const fullName = userData.full_name || username;
  const avatarUrl = userData.image_xlarge_url || userData.image_medium_url || null;
  const websiteUrl = userData.website_url || (userData.domain_url ? `https://${userData.domain_url}` : null);
  const domainVerified = Boolean(userData.domain_verified);
  const lastPinAt = userData.last_pin_save_time ? new Date(userData.last_pin_save_time).toISOString() : null;

  return {
    profileReach,
    profileViews,
    followerCount,
    pinCount,
    fullName,
    avatarUrl,
    websiteUrl,
    domainVerified,
    lastPinAt,
  };
}

export async function fetchBoards(username, cookie, maxRetries = 3) {
  const allBoards = [];
  let bookmark = null;
  let hasMore = true;
  let pageCount = 0;
  const maxPages = 20;

  while (hasMore && pageCount < maxPages) {
    pageCount++;
    const optionsPayload = {
      username,
      field_set_key: 'profile_grid_item',
      privacy_filter: 'all',
      sort: 'last_pinned_to',
      filter_stories: false,
      page_size: 50,
      group_by: 'visibility',
      include_archived: true,
      filter_all_pins: false,
    };

    if (bookmark) optionsPayload.bookmarks = [bookmark];

    const boardsUrl = `https://www.pinterest.com/resource/BoardsResource/get/?source_url=%2F${username}%2F&data=${encodeURIComponent(
      JSON.stringify({ options: optionsPayload, context: {} })
    )}&_=${Date.now()}`;

    const res = await fetchWithRetry(boardsUrl, { method: 'GET', headers: getPinterestHeaders(username, cookie) }, maxRetries);
    if (!res.ok) {
      console.warn(`⚠️ BoardsResource HTTP ${res.status} on page ${pageCount} for @${username}`);
      break;
    }

    const payload = await res.json();
    const resData = payload?.resource_response;
    const boardsList = resData?.data || [];
    const actualBoards = boardsList.filter((b) => b.type === 'board' || !b.type);
    allBoards.push(...actualBoards);

    const nextBookmark = resData?.bookmark;
    if (nextBookmark && nextBookmark !== '-end-' && boardsList.length > 0) {
      bookmark = nextBookmark;
    } else {
      hasMore = false;
    }
  }

  return allBoards;
}

export async function fetchTopPins(username, cookie, maxRetries = 3) {
  const allPins = [];
  let bookmark = null;
  let hasMore = true;
  let pageCount = 0;
  const maxPages = 10;

  while (hasMore && pageCount < maxPages) {
    pageCount++;
    const optionsPayload = {
      username,
      field_set_key: 'detailed',
      page_size: 25,
    };

    if (bookmark) optionsPayload.bookmarks = [bookmark];

    const pinsUrl = `https://www.pinterest.com/resource/UserPinsResource/get/?source_url=%2F${username}%2F&data=${encodeURIComponent(
      JSON.stringify({ options: optionsPayload, context: {} })
    )}&_=${Date.now()}`;

    try {
      const res = await fetchWithRetry(pinsUrl, { method: 'GET', headers: getPinterestHeaders(username, cookie) }, maxRetries);
      if (!res.ok) break;

      const payload = await res.json();
      const resData = payload?.resource_response;
      const pinsList = resData?.data || [];
      allPins.push(...pinsList);

      const nextBookmark = resData?.bookmark;
      if (nextBookmark && nextBookmark !== '-end-' && pinsList.length > 0) {
        bookmark = nextBookmark;
      } else {
        hasMore = false;
      }
    } catch {
      break;
    }
  }

  return allPins;
}

// ─── Main Execution Contract ────────────────────────────────────────────────
async function main() {
  // Step 1: Validate Mandatory Environment Variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tokenKek = process.env.TOKEN_KEK;

  if (!supabaseUrl || !serviceRoleKey || !tokenKek) {
    console.error('❌ FATAL: Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or TOKEN_KEK.');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Step 2: Read Pipeline Settings Singleton
  const { data: pipe } = await db.from('competitor_pipeline_settings').select('*').limit(1).maybeSingle();

  if (!pipe) {
    console.log('⚠️ No competitor_pipeline_settings row found — continuing with defaults (is_enabled=true, dry_run=false, max_retries=3)');
  }

  const isEnabled = pipe ? Boolean(pipe.is_enabled) : true;
  const forceRun = Boolean(process.env.FORCE_RUN && process.env.FORCE_RUN !== 'false');

  if (!isEnabled && !forceRun) {
    console.log('⏸️ Pipeline disabled. Ingestion skipped cleanly.');
    process.exit(0);
  }

  const wsId = process.env.WORKSPACE_ID || pipe?.workspace_id || null;
  const DRY_RUN = Boolean(process.env.DRY_RUN && process.env.DRY_RUN !== 'false') || Boolean(pipe?.dry_run);
  const MAX_RETRIES = pipe?.max_retries || 3;

  console.log(`🚀 Starting Ingestion: wsId=${wsId || 'global'}, DRY_RUN=${DRY_RUN}, MAX_RETRIES=${MAX_RETRIES}`);

  // Step 3: Job Adoption
  let jobId = process.env.JOB_ID || null;
  if (jobId) {
    await db
      .from('competitor_ingestion_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', jobId);
  } else {
    const { data: newJob } = await db
      .from('competitor_ingestion_jobs')
      .insert({
        workspace_id: wsId,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    jobId = newJob?.id || null;
  }

  // Step 4: Cookie Selection & Rotation
  const activeCookie = await pickActiveCookie(db, wsId, tokenKek);
  if (!activeCookie) {
    console.error('❌ No Pinterest cookie available in vault or environment.');
    if (jobId) {
      await db
        .from('competitor_ingestion_jobs')
        .update({
          status: 'failed',
          error_message: 'No Pinterest cookie available',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    }
    process.exit(1);
  }

  // Step 5: Build Competitor Query
  let compQuery = db.from('competitors').select('id, workspace_id, username');
  if (wsId) compQuery = compQuery.eq('workspace_id', wsId);

  const targetUsername = process.env.TARGET_USERNAME?.trim();
  if (targetUsername) {
    compQuery = compQuery.ilike('username', targetUsername);
  } else {
    compQuery = compQuery.eq('is_active', true);
  }

  const { data: competitors, error: fetchErr } = await compQuery;
  if (fetchErr || !competitors) {
    console.error('❌ Failed to fetch competitors:', fetchErr?.message);
    if (jobId) {
      await db
        .from('competitor_ingestion_jobs')
        .update({
          status: 'failed',
          error_message: fetchErr?.message || 'Failed to fetch competitors',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    }
    process.exit(1);
  }

  console.log(`📋 Found ${competitors.length} competitor(s) to process.`);

  // Step 6: Ingestion Loop
  let successCount = 0;
  const errors = [];
  const nowIso = new Date().toISOString();
  const todayDate = nowIso.slice(0, 10);

  for (const comp of competitors) {
    const u = comp.username.trim();
    console.log(`\n🔍 Processing @${u}...`);

    try {
      // Fetch Profile, Boards, and Top Pins
      const profile = await fetchProfile(u, activeCookie, MAX_RETRIES);
      const boards = await fetchBoards(u, activeCookie, MAX_RETRIES);
      const pins = await fetchTopPins(u, activeCookie, MAX_RETRIES);

      if (!DRY_RUN) {
        // 1. Update Competitor Profile
        await db
          .from('competitors')
          .update({
            profile_reach: profile.profileReach,
            profile_views: profile.profileViews,
            follower_count: profile.followerCount,
            pin_count: profile.pinCount,
            avatar_url: profile.avatarUrl,
            full_name: profile.fullName,
            website_url: profile.websiteUrl,
            domain_verified: profile.domainVerified,
            last_pin_at: profile.lastPinAt,
            last_checked_at: nowIso,
          })
          .eq('id', comp.id);

        // 2. Insert Snapshot (ONLY recorded_at, NO created_at)
        await db.from('competitor_snapshots').insert({
          competitor_id: comp.id,
          profile_reach: profile.profileReach,
          profile_views: profile.profileViews,
          follower_count: profile.followerCount,
          pin_count: profile.pinCount,
          recorded_at: nowIso,
        });

        // 3. Upsert Daily Snapshot
        await db.from('competitor_daily_snapshots').upsert(
          {
            competitor_id: comp.id,
            snapshot_date: todayDate,
            profile_reach: profile.profileReach,
            profile_views: profile.profileViews,
            follower_count: profile.followerCount,
            pin_count: profile.pinCount,
          },
          { onConflict: 'competitor_id, snapshot_date' }
        );

        // 4. Upsert Boards
        if (boards.length > 0) {
          const boardsToUpsert = boards.map((b) => ({
            competitor_id: comp.id,
            workspace_id: comp.workspace_id || wsId,
            board_id: String(b.id || b.node_id),
            name: b.name || 'Untitled Board',
            description: b.description || '',
            pin_count: Number(b.pin_count || 0),
            follower_count: Number(b.follower_count || 0),
            url: b.url ? (b.url.startsWith('http') ? b.url : `https://www.pinterest.com${b.url}`) : null,
            board_created_at: b.created_at ? new Date(b.created_at).toISOString() : nowIso,
            last_pinned_at: b.last_pinned_at ? new Date(b.last_pinned_at).toISOString() : nowIso,
            updated_at: nowIso,
          }));
          await db.from('competitor_boards').upsert(boardsToUpsert, { onConflict: 'competitor_id, board_id' });
        }

        // 5. Upsert Top Pins
        if (pins.length > 0) {
          const pinsToUpsert = pins.map((p) => ({
            competitor_id: comp.id,
            pin_id: String(p.id),
            title: p.title || p.grid_title || null,
            description: p.description || null,
            image_url: p.images?.orig?.url || p.images?.['736x']?.url || null,
            save_count: Number(p.aggregated_pin_data?.aggregated_stats?.saves || p.repin_count || 0),
            comment_count: Number(p.aggregated_pin_data?.aggregated_stats?.comments || p.comment_count || 0),
            link: p.link || null,
            captured_at: nowIso,
          }));
          await db.from('competitor_top_pins').upsert(pinsToUpsert, { onConflict: 'competitor_id, pin_id' });
        }

        // 6. Update Competitor Settings last_manual_update
        await db.from('competitor_settings').upsert(
          {
            competitor_id: comp.id,
            last_manual_update: nowIso,
            updated_at: nowIso,
          },
          { onConflict: 'competitor_id' }
        );

        console.log(`✅ @${u} synchronized successfully (reach=${profile.profileReach}, boards=${boards.length}, pins=${pins.length}).`);
      } else {
        console.log(`   [DRY-RUN] Would update @${u}: reach=${profile.profileReach}, views=${profile.profileViews}, boards=${boards.length}, pins=${pins.length}`);
      }

      successCount++;
    } catch (err) {
      console.error(`❌ Ingestion failed for @${u}:`, err.message);
      errors.push(`@${u}: ${err.message}`);
    }
  }

  // Step 7: Finalize Ingestion Job
  const isFailed = successCount === 0 && competitors.length > 0;
  const finalStatus = isFailed ? 'failed' : 'completed';

  if (jobId) {
    await db
      .from('competitor_ingestion_jobs')
      .update({
        status: finalStatus,
        items_processed: DRY_RUN ? 0 : successCount,
        error_message: errors.length > 0 ? errors.join(' | ').slice(0, 2000) : null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  }

  console.log(`\n🎉 Ingestion complete: ${successCount}/${competitors.length} profiles processed (status=${finalStatus}).`);

  // Step 8: Exit cleanly unless entire run failed
  process.exit(isFailed ? 1 : 0);
}

main();
