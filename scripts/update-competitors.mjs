import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const envCookie = process.env.PINTEREST_COOKIE;

// Fallback cookie string directly from DevTools session
const fallbackCookie = `csrftoken=56115a2c9a45b1d88820c8694d8e9749; _auth=1; _b="AZIjb8mUzExO7odi8GroQfERd6ePiINUd4NbaKyFFe+fIsraTk0FIs5aqR4ApYlHvX0="; ar_debug=1; ar_debug=1; _pinterest_sess=TWc9PSZvT09YWnUrRjM5VFM1TUFsRmZVTkpuT2I2SEFhWkgrcVlNeG5hc3NadVRCNWt6UDRnSDJDVCtqY0xJelV0c3ljejVEVUQ3V202ZllzVXlDODVxdjdxNHl2dkF1ZkJSSE1sUzd6eUdMQnpQTDltRit6UjRKVUpIVEVzc2pxbVRhQ1UwZTBFYlkrTDA5aDBodTE3Nkt1SmwxZzRyd21ub21kNzhLT1BMUWlaMm1WcGhMVG9uNzBrdUZibnZOand4L1BxeURUNnVFY05xbVVTOVAyb2xTSTBWWmJVVFIrU0N4RjNqelRocmZxRDlBRkJYakRTcWo2WFRzdnhTcmE3Nlo4K3ZrREJvRVdic0hQQm8yVlFTbjkrMlVkRUNLRjFUd0ViZTJOQTZJaHNyMm1vLzhBUVRKS3lrN0xKRllyV0FpRkF6QVlBTDlydzBwS2Y2MTJEVWVEQlZlaXlCZ0h1R0kwcVRWb1BRblNaRXgrNithdkhpbGVpYVhBeVdhVDdhL05hTkdXL3ZHcUZBekk3b0hYWmVaQldKd25TZzR5a3UyY0JXMnhMN1YxSlJNanNIeEpTRTVrSVo4bm5OODFrQlZqTDlxeW1xRGU3QTBwWVMrV2dsRGJweTB1dWsvL1NWdUdXOWg5UDJ2NEorZXByN2p0SmQ0aUFINFlxV2hna2NhdTU1a05Kd0RrMWJoeHNpVlVjaExZaXI2QjB1U3Ixa0trd2xCRGFsYlA4dXJmYmY4aVEzZGZVVVNPWVBFbEhhMGUycTlKQVNUMUVCbmpkaDdXQi9KT0hjbU5YYUJ1NWVJeG92dXRmR1BMR2ZyL2ZUdWllQ2VyVDJVOVU2KzdnM0ROU01DcEJBTHBhL09nMGRHR3hINzdkYUhUbW1ya0MybWRxYmRHTDh1dEMxVzNaeXgzV3A4NGxqSUc0cHZIcDBzbW1vNk9PekhhVTlSOG1yTkQ4eVkxMXpremtDRHlVM0JtUnBIbi85dmo1WktObDBYcHFNWDBPUkh5NjJrZmZVcTBuTytPQXg0RzJRVGlGODAzUXdJeGpnVjF5YUJYeEEyR3k0MitNKzVQdWM4K0s1ZS90ZW51aERrRTVPQmNmQys0NWpvVVJhM212TG1zMFpWV0E3Z3cyZ3g5SU95SVRqSnAvQk5oTU5SNmJheWRYMnl4Qy9NSVNLMjBWWXRPSFFKUGFRd0tVYWdUTUNhcG5ocWQwNzkyZjRqZkpXd2JRTVhLYmJ0R1hMZDZhZStiNWduYWc0aFJXaG1kTkpQc2ExVGJWN2FhUm5tSXUrRjZrYTg5eDFMdlpGdkhseXNPTktTd3dMQjJvRjIrVWMxaTVSaWpiMjg4cldXeUhJSmZYVEtmWEFqZFhsNnVuVmJvSGgyYm0vdnVaSjZWVHB1SkV1bFNsMXMvTkEyQVhCMW1CTUoyWUpRMkpVYldwb0hYeFMycjQrck1ZTGFQRWlLRnBBc0QxdWNDcjI3WnF6S29ZYVhNVU03c1B6ZlVmYkxUSW9kbC82Zlh2Ukh6L2dDdzBmQVZrSVN0NVptdzhkblJBa2N0UzE3YU81ejlwR29WRnNOZkhLQlNXay9uMFIrcUhuakZ1elJDblFMZU52MjlYZ1diblZvQmJ4ZTdPWGNFU202NTRlb3Z3Qi9ScmVWUWVFV1h0NDJsRHV4aWpncng5V3ZlOXhLaFRvMXRheWZrWEk5Y0JBOWNkK3d2WlF0L2d3NitEVVYyT01qRWJZZkNuTXp5TWJkeE5PQllvbzdpM211TllZdytVTEkxVlNCVE1jcHkmR0FNTlc0R1V0aTBFSGNsRmFHT2FpYkU2TG93PQ==; l_o=X//oDaF2/LpEwgT6WJDiGkHYZBtC6MxjytQOlAflPTz6CpBZrLQpZngWZihufqC/LLdraElKKa5h5EAw4kh9bOAsMFAcW9cGzhTykXTZt5XTDU8ftijWvN7ES7T+953Fj+rD/w==; __Secure-s_a=QThkdkJ3NDdJVTZPT3k3Q21rRHFSZlZPajlBa3BzbExmTWl3NDJhZ2lneEpONzFDZnNEdDAyYVJ2Smw5eVBpckJWL2dMTjhObm1CdkR1Q0xESWJSMnJCb050YXZmS1ZBTDI4NEo4dW5TV3NyUVlqL2c1dHRka09qUTZEWWprcWMvOTZjc1pKOEdqK0ZRbS9pTGJ3Q2NoeE5OUmp5RTJLNjg3NGFBSXA0bGMrcDQ1bnovOCtkZmxUZEhtMGxhRkVqTXpxcjB6eENUZlhmSVBuZitsSHovVjJaTG9XVkJmRCsyZThYZ1FyWFZ6MWVKdHdxR0VnRUxHT09rdnJxbDNBdW9wVXpVS1JZYjZRdXJ1alZ0TXJaOUtacHEydDUrQlh2b2xoSEcwdFkrOVhyTFNaN2h3K2hnVjNNVGp5SEtJbnVnTERCK3cxcjRDRTJ0ZjhrcmFoTmJxZWVFV1cwZ3BSY0hSUTh2Qjlvcmw4MlJ1cktnaW4vNlQ5NDlwSDEwVW95cXVDa0JYekpGWk84aStOUk84bVRGYjF1MUFIRVB1Rm9aTnpXcFhyaWYzU0JpbVVGM2pTaGVuTzdhU3kvMUt1ZHR3MkxZWWVmN2FrcUwrQkFtK3hueXFDMVZxUVFQczM2ZGFTQWJ4WXNkMlZKNllEVVhRcGFLMzVranBQcnJNWDVqdzRndW02OWk0cHU1UVFveXdpMG1pSkpWeHB1VjU0VTRicmhBaEQzU29Pb0lWNjFiemFYZlE1Q2pKV0ZyV0sxNVB5THBzRS9MdGxhNTRUZmxzamFkQThQbXF3VEFabGhremcwRjJpZDZ6OWJublAzNmVMVFBsUDFaaFhpbER5SzVMTVBVV3dwa1pqUkJQLzVHbmJuUnV5djBXcGRESytiZW9NM0ZxRFNTc2dWK0V2aTlBUm1PejQ3dEhjdFpGU0ZDMW1PalA3YjhZR2x5ZllqQmJFVkRWQ2FVODFMQW5NL1VCR1J6OVNKZUdtTHV3VzFaa2prQVFmelA4Nys2MG9UbDdkcHE0eXQvaGlmaW9qUDVPRkIvZHlvSUI5SmNMU3NSeFduK3cxSC93ajNpN2tGK21kOFRSeURSTUZEb25YSk5taDl6RjJndG5tWlRNNlp4Qm1QWmRBbTZZa0JEbS92WEJ2amk5VE45eGI2VUExOFNSNnhaK3BHazZlcGVtYkFHNmEvRGRJbkxPczV6M3JxQ2RENTA3NllsOWlDeGpnbDIyWkxUMTdIa0Q3OXJPaGFkR1o2ZDByb2xqUmZlY2JZc3hsMytJd0xlK2dyZUV5UzdmMVh5cVA1TS8rcnpVZk40clFEWU8zVThmYz0mU0ZtN05XSkFWMkJMUFdBOGVDWXlNNUYxOVUwPQ==; usersync=%7B%22magnite%22%3A%7B%22id%22%3A%22MMW80NUX-9-DKKR%22%2C%22ts%22%3A1782721056632%7D%7D; _routing_id="744ce4bd-18f4-48b9-aecf-bcd42a4079b8"; sessionFunnelEventLogged=1; g_state={"i_l":0,"i_ll":1785971722375,"i_e":{"enable_itp_optimization":24},"i_b":"7AOR2pAWgpXVf0ko6OsHMGNVT37h9WNgkYPAj+a39SE","i_et":1785971722375}; _pinterest_cm=TWc9PSZMbFVOQjlQaWJQOGxRb0FsYnFiMnlSaGd5NmJZV2ZWa3BZQ1ZESU9IclQrcjh0MTJtVXQ0bzJhRmM0OWZXVkJtS2RhQmNrMjh1Qmw5ellaVSs3QXhVdWVxb2dsRW1VUEt0QzVPc0NaUjY0ajNQOHBPSjE3c1YvTnFWT051M0ZCakpYYjhsSlJ2OEtxeTVnZ01WeHVRMUFLclJ6VHMxd012N3UybmpRUzgwZEl1UitUaFNhY3VyQ2w2T05NRVVBZ24mVzE4ZThOK2xVajlQVlY1WUdNRitZTFFYaWhVPQ==`;

const activeCookie = envCookie || fallbackCookie;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

async function updateCompetitors() {
  console.log('🚀 Starting daily Pinterest competitor metric update...');

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
    console.log(`\n🔍 Fetching metrics for competitor: @${username}`);

    const targetUrl = `https://www.pinterest.com/resource/UserResource/get/?source_url=%2F${username}%2F&data=%7B%22options%22%3A%7B%22username%22%3A%22${username}%22%2C%22field_set_key%22%3A%22profile%22%7D%2C%22context%22%3A%7B%7D%7D&_=${Date.now()}`;

    const headers = {
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
      "x-b3-parentspanid": "5733cb4107910351",
      "x-b3-spanid": "4e3d70503954c799",
      "x-b3-traceid": "5733cb4107910351",
      "x-pinterest-appstate": "background",
      "x-pinterest-pws-handler": "www/[username].js",
      "x-pinterest-source-url": `/${username}/`,
      "x-requested-with": "XMLHttpRequest",
      "Referer": `https://www.pinterest.com/${username}/`,
      "cookie": activeCookie
    };

    try {
      const response = await fetch(targetUrl, { method: "GET", headers });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`⚠️ HTTP ${response.status} returned for @${username}. Preview: ${errText.substring(0, 150)}`);
        continue;
      }

      const payload = await response.json();
      const userData = payload?.resource_response?.data;

      if (!userData) {
        console.warn(`⚠️ Warning: No valid resource_response data payload for @${username}.`);
        continue;
      }

      const reach = userData.monthly_views || 0;
      const followers = userData.follower_count || 0;
      const pins = userData.pin_count || 0;
      const fullName = userData.full_name || username;
      const now = new Date().toISOString();

      // 1. Update Competitor Table Record
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
        console.error(`❌ DB Update Error for @${username}:`, updateError);
        continue;
      }

      // 2. Insert Historical Metrics Snapshot
      const { error: snapshotError } = await supabase
        .from('competitor_snapshots')
        .insert({
          competitor_id: comp.id,
          profile_reach: reach,
          follower_count: followers,
          pin_count: pins
        });

      if (snapshotError) {
        console.error(`⚠️ Snapshot Insert Warning for @${username}:`, snapshotError);
      }

      console.log(`✅ Successfully Updated @${username} -> Reach: ${reach}, Followers: ${followers}, Pins: ${pins}`);

    } catch (err) {
      console.error(`❌ Unexpected Failure for @${username}:`, err.message);
    }
  }

  console.log('\n🎉 Competitor metric sync process completed successfully!');
}

updateCompetitors();
