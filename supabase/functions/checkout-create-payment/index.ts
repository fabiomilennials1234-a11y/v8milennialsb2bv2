/**
 * checkout-create-payment
 *
 * Validates checkout inputs server-side, calculates pricing authoritatively,
 * creates or finds an Asaas customer, and initiates payment.
 *
 * PIX    → one-time payment; stores checkout_data in user metadata for the
 *           webhook (asaas-webhook) to provision the org on confirmation.
 * Card   → recurring subscription; immediately fires checkout-provision-org
 *           (fire-and-forget); webhook handles any retry.
 *
 * POST /checkout-create-payment
 * Body:    CheckoutPaymentRequest
 * Returns: CheckoutPaymentResponse
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  createCustomer,
  findCustomerByEmail,
  createPayment,
  getPaymentPixQrCode,
  createSubscription,
} from "../_shared/asaas.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  name: string;
  email: string;
}

interface CheckoutPaymentRequest {
  plan_slug: string;
  billing_cycle: string;
  user_count: number;
  turbo_count: number;
  coupon_code: string | null;
  payment_method: "pix" | "credit_card";
  card_token?: string;
  org_name: string;
  team_members: TeamMember[];
}

interface PixSuccessResponse {
  success: true;
  payment_method: "pix";
  payment_id: string;
  qr_code: string;
  qr_code_payload: string;
  expires_at: string;
}

interface CardSuccessResponse {
  success: true;
  payment_method: "credit_card";
  subscription_id: string;
  status: "confirmed";
}

interface ErrorResponse {
  success: false;
  error: string;
}

type CheckoutPaymentResponse = PixSuccessResponse | CardSuccessResponse | ErrorResponse;

// ─── DB row shapes (minimal) ──────────────────────────────────────────────────

interface PlanRow {
  id: string;
  name: string;
  display_name: string;
  price_per_user_monthly: number | null;
  base_price_monthly: number | null;
  min_users: number;
  included_users: number;
  extra_user_price: number;
  discount_semester_pct: number;
  discount_annual_pct: number;
  discount_volume_pct: number;
  discount_volume_min: number;
}

interface AddonRow {
  id: string;
  slug: string;
  price_monthly: number;
  applicable_plans: string[];
}

// ─── Pricing (mirrors src/lib/pricing-calculator.ts) ─────────────────────────
// Intentional duplication: edge functions must not import frontend modules.

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

interface PricingResult {
  total_monthly: number;
  total_cycle: number;
  cycle_months: number;
  subtotal_monthly: number;
  volume_discount: number;
  coupon_discount: number;
  cycle_discount: number;
}

function calculatePricing(
  plan: PlanRow,
  billing_cycle: "monthly" | "semester" | "annual",
  user_count: number,
  turbo_count: number,
  addon: AddonRow | null,
  coupon_discount_pct: number,
): PricingResult {
  // Enforce minimum
  const users = Math.max(user_count, plan.min_users);

  // Plan cost
  let plan_monthly: number;
  let extras_monthly: number;

  if (plan.base_price_monthly !== null) {
    // Package plan (V8 style): fixed base + extra users above included
    plan_monthly = plan.base_price_monthly;
    extras_monthly = Math.max(users - plan.included_users, 0) * plan.extra_user_price;
  } else if (plan.price_per_user_monthly !== null) {
    // Per-user plan (1.0 / 2.0 style)
    plan_monthly = users * plan.price_per_user_monthly;
    extras_monthly = 0;
  } else {
    plan_monthly = 0;
    extras_monthly = 0;
  }

  // Addons
  let addons_monthly = 0;
  if (addon !== null && turbo_count > 0 && addon.applicable_plans.includes(plan.name)) {
    addons_monthly = turbo_count * addon.price_monthly;
  }

  // Subtotal
  const subtotal_monthly = plan_monthly + extras_monthly + addons_monthly;

  // Volume discount
  let volume_discount = 0;
  if (users >= plan.discount_volume_min && plan.discount_volume_pct > 0) {
    if (plan.price_per_user_monthly !== null) {
      volume_discount = users * plan.price_per_user_monthly * (plan.discount_volume_pct / 100);
    } else {
      const extra_users = Math.max(users - plan.included_users, 0);
      volume_discount = extra_users * plan.extra_user_price * (plan.discount_volume_pct / 100);
    }
  }

  const after_volume = subtotal_monthly - volume_discount;

  // Coupon discount
  const coupon_discount = coupon_discount_pct > 0
    ? after_volume * (coupon_discount_pct / 100)
    : 0;

  const after_coupon = after_volume - coupon_discount;

  // Cycle discount
  let cycle_pct = 0;
  if (billing_cycle === "semester") cycle_pct = plan.discount_semester_pct;
  else if (billing_cycle === "annual") cycle_pct = plan.discount_annual_pct;
  const cycle_discount = cycle_pct > 0 ? after_coupon * (cycle_pct / 100) : 0;

  const total_monthly = Math.max(after_coupon - cycle_discount, 0);
  const cycle_months = billing_cycle === "annual" ? 12 : billing_cycle === "semester" ? 6 : 1;

  return {
    total_monthly: round2(total_monthly),
    total_cycle: round2(total_monthly * cycle_months),
    cycle_months,
    subtotal_monthly: round2(subtotal_monthly),
    volume_discount: round2(volume_discount),
    coupon_discount: round2(coupon_discount),
    cycle_discount: round2(cycle_discount),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** ISO date string (YYYY-MM-DD) for today + offsetDays */
function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function jsonResp(
  body: CheckoutPaymentResponse,
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
  withSentry("checkout-create-payment", async (req: Request): Promise<Response> => {
    const cors = getCorsHeaders(req.headers.get("origin"));

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== "POST") {
      return jsonResp({ success: false, error: "Method not allowed" }, 405, cors);
    }

    // ── Supabase service-role client ──────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // ── 1. Validate JWT ───────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResp({ success: false, error: "Unauthorized" }, 401, cors);
    }
    const token = authHeader.slice(7).trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return jsonResp({ success: false, error: "JWT inválido ou expirado" }, 401, cors);
    }

    const userId = user.id;
    const userEmail = user.email ?? "";
    const userMeta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const userFullName = (userMeta.full_name ?? userMeta.name ?? userEmail) as string;
    const userDocument = (userMeta.document ?? "") as string;

    // ── 2. Parse body ─────────────────────────────────────────────────────────
    let body: CheckoutPaymentRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResp({ success: false, error: "Body JSON inválido" }, 400, cors);
    }

    const {
      plan_slug,
      billing_cycle,
      user_count,
      turbo_count,
      coupon_code,
      payment_method,
      card_token,
      org_name,
      team_members,
    } = body;

    // ── 3. Input validation ───────────────────────────────────────────────────
    if (!plan_slug || typeof plan_slug !== "string") {
      return jsonResp({ success: false, error: "plan_slug é obrigatório" }, 400, cors);
    }
    if (!["monthly", "semester", "annual"].includes(billing_cycle)) {
      return jsonResp(
        { success: false, error: "billing_cycle deve ser monthly, semester ou annual" },
        400, cors,
      );
    }
    if (!Number.isInteger(user_count) || user_count < 1) {
      return jsonResp({ success: false, error: "user_count inválido (mínimo 1)" }, 400, cors);
    }
    if (!Number.isInteger(turbo_count) || turbo_count < 0) {
      return jsonResp({ success: false, error: "turbo_count inválido (mínimo 0)" }, 400, cors);
    }
    if (user_count > 100) {
      return jsonResp(
        { success: false, error: "Máximo de 100 usuários. Para mais, fale com vendas." },
        400, cors,
      );
    }
    if (turbo_count > 10) {
      return jsonResp(
        { success: false, error: "Máximo de 10 copilots Turbo." },
        400, cors,
      );
    }
    if (!["pix", "credit_card"].includes(payment_method)) {
      return jsonResp(
        { success: false, error: "payment_method deve ser pix ou credit_card" },
        400, cors,
      );
    }
    if (payment_method === "credit_card" && !card_token) {
      return jsonResp(
        { success: false, error: "card_token é obrigatório para pagamento com cartão" },
        400, cors,
      );
    }
    if (!org_name?.trim()) {
      return jsonResp({ success: false, error: "org_name é obrigatório" }, 400, cors);
    }
    if (!Array.isArray(team_members)) {
      return jsonResp({ success: false, error: "team_members deve ser um array" }, 400, cors);
    }
    if (team_members.length !== user_count) {
      return jsonResp(
        {
          success: false,
          error: `team_members deve ter exatamente ${user_count} entradas (recebido ${team_members.length})`,
        },
        400, cors,
      );
    }
    for (const m of team_members) {
      if (!m.name?.trim() || !m.email?.trim()) {
        return jsonResp(
          { success: false, error: "Cada membro deve ter name e email preenchidos" },
          400, cors,
        );
      }
    }

    // ── 4. Fetch plan ─────────────────────────────────────────────────────────
    const { data: planRow, error: planErr } = await supabase
      .from("subscription_plans")
      .select([
        "id", "name", "display_name",
        "price_per_user_monthly", "base_price_monthly",
        "min_users", "included_users", "extra_user_price",
        "discount_semester_pct", "discount_annual_pct",
        "discount_volume_pct", "discount_volume_min",
      ].join(", "))
      .eq("name", plan_slug)
      .eq("is_active", true)
      .maybeSingle();

    if (planErr || !planRow) {
      return jsonResp({ success: false, error: "Plano não encontrado ou inativo" }, 404, cors);
    }
    const plan = planRow as PlanRow;

    // ── 5. Validate user_count vs plan minimum ────────────────────────────────
    if (user_count < plan.min_users) {
      return jsonResp(
        { success: false, error: `Este plano requer no mínimo ${plan.min_users} usuário(s)` },
        400, cors,
      );
    }

    // ── 6. Fetch addon (if turbo requested) ───────────────────────────────────
    let addon: AddonRow | null = null;
    if (turbo_count > 0) {
      const { data: addonRow, error: addonErr } = await supabase
        .from("plan_addons")
        .select("id, slug, price_monthly, applicable_plans")
        .eq("slug", "turbo")
        .eq("is_active", true)
        .maybeSingle();

      if (addonErr || !addonRow) {
        return jsonResp({ success: false, error: "Addon Turbo não disponível" }, 400, cors);
      }
      addon = addonRow as AddonRow;

      if (!addon.applicable_plans.includes(plan_slug)) {
        return jsonResp(
          {
            success: false,
            error: `O addon Turbo não está disponível para o plano ${plan.display_name}`,
          },
          400, cors,
        );
      }
    }

    // ── 7. Validate coupon ────────────────────────────────────────────────────
    let couponDiscountPct = 0;
    let couponId: string | null = null;

    if (coupon_code) {
      const { data: couponResult, error: couponErr } = await supabase.rpc("validate_coupon", {
        p_code: coupon_code,
        p_plan_slug: plan_slug,
      });

      if (couponErr) {
        console.error("[checkout-create-payment] validate_coupon error:", couponErr);
        return jsonResp({ success: false, error: "Erro ao validar cupom" }, 500, cors);
      }

      const cv = couponResult as {
        valid: boolean;
        discount_pct: number;
        coupon_id: string | null;
        error: string | null;
      };

      if (!cv.valid) {
        const labels: Record<string, string> = {
          COUPON_NOT_FOUND: "Cupom não encontrado",
          COUPON_INACTIVE: "Cupom inativo",
          COUPON_NOT_YET_VALID: "Cupom ainda não está válido",
          COUPON_EXPIRED: "Cupom expirado",
          COUPON_MAX_USES_REACHED: "Cupom atingiu o limite de usos",
          COUPON_PLAN_NOT_ELIGIBLE: "Cupom não se aplica a este plano",
        };
        return jsonResp(
          { success: false, error: labels[cv.error ?? ""] ?? "Cupom inválido" },
          400, cors,
        );
      }

      couponDiscountPct = cv.discount_pct;
      couponId = cv.coupon_id;
    }

    // ── 8. Calculate pricing (server-side authoritative) ──────────────────────
    const pricing = calculatePricing(
      plan,
      billing_cycle as "monthly" | "semester" | "annual",
      user_count,
      turbo_count,
      addon,
      couponDiscountPct,
    );

    // ── 9. Resolve Asaas customer ─────────────────────────────────────────────
    let asaasCustomerId: string;
    try {
      const existing = await findCustomerByEmail(userEmail);
      if (existing) {
        asaasCustomerId = existing.id;
      } else {
        const created = await createCustomer({
          name: userFullName,
          email: userEmail,
          cpfCnpj: userDocument,
        });
        asaasCustomerId = created.id;
      }
    } catch (e) {
      console.error("[checkout-create-payment] Asaas customer error:", e);
      await logRuntime({
        module: "checkout",
        action: "asaas_customer_resolve",
        status: "error",
        errorMessage: String(e),
        entityType: "user",
        entityId: userId,
      });
      return jsonResp({ success: false, error: "Erro ao criar cliente no Asaas" }, 502, cors);
    }

    // ── 10. Build checkout_data (persisted to user metadata for webhook) ──────
    const checkoutData = {
      plan_id: plan.id,
      plan_slug,
      billing_cycle,
      user_count,
      turbo_count,
      coupon_id: couponId,
      coupon_discount_pct: couponDiscountPct,
      org_name: org_name.trim(),
      team_members,
      total_monthly: pricing.total_monthly,
      total_cycle: pricing.total_cycle,
      // Full discount breakdown for provision-org to record accurately
      subtotal_monthly: pricing.subtotal_monthly,
      volume_discount: pricing.volume_discount,
      coupon_discount: pricing.coupon_discount,
      cycle_discount: pricing.cycle_discount,
      addon_id: addon?.id ?? null,
    };

    // ── 11. Payment branch ────────────────────────────────────────────────────

    if (payment_method === "pix") {
      // ── PIX: one-time payment ───────────────────────────────────────────────
      let asaasPaymentId: string;
      let qrCode: string;
      let qrCodePayload: string;
      let qrExpiresAt: string;

      try {
        // externalReference = userId lets the asaas-webhook find checkout_data
        const payment = await createPayment({
          customer: asaasCustomerId,
          billingType: "PIX",
          value: pricing.total_cycle,
          dueDate: isoDate(1),
          description: `Torque CRM — ${plan.display_name}`,
          externalReference: userId,
        } as Parameters<typeof createPayment>[0]);

        asaasPaymentId = payment.id;

        const pix = await getPaymentPixQrCode(asaasPaymentId);
        qrCode = pix.encodedImage;
        qrCodePayload = pix.payload;
        qrExpiresAt = pix.expirationDate;
      } catch (e) {
        console.error("[checkout-create-payment] Asaas PIX error:", e);
        await logRuntime({
          module: "checkout",
          action: "asaas_pix_create",
          status: "error",
          errorMessage: String(e),
          entityType: "user",
          entityId: userId,
        });
        return jsonResp({ success: false, error: "Erro ao gerar cobrança PIX" }, 502, cors);
      }

      // Persist checkout_data in user metadata.
      // The asaas-webhook reads this on PAYMENT_CONFIRMED to provision the org.
      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...userMeta,
          checkout_data: {
            ...checkoutData,
            asaas_payment_id: asaasPaymentId,
          },
        },
      });

      // payment_history row is deferred: organization_id NOT NULL constraint
      // means it can only be inserted after the org is provisioned by the webhook.
      await logRuntime({
        module: "checkout",
        action: "pix_payment_created",
        status: "success",
        entityType: "payment",
        entityId: asaasPaymentId,
        triggeredBy: userId,
        payloadSnapshot: {
          plan_slug,
          billing_cycle,
          total_cycle: pricing.total_cycle,
          asaas_payment_id: asaasPaymentId,
        },
      });

      // Coupon increment moved to checkout-provision-org (after payment confirmation)

      return jsonResp(
        {
          success: true,
          payment_method: "pix",
          payment_id: asaasPaymentId,
          qr_code: qrCode,
          qr_code_payload: qrCodePayload,
          expires_at: qrExpiresAt,
        },
        200,
        cors,
      );
    } else {
      // ── Credit card: recurring subscription ────────────────────────────────
      const cycleMap: Record<string, "MONTHLY" | "SEMIANNUALLY" | "YEARLY"> = {
        monthly: "MONTHLY",
        semester: "SEMIANNUALLY",
        annual: "YEARLY",
      };

      let subscriptionId: string;
      try {
        const subscription = await createSubscription({
          customer: asaasCustomerId,
          billingType: "CREDIT_CARD",
          value: pricing.total_monthly,
          cycle: cycleMap[billing_cycle],
          nextDueDate: isoDate(0),
          description: `Torque CRM — ${plan.display_name}`,
          creditCardToken: card_token!,
        });
        subscriptionId = subscription.id;
      } catch (e) {
        console.error("[checkout-create-payment] Asaas subscription error:", e);
        await logRuntime({
          module: "checkout",
          action: "asaas_subscription_create",
          status: "error",
          errorMessage: String(e),
          entityType: "user",
          entityId: userId,
        });
        return jsonResp({ success: false, error: "Erro ao criar assinatura no Asaas" }, 502, cors);
      }

      // Persist checkout_data in user metadata for the webhook / provision-org
      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...userMeta,
          checkout_data: {
            ...checkoutData,
            asaas_subscription_id: subscriptionId,
          },
        },
      });

      // Coupon increment moved to checkout-provision-org (after payment confirmation)

      await logRuntime({
        module: "checkout",
        action: "card_subscription_created",
        status: "success",
        entityType: "subscription",
        entityId: subscriptionId,
        triggeredBy: userId,
        payloadSnapshot: {
          plan_slug,
          billing_cycle,
          total_monthly: pricing.total_monthly,
          asaas_subscription_id: subscriptionId,
        },
      });

      // Fire-and-forget: provision the org immediately after card confirmation.
      // The webhook will handle any failure retry.
      const provisionUrl =
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/checkout-provision-org`;
      fetch(provisionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "X-Internal-Api-Key": Deno.env.get("INTERNAL_API_KEY") ?? "",
        },
        body: JSON.stringify({
          user_id: userId,
          asaas_subscription_id: subscriptionId,
          checkout_data: checkoutData,
        }),
      }).catch((e) => {
        console.warn("[checkout-create-payment] provision-org fire-and-forget failed:", e);
      });

      return jsonResp(
        {
          success: true,
          payment_method: "credit_card",
          subscription_id: subscriptionId,
          status: "confirmed",
        },
        200,
        cors,
      );
    }
  }),
);
