import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pinterestCookie = process.env.PINTEREST_COOKIE || '';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

async function updateCompetitors() {
  console.log('🚀 Starting daily Pinterest competitor metric update...');

  // Fetch all registered competitors
  const { data: competitors, error: fetchError } = await supabase
    .from('competitors')
    .select('id, username');

  if (fetchError || !competitors) {
    console.error('❌ Failed to fetch competitors from Supabase:', fetchError);
    process.exit(1);
  }

  console.log(`📋 Found ${competitors.length} competitor(s) to process.`);

  for (const comp of competitors) {
    console.log(`\n🔍 Fetching metrics for competitor: @${comp.username}`);
    
    const targetUrl = `https://www.pinterest.com/resource/UserResource/get/?source_url=%2F${comp.username}%2F&data=%7B%22options%22%3A%7B%22username%22%3A%22${comp.username}%22%2C%22field_set_key%22%3A%22profile%22%7D%2C%22context%22%3A%7B%7D%7D`;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `https://www.pinterest.com/${comp.username}/`,
      ...(pinterestCookie ? { 'Cookie': pinterestCookie } : {})
    };

    try {
      const response = await fetch(targetUrl, { headers });

      if (!response.ok) {
        console.warn(`⚠️ Warning: HTTP ${response.status} returned for @${comp.username}. Skipping.`);
        continue;
      }

      const payload = await response.json();
      const userData = payload?.resource_response?.data;

      if (!userData) {
        console.warn(`⚠️ Warning: No resource_response payload found for @${comp.username}. Skipping.`);
        continue;
      }

      const reach = userData.monthly_views || 0;
      const followers = userData.follower_count || 0;
      const pins = userData.pin_count || 0;
      const fullName = userData.full_name || comp.username;
      const now = new Date().toISOString();

      // 1. Update Competitors Table
      const { error: updateError } = await supabase
        .from('competitors')
        .update({
          full_name: fullName,
          profile_reach: reach,
          follower_count: followers,
          pin_count: pins,
          last_checked_at: now
        })
        .eq('id', comp.id);

      if (updateError) {
        console.error(`❌ Error updating competitor @${comp.username}:`, updateError);
        continue;
      }

      // 2. Insert Historical Snapshot for Analytics Charting
      const { error: snapshotError } = await supabase
        .from('competitor_snapshots')
        .insert({
          competitor_id: comp.id,
          profile_reach: reach,
          follower_count: followers,
          pin_count: pins
        });

      if (snapshotError) {
        console.error(`⚠️ Snapshot insert warning for @${comp.username}:`, snapshotError);
      }

      console.log(`✅ Updated @${comp.username}: Reach=${reach}, Followers=${followers}, Pins=${pins}`);

    } catch (err) {
      console.error(`❌ Unexpected failure processing @${comp.username}:`, err.message);
    }
  }

  console.log('\n🎉 Competitor update process completed successfully!');
}

updateCompetitors();
