import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!authHeader || !cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {
      // empty body is acceptable
    }

    const targetCompetitorId = body?.competitor_id || null;

    let query = supabase.from('competitors').select('*');
    if (targetCompetitorId) {
      query = query.eq('id', targetCompetitorId);
    }

    const { data: competitors, error: compErr } = await query;
    if (compErr) {
      throw new Error(`Error fetching competitors: ${compErr.message}`);
    }

    const results = [];

    for (const comp of competitors || []) {
      const username = comp.username;
      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      };

      // 1. Fetch UserResource Profile
      const userProfileUrl = `https://www.pinterest.com/resource/UserResource/get/?source_url=%2F${username}%2F&data=%7B%22options%22%3A%7B%22username%22%3A%22${username}%22%2C%22field_set_key%22%3A%22profile%22%7D%2C%22context%22%3A%7B%7D%7D`;
      let profileUpdated = false;
      let reach = comp.profile_reach || 0;
      let views = comp.profile_views || 0;
      let followers = comp.follower_count || 0;
      let pins = comp.pin_count || 0;

      try {
        const userRes = await fetch(userProfileUrl, { headers, signal: AbortSignal.timeout(8000) });
        if (userRes.ok) {
          const userJson = await userRes.json();
          const userData = userJson.resource_response?.data || {};

          if (userData) {
            reach = Number(userData.profile_reach || userData.profile_views || reach);
            views = Number(userData.profile_views || userData.profile_reach || views);
            followers = Number(userData.follower_count || followers);
            pins = Number(userData.pin_count || pins);
            const avatarUrl = userData.image_large_url || userData.image_medium_url || comp.avatar_url;
            const fullName = userData.full_name || comp.full_name || username;

            // Update competitors table
            await supabase
              .from('competitors')
              .update({
                full_name: fullName,
                profile_reach: reach,
                profile_views: views,
                follower_count: followers,
                pin_count: pins,
                avatar_url: avatarUrl,
                last_checked_at: new Date().toISOString(),
              })
              .eq('id', comp.id);

            // Record historical snapshot
            await supabase.from('competitor_snapshots').insert([
              {
                competitor_id: comp.id,
                profile_reach: reach,
                profile_views: views,
                follower_count: followers,
                pin_count: pins,
              },
            ]);

            profileUpdated = true;
          }
        }
      } catch (err: any) {
        console.error(`Failed to fetch UserResource for ${username}:`, err.message);
      }

      // 2. Fetch BoardsResource
      const boardsUrl = `https://www.pinterest.com/resource/BoardsResource/get/?source_url=%2F${username}%2F&data=%7B%22options%22%3A%7B%22privacy_filter%22%3A%22all%22%2C%22sort%22%3A%22last_pinned_to%22%2C%22field_set_key%22%3A%22profile_grid_item%22%2C%22filter_stories%22%3Afalse%2C%22username%22%3A%22${username}%22%2C%22page_size%22%3A25%2C%22group_by%22%3A%22visibility%22%2C%22include_archived%22%3Atrue%2C%22filter_all_pins%22%3Afalse%2C%22add_fields%22%3A%22board.%7Bmeal_plan%7D%22%7D%2C%22context%22%3A%7B%7D%7D`;
      let boardsUpdatedCount = 0;

      try {
        const boardsRes = await fetch(boardsUrl, { headers, signal: AbortSignal.timeout(8000) });
        if (boardsRes.ok) {
          const boardsJson = await boardsRes.json();
          const items = boardsJson.resource_response?.data || [];

          if (Array.isArray(items)) {
            for (const item of items) {
              if (item && (item.type === 'board' || item.id || item.node_id)) {
                const boardId = String(item.id || item.node_id);
                const boardName = item.name || 'Untitled Board';
                const boardDesc = item.description || '';
                const boardUrl = item.url || '';
                const bPins = Number(item.pin_count) || 0;
                const bFollowers = Number(item.follower_count) || 0;
                const createdAt = item.created_at ? new Date(item.created_at).toISOString() : null;
                const lastPinnedAt = item.board_order_modified_at ? new Date(item.board_order_modified_at).toISOString() : null;

                await supabase.from('competitor_boards').upsert(
                  [
                    {
                      competitor_id: comp.id,
                      board_id: boardId,
                      name: boardName,
                      description: boardDesc,
                      url: boardUrl,
                      pin_count: bPins,
                      follower_count: bFollowers,
                      board_created_at: createdAt,
                      last_pinned_at: lastPinnedAt,
                      updated_at: new Date().toISOString(),
                    },
                  ],
                  { onConflict: 'competitor_id,board_id' }
                );

                boardsUpdatedCount++;
              }
            }
          }
        }
      } catch (err: any) {
        console.error(`Failed to fetch BoardsResource for ${username}:`, err.message);
      }

      results.push({
        id: comp.id,
        username,
        profileUpdated,
        boardsUpdatedCount,
      });

      // Add pacing delay before next competitor (1-2.5 seconds with jitter)
      if (competitors && comp !== competitors[competitors.length - 1]) {
        const delayMs = 1000 + Math.floor(Math.random() * 1500);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        processed: results.length,
        results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
