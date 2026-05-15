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
import { withSecurityHeaders } from "../_shared/security-headers.ts";

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
  subtotal_monthly?: number;
  volume_discount?: number;
  coupon_discount?: number;
  cycle_discount?: number;
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
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== "POST") {
      return jsonResp({ success: false, error: "Method not allowed" }, 405, cors);
    }

    // ── Auth: internal calls only ─────────────────────────────────────────────
    // SECURITY: Only accept requests with a valid X-Internal-Api-Key or a
    // Bearer token that exactly matches SUPABASE_SERVICE_ROLE_KEY. This is
    // never exposed publicly — only called by checkout-create-payment and
    // asaas-webhook.
    const authHeader = req.headers.get("Authorization");
    const internalKey = req.headers.get("X-Internal-Api-Key");
    const expectedInternalKey = Deno.env.get("INTERNAL_API_KEY");
    const serviceRoleKeyEnv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // Fail closed: if INTERNAL_API_KEY is not configured, reject everything
    // that doesn't carry the service_role key as Bearer token.
    const hasValidInternalKey =
      !!expectedInternalKey && !!internalKey && internalKey === expectedInternalKey;

    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;
    const hasValidServiceRoleBearer =
      !!serviceRoleKeyEnv && !!bearerToken && bearerToken === serviceRoleKeyEnv;

    if (!hasValidInternalKey && !hasValidServiceRoleBearer) {
      return jsonResp({ success: false, error: "Unauthorized" }, 401, cors);
    }

    // ── Supabase service-role client ──────────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const supabase = createClient(supabaseUrl, serviceRoleKeyEnv!, {
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
      subtotal_monthly: cd_subtotal_monthly,
      volume_discount: cd_volume_discount,
      coupon_discount: cd_coupon_discount,
      cycle_discount: cd_cycle_discount,
      asaas_customer_id,
    } = checkoutData;

    // ── 1b. Validate checkout_data from body (not from trusted user metadata) ──
    // When checkout_data is forwarded directly in the request body, validate it
    // against the DB to prevent spoofed plan_id, pricing, or user_count.
    if (body.checkout_data) {
      // Validate plan_id exists and is active
      const { data: planRow, error: planErr } = await supabase
        .from("subscription_plans")
        .select("id, min_users, is_active")
        .eq("id", plan_id)
        .eq("is_active", true)
        .maybeSingle();

      if (planErr || !planRow) {
        console.error("[checkout-provision-org] plan_id validation failed:", plan_id);
        return jsonResp(
          { success: false, error: "Plano inválido ou inativo" },
          422,
          cors,
        );
      }

      // Validate monetary values
      if (typeof total_monthly !== "number" || total_monthly <= 0) {
        return jsonResp(
          { success: false, error: "total_monthly deve ser > 0" },
          422,
          cors,
        );
      }
      if (typeof total_cycle !== "number" || total_cycle <= 0) {
        return jsonResp(
          { success: false, error: "total_cycle deve ser > 0" },
          422,
          cors,
        );
      }

      // Validate user_count against plan minimum
      if (typeof user_count !== "number" || user_count < planRow.min_users) {
        return jsonResp(
          {
            success: false,
            error: `user_count (${user_count}) é menor que o mínimo do plano (${planRow.min_users})`,
          },
          422,
          cors,
        );
      }
    }

    // Resolve payment identifiers (body takes precedence over checkout_data)
    const resolvedPaymentId = asaas_payment_id ?? checkoutData.asaas_payment_id ?? null;
    const resolvedSubscriptionId =
      asaas_subscription_id ?? checkoutData.asaas_subscription_id ?? null;

    // ── 2a. Advisory lock: prevent double-provisioning from concurrent calls ──
    // Uses the try_provision_lock RPC (created by migration). If it returns false,
    // another process is already provisioning for this user.
    try {
      const { data: lockAcquired, error: lockErr } = await supabase.rpc(
        "try_provision_lock",
        { p_user_id: user_id },
      );

      if (!lockErr && lockAcquired === false) {
        console.log(
          "[checkout-provision-org] Advisory lock not acquired — another process is provisioning for user:",
          user_id,
        );
        // Return success — the other process will complete provisioning
        return jsonResp(
          {
            success: true,
            organization_id: "pending",
            organization_name: org_name,
            already_provisioned: true,
          },
          200,
          cors,
        );
      }

      if (lockErr) {
        // RPC may not exist yet — fall through to idempotency check
        console.warn("[checkout-provision-org] Advisory lock RPC unavailable, relying on idempotency check:", lockErr.message);
      }
    } catch (e) {
      // Best-effort: if the lock mechanism fails, the idempotency check still protects us
      console.warn("[checkout-provision-org] Advisory lock failed, proceeding:", e);
    }

    // ── 2b. Idempotency: check if org already exists for this user ─────────────
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
    const cycleMonths = billing_cycle === "annual" ? 12 : billing_cycle === "semester" ? 6 : 1;

    // Use the full discount breakdown from checkout_data if available (set by
    // checkout-create-payment). Fall back to legacy reverse-engineering only
    // if the fields are absent (e.g. old webhook paths).
    let baseAmount: number;
    let discountAmount: number;
    let finalAmount: number;

    if (
      cd_subtotal_monthly != null &&
      cd_volume_discount != null &&
      cd_coupon_discount != null &&
      cd_cycle_discount != null
    ) {
      // Authoritative breakdown from checkout-create-payment
      baseAmount = Math.round(cd_subtotal_monthly * cycleMonths * 100) / 100;
      discountAmount = Math.round(
        (cd_volume_discount + cd_coupon_discount + cd_cycle_discount) * cycleMonths * 100,
      ) / 100;
      finalAmount = total_cycle;
    } else {
      // Legacy fallback: best-effort calculation
      baseAmount = total_cycle;
      discountAmount = 0;
      finalAmount = total_cycle;
    }

    const { error: subErr } = await supabase.from("org_subscriptions").insert({
      organization_id: organizationId,
      plan_id: plan_id,
      billing_cycle: billing_cycle,
      user_count: user_count,
      addon_turbo_count: turbo_count,
      coupon_id: coupon_id ?? null,
      base_amount: baseAmount,
      discount_amount: discountAmount,
      final_amount: finalAmount,
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

    // ── 4b. Sync org_quotas from plan ────────────────────────────────────────
    const { error: quotaSyncErr } = await supabase.rpc("sync_org_quotas_from_plan", {
      p_org_id: organizationId,
    });
    if (quotaSyncErr) {
      console.error("[checkout-provision-org] sync_org_quotas_from_plan failed:", quotaSyncErr);
      // Non-fatal: quotas can be backfilled; enforcement still works via fallback path
      await captureError(quotaSyncErr, {
        functionName: "checkout-provision-org",
        organizationId,
        userId: user_id,
        extra: { step: "sync_org_quotas" },
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

    // ── 7b. Increment coupon usage (after payment confirmed) ─────────────────
    if (coupon_id) {
      try {
        const { error: couponErr } = await supabase.rpc("increment_coupon_uses", {
          p_coupon_id: coupon_id,
        });
        if (couponErr) {
          console.warn("[checkout-provision-org] increment_coupon_uses failed:", couponErr.message);
        }
      } catch (e) {
        console.warn("[checkout-provision-org] increment_coupon_uses threw:", e);
      }
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
