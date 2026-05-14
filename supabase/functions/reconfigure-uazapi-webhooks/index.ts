// deno-lint-ignore-file no-explicit-any
/**
 * reconfigure-uazapi-webhooks — Update webhook URL for all Uazapi instances
 * to include the uazapi_instance_id in the path.
 *
 * New URL format:
 *   https://<ref>.supabase.co/functions/v1/whatsapp-webhook/<SECRET>/<UAZAPI_INSTANCE_ID>
 *
 * Auth: x-cron-secret header.
 * Idempotent: safe to run multiple times.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { UazapiClient } from "../_shared/uazapi-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const UAZAPI_BASE_URL = Deno.env.get("UAZAPI_BASE_URL") ?? "";
const UAZAPI_WEBHOOK_SECRET = Deno.env.get("UAZAPI_WEBHOOK_SECRET") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const cronSecret = req.headers.get("x-cron-secret") ?? "";
  if (!CRON_SECRET || cronSecret !== CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: instances, error } = await supabase
    .from("whatsapp_instance_secrets")
    .select("instance_id, uazapi_instance_id, uazapi_token");

  if (error || !instances?.length) {
    return new Response(JSON.stringify({ error: "no instances", detail: error?.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];

  for (const inst of instances) {
    if (!inst.uazapi_token || !inst.uazapi_instance_id) {
      results.push({ instance_id: inst.instance_id, status: "skipped", reason: "missing token or uazapi_instance_id" });
      continue;
    }

    const webhookUrl = `${SUPABASE_URL}/functions/v1/whatsapp-webhook/${UAZAPI_WEBHOOK_SECRET}/${inst.uazapi_instance_id}`;

    const client = new UazapiClient({
      baseUrl: UAZAPI_BASE_URL,
      token: inst.uazapi_token,
    });

    try {
      await client.updateWebhook({
        url: webhookUrl,
        events: ["messages", "messages_update", "connection", "payment_response"],
        excludeMessages: ["messages_from_me"],
        addUrlEvents: false,
        enabled: true,
      });
      results.push({ instance_id: inst.instance_id, uazapi_id: inst.uazapi_instance_id, status: "ok", url: webhookUrl });
    } catch (err) {
      results.push({
        instance_id: inst.instance_id,
        uazapi_id: inst.uazapi_instance_id,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Response(JSON.stringify({ updated: results.filter((r) => r.status === "ok").length, total: instances.length, results }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
