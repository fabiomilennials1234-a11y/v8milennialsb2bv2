/**
 * billing-checkout-subscription: porta pública do checkout (verify_jwt=false).
 * A autorização é o conhecimento do token, que é credencial: nunca em log nem em erro.
 * A lógica mora em flow.ts.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { readStripeConfig } from "../_shared/stripe/env.ts";
import { createStripeGateway, stripeErrorInfo } from "../_shared/stripe/client.ts";
import { parseCheckoutInput, runCheckout, withinRateLimit, type CheckoutLogEntry } from "./flow.ts";

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

Deno.serve(
  withErrorBoundary("billing-checkout-subscription", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

    const log = (entry: CheckoutLogEntry) => logRuntime({ module: "billing", ...entry });

    // Antes de tudo: configuração divergente não chega a instanciar cliente.
    const config = readStripeConfig((name) => Deno.env.get(name));
    if (!config.ok) {
      await log({
        action: "checkout_nao_configurado",
        status: "error",
        errorMessage: config.reason,
      });
      return json(503, { state: "billing_not_configured" });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json(400, { error: "malformed_body" });
    }
    const input = parseCheckoutInput(raw);
    if (!input) return json(400, { error: "malformed_body" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(name, args);
      return { data, error };
    };

    if (!(await withinRateLimit(rpc, input.token, clientIp(req), log))) {
      return json(429, { state: "rate_limited" }, { "Retry-After": "300" });
    }

    const outcome = await runCheckout(input, {
      env: config.config.env,
      livemode: config.config.livemode,
      gateway: createStripeGateway(config.config.secretKey),
      describeError: stripeErrorInfo,
      log,
      db: {
        resolveLink: async (token) => {
          const { data, error } = await rpc("billing_resolve_payment_link", { p_token: token });
          return { data: data as Record<string, unknown> | null, error };
        },
        upsertBuyer: async (a) => {
          const { data, error } = await rpc("billing_upsert_link_buyer", {
            p_link_id: a.linkId,
            p_provider: a.providerCustomerId ? "stripe" : null,
            p_provider_customer_id: a.providerCustomerId,
            p_legal_name: a.legalName,
            p_email: a.email,
            p_tax_id: a.taxId,
          });
          return { data: data as { ok?: boolean; code?: string } | null, error };
        },
        recordConsent: async (linkId, version) => {
          const { data, error } = await rpc("billing_stripe_record_consent", {
            p_link_id: linkId,
            p_version: version,
          });
          return { data: data as { ok?: boolean; code?: string } | null, error };
        },
        attachCheckout: async (a) => {
          const { data, error } = await rpc("billing_stripe_attach_checkout", {
            p_link_id: a.linkId,
            p_subscription_id: a.subscriptionId,
            p_invoice_id: a.invoiceId,
            p_customer_id: a.customerId,
            p_attempt: a.attempt,
          });
          return { data: data as { ok?: boolean; code?: string; must_cancel?: boolean; reason?: string | null } | null, error };
        },
        getOrgCustomer: async (orgId) =>
          await supabase
            .from("org_billing_customers")
            .select("provider_customer_id, livemode")
            .eq("organization_id", orgId)
            .maybeSingle(),
        insertOrgCustomer: async (orgId, customerId, livemode) => {
          const { error } = await supabase.from("org_billing_customers").insert({
            organization_id: orgId,
            provider: "stripe",
            provider_customer_id: customerId,
            livemode,
          });
          return { error };
        },
        getLinkCharge: async (linkId) =>
          await supabase
            .from("payment_link_charges")
            .select("provider, provider_subscription_id, attempt")
            .eq("payment_link_id", linkId)
            .eq("method", "credit_card")
            .maybeSingle(),
        otherLinkSubscriptions: async (orgId, linkId) => {
          const { data, error } = await supabase
            .from("payment_link_charges")
            .select("provider_subscription_id, payment_links!inner(organization_id, revoked_at)")
            .eq("provider", "stripe")
            .not("provider_subscription_id", "is", null)
            .neq("payment_link_id", linkId)
            .eq("payment_links.organization_id", orgId);
          return {
            data: (data ?? []).map((r) => ({
              subscription_id: r.provider_subscription_id as string,
              link_revoked: (r.payment_links as unknown as { revoked_at: string | null }).revoked_at !== null,
            })),
            error,
          };
        },
        currentSubscription: async (orgId) =>
          await supabase
            .from("org_subscriptions")
            .select("provider_subscription_id")
            .eq("organization_id", orgId)
            .is("cancelled_at", null)
            .maybeSingle(),
      },
    });

    return json(outcome.status, outcome.body);
  }),
);
