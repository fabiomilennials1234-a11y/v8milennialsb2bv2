/**
 * stripe-webhook: porta pública, autenticada pelo HMAC da Stripe (verify_jwt=false).
 * Sem IP allowlist: HMAC é a defesa, e X-Forwarded-For não é confiável aqui.
 *
 * O corpo é lido com `req.text()`: reserializar JSON quebra a assinatura.
 * A lógica mora em handler.ts.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { readStripeConfig } from "../_shared/stripe/env.ts";
import { createStripeGateway, createStripeSdk, stripeErrorInfo, verifyStripeWebhook } from "../_shared/stripe/client.ts";
import { handleStripeWebhook } from "./handler.ts";

Deno.serve(
  withErrorBoundary("stripe-webhook", async (req: Request): Promise<Response> => {
    const headers = withSecurityHeaders({ ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
    }

    const config = readStripeConfig((name) => Deno.env.get(name));
    const rawBody = await req.text();

    // Só instancia o cliente com a configuração validada: critério 11.
    const secretKey = config.ok ? config.config.secretKey : "";
    const webhookSecret = config.ok ? config.config.webhookSecret ?? "" : "";
    const sdk = config.ok ? createStripeSdk(secretKey) : null;
    const gateway = config.ok ? createStripeGateway(secretKey) : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { status, body } = await handleStripeWebhook(
      { rawBody, signature: req.headers.get("stripe-signature") },
      {
        config,
        verify: (raw, signature) => verifyStripeWebhook(sdk!, raw, signature, webhookSecret),
        retrieveSubscription: (id) => gateway!.retrieveSubscription(id),
        describeError: stripeErrorInfo,
        insertEvent: async (row) => {
          const { data, error } = await supabase
            .from("payment_webhook_events")
            .insert({ provider: "stripe", ...row })
            .select("id")
            .maybeSingle();
          return { data, error };
        },
        findEvent: async (providerEventId) => {
          const { data, error } = await supabase
            .from("payment_webhook_events")
            .select("id, status")
            .eq("provider", "stripe")
            .eq("provider_event_id", providerEventId)
            .maybeSingle();
          return { data, error };
        },
        markEvent: async (id, newStatus, errorMessage) => {
          const { error } = await supabase
            .from("payment_webhook_events")
            .update({ status: newStatus, error_message: errorMessage, processed_at: new Date().toISOString() })
            .eq("id", id);
          if (error) {
            await logRuntime({
              module: "billing",
              action: "stripe_webhook_marcar_falhou",
              status: "error",
              errorMessage: error.message,
              payloadSnapshot: { event_row_id: id },
            });
          }
        },
        rpc: async (name, args) => {
          const { data, error } = await supabase.rpc(name, args);
          return { data, error };
        },
        log: (entry) => logRuntime({ module: "billing", ...entry }),
      },
    );

    return new Response(JSON.stringify(body), { status, headers });
  }),
);
