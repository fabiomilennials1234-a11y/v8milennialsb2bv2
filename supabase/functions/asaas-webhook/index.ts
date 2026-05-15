/**
 * asaas-webhook
 *
 * Receives webhook events from Asaas and routes them to the appropriate
 * handlers. Always returns HTTP 200 to Asaas (even on internal errors) to
 * prevent retries — errors are logged to runtime_logs and Sentry instead.
 *
 * Supported events:
 *   PAYMENT_CONFIRMED / PAYMENT_RECEIVED  → provision org (first payment) or update status
 *   PAYMENT_OVERDUE                        → mark org as overdue
 *   PAYMENT_DELETED / PAYMENT_REFUNDED    → suspend org, mark payment refunded
 *   SUBSCRIPTION_DELETED                  → cancel org subscription
 *
 * Authentication: asaas-access-token header validated against ASAAS_WEBHOOK_TOKEN env var.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry, captureError } from "../_shared/sentry.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AsaasPaymentPayload {
  id: string;
  customer: string;
  billingType: string;
  value: number;
  status: string;
  externalReference?: string;
  subscription?: string;
  [key: string]: unknown;
}

interface AsaasWebhookBody {
  event: string;
  payment?: AsaasPaymentPayload;
  subscription?: {
    id: string;
    customer: string;
    status: string;
    [key: string]: unknown;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ASAAS_WEBHOOK_TOKEN = Deno.env.get("ASAAS_WEBHOOK_TOKEN");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ack(extra?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ received: true, ...extra }),
    { status: 200, headers: withSecurityHeaders({ "Content-Type": "application/json" }) },
  );
}

function createSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// ─── Org lookup ───────────────────────────────────────────────────────────────

/**
 * Locate an organization using the available identifiers on a payment event.
 *
 * Strategy:
 *   1. payment.customer  → organizations.payment_customer_id
 *   2. payment.subscription → organizations.payment_subscription_id
 *   3. payment.externalReference (user_id) → team_members → organization_id
 *
 * Returns null when nothing matches.
 */
async function findOrgByPayment(
  supabase: ReturnType<typeof createSupabase>,
  payment: AsaasPaymentPayload,
): Promise<string | null> {
  // 1. By Asaas customer ID (most reliable for recurring payments)
  if (payment.customer) {
    const { data } = await supabase
      .from("organizations")
      .select("id")
      .eq("payment_customer_id", payment.customer)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  // 2. By subscription ID
  if (payment.subscription) {
    const { data } = await supabase
      .from("organizations")
      .select("id")
      .eq("payment_subscription_id", payment.subscription)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  // 3. By externalReference = user_id → team_members (handles first PIX payments)
  if (payment.externalReference) {
    const { data } = await supabase
      .from("team_members")
      .select("organization_id")
      .eq("user_id", payment.externalReference)
      .maybeSingle();
    if (data?.organization_id) return data.organization_id;
  }

  return null;
}

/**
 * Locate an organization by subscription ID (SUBSCRIPTION_DELETED events).
 */
async function findOrgBySubscription(
  supabase: ReturnType<typeof createSupabase>,
  subscriptionId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("payment_subscription_id", subscriptionId)
    .maybeSingle();
  return data?.id ?? null;
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * PAYMENT_CONFIRMED / PAYMENT_RECEIVED
 *
 * First-time payment: call checkout-provision-org to create the org.
 * Recurring payment:  update payment_history and set subscription_status = 'active'.
 */
async function handlePaymentConfirmed(
  supabase: ReturnType<typeof createSupabase>,
  payment: AsaasPaymentPayload,
  eventName: string,
): Promise<void> {
  const userId = payment.externalReference;

  // ── Check if org already exists for this user ────────────────────────────
  let existingOrgId: string | null = null;

  if (userId) {
    const { data: memberRow } = await supabase
      .from("team_members")
      .select("organization_id")
      .eq("user_id", userId)
      .maybeSingle();
    existingOrgId = memberRow?.organization_id ?? null;
  }

  // Also check by customer ID (handles cases where externalReference is absent)
  if (!existingOrgId && payment.customer) {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("id")
      .eq("payment_customer_id", payment.customer)
      .maybeSingle();
    existingOrgId = orgRow?.id ?? null;
  }

  // ── Idempotency: skip if already processed this exact payment ────────────
  if (existingOrgId) {
    const { data: existingPayment } = await supabase
      .from("payment_history")
      .select("id, status")
      .eq("asaas_payment_id", payment.id)
      .maybeSingle();

    if (existingPayment && existingPayment.status === "confirmed") {
      console.log(`[asaas-webhook] ${eventName} already processed: ${payment.id} — skipping`);
      await logRuntime({
        organizationId: existingOrgId,
        module: "asaas-webhook",
        action: `${eventName.toLowerCase()}_skipped_duplicate`,
        status: "skipped",
        entityType: "payment",
        entityId: payment.id,
      });
      return;
    }
  }

  // ── First payment: provision the org ────────────────────────────────────
  if (!existingOrgId) {
    if (!userId) {
      console.error(`[asaas-webhook] ${eventName}: no externalReference for first payment ${payment.id}`);
      await logRuntime({
        module: "asaas-webhook",
        action: `${eventName.toLowerCase()}_missing_user_ref`,
        status: "error",
        errorMessage: "externalReference (user_id) missing — cannot provision org",
        entityType: "payment",
        entityId: payment.id,
      });
      return;
    }

    console.log(`[asaas-webhook] ${eventName}: first payment — provisioning org for user ${userId}`);

    // ── Validate payment amount against checkout_data (C3 + M1) ──────────
    const { data: { user: payingUser } } = await supabase.auth.admin.getUserById(userId);
    const checkoutData = (payingUser?.user_metadata as Record<string, unknown>)?.checkout_data as
      | { total_cycle?: number; coupon_id?: string }
      | undefined;

    if (checkoutData?.total_cycle != null) {
      const expectedAmount = checkoutData.total_cycle;
      const actualAmount = payment.value;
      const tolerance = expectedAmount * 0.01; // 1% tolerance for rounding

      if (Math.abs(actualAmount - expectedAmount) > tolerance) {
        console.error(
          `[asaas-webhook] ${eventName}: amount mismatch — expected ${expectedAmount}, got ${actualAmount} (payment ${payment.id})`,
        );
        await logRuntime({
          module: "asaas-webhook",
          action: `${eventName.toLowerCase()}_amount_mismatch`,
          status: "error",
          errorMessage: `Expected ${expectedAmount}, received ${actualAmount}`,
          entityType: "payment",
          entityId: payment.id,
          triggeredBy: userId,
          payloadSnapshot: { expected: expectedAmount, actual: actualAmount },
        });
        return; // Skip provisioning — possible fake/partial payment
      }
    }

    const provisionRes = await fetch(
      `${SUPABASE_URL}/functions/v1/checkout-provision-org`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: userId, asaas_payment_id: payment.id }),
      },
    );

    if (!provisionRes.ok) {
      const body = await provisionRes.text();
      console.error(`[asaas-webhook] checkout-provision-org failed (${provisionRes.status}): ${body}`);
      await logRuntime({
        module: "asaas-webhook",
        action: "provision_org_failed",
        status: "error",
        errorMessage: `HTTP ${provisionRes.status}: ${body.substring(0, 500)}`,
        entityType: "payment",
        entityId: payment.id,
        triggeredBy: userId,
      });
    } else {
      await logRuntime({
        module: "asaas-webhook",
        action: "provision_org_triggered",
        status: "success",
        entityType: "payment",
        entityId: payment.id,
        triggeredBy: userId,
        payloadSnapshot: { asaas_payment_id: payment.id, value: payment.value },
      });
    }
    return;
  }

  // ── Recurring payment: update status ────────────────────────────────────
  // Update org subscription status to active
  const { error: orgErr } = await supabase
    .from("organizations")
    .update({ subscription_status: "active" })
    .eq("id", existingOrgId);

  if (orgErr) {
    console.error(`[asaas-webhook] Failed to update org subscription_status: ${orgErr.message}`);
  }

  // Upsert payment_history (idempotent via asaas_payment_id UNIQUE)
  const { error: histErr } = await supabase
    .from("payment_history")
    .upsert(
      {
        organization_id: existingOrgId,
        asaas_payment_id: payment.id,
        asaas_subscription_id: payment.subscription ?? null,
        amount: payment.value,
        billing_cycle: "monthly", // default for recurring; provision-org sets the real value
        status: "confirmed",
        paid_at: new Date().toISOString(),
      },
      { onConflict: "asaas_payment_id", ignoreDuplicates: false },
    );

  if (histErr) {
    console.error(`[asaas-webhook] Failed to upsert payment_history: ${histErr.message}`);
  }

  await logRuntime({
    organizationId: existingOrgId,
    module: "asaas-webhook",
    action: `${eventName.toLowerCase()}_recurring`,
    status: orgErr || histErr ? "error" : "success",
    errorMessage: orgErr?.message ?? histErr?.message,
    entityType: "payment",
    entityId: payment.id,
    payloadSnapshot: {
      asaas_payment_id: payment.id,
      value: payment.value,
      subscription_status: "active",
    },
  });
}

/**
 * PAYMENT_OVERDUE
 *
 * Mark org as overdue and record the overdue payment in payment_history.
 */
async function handlePaymentOverdue(
  supabase: ReturnType<typeof createSupabase>,
  payment: AsaasPaymentPayload,
): Promise<void> {
  const orgId = await findOrgByPayment(supabase, payment);

  if (!orgId) {
    console.warn(`[asaas-webhook] PAYMENT_OVERDUE: org not found for payment ${payment.id}`);
    await logRuntime({
      module: "asaas-webhook",
      action: "payment_overdue_org_not_found",
      status: "error",
      errorMessage: "Organization not found for overdue payment",
      entityType: "payment",
      entityId: payment.id,
    });
    return;
  }

  const { error: orgErr } = await supabase
    .from("organizations")
    .update({ subscription_status: "overdue" })
    .eq("id", orgId);

  if (orgErr) {
    console.error(`[asaas-webhook] PAYMENT_OVERDUE: org update failed: ${orgErr.message}`);
  }

  // Insert or update payment_history — upsert on asaas_payment_id
  const { error: histErr } = await supabase
    .from("payment_history")
    .upsert(
      {
        organization_id: orgId,
        asaas_payment_id: payment.id,
        asaas_subscription_id: payment.subscription ?? null,
        amount: payment.value,
        billing_cycle: "monthly",
        status: "overdue",
        paid_at: null,
      },
      { onConflict: "asaas_payment_id", ignoreDuplicates: false },
    );

  if (histErr) {
    console.error(`[asaas-webhook] PAYMENT_OVERDUE: payment_history upsert failed: ${histErr.message}`);
  }

  await logRuntime({
    organizationId: orgId,
    module: "asaas-webhook",
    action: "payment_overdue",
    status: orgErr || histErr ? "error" : "success",
    errorMessage: orgErr?.message ?? histErr?.message,
    entityType: "payment",
    entityId: payment.id,
    payloadSnapshot: { asaas_payment_id: payment.id, value: payment.value },
  });
}

/**
 * PAYMENT_DELETED / PAYMENT_REFUNDED
 *
 * Suspend the org and record refund in payment_history.
 */
async function handlePaymentRefundedOrDeleted(
  supabase: ReturnType<typeof createSupabase>,
  payment: AsaasPaymentPayload,
  eventName: string,
): Promise<void> {
  const orgId = await findOrgByPayment(supabase, payment);

  if (!orgId) {
    console.warn(`[asaas-webhook] ${eventName}: org not found for payment ${payment.id}`);
    await logRuntime({
      module: "asaas-webhook",
      action: `${eventName.toLowerCase()}_org_not_found`,
      status: "error",
      errorMessage: "Organization not found",
      entityType: "payment",
      entityId: payment.id,
    });
    return;
  }

  const { error: orgErr } = await supabase
    .from("organizations")
    .update({ subscription_status: "suspended" })
    .eq("id", orgId);

  if (orgErr) {
    console.error(`[asaas-webhook] ${eventName}: org update failed: ${orgErr.message}`);
  }

  // Update payment_history status to 'refunded'
  const { error: histErr } = await supabase
    .from("payment_history")
    .update({ status: "refunded" })
    .eq("asaas_payment_id", payment.id);

  if (histErr) {
    console.error(`[asaas-webhook] ${eventName}: payment_history update failed: ${histErr.message}`);
  }

  await logRuntime({
    organizationId: orgId,
    module: "asaas-webhook",
    action: eventName.toLowerCase(),
    status: orgErr || histErr ? "error" : "success",
    errorMessage: orgErr?.message ?? histErr?.message,
    entityType: "payment",
    entityId: payment.id,
    payloadSnapshot: { asaas_payment_id: payment.id, value: payment.value },
  });
}

/**
 * SUBSCRIPTION_DELETED
 *
 * Mark the org subscription as cancelled.
 */
async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof createSupabase>,
  body: AsaasWebhookBody,
): Promise<void> {
  // The subscription object may be on body.subscription or body.payment.subscription
  const subscriptionId = body.subscription?.id ?? body.payment?.subscription;

  if (!subscriptionId) {
    console.warn("[asaas-webhook] SUBSCRIPTION_DELETED: no subscription ID in payload");
    await logRuntime({
      module: "asaas-webhook",
      action: "subscription_deleted_missing_id",
      status: "error",
      errorMessage: "Subscription ID not found in webhook payload",
    });
    return;
  }

  const orgId = await findOrgBySubscription(supabase, subscriptionId);

  if (!orgId) {
    console.warn(`[asaas-webhook] SUBSCRIPTION_DELETED: org not found for subscription ${subscriptionId}`);
    await logRuntime({
      module: "asaas-webhook",
      action: "subscription_deleted_org_not_found",
      status: "error",
      errorMessage: "Organization not found for subscription",
      entityType: "subscription",
      entityId: subscriptionId,
    });
    return;
  }

  const { error: orgErr } = await supabase
    .from("organizations")
    .update({ subscription_status: "cancelled" })
    .eq("id", orgId);

  if (orgErr) {
    console.error(`[asaas-webhook] SUBSCRIPTION_DELETED: org update failed: ${orgErr.message}`);
  }

  await logRuntime({
    organizationId: orgId,
    module: "asaas-webhook",
    action: "subscription_deleted",
    status: orgErr ? "error" : "success",
    errorMessage: orgErr?.message,
    entityType: "subscription",
    entityId: subscriptionId,
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(
  withSentry("asaas-webhook", async (req: Request): Promise<Response> => {
    // Only accept POST
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: withSecurityHeaders({ "Content-Type": "application/json" }),
      });
    }

    // ── 1. Authenticate ───────────────────────────────────────────────────────
    const incomingToken = req.headers.get("asaas-access-token");
    if (!ASAAS_WEBHOOK_TOKEN || !incomingToken || !timingSafeCompare(incomingToken, ASAAS_WEBHOOK_TOKEN)) {
      console.warn("[asaas-webhook] Rejected: invalid asaas-access-token");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: withSecurityHeaders({ "Content-Type": "application/json" }),
      });
    }

    // ── 2. Parse body ─────────────────────────────────────────────────────────
    let body: AsaasWebhookBody;
    try {
      body = await req.json();
    } catch {
      // Malformed JSON — still return 200 to prevent Asaas from retrying
      console.error("[asaas-webhook] Invalid JSON body");
      return ack({ warning: "invalid_json" });
    }

    const { event, payment } = body;

    console.log(`[asaas-webhook] Event: ${event}, payment: ${payment?.id ?? "n/a"}`);

    // ── 3. Log receipt ────────────────────────────────────────────────────────
    await logRuntime({
      module: "asaas-webhook",
      action: "event_received",
      status: "success",
      entityType: "payment",
      entityId: payment?.id,
      payloadSnapshot: {
        event,
        payment_id: payment?.id,
        customer: payment?.customer,
        value: payment?.value,
        status: payment?.status,
        external_reference: payment?.externalReference,
      },
    });

    // ── 4. Route event ────────────────────────────────────────────────────────
    try {
      const supabase = createSupabase();

      switch (event) {
        case "PAYMENT_CONFIRMED":
        case "PAYMENT_RECEIVED":
          if (!payment) {
            console.warn(`[asaas-webhook] ${event}: missing payment object`);
            break;
          }
          await handlePaymentConfirmed(supabase, payment, event);
          break;

        case "PAYMENT_OVERDUE":
          if (!payment) {
            console.warn("[asaas-webhook] PAYMENT_OVERDUE: missing payment object");
            break;
          }
          await handlePaymentOverdue(supabase, payment);
          break;

        case "PAYMENT_DELETED":
        case "PAYMENT_REFUNDED":
          if (!payment) {
            console.warn(`[asaas-webhook] ${event}: missing payment object`);
            break;
          }
          await handlePaymentRefundedOrDeleted(supabase, payment, event);
          break;

        case "SUBSCRIPTION_DELETED":
          await handleSubscriptionDeleted(supabase, body);
          break;

        default:
          console.log(`[asaas-webhook] Unhandled event: ${event} — acknowledged without action`);
          break;
      }
    } catch (err) {
      // Internal errors MUST NOT prevent a 200 response — Asaas would retry otherwise.
      console.error(`[asaas-webhook] Unhandled error processing event ${event}:`, err);
      await captureError(err, {
        functionName: "asaas-webhook",
        extra: { event, payment_id: payment?.id },
      });
      await logRuntime({
        module: "asaas-webhook",
        action: `${event?.toLowerCase()}_unhandled_error`,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        entityType: "payment",
        entityId: payment?.id,
        payloadSnapshot: { event },
      });
    }

    // ── 5. Always ACK ─────────────────────────────────────────────────────────
    return ack();
  }),
);
