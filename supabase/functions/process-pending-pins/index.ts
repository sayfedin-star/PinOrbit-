import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface Account {
  id: string;
  account_name: string;
  webhook_url?: string;
  max_pins_per_day: number;
  is_active: boolean;
  pinning_started_at?: string | null;
  posting_window_start?: string | null;
  posting_window_end?: string | null;
  timezone?: string | null;
  last_published_at?: string | null;
}

interface AccountWebhook {
  id: string;
  account_id: string;
  label: string;
  webhook_url: string;
  monthly_capacity: number;
  monthly_usage: number;
  priority: number;
  is_active: boolean;
  is_primary: boolean;
  last_used_at?: string | null;
  last_failed_at?: string | null;
  last_failure_reason?: string | null;
}

interface Board {
  id: string;
  account_id: string;
  board_name: string;
  board_id: string;
}

interface Pin {
  id: string;
  account_id: string;
  title: string;
  description: string | null;
  image_url: string;
  board_name: string | null;
  link: string | null;
  status: 'pending' | 'processing' | 'posted' | 'failed';
  source: string;
  scheduled_for?: string | null;
  posted_at?: string | null;
  processing_started_at?: string | null;
  created_at: string;
}

/**
 * Calculates current time and date in specified IANA timezone with hourCycle: 'h23'
 * to guarantee strict 00-23 hour formatting across all JS runtimes.
 */
function getAccountTimeInfo(timezoneStr?: string | null, date: Date = new Date()) {
  const tz = timezoneStr && timezoneStr.trim() !== "" ? timezoneStr.trim() : "UTC";
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });

    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || "00";

    const year = getPart("year");
    const month = getPart("month");
    const day = getPart("day");
    let hour = getPart("hour");
    if (hour === "24") hour = "00";
    const minute = getPart("minute");
    const second = getPart("second");

    const dateStr = `${year}-${month}-${day}`;
    const timeStr = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}`;

    return { dateStr, timeStr, valid: true };
  } catch (_e) {
    // Fallback to UTC if timezone is invalid or unrecognized
    const iso = date.toISOString();
    return {
      dateStr: iso.substring(0, 10),
      timeStr: iso.substring(11, 19),
      valid: false,
    };
  }
}

/**
 * Checks if current local time is within posting window (handles standard & overnight windows)
 */
function isWithinPostingWindow(currentTimeStr: string, windowStart?: string | null, windowEnd?: string | null): boolean {
  if (!windowStart || !windowEnd || windowStart.trim() === "" || windowEnd.trim() === "") {
    return true; // No window constraints configured
  }

  const cur = currentTimeStr.length === 5 ? `${currentTimeStr}:00` : currentTimeStr;
  const start = windowStart.length === 5 ? `${windowStart}:00` : windowStart;
  const end = windowEnd.length === 5 ? `${windowEnd}:00` : windowEnd;

  if (start <= end) {
    // Standard daytime window (e.g. 09:00:00 to 21:00:00)
    return cur >= start && cur <= end;
  } else {
    // Overnight window (e.g. 22:00:00 to 04:00:00)
    return cur >= start || cur <= end;
  }
}

/**
 * Selects optimal webhook based on hierarchy:
 * 1. Primary webhook if active with remaining capacity
 * 2. Lowest priority number (1, 2, 3...)
 * 3. Highest remaining capacity
 * 4. Oldest last_used_at / null first
 */
function selectOptimalWebhook(webhooks: AccountWebhook[]): AccountWebhook | null {
  const eligible = webhooks.filter(
    (w) => w.is_active && w.monthly_capacity - w.monthly_usage > 0
  );

  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    // 1. Primary webhook first
    if (a.is_primary !== b.is_primary) {
      return a.is_primary ? -1 : 1;
    }

    // 2. Priority (lower number is higher priority)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    // 3. Remaining capacity (higher capacity first)
    const remA = a.monthly_capacity - a.monthly_usage;
    const remB = b.monthly_capacity - b.monthly_usage;
    if (remA !== remB) {
      return remB - remA;
    }

    // 4. Oldest last_used_at (null first)
    if (!a.last_used_at && b.last_used_at) return -1;
    if (a.last_used_at && !b.last_used_at) return 1;
    if (a.last_used_at && b.last_used_at) {
      return new Date(a.last_used_at).getTime() - new Date(b.last_used_at).getTime();
    }

    return 0;
  });

  return eligible[0];
}

Deno.serve(async (req: Request) => {
  // Allow OPTIONS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  // 1. Authorization check
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing or invalid Authorization header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = authHeader.split(" ")[1];
  const expectedSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const isValidSecret = (expectedSecret && token === expectedSecret) || (serviceRoleKey && token === serviceRoleKey);
  if (!isValidSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized: Invalid Bearer token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Initialize Supabase Admin Client
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: "Server configuration error: missing Supabase credentials" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date();
  const nowIso = now.toISOString();

  // Summary counters
  let processedAccounts = 0;
  let sentCount = 0;
  let failedCount = 0;
  let skippedDueToLimit = 0;
  let skippedDueToWindow = 0;
  let skippedDueToWebhook = 0;
  let skippedDueToMissingBoard = 0;
  let recoveredLocks = 0;

  try {
    // 3. Concurrency Safety: Recover stale or orphaned processing locks (> 10 minutes or null timestamp)
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const { data: recoveredPins, error: recoverErr } = await supabase
      .from("pins")
      .update({ status: "pending", processing_started_at: null })
      .eq("status", "processing")
      .or(`processing_started_at.is.null,processing_started_at.lt.${tenMinutesAgo}`)
      .select("id");

    if (!recoverErr && recoveredPins) {
      recoveredLocks = recoveredPins.length;
    }

    // 4. Fetch all active accounts
    const { data: accounts, error: accountsError } = await supabase
      .from("accounts")
      .select("*")
      .eq("is_active", true);

    if (accountsError) {
      throw new Error(`Failed to fetch active accounts: ${accountsError.message}`);
    }

    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          message: "No active accounts found",
          accounts_checked: 0,
          pins_processed: 0,
          pins_failed: 0,
          skipped_due_to_limit: 0,
          skipped_due_to_window: 0,
          skipped_due_to_webhook: 0,
          skipped_due_to_missing_board: 0,
          stale_locks_recovered: recoveredLocks,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Process each active account (safely limited to 1 pin per eligible account per run)
    for (const account of accounts as Account[]) {
      // 5. Account Eligibility Rules

      // Rule 5a: pinning_started_at check
      if (account.pinning_started_at) {
        const startTz = new Date(account.pinning_started_at);
        if (!isNaN(startTz.getTime()) && startTz > now) {
          continue; // Account pinning scheduled to start in the future
        }
      }

      // Rule 5b: Posting window check (Timezone-aware)
      const { dateStr, timeStr } = getAccountTimeInfo(account.timezone, now);
      if (!isWithinPostingWindow(timeStr, account.posting_window_start, account.posting_window_end)) {
        skippedDueToWindow++;
        continue;
      }

      // Rule 5c: Account daily limit check
      // ⚡ Optimization: Filter posted pins with lower cutoff (48h ago) to avoid O(N) full historical table scans
      const fortyEightHoursAgoIso = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
      const { data: recentPostedPins, error: postedCountError } = await supabase
        .from("pins")
        .select("posted_at")
        .eq("account_id", account.id)
        .eq("status", "posted")
        .gte("posted_at", fortyEightHoursAgoIso);

      if (postedCountError) {
        console.error(`Error checking daily posted count for account ${account.account_name}:`, postedCountError);
        continue;
      }

      const todayPostedCount = (recentPostedPins || []).filter((p) => {
        if (!p.posted_at) return false;
        const pTimeInfo = getAccountTimeInfo(account.timezone, new Date(p.posted_at));
        return pTimeInfo.dateStr === dateStr;
      }).length;

      if (todayPostedCount >= account.max_pins_per_day) {
        skippedDueToLimit++;
        continue;
      }

      // 6. Select Candidate Pending Pin
      // Find earliest pending pin that is due for publishing (scheduled_for is null OR scheduled_for <= now)
      const { data: candidatePins, error: pinsError } = await supabase
        .from("pins")
        .select("*")
        .eq("account_id", account.id)
        .eq("status", "pending")
        .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
        .order("scheduled_for", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true })
        .limit(1);

      if (pinsError) {
        console.error(`Error fetching pending pins for account ${account.account_name}:`, pinsError);
        continue;
      }

      if (!candidatePins || candidatePins.length === 0) {
        continue; // No pending pins ready for scheduling
      }

      const candidatePin = candidatePins[0] as Pin;

      // 7. Atomic Concurrency Lock: Claim the pin atomically
      const { data: claimedPins, error: claimError } = await supabase
        .from("pins")
        .update({
          status: "processing",
          processing_started_at: nowIso,
        })
        .eq("id", candidatePin.id)
        .eq("status", "pending")
        .select();

      if (claimError || !claimedPins || claimedPins.length === 0) {
        // Pin was claimed concurrently by another worker
        continue;
      }

      const currentPin = claimedPins[0] as Pin;
      processedAccounts++;

      // 8. Board Matching Validation
      if (!currentPin.board_name || currentPin.board_name.trim() === "") {
        await supabase
          .from("pins")
          .update({ status: "failed", processing_started_at: null })
          .eq("id", currentPin.id);

        await supabase.from("logs").insert({
          pin_id: currentPin.id,
          account_id: account.id,
          status: "error",
          message: "Board name is missing on pin",
          webhook_used: null,
        });

        skippedDueToMissingBoard++;
        failedCount++;
        continue;
      }

      const { data: matchedBoards, error: boardError } = await supabase
        .from("boards")
        .select("*")
        .eq("account_id", account.id)
        .ilike("board_name", currentPin.board_name.trim())
        .limit(1);

      if (boardError || !matchedBoards || matchedBoards.length === 0) {
        await supabase
          .from("pins")
          .update({ status: "failed", processing_started_at: null })
          .eq("id", currentPin.id);

        await supabase.from("logs").insert({
          pin_id: currentPin.id,
          account_id: account.id,
          status: "error",
          message: `Board '${currentPin.board_name}' not found for account`,
          webhook_used: null,
        });

        skippedDueToMissingBoard++;
        failedCount++;
        continue;
      }

      const matchedBoard = matchedBoards[0] as Board;

      // 9. Multi-Webhook Routing & Selection
      const { data: webhooks, error: webhooksError } = await supabase
        .from("account_webhooks")
        .select("*")
        .eq("account_id", account.id);

      let targetWebhook: AccountWebhook | null = null;

      if (!webhooksError && webhooks && webhooks.length > 0) {
        targetWebhook = selectOptimalWebhook(webhooks as AccountWebhook[]);
      } else if (account.webhook_url && account.webhook_url.trim() !== "") {
        // Fallback to legacy accounts.webhook_url if account_webhooks table entry missing
        targetWebhook = {
          id: "",
          account_id: account.id,
          label: "Legacy Primary",
          webhook_url: account.webhook_url,
          monthly_capacity: 500,
          monthly_usage: 0,
          priority: 1,
          is_active: true,
          is_primary: true,
        };
      }

      if (!targetWebhook) {
        // No eligible active webhook with remaining capacity found
        // Revert pin status to pending so it can be retried when capacity is restored
        await supabase
          .from("pins")
          .update({ status: "pending", processing_started_at: null })
          .eq("id", currentPin.id);

        await supabase.from("logs").insert({
          pin_id: currentPin.id,
          account_id: account.id,
          status: "error",
          message: "No active webhook with remaining capacity available for account",
          webhook_used: null,
        });

        skippedDueToWebhook++;
        continue;
      }

      // 10. Webhook Dispatch Execution
      const payload = {
        pin_id: currentPin.id,
        account_id: account.id,
        title: currentPin.title,
        description: currentPin.description,
        image_url: currentPin.image_url,
        link: currentPin.link,
        board_id: matchedBoard.board_id,
        board_name: matchedBoard.board_name,
      };

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const webhookResponse = await fetch(targetWebhook.webhook_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // 11. Handle Dispatch Result
        if (webhookResponse.ok) {
          // Success!
          const postedTimestamp = new Date().toISOString();

          await supabase
            .from("pins")
            .update({
              status: "posted",
              posted_at: postedTimestamp,
              processing_started_at: null,
            })
            .eq("id", currentPin.id);

          await supabase.from("logs").insert({
            pin_id: currentPin.id,
            account_id: account.id,
            webhook_id: targetWebhook.id || null,
            status: "success",
            message: `Published successfully via webhook '${targetWebhook.label}'`,
            webhook_used: targetWebhook.webhook_url,
          });

          // Update webhook monthly usage & last_used_at
          if (targetWebhook.id) {
            await supabase
              .from("account_webhooks")
              .update({
                monthly_usage: targetWebhook.monthly_usage + 1,
                last_used_at: postedTimestamp,
              })
              .eq("id", targetWebhook.id);
          }

          // Update account last_published_at
          await supabase
            .from("accounts")
            .update({ last_published_at: postedTimestamp })
            .eq("id", account.id);

          sentCount++;
        } else {
          // Webhook returned non-2xx HTTP status
          const responseText = await webhookResponse.text();
          const errorMessage = `Webhook failed [HTTP ${webhookResponse.status}]: ${responseText.slice(0, 300)}`;

          await supabase
            .from("pins")
            .update({ status: "failed", processing_started_at: null })
            .eq("id", currentPin.id);

          await supabase.from("logs").insert({
            pin_id: currentPin.id,
            account_id: account.id,
            webhook_id: targetWebhook.id || null,
            status: "error",
            message: errorMessage,
            webhook_used: targetWebhook.webhook_url,
          });

          if (targetWebhook.id) {
            await supabase
              .from("account_webhooks")
              .update({
                last_failed_at: new Date().toISOString(),
                last_failure_reason: errorMessage,
              })
              .eq("id", targetWebhook.id);
          }

          failedCount++;
        }
      } catch (fetchErr: any) {
        // Network exception, abort timeout, or fetch error
        const isAbort = fetchErr?.name === "AbortError";
        const errorMessage = isAbort
          ? "Webhook dispatch timed out after 15 seconds"
          : `Network error dispatching webhook: ${fetchErr?.message || String(fetchErr)}`;

        await supabase
          .from("pins")
          .update({ status: "failed", processing_started_at: null })
          .eq("id", currentPin.id);

        await supabase.from("logs").insert({
          pin_id: currentPin.id,
          account_id: account.id,
          webhook_id: targetWebhook.id || null,
          status: "error",
          message: errorMessage,
          webhook_used: targetWebhook.webhook_url,
        });

        if (targetWebhook.id) {
          await supabase
            .from("account_webhooks")
            .update({
              last_failed_at: new Date().toISOString(),
              last_failure_reason: errorMessage,
            })
            .eq("id", targetWebhook.id);
        }

        failedCount++;
      }
    }

    // 12. Return JSON Execution Summary
    return new Response(
      JSON.stringify({
        ok: true,
        accounts_checked: processedAccounts,
        pins_processed: sentCount,
        pins_failed: failedCount,
        skipped_due_to_limit: skippedDueToLimit,
        skipped_due_to_window: skippedDueToWindow,
        skipped_due_to_webhook: skippedDueToWebhook,
        skipped_due_to_missing_board: skippedDueToMissingBoard,
        stale_locks_recovered: recoveredLocks,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err.message || "Internal server error during scheduler execution",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
