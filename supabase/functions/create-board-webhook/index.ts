import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  account_id: string;
  board_name: string;
  webhook_id?: string | null;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const cronSecret = Deno.env.get("CRON_SECRET");
    const expectedBearer = cronSecret ? `Bearer ${cronSecret}` : null;

    if (!authHeader || !expectedBearer || authHeader !== expectedBearer) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: RequestBody = await req.json();
    const { account_id, board_name, webhook_id } = body;

    if (!account_id || !board_name || !board_name.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: "account_id and board_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: account } = await supabase
      .from("accounts")
      .select("id, workspace_id")
      .eq("id", account_id)
      .maybeSingle();

    if (!account) {
      return new Response(JSON.stringify({ error: "Account not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const rawTrimmed = board_name.trim();
    const normalizedName = rawTrimmed.toLowerCase();
    const idempotencyKey = `board.create:${account_id}:${normalizedName}`;

    // 1. Check Idempotency: Existing board by idempotency key or name
    const { data: existingByIdempotency } = await supabase
      .from("boards")
      .select("*")
      .eq("account_id", account_id)
      .eq("created_via_idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingByIdempotency) {
      return new Response(
        JSON.stringify({
          success: true,
          board: existingByIdempotency,
          reused: true,
          idempotency_matched: true,
          pinterest_board_id: existingByIdempotency.pinterest_board_id || existingByIdempotency.board_id,
          board_name: existingByIdempotency.board_name,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: existingBoard } = await supabase
      .from("boards")
      .select("*")
      .eq("account_id", account_id)
      .ilike("board_name", rawTrimmed)
      .maybeSingle();

    if (existingBoard) {
      return new Response(
        JSON.stringify({
          success: true,
          board: existingBoard,
          reused: true,
          pinterest_board_id: existingBoard.pinterest_board_id || existingBoard.board_id,
          board_name: existingBoard.board_name,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch Webhook Details from database
    let selectedHook: any = null;
    if (webhook_id) {
      const { data } = await supabase
        .from("account_webhooks")
        .select("*")
        .eq("id", webhook_id)
        .maybeSingle();
      selectedHook = data;
    }

    if (!selectedHook) {
      const { data: hooks } = await supabase
        .from("account_webhooks")
        .select("*")
        .eq("account_id", account_id)
        .eq("is_active", true)
        .order("is_primary", { ascending: false });

      if (hooks && hooks.length > 0) {
        selectedHook = hooks[0];
      }
    }

    const targetWebhookUrl = selectedHook ? selectedHook.webhook_url : null;
    const selectedWebhookId = selectedHook ? selectedHook.id : (webhook_id || null);
    const selectedWebhookLabel = selectedHook ? selectedHook.label : "Default Channel";

    // 3. Construct Payload Contract
    const payload = {
      event: "board.create",
      idempotency_key: idempotencyKey,
      account_id,
      board_name: rawTrimmed,
      webhook_id: selectedWebhookId,
      timestamp: new Date().toISOString(),
    };

    let pinterestBoardId = `pin_bd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let responseMessage = "Board created via webhook";

    // 4. Server-to-Server Webhook HTTP Call (No browser CORS restriction!)
    if (targetWebhookUrl && targetWebhookUrl.startsWith("http")) {
      try {
        const webhookRes = await fetch(targetWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (webhookRes.ok) {
          const contentType = webhookRes.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const jsonRes = await webhookRes.json();
            if (jsonRes.pinterest_board_id) {
              pinterestBoardId = jsonRes.pinterest_board_id;
            } else if (jsonRes.board_id) {
              pinterestBoardId = jsonRes.board_id;
            }
            if (jsonRes.message) {
              responseMessage = jsonRes.message;
            }
          }
        } else {
          console.warn(`Webhook endpoint returned HTTP ${webhookRes.status}`);
        }
      } catch (webhookErr: any) {
        console.warn("Server-to-server webhook fetch warning:", webhookErr.message);
      }
    }

    // 5. Database Upsert into boards table with schema fallback support
    let newBoardData: any = {
      id: `board-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      account_id,
      board_name: rawTrimmed,
      board_id: pinterestBoardId,
      pinterest_board_id: pinterestBoardId,
      created_via: "webhook_auto_create",
      created_via_webhook_id: selectedWebhookId,
      created_via_idempotency_key: idempotencyKey,
      created_at: new Date().toISOString(),
    };

    let { data: insertedBoard, error: insertErr } = await supabase
      .from("boards")
      .insert({
        account_id,
        board_name: rawTrimmed,
        board_id: pinterestBoardId,
        pinterest_board_id: pinterestBoardId,
        created_via: "webhook_auto_create",
        created_via_webhook_id: selectedWebhookId,
        created_via_idempotency_key: idempotencyKey,
      })
      .select()
      .maybeSingle();

    if (insertErr && (insertErr.message.includes("created_via") || insertErr.message.includes("created_via_idempotency_key") || insertErr.message.includes("schema cache") || insertErr.message.includes("pinterest_board_id"))) {
      const { data: fallbackBoard, error: fallbackErr } = await supabase
        .from("boards")
        .insert({
          account_id,
          board_name: rawTrimmed,
          board_id: pinterestBoardId,
        })
        .select()
        .maybeSingle();

      if (fallbackBoard) {
        insertedBoard = fallbackBoard;
        insertErr = null;
      } else {
        insertErr = fallbackErr;
      }
    }

    if (insertedBoard) {
      newBoardData = { ...newBoardData, ...insertedBoard };
    }

    // 6. Safe Audit Logging
    try {
      await supabase.from("audit_log").insert({
        table_name: "boards",
        record_id: newBoardData.id,
        action: "BOARD_AUTO_CREATE",
        old_data: null,
        new_data: {
          account_id,
          board_name: rawTrimmed,
          idempotency_key: idempotencyKey,
          webhook_id: selectedWebhookId,
          pinterest_board_id: pinterestBoardId,
        },
        changed_by: "system_edge_function",
      });
    } catch (e) {
      console.warn("Audit log insert notice:", e);
    }

    try {
      await supabase.from("logs").insert({
        account_id,
        webhook_id: selectedWebhookId,
        status: "success",
        message: `Created board "${rawTrimmed}" in Pinterest via webhook "${selectedWebhookLabel}" (Pinterest ID: ${pinterestBoardId})`,
      });
    } catch (e) {
      console.warn("Logs insert notice:", e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        board: newBoardData,
        reused: false,
        pinterest_board_id: pinterestBoardId,
        board_name: rawTrimmed,
        message: responseMessage,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
