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
import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const BATCH_SIZE = 100;
const CIRCUIT_BREAKER_THRESHOLD = 10;

interface WebhookRow {
  id: string;
  url: string;
  secret: string | null;
  http_method: "POST" | "PUT" | "PATCH";
  custom_headers: Record<string, string>;
  consecutive_failures: number;
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  attempt: number;
  max_attempts: number;
}

Deno.serve(withSentry('process-webhook-deliveries', async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || cronSecret !== CRON_SECRET) {
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
    await logRuntime({
      module: "webhook",
      action: "deliver",
      status: "error",
      errorMessage: fetchError.message,
    });
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
      .select("id, name, organization_id, url, secret, http_method, custom_headers, consecutive_failures, is_active")
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
      // Circuit breaker: reset consecutive failures on success
      await supabase
        .from("webhooks")
        .update({ consecutive_failures: 0 })
        .eq("id", d.webhook_id);
    } else if (d.attempt >= d.max_attempts) {
      // Move to dead letter queue instead of discarding
      await supabase.from("webhook_dead_letters").insert({
        webhook_id: d.webhook_id,
        event: d.event,
        payload: d.payload,
        attempts: d.attempt,
        last_status_code: result.statusCode,
        last_error: result.errorMessage ?? null,
        last_response_body: result.responseBody || null,
      });
      await supabase.from("webhook_deliveries").delete().eq("id", d.id);

      // Circuit breaker: increment and check threshold
      const newFailures = (wh.consecutive_failures ?? 0) + 1;
      if (newFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        await supabase
          .from("webhooks")
          .update({
            consecutive_failures: newFailures,
            is_active: false,
            disabled_reason: "Circuit breaker: 10+ consecutive failures",
          })
          .eq("id", d.webhook_id);

        // Onda 2 / T2.D.1: cria system_alert apenas na 1ª desativação
        // (wh.is_active==true antes do update). Evita dup em cada falha.
        if (wh.is_active) {
          await supabase.from("system_alerts").insert({
            organization_id: wh.organization_id,
            severity: "critical",
            category: "webhook_circuit_breaker",
            source_type: "webhook",
            source_id: wh.id,
            title: "Webhook desativado por falhas consecutivas",
            message: `${wh.name} (${wh.url}) atingiu ${CIRCUIT_BREAKER_THRESHOLD} falhas consecutivas e foi desativado.`,
            metadata: { url: wh.url, last_error: result.errorMessage ?? null, failures: newFailures },
          });
        }
      } else {
        await supabase
          .from("webhooks")
          .update({ consecutive_failures: newFailures })
          .eq("id", d.webhook_id);
      }
    } else {
      const delayMin = nextRetryDelayMinutes(d.attempt);
      const nextRetry = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
      await supabase
        .from("webhook_deliveries")
        .update({ attempt: d.attempt + 1, next_retry_at: nextRetry })
        .eq("id", d.id);

      // Circuit breaker: increment and check threshold
      const newFailures = (wh.consecutive_failures ?? 0) + 1;
      if (newFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        await supabase
          .from("webhooks")
          .update({
            consecutive_failures: newFailures,
            is_active: false,
            disabled_reason: "Circuit breaker: 10+ consecutive failures",
          })
          .eq("id", d.webhook_id);

        // Onda 2 / T2.D.1: cria system_alert apenas na 1ª desativação
        // (wh.is_active==true antes do update). Evita dup em cada falha.
        if (wh.is_active) {
          await supabase.from("system_alerts").insert({
            organization_id: wh.organization_id,
            severity: "critical",
            category: "webhook_circuit_breaker",
            source_type: "webhook",
            source_id: wh.id,
            title: "Webhook desativado por falhas consecutivas",
            message: `${wh.name} (${wh.url}) atingiu ${CIRCUIT_BREAKER_THRESHOLD} falhas consecutivas e foi desativado.`,
            metadata: { url: wh.url, last_error: result.errorMessage ?? null, failures: newFailures },
          });
        }
      } else {
        await supabase
          .from("webhooks")
          .update({ consecutive_failures: newFailures })
          .eq("id", d.webhook_id);
      }
    }
    processed++;
  }

  await logRuntime({
    module: "webhook",
    action: "deliver",
    status: "success",
    payloadSnapshot: { processed },
  });

  return new Response(
    JSON.stringify({ processed }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}));
