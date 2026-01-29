/**
 * Worker: processa fila webhook_deliveries (envia requests, grava logs, retry com backoff).
 * Chamado por pg_cron a cada minuto ou manualmente com x-cron-secret.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  validateUrl,
  sendWebhook,
  nextRetryDelayMinutes,
} from "../_shared/webhook-utils.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const BATCH_SIZE = 100;

interface WebhookRow {
  id: string;
  url: string;
  secret: string | null;
  http_method: "POST" | "PUT" | "PATCH";
  custom_headers: Record<string, string>;
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  attempt: number;
  max_attempts: number;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (CRON_SECRET && cronSecret !== CRON_SECRET) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date().toISOString();

  const { data: deliveries, error: fetchError } = await supabase
    .from("webhook_deliveries")
    .select("id, webhook_id, event, payload, attempt, max_attempts")
    .lte("next_retry_at", now)
    .order("next_retry_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchError) {
    console.error("[process-webhook-deliveries] Fetch error:", fetchError);
    return new Response(
      JSON.stringify({ error: "Failed to fetch deliveries", details: fetchError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!deliveries?.length) {
    return new Response(
      JSON.stringify({ processed: 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let processed = 0;
  for (const d of deliveries as DeliveryRow[]) {
    const { data: webhook, error: whError } = await supabase
      .from("webhooks")
      .select("url, secret, http_method, custom_headers")
      .eq("id", d.webhook_id)
      .single();

    if (whError || !webhook) {
      await supabase.from("webhook_delivery_logs").insert({
        webhook_id: d.webhook_id,
        event: d.event,
        attempt: d.attempt,
        status_code: null,
        response_body: "",
        error_message: whError?.message ?? "Webhook not found",
      });
      await supabase.from("webhook_deliveries").delete().eq("id", d.id);
      processed++;
      continue;
    }

    const wh = webhook as WebhookRow;
    const customHeaders = (wh.custom_headers && typeof wh.custom_headers === "object")
      ? (wh.custom_headers as Record<string, string>)
      : {};

    const urlValidation = await validateUrl(wh.url);
    if (!urlValidation.valid) {
      await supabase.from("webhook_delivery_logs").insert({
        webhook_id: d.webhook_id,
        event: d.event,
        attempt: d.attempt,
        status_code: null,
        response_body: "",
        error_message: urlValidation.error ?? "URL invalid",
      });
      if (d.attempt >= d.max_attempts) {
        await supabase.from("webhook_deliveries").delete().eq("id", d.id);
      } else {
        const delayMin = nextRetryDelayMinutes(d.attempt);
        const nextRetry = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
        await supabase
          .from("webhook_deliveries")
          .update({ attempt: d.attempt + 1, next_retry_at: nextRetry })
          .eq("id", d.id);
      }
      processed++;
      continue;
    }

    const result = await sendWebhook({
      url: wh.url,
      method: wh.http_method,
      payload: d.payload as Record<string, unknown>,
      secret: wh.secret,
      customHeaders,
      deliveryId: d.id,
      event: d.event,
    });

    await supabase.from("webhook_delivery_logs").insert({
      webhook_id: d.webhook_id,
      event: d.event,
      attempt: d.attempt,
      status_code: result.statusCode,
      response_body: result.responseBody,
      error_message: result.errorMessage ?? null,
    });

    const success = result.statusCode != null && result.statusCode >= 200 && result.statusCode < 300;
    if (success) {
      await supabase.from("webhook_deliveries").delete().eq("id", d.id);
    } else if (d.attempt >= d.max_attempts) {
      await supabase.from("webhook_deliveries").delete().eq("id", d.id);
    } else {
      const delayMin = nextRetryDelayMinutes(d.attempt);
      const nextRetry = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
      await supabase
        .from("webhook_deliveries")
        .update({ attempt: d.attempt + 1, next_retry_at: nextRetry })
        .eq("id", d.id);
    }
    processed++;
  }

  return new Response(
    JSON.stringify({ processed }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
