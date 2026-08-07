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
  posting_interval_minutes?: number | null;
  random_delay_minutes?: number | null;
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
    return cur >= start && cur <= end;
  } else {
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
    (w) => w.is_active && (w.monthly_capacity ?? 500) - (w.monthly_usage ?? 0) > 0
  );

  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    if (a.is_primary !== b.is_primary) {
      return a.is_primary ? -1 : 1;
    }
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    const remA = (a.monthly_capacity ?? 500) - (a.monthly_usage ?? 0);
    const remB = (b.monthly_capacity ?? 500) - (b.monthly_usage ?? 0);
    if (remA !== remB) {
      return remB - remA;
    }
    if (!a.last_used_at && b.last_used_at) return -1;
    if (a.last_used_at && !b.last_used_at) return 1;
    if (a.last_used_at && b.last_used_at) {
      return new Date(a.last_used_at).getTime() - new Date(b.last_used_at).getTime();
    }
    return 0;
  });

  return eligible[0];
}

/**
 * Smart board matcher with exact, ILIKE, partial fuzzy matching, and fallback handling
 */
async function findMatchingBoard(supabase: any, accountId: string, targetBoardName?: string | null): Promise<Board | null> {
  const { data: allBoards } = await supabase
    .from("boards")
    .select("*")
    .eq("account_id", accountId);

  if (!allBoards || allBoards.length === 0) {
    return null; // Account has no boards configured
  }

  if (!targetBoardName || targetBoardName.trim() === "") {
    return allBoards[0] as Board; // Default to first board if none specified
  }

  const cleanName = targetBoardName.trim();
  const cleanLower = cleanName.toLowerCase();

  // 1. Exact match (case insensitive)
  const exactMatch = allBoards.find((b: Board) => (b.board_name || "").trim().toLowerCase() === cleanLower);
  if (exactMatch) return exactMatch as Board;

  // 2. Partial / Fuzzy match (e.g. "dinner ideas" matching "dinner ideasfff" or vice versa)
  const partialMatch = allBoards.find((b: Board) => {
    const bLower = (b.board_name || "").trim().toLowerCase();
    return bLower.includes(cleanLower) || cleanLower.includes(bLower);
  });
  if (partialMatch) return partialMatch as Board;

  // 3. Fallback to first available board for account
  return allBoards[0] as Board;
}

Deno.serve(async (req: Request) => {
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

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const expectedSecret = Deno.env.get("CRON_SECRET")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

  let isValidSecret = false;

  if (expectedSecret && token === expectedSecret) {
    isValidSecret = true;
  } else if (serviceRoleKey && token === serviceRoleKey) {
    isValidSecret = true;
  } else {
    // JWT signature payload check for service_role or admin tokens
    try {
      const payloadBase64 = token.split(".")[1];
      if (payloadBase64) {
        // Base64Url decode
        const base64 = payloadBase64.replace(/-/g, "+").replace(/_/g, "/");
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split("")
            .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
            .join("")
        );
        const decoded = JSON.parse(jsonPayload);
        if (decoded.role === "service_role" || decoded.role === "authenticated" || decoded.iss === "supabase") {
          isValidSecret = true;
        }
      }
    } catch (_e) {
      isValidSecret = false;
    }
  }

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

  let processedAccounts = 0;
  let sentCount = 0;
  let failedCount = 0;
  let skippedDueToLimit = 0;
  let skippedDueToWindow = 0;
  let skippedDueToInterval = 0;
  let skippedDueToWebhook = 0;
  let skippedDueToMissingBoard = 0;
  let recoveredLocks = 0;

  try {
    // 3. Concurrency Safety: Recover stale processing locks (> 10 minutes)
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
      processedAccounts++;
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

      // Rule 5d: Posting interval check (per-account elapsed time since last published pin + random delay jitter)
      if (account.last_published_at) {
        const lastPubDate = new Date(account.last_published_at);
        if (!isNaN(lastPubDate.getTime())) {
          const baseInterval = account.posting_interval_minutes ?? 30;
          const maxDelay = account.random_delay_minutes ?? 0;
          const jitter = maxDelay > 0 ? Math.floor(Math.random() * (maxDelay + 1)) : 0;
          const targetInterval = baseInterval + jitter;

          const elapsedMs = now.getTime() - lastPubDate.getTime();
          const elapsedMinutes = Math.floor(elapsedMs / 60000);
          if (elapsedMinutes < targetInterval) {
            skippedDueToInterval++;
            continue;
          }
        }
      }

      // 6. Select Candidate Pending Pin
      const { data: candidatePins, error: pinsError } = await supabase
        .from("pins")
        .select("*")
        .eq("account_id", account.id)
        .eq("status", "pending")
        .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
        .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
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
        continue;
      }

      const currentPin = claimedPins[0] as Pin;

      // Log 'queued' event when claimed for processing
      try {
        await supabase.rpc('append_pin_delivery_log', {
          p_pin_id: currentPin.id,
          p_attempt_no: ((currentPin as any).retry_count || 0) + 1,
          p_event_type: 'queued',
          p_provider: account.account_name,
          p_metadata: {
            account_id: account.id,
            scheduled_for: currentPin.scheduled_for || null,
            claimed_at: nowIso,
          },
        });
      } catch (_logErr) {
        console.warn("Failed to append queued delivery log:", _logErr);
      }

      // 8. Board Matching Validation
      const matchedBoard = await findMatchingBoard(supabase, account.id, currentPin.board_name);

      if (!matchedBoard) {
        await supabase
          .from("pins")
          .update({ status: "failed", processing_started_at: null })
          .eq("id", currentPin.id);

        await supabase.from("logs").insert({
          pin_id: currentPin.id,
          account_id: account.id,
          status: "error",
          message: `No boards configured for account ${account.account_name}`,
          webhook_used: null,
        });

        skippedDueToMissingBoard++;
        failedCount++;
        continue;
      }

      // 9. Multi-Webhook Routing & Selection
      const { data: webhooks, error: webhooksError } = await supabase
        .from("account_webhooks")
        .select("*")
        .eq("account_id", account.id);

      let targetWebhook: AccountWebhook | null = null;

      if (!webhooksError && webhooks && webhooks.length > 0) {
        targetWebhook = selectOptimalWebhook(webhooks as AccountWebhook[]);
      } else if (account.webhook_url && account.webhook_url.trim() !== "") {
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
        // Log 'dispatched' event
        try {
          await supabase.rpc('append_pin_delivery_log', {
            p_pin_id: currentPin.id,
            p_attempt_no: ((currentPin as any).retry_count || 0) + 1,
            p_event_type: 'dispatched',
            p_provider: targetWebhook.label || 'Webhook Provider',
            p_metadata: { webhook_id: targetWebhook.id || null, webhook_url: targetWebhook.webhook_url },
          });
        } catch (_logErr) {
          console.warn("Failed to append dispatched delivery log:", _logErr);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const webhookResponse = await fetch(targetWebhook.webhook_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (webhookResponse.ok) {
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

          // Log 'published' event in pin_delivery_logs
          try {
            await supabase.rpc('append_pin_delivery_log', {
              p_pin_id: currentPin.id,
              p_attempt_no: ((currentPin as any).retry_count || 0) + 1,
              p_event_type: 'published',
              p_provider: targetWebhook.label || 'Webhook Provider',
              p_http_status: webhookResponse.status,
              p_response_excerpt: 'Published successfully via webhook',
              p_metadata: { webhook_id: targetWebhook.id || null, posted_at: postedTimestamp },
            });
          } catch (_logErr) {
            console.warn("Failed to append published delivery log:", _logErr);
          }

          if (targetWebhook.id) {
            await supabase
              .from("account_webhooks")
              .update({
                monthly_usage: (targetWebhook.monthly_usage || 0) + 1,
                last_used_at: postedTimestamp,
              })
              .eq("id", targetWebhook.id);
          }

          await supabase
            .from("accounts")
            .update({ last_published_at: postedTimestamp })
            .eq("id", account.id);

          sentCount++;
        } else {
          const responseText = await webhookResponse.text();
          const status = webhookResponse.status;
          const errorMessage = `Webhook failed [HTTP ${status}]: ${responseText.slice(0, 300)}`;

          // Classify failure: HTTP 400, 401, 403, 404 are permanent; 429 & 5xx are transient
          const isPermanent = [400, 401, 403, 404].includes(status);
          const failureType = isPermanent ? 'permanent' : (status === 429 ? 'rate_limited' : 'transient');

          const currentRetryCount = (currentPin as any).retry_count || 0;
          const maxRetries = (currentPin as any).max_retries || 3;
          const isEligibleForRetry = !isPermanent && currentRetryCount < maxRetries;
          const deliveryEventType = status === 429 ? 'rate_limited' : (isEligibleForRetry ? 'provider_error' : 'failed');

          // Log delivery failure event in pin_delivery_logs
          try {
            await supabase.rpc('append_pin_delivery_log', {
              p_pin_id: currentPin.id,
              p_attempt_no: currentRetryCount + 1,
              p_event_type: deliveryEventType,
              p_provider: targetWebhook.label || 'Webhook Provider',
              p_http_status: status,
              p_error_code: status,
              p_error_message: errorMessage,
              p_response_excerpt: responseText.slice(0, 4000),
              p_metadata: {
                webhook_id: targetWebhook.id || null,
                failure_type: failureType,
                is_eligible_for_retry: isEligibleForRetry,
              },
            });
          } catch (_logErr) {
            console.warn("Failed to append delivery log event:", _logErr);
          }

          if (isEligibleForRetry) {
            const nextRetryCount = currentRetryCount + 1;
            const expDelay = Math.min(1800, 60 * Math.pow(2, nextRetryCount));
            const jitterSec = expDelay * (0.5 + Math.random() * 0.5);
            const nextRetryAt = new Date(Date.now() + jitterSec * 1000).toISOString();

            await supabase
              .from("pins")
              .update({
                status: "pending",
                retry_count: nextRetryCount,
                next_retry_at: nextRetryAt,
                last_failure_reason: errorMessage,
                last_attempt_at: new Date().toISOString(),
                failure_type: failureType,
                processing_started_at: null,
              })
              .eq("id", currentPin.id);

            await supabase.from("logs").insert({
              pin_id: currentPin.id,
              account_id: account.id,
              webhook_id: targetWebhook.id || null,
              status: "error",
              message: `Attempt ${nextRetryCount}/${maxRetries} failed: ${errorMessage}. Retrying in ${Math.round(jitterSec / 60)}m.`,
              webhook_used: targetWebhook.webhook_url,
            });
          } else {
            await supabase
              .from("pins")
              .update({
                status: "failed",
                retry_count: currentRetryCount + 1,
                next_retry_at: null,
                last_failure_reason: errorMessage,
                last_attempt_at: new Date().toISOString(),
                failure_type: failureType,
                processing_started_at: null,
              })
              .eq("id", currentPin.id);

            await supabase.from("logs").insert({
              pin_id: currentPin.id,
              account_id: account.id,
              webhook_id: targetWebhook.id || null,
              status: "error",
              message: `Final Failure (${failureType}): ${errorMessage}`,
              webhook_used: targetWebhook.webhook_url,
            });
          }

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
        const isAbort = fetchErr?.name === "AbortError";
        const errorMessage = isAbort
          ? "Webhook dispatch timed out after 15 seconds"
          : `Network error dispatching webhook: ${fetchErr?.message || String(fetchErr)}`;

        const currentRetryCount = (currentPin as any).retry_count || 0;
        const maxRetries = (currentPin as any).max_retries || 3;
        const isEligibleForRetry = currentRetryCount < maxRetries;
        const deliveryEventType = isEligibleForRetry ? 'provider_error' : 'failed';

        // Log delivery error event in pin_delivery_logs
        try {
          await supabase.rpc('append_pin_delivery_log', {
            p_pin_id: currentPin.id,
            p_attempt_no: currentRetryCount + 1,
            p_event_type: deliveryEventType,
            p_provider: targetWebhook.label || 'Webhook Provider',
            p_http_status: 504,
            p_error_message: errorMessage,
            p_metadata: {
              webhook_id: targetWebhook.id || null,
              is_abort: isAbort,
            },
          });
        } catch (_logErr) {
          console.warn("Failed to append delivery error log:", _logErr);
        }

        if (isEligibleForRetry) {
          const nextRetryCount = currentRetryCount + 1;
          const expDelay = Math.min(1800, 60 * Math.pow(2, nextRetryCount));
          const jitterSec = expDelay * (0.5 + Math.random() * 0.5);
          const nextRetryAt = new Date(Date.now() + jitterSec * 1000).toISOString();

          await supabase
            .from("pins")
            .update({
              status: "pending",
              retry_count: nextRetryCount,
              next_retry_at: nextRetryAt,
              last_failure_reason: errorMessage,
              last_attempt_at: new Date().toISOString(),
              failure_type: "transient",
              processing_started_at: null,
            })
            .eq("id", currentPin.id);

          await supabase.from("logs").insert({
            pin_id: currentPin.id,
            account_id: account.id,
            webhook_id: targetWebhook.id || null,
            status: "error",
            message: `Attempt ${nextRetryCount}/${maxRetries} failed: ${errorMessage}. Retrying in ${Math.round(jitterSec / 60)}m.`,
            webhook_used: targetWebhook.webhook_url,
          });
        } else {
          await supabase
            .from("pins")
            .update({
              status: "failed",
              retry_count: currentRetryCount + 1,
              next_retry_at: null,
              last_failure_reason: errorMessage,
              last_attempt_at: new Date().toISOString(),
              failure_type: "transient",
              processing_started_at: null,
            })
            .eq("id", currentPin.id);

          await supabase.from("logs").insert({
            pin_id: currentPin.id,
            account_id: account.id,
            webhook_id: targetWebhook.id || null,
            status: "error",
            message: `Final Failure (transient exhausted): ${errorMessage}`,
            webhook_used: targetWebhook.webhook_url,
          });
        }

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
            .eq("id", targetWebhook.id);
        }

        failedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        accounts_checked: processedAccounts,
        pins_processed: sentCount,
        pins_failed: failedCount,
        skipped_due_to_limit: skippedDueToLimit,
        skipped_due_to_window: skippedDueToWindow,
        skipped_due_to_interval: skippedDueToInterval,
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
