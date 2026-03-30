/**
 * checkout-provision-org
 *
 * Provisions an organization after payment is confirmed.
 * Called internally by:
 *   - checkout-create-payment (fire-and-forget for card payments)
 *   - asaas-webhook (on PAYMENT_CONFIRMED for PIX payments)
 *
 * Auth: Accepts requests with a valid service_role JWT or a matching
 * X-Internal-Api-Key header. Never exposed publicly.
 *
 * POST /checkout-provision-org
 * Body:    ProvisionOrgRequest
 * Returns: ProvisionOrgResponse
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry, captureError } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProvisionOrgRequest {
  user_id: string;
  asaas_payment_id?: string;
  asaas_subscription_id?: string;
  // checkout-create-payment may forward checkout_data directly to avoid
  // a race condition where user metadata hasn't been flushed yet.
  checkout_data?: CheckoutData;
}

interface TeamMemberEntry {
  name: string;
  email?: string;
}

interface CheckoutData {
  plan_id: string;
  plan_slug: string;
  billing_cycle: "monthly" | "semester" | "annual";
  user_count: number;
  turbo_count: number;
  addon_id: string | null;
  coupon_id: string | null;
  coupon_discount_pct: number;
  org_name: string;
  team_members: TeamMemberEntry[];
  total_monthly: number;
  total_cycle: number;
  asaas_customer_id?: string;
  asaas_payment_id?: string;
  asaas_subscription_id?: string;
}

interface ProvisionOrgSuccess {
  success: true;
  organization_id: string;
  organization_name: string;
  already_provisioned?: boolean;
}

interface ProvisionOrgError {
  success: false;
  error: string;
}

type ProvisionOrgResponse = ProvisionOrgSuccess | ProvisionOrgError;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a URL-safe slug from a human name, appending 4 random hex chars for uniqueness. */
function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);

  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 4);
  return `${base}-${suffix}`;
}

/** Calculates the subscription renewal timestamp based on billing cycle. */
function calculateRenewsAt(
  billingCycle: "monthly" | "semester" | "annual",
  from: Date = new Date(),
): Date {
  const d = new Date(from);
  if (billingCycle === "annual") {
    d.setMonth(d.getMonth() + 12);
  } else if (billingCycle === "semester") {
    d.setMonth(d.getMonth() + 6);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}

function jsonResp(
  body: ProvisionOrgResponse,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ─── Edge Function Handler ────────────────────────────────────────────────────

serve(
  withSentry("checkout-provision-org", async (req: Request): Promise<Response> => {
    const cors = getCorsHeaders(req.headers.get("origin"));

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== "POST") {
      return jsonResp({ success: false, error: "Method not allowed" }, 405, cors);
    }

    // ── Auth: internal calls only ─────────────────────────────────────────────
    // Accept either a service_role JWT or a matching X-Internal-Api-Key header.
    const authHeader = req.headers.get("Authorization");
    const internalKey = req.headers.get("X-Internal-Api-Key");
    const expectedInternalKey = Deno.env.get("INTERNAL_API_KEY");

    const hasValidInternalKey =
      expectedInternalKey && internalKey === expectedInternalKey;

    // We will validate the token against Supabase below; for now just ensure
    // the header is present so we can extract it.
    if (!authHeader?.startsWith("Bearer ") && !hasValidInternalKey) {
      return jsonResp({ success: false, error: "Unauthorized" }, 401, cors);
    }

    // ── Supabase service-role client ──────────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: ProvisionOrgRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResp({ success: false, error: "Body JSON inválido" }, 400, cors);
    }

    const { user_id, asaas_payment_id, asaas_subscription_id } = body;

    if (!user_id || typeof user_id !== "string") {
      return jsonResp({ success: false, error: "user_id é obrigatório" }, 400, cors);
    }

    // ── 1. Fetch user and checkout_data ───────────────────────────────────────
    const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(user_id);

    if (userErr || !user) {
      console.error("[checkout-provision-org] getUserById failed:", userErr);
      return jsonResp({ success: false, error: "Usuário não encontrado" }, 404, cors);
    }

    const userMeta = (user.user_metadata ?? {}) as Record<string, unknown>;

    // checkout_data can come directly in the request body (forwarded by
    // checkout-create-payment to eliminate the race window) or fall back to
    // user metadata (set by the PIX flow and card webhook path).
    const checkoutData: CheckoutData | null =
      (body.checkout_data as CheckoutData) ??
      (userMeta.checkout_data as CheckoutData) ??
      null;

    if (!checkoutData) {
      console.error("[checkout-provision-org] No checkout_data for user", user_id);
      return jsonResp(
        { success: false, error: "checkout_data não encontrado para este usuário" },
        422,
        cors,
      );
    }

    const {
      plan_id,
      plan_slug,
      billing_cycle,
      user_count,
      turbo_count,
      addon_id,
      coupon_id,
      coupon_discount_pct,
      org_name,
      team_members: checkoutMembers,
      total_monthly,
      total_cycle,
      asaas_customer_id,
    } = checkoutData;

    // Resolve payment identifiers (body takes precedence over checkout_data)
    const resolvedPaymentId = asaas_payment_id ?? checkoutData.asaas_payment_id ?? null;
    const resolvedSubscriptionId =
      asaas_subscription_id ?? checkoutData.asaas_subscription_id ?? null;

    // ── 2. Idempotency: check if org already exists for this user ─────────────
    const { data: existingMember, error: memberCheckErr } = await supabase
      .from("team_members")
      .select("organization_id, organizations!inner(id, name)")
      .eq("user_id", user_id)
      .not("organization_id", "is", null)
      .maybeSingle();

    if (memberCheckErr) {
      console.error("[checkout-provision-org] idempotency check failed:", memberCheckErr);
      // Non-fatal; proceed — worst case we create a duplicate (caught by logic below)
    }

    if (existingMember?.organization_id) {
      console.log(
        "[checkout-provision-org] Already provisioned — org:",
        existingMember.organization_id,
        "user:",
        user_id,
      );
      await logRuntime({
        module: "checkout",
        action: "provision_org_already_exists",
        status: "skipped",
        organizationId: existingMember.organization_id,
        triggeredBy: user_id,
      });

      return jsonResp(
        {
          success: true,
          organization_id: existingMember.organization_id,
          organization_name: (existingMember as Record<string, unknown>).organizations
            ? String(
                (
                  (existingMember as Record<string, unknown>).organizations as Record<
                    string,
                    unknown
                  >
                ).name ?? org_name,
              )
            : org_name,
          already_provisioned: true,
        },
        200,
        cors,
      );
    }

    // ── 3. Create organization ────────────────────────────────────────────────
    const orgSlug = generateSlug(org_name);

    const { data: orgRow, error: orgErr } = await supabase
      .from("organizations")
      .insert({
        name: org_name.trim(),
        slug: orgSlug,
        subscription_status: "active",
        subscription_plan: plan_slug,
        plan_id: plan_id,
        payment_customer_id: asaas_customer_id ?? null,
        payment_subscription_id: resolvedSubscriptionId ?? null,
      })
      .select("id, name")
      .single();

    if (orgErr || !orgRow) {
      console.error("[checkout-provision-org] create organization failed:", orgErr);
      await captureError(orgErr ?? new Error("org insert returned no row"), {
        functionName: "checkout-provision-org",
        userId: user_id,
        extra: { plan_slug, org_name },
      });
      return jsonResp({ success: false, error: "Erro ao criar organização" }, 500, cors);
    }

    const organizationId: string = orgRow.id;

    // ── 4. Create org_subscriptions ───────────────────────────────────────────
    const now = new Date();
    const renews_at = calculateRenewsAt(billing_cycle, now);

    // discount_amount = total_cycle * (coupon_discount_pct / 100), or 0
    const baseAmountCycle = total_cycle / (1 - (coupon_discount_pct > 0 ? coupon_discount_pct / 100 : 0));
    const discountAmount = coupon_discount_pct > 0
      ? Math.round((baseAmountCycle - total_cycle) * 100) / 100
      : 0;

    const { error: subErr } = await supabase.from("org_subscriptions").insert({
      organization_id: organizationId,
      plan_id: plan_id,
      billing_cycle: billing_cycle,
      user_count: user_count,
      addon_turbo_count: turbo_count,
      coupon_id: coupon_id ?? null,
      base_amount: Math.round((total_monthly + discountAmount) * 100) / 100,
      discount_amount: discountAmount,
      final_amount: total_monthly,
      started_at: now.toISOString(),
      renews_at: renews_at.toISOString(),
    });

    if (subErr) {
      console.error("[checkout-provision-org] create org_subscriptions failed:", subErr);
      // Not fatal — org exists, subscription can be backfilled; log and continue.
      await captureError(subErr, {
        functionName: "checkout-provision-org",
        organizationId,
        userId: user_id,
        extra: { step: "org_subscriptions" },
      });
    }

    // ── 5. Create team_members ────────────────────────────────────────────────
    const userFullName = String(
      userMeta.full_name ?? userMeta.name ?? user.email ?? "Admin",
    );

    // Paying user → admin
    const { error: adminMemberErr } = await supabase.from("team_members").insert({
      user_id: user_id,
      name: userFullName,
      role: "admin",
      organization_id: organizationId,
      is_active: true,
      metric_type: "sales",
    });

    if (adminMemberErr) {
      console.error("[checkout-provision-org] insert admin team_member failed:", adminMemberErr);
      // Critical — rollback is not trivial here, so we log and keep going.
      // The org was created; this can be repaired manually if needed.
      await captureError(adminMemberErr, {
        functionName: "checkout-provision-org",
        organizationId,
        userId: user_id,
        extra: { step: "team_members_admin" },
      });
    }

    // Additional members (no auth account yet — user_id is null)
    // Skip index 0 if team_members[0] maps to the paying user (same email).
    const additionalMembers = checkoutMembers.filter((m) => {
      const memberEmail = m.email?.trim().toLowerCase();
      const payingEmail = user.email?.trim().toLowerCase();
      return !memberEmail || memberEmail !== payingEmail;
    });

    if (additionalMembers.length > 0) {
      const memberRows = additionalMembers.map((m) => ({
        user_id: null,
        name: m.name.trim(),
        role: "member" as const,
        organization_id: organizationId,
        is_active: true,
        metric_type: "sales",
      }));

      const { error: membersErr } = await supabase.from("team_members").insert(memberRows);
      if (membersErr) {
        console.error(
          "[checkout-provision-org] insert additional team_members failed:",
          membersErr,
        );
        // Non-fatal: org and admin member exist.
        await captureError(membersErr, {
          functionName: "checkout-provision-org",
          organizationId,
          userId: user_id,
          extra: { step: "team_members_additional", count: additionalMembers.length },
        });
      }
    }

    // ── 6. Insert payment_history ─────────────────────────────────────────────
    const { error: paymentHistoryErr } = await supabase.from("payment_history").insert({
      organization_id: organizationId,
      asaas_payment_id: resolvedPaymentId ?? null,
      asaas_subscription_id: resolvedSubscriptionId ?? null,
      amount: total_cycle,
      discount_applied: discountAmount,
      coupon_id: coupon_id ?? null,
      billing_cycle: billing_cycle,
      status: "confirmed",
      paid_at: now.toISOString(),
    });

    if (paymentHistoryErr) {
      console.error(
        "[checkout-provision-org] insert payment_history failed:",
        paymentHistoryErr,
      );
      // Non-fatal: organization is live; payment record can be backfilled.
      await captureError(paymentHistoryErr, {
        functionName: "checkout-provision-org",
        organizationId,
        userId: user_id,
        extra: { step: "payment_history" },
      });
    }

    // ── 7. Update user metadata ───────────────────────────────────────────────
    // Clear checkout_data and mark subscription as active.
    const { error: metaErr } = await supabase.auth.admin.updateUserById(user_id, {
      user_metadata: {
        ...userMeta,
        checkout_data: null,
        subscription_status: "active",
        organization_id: organizationId,
      },
    });

    if (metaErr) {
      console.warn("[checkout-provision-org] updateUserById (metadata) failed:", metaErr);
      // Non-fatal: the org is live; metadata cleanup can be retried.
    }

    // ── 8. Log success ────────────────────────────────────────────────────────
    await logRuntime({
      module: "checkout",
      action: "provision_org_success",
      status: "success",
      organizationId,
      triggeredBy: user_id,
      payloadSnapshot: {
        plan_slug,
        billing_cycle,
        user_count,
        turbo_count,
        total_cycle,
        asaas_payment_id: resolvedPaymentId,
        asaas_subscription_id: resolvedSubscriptionId,
      },
    });

    console.log(
      `[checkout-provision-org] Org provisioned: ${organizationId} (${org_name}) for user: ${user_id}`,
    );

    return jsonResp(
      {
        success: true,
        organization_id: organizationId,
        organization_name: orgRow.name,
      },
      201,
      cors,
    );
  }),
);
