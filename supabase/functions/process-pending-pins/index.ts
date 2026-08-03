import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Define TypeScript interfaces for database models
interface Account {
  id: string;
  account_name: string;
  webhook_url: string;
  max_pins_per_day: number;
  is_active: boolean;
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
  status: 'pending' | 'posted' | 'failed';
  source: string;
  created_at: string;
}

Deno.serve(async (req: Request) => {
  // Allow OPTIONS for CORS preflight
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

  // Validate token against CRON_SECRET or SUPABASE_SERVICE_ROLE_KEY
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

  // Summary counters
  let processedAccounts = 0;
  let sentCount = 0;
  let failedCount = 0;
  let skippedDueToLimit = 0;
  let skippedDueToMissingBoard = 0;

  try {
    // 3. Fetch all active accounts
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
          message: "No active accounts found",
          processed_accounts: 0,
          sent: 0,
          failed: 0,
          skipped_due_to_limit: 0,
          skipped_due_to_missing_board: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Today's start timestamp in UTC for daily limit checking
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startOfDayIso = startOfDay.toISOString();

    // Process accounts (1 pin per active account per cycle to avoid flooding)
    for (const account of accounts as Account[]) {
      // Fetch earliest pending pin for this account
      const { data: pendingPins, error: pinsError } = await supabase
        .from("pins")
        .select("*")
        .eq("account_id", account.id)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1);

      if (pinsError) {
        console.error(`Error fetching pending pins for account ${account.account_name}:`, pinsError);
        continue;
      }

      if (!pendingPins || pendingPins.length === 0) {
        continue; // No pending pins for this account
      }

      processedAccounts++;
      const currentPin = pendingPins[0] as Pin;

      // 4. Daily limit check: count successful logs today for this account
      const { count: todayPostedCount, error: countError } = await supabase
        .from("logs")
        .select("id", { count: "exact", head: true })
        .eq("account_id", account.id)
        .eq("status", "success")
        .gte("created_at", startOfDayIso);

      if (countError) {
        console.error(`Error checking daily count for account ${account.account_name}:`, countError);
        continue;
      }

      const currentDailyCount = todayPostedCount || 0;
      if (currentDailyCount >= account.max_pins_per_day) {
        skippedDueToLimit++;
        continue;
      }

      // 5. Board matching
      if (!currentPin.board_name || currentPin.board_name.trim() === "") {
        // No board specified
        await supabase
          .from("pins")
          .update({ status: "failed" })
          .eq("id", currentPin.id);

        await supabase.from("logs").insert({
          pin_id: currentPin.id,
          account_id: account.id,
          status: "error",
          message: "Board name is missing on pin",
          webhook_used: null,
        });

        skippedDueToMissingBoard++;
        continue;
      }

      // Query matching board in boards table for this account
      const { data: matchedBoards, error: boardError } = await supabase
        .from("boards")
        .select("*")
        .eq("account_id", account.id)
        .ilike("board_name", currentPin.board_name.trim())
        .limit(1);

      if (boardError || !matchedBoards || matchedBoards.length === 0) {
        // Board not found
        await supabase
          .from("pins")
          .update({ status: "failed" })
          .eq("id", currentPin.id);

        await supabase.from("logs").insert({
          pin_id: currentPin.id,
          account_id: account.id,
          status: "error",
          message: "Board not found for this account",
          webhook_used: null,
        });

        skippedDueToMissingBoard++;
        continue;
      }

      const matchedBoard = matchedBoards[0] as Board;

      // 6. Webhook execution
      if (!account.webhook_url || account.webhook_url.trim() === "") {
        await supabase
          .from("pins")
          .update({ status: "failed" })
          .eq("id", currentPin.id);

        await supabase.from("logs").insert({
          pin_id: currentPin.id,
          account_id: account.id,
          status: "error",
          message: "Webhook URL missing for account",
          webhook_used: null,
        });

        failedCount++;
        continue;
      }

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
        const webhookResponse = await fetch(account.webhook_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        // 7. Result handling
        if (webhookResponse.ok) {
          // Success
          await supabase
            .from("pins")
            .update({
              status: "posted",
              posted_at: new Date().toISOString(),
            })
            .eq("id", currentPin.id);

          await supabase.from("logs").insert({
            pin_id: currentPin.id,
            account_id: account.id,
            status: "success",
            message: "Sent to Make successfully",
            webhook_used: account.webhook_url,
          });

          sentCount++;
        } else {
          // Webhook responded with error HTTP status
          const responseText = await webhookResponse.text();
          const errorMessage = `Webhook failed [HTTP ${webhookResponse.status}]: ${responseText.slice(0, 500)}`;

          await supabase
            .from("pins")
            .update({ status: "failed" })
            .eq("id", currentPin.id);

          await supabase.from("logs").insert({
            pin_id: currentPin.id,
            account_id: account.id,
            status: "error",
            message: errorMessage,
            webhook_used: account.webhook_url,
          });

          failedCount++;
        }
      } catch (fetchErr: any) {
        // Network or fetch error
        const errorMessage = `Network error calling webhook: ${fetchErr?.message || String(fetchErr)}`;

        await supabase
          .from("pins")
          .update({ status: "failed" })
          .eq("id", currentPin.id);

        await supabase.from("logs").insert({
          pin_id: currentPin.id,
          account_id: account.id,
          status: "error",
          message: errorMessage,
          webhook_used: account.webhook_url,
        });

        failedCount++;
      }
    }

    // 8. Return JSON Summary
    return new Response(
      JSON.stringify({
        processed_accounts: processedAccounts,
        sent: sentCount,
        failed: failedCount,
        skipped_due_to_limit: skippedDueToLimit,
        skipped_due_to_missing_board: skippedDueToMissingBoard,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: err.message || "Internal server error during processing",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
