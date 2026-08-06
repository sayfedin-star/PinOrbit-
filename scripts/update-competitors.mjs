import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const envCookie = process.env.PINTEREST_COOKIE;

// Verified fallback session cookie string
const fallbackCookie = `csrftoken=56115a2c9a45b1d88820c8694d8e9749; _auth=1; _b="AZIjb8mUzExO7odi8GroQfERd6ePiINUd4NbaKyFFe+fIsraTk0FIs5aqR4ApYlHvX0="; ar_debug=1; ar_debug=1; _pinterest_sess=TWc9PSZvT09YWnUrRjM5VFM1TUFsRmZVTkpuT2I2SEFhWkgrcVlNeG5hc3NadVRCNWt6UDRnSDJDVCtqY0xJelV0c3ljejVEVUQ3V202ZllzVXlDODVxdjdxNHl2dkF1ZkJSSE1sUzd6eUdMQnpQTDltRit6UjRKVUpIVEVzc2pxbVRhQ1UwZTBFYlkrTDA5aDBodTE3Nkt1SmwxZzRyd21ub21kNzhLT1BMUWlaMm1WcGhMVG9uNzBrdUZibnZOand4L1BxeURUNnVFY05xbVVTOVAyb2xTSTBWWmJVVFIrU0N4RjNqelRocmZxRDlBRkJYakRTcWo2WFRzdnhTcmE3Nlo4K3ZrREJvRVdic0hQQm8yVlFTbjkrMlVkRUNLRjFUd0ViZTJOQTZJaHNyMm1vLzhBUVRKS3lrN0xKRllyV0FpRkF6QVlBTDlydzBwS2Y2MTJEVWVEQlZlaXlCZ0h1R0kwcVRWb1BRblNaRXgrNithdkhpbGVpYVhBeVdhVDdhL05hTkdXL3ZHcUZBekk3b0hYWmVaQldKd25TZzR5a3UyY0JXMnhMN1YxSlJNanNIeEpTRTVrSVo4bm5OODFrQlZqTDlxeW1xRGU3QTBwWVMrV2dsRGJweTB1dWsvL1NWdUdXOWg5UDJ2NEorZXByN2p0SmQ0aUFINFlxV2hna2NhdTU1a05Kd0RrMWJoeHNpVlVjaExZaXI2QjB1U3Ixa0trd2xCRGFsYlA4dXJmYmY4aVEzZGZVVVNPWVBFbEhhMGUycTlKQVNUMUVCbmpkaDdXQi9KT0hjbU5YYUJ1NWVJeG92dXRmR1BMR2ZyL2ZUdWllQ2VyVDJVOVU2KzdnM0ROU01DcEJBTHBhL09nMGRHR3hINzdkYUhUbW1ya0MybWRxYmRHTDh1dEMxVzNaeXgzV3A4NGxqSUc0cHZIcDBzbW1vNk9PekhhVTlSOG1yTkQ4eVkxMXpremtDRHlVM0JtUnBIbi85dmo1WktObDBYcHFNWDBPUkh5NjJrZmZVcTBuTytPQXg0RzJRVGlGODAzUXdJeGpnVjF5YUJYeEEyR3k0MitNKzVQdWM4K0s1ZS90ZW51aERrRTVPQmNmQys0NWpvVVJhM212TG1zMFpWV0E3Z3cyZ3g5SU95SVRqSnAvQk5oTU5SNmJheWRYMnl4Qy9NSVNLMjBWWXRPSFFKUGFRd0tVYWdUTUNhcG5ocWQwNzkyZjRqZkpXd2JRTVhLYmJ0R1hMZDZhZStiNWduYWc0aFJXaG1kTkpQc2ExVGJWN2FhUm5tSXUrRjZrYTg5eDFLdlpGdkhseXNPTktTd3dMQjJvRjIrVWMxaTVSaWpiMjg4cldXeUhJSmZYVEtmWEFqZFhsNnVuVmJvSGgyYm0vdnVaSjZWVHB1SkV1bFNsMXMvTkEyQVhCMW1CTUoyWUpRMkpVYldwb0hYeFMycjQrck1ZTGFQRWlLRnBBc0QxdWNDcjI3WnF6S29ZYVhNVU03c1B6ZlVmYkxUSW9kbC82Zlh2Ukh6L2dDdzBmQVZrSVN0NVptdzhkblJBa2N0UzE3YU81ejlwR29WRnNOZkhLQlNXay9uMFIrcUhuakZ1elJDblFMZU52MjlYZ1diblZvQmJ4ZTdPWGNFU202NTRlb3Z3Qi9ScmVWUWVFV1h0NDJsRHV4aWpncng5V3ZlOXhLaFRvMXRheWZrWEk5Y0JBOWNkK3d2WlF0L2d3NitEVVYyT01qRWJZZkNuTXp5TWJkeE5PQllvbzdpM211TllZdytVTEkxVlNCVE1jcHkmR0FNTlc0R1V0aTBFSGNsRmFHT2FpYkU2TG93PQ==`;

const activeCookie = envCookie || fallbackCookie;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

const getHeaders = (username) => ({
  "accept": "application/json, text/javascript, */*, q=0.01",
  "accept-language": "en-GB,en-US;q=0.9,en;q=0.8,fr;q=0.7,ar;q=0.6,de;q=0.5",
  "priority": "u=1, i",
  "screen-dpr": "1.25",
  "sec-ch-ua": "\"Not=A?Brand\";v=\"99\", \"Google Chrome\";v=\"151\", \"Chromium\";v=\"151\"",
  "sec-ch-ua-full-version-list": "\"Not=A?Brand\";v=\"99.0.0.0\", \"Google Chrome\";v=\"151.0.7922.76\", \"Chromium\";v=\"151.0.7922.76\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-model": "\"\"",
  "sec-ch-ua-platform": "\"Windows\"",
  "sec-ch-ua-platform-version": "\"19.0.0\"",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "x-app-version": "9302641",
  "x-b3-flags": "0",
  "x-pinterest-appstate": "background",
  "x-pinterest-pws-handler": "www/[username].js",
  "x-pinterest-source-url": `/${username}/`,
  "x-requested-with": "XMLHttpRequest",
  "Referer": `https://www.pinterest.com/${username}/`,
  "cookie": activeCookie
});

async function updateCompetitors() {
  console.log('🚀 Starting robust Pinterest competitor metrics & boards ingestion...');

  const { data: competitors, error: fetchError } = await supabase
    .from('competitors')
    .select('id, username');

  if (fetchError || !competitors) {
    console.error('❌ Failed to fetch competitors from Supabase:', fetchError);
    process.exit(1);
  }

  console.log(`📋 Found ${competitors.length} competitor(s) to process.`);

  for (const comp of competitors) {
    const username = comp.username.trim();
    console.log(`\n--------------------------------------------------`);
    console.log(`🔍 Processing Competitor: @${username}`);

    const now = new Date().toISOString();

    // =========================================================================
    // STEP 1: Fetch Profile UserResource Metrics
    // =========================================================================
    const userUrl = `https://www.pinterest.com/resource/UserResource/get/?source_url=%2F${username}%2F&data=%7B%22options%22%3A%7B%22username%22%3A%22${username}%22%2C%22field_set_key%22%3A%22profile%22%7D%2C%22context%22%3A%7B%7D%7D&_=${Date.now()}`;

    try {
      const userRes = await fetch(userUrl, { method: "GET", headers: getHeaders(username) });

      if (!userRes.ok) {
        console.warn(`⚠️ UserResource HTTP ${userRes.status} for @${username}. Skipping profile update.`);
      } else {
        const userPayload = await userRes.json();
        const userData = userPayload?.resource_response?.data;

        if (userData) {
          // Extract exact JSON metrics
          const profileViews = userData.profile_views || userData.monthly_views || 0;
          const profileReach = userData.profile_reach || userData.monthly_views || profileViews;
          const followers = userData.follower_count || 0;
          const pins = userData.pin_count || 0;
          const fullName = userData.full_name || username;

          // Update DB record
          const { error: updateError } = await supabase
            .from('competitors')
            .update({
              full_name: fullName,
              profile_reach: profileReach,
              profile_views: profileViews,
              follower_count: followers,
              pin_count: pins,
              last_checked_at: now
            })
            .eq('id', comp.id);

          if (updateError) {
            console.error(`❌ DB Update Error for @${username}:`, updateError.message);
          } else {
            console.log(`✅ Profile Updated -> Reach: ${profileReach.toLocaleString()}, Views: ${profileViews.toLocaleString()}, Followers: ${followers.toLocaleString()}, Pins: ${pins.toLocaleString()}`);
          }

          // Insert historical snapshot
          const { error: snapshotError } = await supabase
            .from('competitor_snapshots')
            .insert({
              competitor_id: comp.id,
              profile_reach: profileReach,
              follower_count: followers,
              pin_count: pins
            });

          if (snapshotError) {
            console.warn(`⚠️ Snapshot Warning for @${username}:`, snapshotError.message);
          }
        } else {
          console.warn(`⚠️ Invalid UserResource data structure for @${username}.`);
        }
      }
    } catch (err) {
      console.error(`❌ UserResource error for @${username}:`, err.message);
    }

    // =========================================================================
    // STEP 2: Fetch ALL Boards via BoardsResource (with Bookmark Pagination)
    // =========================================================================
    let allBoards = [];
    let bookmark = null;
    let hasMore = true;
    let pageCount = 0;
    const maxPages = 20; // Safety ceiling (up to 1,000 boards per competitor)

    while (hasMore && pageCount < maxPages) {
      pageCount++;

      const optionsPayload = {
        username: username,
        field_set_key: "profile_grid_item",
        privacy_filter: "all",
        sort: "last_pinned_to",
        filter_stories: false,
        page_size: 50,
        group_by: "visibility",
        include_archived: true,
        filter_all_pins: false,
        add_fields: "board.{meal_plan}"
      };

      if (bookmark) {
        optionsPayload.bookmarks = [bookmark];
      }

      const boardsUrl = `https://www.pinterest.com/resource/BoardsResource/get/?source_url=%2F${username}%2F&data=${encodeURIComponent(JSON.stringify({ options: optionsPayload, context: {} }))}&_=${Date.now()}`;

      try {
        const boardsRes = await fetch(boardsUrl, { method: "GET", headers: getHeaders(username) });

        if (!boardsRes.ok) {
          console.warn(`⚠️ BoardsResource HTTP ${boardsRes.status} on page ${pageCount} for @${username}. Stopping pagination.`);
          break;
        }

        const boardsPayload = await boardsRes.json();
        const responseData = boardsPayload?.resource_response;
        const boardsList = responseData?.data || [];

        // Filter out 'story' types or non-board items if present
        const actualBoards = boardsList.filter(b => b.type === 'board' || !b.type);
        allBoards.push(...actualBoards);

        // Check for next page bookmark
        const nextBookmark = responseData?.bookmark;
        if (nextBookmark && nextBookmark !== '-end-' && boardsList.length > 0) {
          bookmark = nextBookmark;
        } else {
          hasMore = false;
        }
      } catch (err) {
        console.error(`❌ Error fetching boards page ${pageCount} for @${username}:`, err.message);
        break;
      }
    }

    if (allBoards.length > 0) {
      const boardsToUpsert = allBoards.map((b) => {
        const boardUrl = b.url 
          ? (b.url.startsWith('http') ? b.url : `https://www.pinterest.com${b.url}`)
          : `https://www.pinterest.com/${username}/`;

        // Extract exact Pinterest creation & modification dates
        const realCreatedAt = b.created_at 
          ? new Date(b.created_at).toISOString() 
          : now;

        const realLastPinnedAt = (b.board_order_modified_at || b.last_pinned_by_owner_at || b.last_pinned_at)
          ? new Date(b.board_order_modified_at || b.last_pinned_by_owner_at || b.last_pinned_at).toISOString()
          : now;

        return {
          competitor_id: comp.id,
          board_id: String(b.id || b.node_id),
          name: b.name || 'Untitled Board',
          description: b.description || '',
          pin_count: b.pin_count || 0,
          follower_count: b.follower_count || 0,
          url: boardUrl,
          board_created_at: realCreatedAt,
          created_at: realCreatedAt,
          last_pinned_at: realLastPinnedAt
        };
      });

      const { error: boardError } = await supabase
        .from('competitor_boards')
        .upsert(boardsToUpsert, { onConflict: 'competitor_id, board_id' });

      if (boardError) {
        console.warn(`⚠️ Boards Upsert Warning for @${username}:`, boardError.message);
      } else {
        console.log(`📋 Ingested ALL ${boardsToUpsert.length} Board(s) across ${pageCount} page(s) with REAL creation dates for @${username}.`);
      }
    } else {
      console.log(`ℹ️ No public boards found for @${username}.`);
    }
  }

  console.log('\n🎉 All competitor metrics and boards updated successfully!');
}

updateCompetitors();
