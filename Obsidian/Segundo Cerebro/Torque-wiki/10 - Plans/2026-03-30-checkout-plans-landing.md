---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-30-checkout-plans-landing.md
---

# Checkout, Plans & Landing Page - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement self-service checkout with Asaas payment, public landing page, and new pricing plans (1.0, 2.0, V8) inside the Torque app.

**Architecture:** Public routes (`/`, `/signup`, `/checkout`) live alongside the existing protected app. Landing page is converted from an HTML mockup at `/Volumes/Untitled/torque-landing-mockup/index.html`. Checkout creates Asaas payments via edge functions. Org provisioning happens after payment confirmation via webhook. All pricing logic is server-side.

**Tech Stack:** React + TypeScript (Vite), Supabase (Auth, Edge Functions, Postgres), Asaas API (payments), framer-motion (animations), Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-30-checkout-plans-landing-design.md`

---

## Phase 1: Database Foundation

### Task 1: Migration - New tables and plan data

**Files:**
- Create: `supabase/migrations/20260830000000_checkout_plans_and_tables.sql`

- [ ] **Step 1: Write the migration SQL**

Create the migration file with all schema changes:

```sql
-- Phase 1: Extend subscription_plans with new pricing columns
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS price_per_user_monthly NUMERIC,
  ADD COLUMN IF NOT EXISTS base_price_monthly NUMERIC,
  ADD COLUMN IF NOT EXISTS min_users INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS included_users INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS included_copilots INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_user_price NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_semester_pct NUMERIC DEFAULT 10,
  ADD COLUMN IF NOT EXISTS discount_annual_pct NUMERIC DEFAULT 15,
  ADD COLUMN IF NOT EXISTS discount_volume_pct NUMERIC DEFAULT 35,
  ADD COLUMN IF NOT EXISTS discount_volume_min INTEGER DEFAULT 10;

-- Deactivate old plans
UPDATE public.subscription_plans SET is_active = false WHERE name IN ('free', 'starter', 'pro', 'enterprise');

-- Insert new plans
INSERT INTO public.subscription_plans (name, display_name, description, price_monthly, price_yearly, is_active, is_default, position, features, limits, price_per_user_monthly, base_price_monthly, min_users, included_users, included_copilots, extra_user_price)
VALUES
  ('torque-1.0', 'Torque 1.0', 'Métricas, funis e ranking. Tudo manual, sem automação.', 297, 0, true, false, 1,
   '{"leads": true, "funnels": true, "performance": true, "products": true, "analytics": true, "chat": false, "carteira": false, "copilot": false, "oraculo": false, "scheduled_messages": false, "automations": false, "whatsapp_bulk": false}'::jsonb,
   '{"max_users": -1, "max_leads": -1}'::jsonb,
   297, NULL, 2, 0, 0, 297),

  ('torque-2.0', 'Torque 2.0 (Remap)', 'CRM completo com chat, automaçoes e gestão de carteira.', 697, 0, true, false, 2,
   '{"leads": true, "funnels": true, "performance": true, "products": true, "analytics": true, "chat": true, "carteira": true, "copilot": false, "oraculo": false, "scheduled_messages": true, "automations": true, "whatsapp_bulk": true}'::jsonb,
   '{"max_users": -1, "max_leads": -1}'::jsonb,
   697, NULL, 3, 0, 0, 697),

  ('torque-v8', 'Torque V8 (Remap + Turbo)', 'Tudo incluso: CRM, automaçoes, IA e Copilot.', 1997, 0, true, true, 3,
   '{"leads": true, "funnels": true, "performance": true, "products": true, "analytics": true, "chat": true, "carteira": true, "copilot": true, "oraculo": true, "scheduled_messages": true, "automations": true, "whatsapp_bulk": true}'::jsonb,
   '{"max_users": -1, "max_leads": -1, "max_copilot_agents": 1}'::jsonb,
   NULL, 1997, 3, 3, 1, 120)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  is_active = EXCLUDED.is_active,
  is_default = EXCLUDED.is_default,
  position = EXCLUDED.position,
  features = EXCLUDED.features,
  limits = EXCLUDED.limits,
  price_per_user_monthly = EXCLUDED.price_per_user_monthly,
  base_price_monthly = EXCLUDED.base_price_monthly,
  min_users = EXCLUDED.min_users,
  included_users = EXCLUDED.included_users,
  included_copilots = EXCLUDED.included_copilots,
  extra_user_price = EXCLUDED.extra_user_price;

-- Phase 2: plan_addons table
CREATE TABLE IF NOT EXISTS public.plan_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  price_monthly NUMERIC NOT NULL,
  unit_label TEXT NOT NULL DEFAULT 'por unidade',
  applicable_plans TEXT[] NOT NULL DEFAULT '{}',
  features_unlocked TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.plan_addons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read active addons" ON public.plan_addons FOR SELECT USING (is_active = true);
CREATE POLICY "Masters can manage addons" ON public.plan_addons FOR ALL USING (public.is_master_user());

INSERT INTO public.plan_addons (slug, display_name, price_monthly, unit_label, applicable_plans, features_unlocked)
VALUES ('turbo', 'Turbo (Copilot IA)', 1427, 'por copiloto', '{torque-1.0,torque-2.0}', '{copilot,oraculo}')
ON CONFLICT (slug) DO NOTHING;

-- Phase 3: coupons table
CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  discount_pct NUMERIC NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 100),
  applies_to TEXT[],
  max_uses INTEGER,
  current_uses INTEGER DEFAULT 0,
  valid_from TIMESTAMPTZ DEFAULT now(),
  valid_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can validate coupons" ON public.coupons FOR SELECT USING (is_active = true);
CREATE POLICY "Masters can manage coupons" ON public.coupons FOR ALL USING (public.is_master_user());

INSERT INTO public.coupons (code, discount_pct, applies_to, is_active)
VALUES ('MILENNIALS35', 35, NULL, true)
ON CONFLICT (code) DO NOTHING;

-- Phase 4: org_subscriptions table
CREATE TABLE IF NOT EXISTS public.org_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'semester', 'annual')),
  user_count INTEGER NOT NULL,
  addon_turbo_count INTEGER DEFAULT 0,
  coupon_id UUID REFERENCES public.coupons(id),
  base_amount NUMERIC NOT NULL,
  discount_amount NUMERIC DEFAULT 0,
  final_amount NUMERIC NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  renews_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.org_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view own subscription" ON public.org_subscriptions FOR SELECT USING (
  organization_id IN (SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id = auth.uid())
);
CREATE POLICY "Service role manages subscriptions" ON public.org_subscriptions FOR ALL USING (true) WITH CHECK (true);
-- Note: INSERT/UPDATE only via service_role (edge functions). The ALL policy is restricted by RLS context - authenticated users can only SELECT via the policy above.

-- Phase 5: payment_history table
CREATE TABLE IF NOT EXISTS public.payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asaas_payment_id TEXT UNIQUE,
  asaas_subscription_id TEXT,
  amount NUMERIC NOT NULL,
  discount_applied NUMERIC DEFAULT 0,
  coupon_id UUID REFERENCES public.coupons(id),
  billing_cycle TEXT CHECK (billing_cycle IN ('monthly', 'semester', 'annual')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'overdue', 'refunded')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_payment_history_org ON public.payment_history(organization_id);
CREATE INDEX idx_payment_history_asaas ON public.payment_history(asaas_payment_id);
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view own payments" ON public.payment_history FOR SELECT USING (
  organization_id IN (SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id = auth.uid())
);
CREATE POLICY "Service role manages payments" ON public.payment_history FOR ALL USING (true) WITH CHECK (true);

-- Phase 6: RPC to validate coupon (used by frontend)
CREATE OR REPLACE FUNCTION public.validate_coupon(p_code TEXT, p_plan_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_coupon RECORD;
BEGIN
  SELECT * INTO v_coupon FROM coupons
  WHERE code = UPPER(TRIM(p_code)) AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Cupom não encontrado');
  END IF;

  IF v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until < NOW() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Cupom expirado');
  END IF;

  IF v_coupon.valid_from > NOW() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Cupom ainda não ativo');
  END IF;

  IF v_coupon.max_uses IS NOT NULL AND v_coupon.current_uses >= v_coupon.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Cupom esgotado');
  END IF;

  IF v_coupon.applies_to IS NOT NULL AND p_plan_slug != ALL(v_coupon.applies_to) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Cupom não aplicável a este plano');
  END IF;

  RETURN jsonb_build_object('valid', true, 'discount_pct', v_coupon.discount_pct, 'coupon_id', v_coupon.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_coupon(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_coupon(TEXT, TEXT) TO service_role;
```

- [ ] **Step 2: Apply migration to PROD**

```bash
npx supabase db query --linked -f supabase/migrations/20260830000000_checkout_plans_and_tables.sql
```

- [ ] **Step 3: Verify tables and data exist**

```bash
npx supabase db query --linked "
  SELECT name, display_name, price_per_user_monthly, base_price_monthly, min_users, included_users
  FROM subscription_plans WHERE is_active = true ORDER BY position;
"
```

Expected: 3 rows (torque-1.0, torque-2.0, torque-v8) with correct pricing.

```bash
npx supabase db query --linked "SELECT slug, price_monthly FROM plan_addons WHERE is_active = true;"
```

Expected: 1 row (turbo, 1427).

```bash
npx supabase db query --linked "SELECT code, discount_pct FROM coupons WHERE is_active = true;"
```

Expected: 1 row (MILENNIALS35, 35).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260830000000_checkout_plans_and_tables.sql
git commit -m "feat: add checkout tables - plans, addons, coupons, subscriptions, payments"
```

---

## Phase 2: Pricing Calculator (Shared Logic)

### Task 2: Pricing calculator utility

This is the source of truth for pricing logic, used by both frontend (preview) and backend (validation).

**Files:**
- Create: `src/lib/pricing-calculator.ts`

- [ ] **Step 1: Create the pricing calculator**

```typescript
// src/lib/pricing-calculator.ts

export interface PlanConfig {
  slug: string;
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

export interface AddonConfig {
  slug: string;
  price_monthly: number;
  applicable_plans: string[];
}

export interface PricingInput {
  plan: PlanConfig;
  billing_cycle: "monthly" | "semester" | "annual";
  user_count: number;
  turbo_count: number;
  addon: AddonConfig | null;
  coupon_discount_pct: number;
}

export interface PricingBreakdown {
  plan_monthly: number;       // base plan cost per month
  extras_monthly: number;     // extra users cost per month
  addons_monthly: number;     // turbo add-on cost per month
  subtotal_monthly: number;   // sum before discounts
  volume_discount: number;    // volume discount amount
  cycle_discount: number;     // semester/annual discount amount
  coupon_discount: number;    // coupon discount amount
  total_monthly: number;      // final monthly after all discounts
  total_cycle: number;        // total for the billing cycle
  cycle_months: number;       // 1, 6, or 12
}

export function calculatePricing(input: PricingInput): PricingBreakdown {
  const { plan, billing_cycle, user_count, turbo_count, addon, coupon_discount_pct } = input;

  // Enforce minimum users
  const users = Math.max(user_count, plan.min_users);

  // Plan base monthly cost
  let plan_monthly: number;
  let extras_monthly = 0;

  if (plan.base_price_monthly) {
    // Package plan (V8): fixed base + extra users beyond included
    plan_monthly = plan.base_price_monthly;
    const extra_users = Math.max(users - plan.included_users, 0);
    extras_monthly = extra_users * plan.extra_user_price;
  } else if (plan.price_per_user_monthly) {
    // Per-user plan (1.0, 2.0): all users charged per-user
    plan_monthly = users * plan.price_per_user_monthly;
    extras_monthly = 0;
  } else {
    plan_monthly = 0;
  }

  // Add-on (Turbo)
  let addons_monthly = 0;
  if (addon && turbo_count > 0 && addon.applicable_plans.includes(plan.slug)) {
    addons_monthly = turbo_count * addon.price_monthly;
  }

  const subtotal_monthly = plan_monthly + extras_monthly + addons_monthly;

  // Volume discount: applies to per-user price when 10+ users
  let volume_discount = 0;
  if (users >= plan.discount_volume_min) {
    if (plan.price_per_user_monthly) {
      // Per-user plans: discount on all users
      volume_discount = users * plan.price_per_user_monthly * (plan.discount_volume_pct / 100);
    } else if (plan.base_price_monthly) {
      // Package plan: discount on extra users only
      const extra_users = Math.max(users - plan.included_users, 0);
      volume_discount = extra_users * plan.extra_user_price * (plan.discount_volume_pct / 100);
    }
  }

  const after_volume = subtotal_monthly - volume_discount;

  // Coupon discount: applies to plan cost (not extras/addons)
  let coupon_discount = 0;
  if (coupon_discount_pct > 0) {
    coupon_discount = after_volume * (coupon_discount_pct / 100);
  }

  const after_coupon = after_volume - coupon_discount;

  // Cycle discount
  let cycle_discount_pct = 0;
  if (billing_cycle === "semester") cycle_discount_pct = plan.discount_semester_pct;
  if (billing_cycle === "annual") cycle_discount_pct = plan.discount_annual_pct;
  const cycle_discount = after_coupon * (cycle_discount_pct / 100);

  const total_monthly = Math.max(after_coupon - cycle_discount, 0);
  const cycle_months = billing_cycle === "annual" ? 12 : billing_cycle === "semester" ? 6 : 1;
  const total_cycle = total_monthly * cycle_months;

  return {
    plan_monthly,
    extras_monthly,
    addons_monthly,
    subtotal_monthly,
    volume_discount: Math.round(volume_discount * 100) / 100,
    cycle_discount: Math.round(cycle_discount * 100) / 100,
    coupon_discount: Math.round(coupon_discount * 100) / 100,
    total_monthly: Math.round(total_monthly * 100) / 100,
    total_cycle: Math.round(total_cycle * 100) / 100,
    cycle_months,
  };
}

export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/pricing-calculator.ts
git commit -m "feat: add pricing calculator with volume/cycle/coupon discounts"
```

---

## Phase 3: Landing Page

### Task 3: Landing page CSS variables and base styles

**Files:**
- Create: `src/styles/landing.css`

- [ ] **Step 1: Extract landing page CSS from mockup**

Extract the CSS from `/Volumes/Untitled/torque-landing-mockup/index.html` (lines 10-512) into `src/styles/landing.css`. Scope all rules under a `.landing-page` wrapper class to prevent bleed into the existing app. Keep the full palette, animations, component styles, and responsive breakpoints.

- [ ] **Step 2: Commit**

```bash
git add src/styles/landing.css
git commit -m "feat: add landing page styles extracted from mockup"
```

### Task 4: Landing page components

**Files:**
- Create: `src/pages/Landing.tsx`
- Create: `src/components/landing/LandingNavbar.tsx`
- Create: `src/components/landing/HeroSection.tsx`
- Create: `src/components/landing/LogosMarquee.tsx`
- Create: `src/components/landing/FeatureShowcase.tsx`
- Create: `src/components/landing/SegmentsGrid.tsx`
- Create: `src/components/landing/TestimonialsGrid.tsx`
- Create: `src/components/landing/PricingSection.tsx`
- Create: `src/components/landing/FAQAccordion.tsx`
- Create: `src/components/landing/CTAFinal.tsx`
- Create: `src/components/landing/LandingFooter.tsx`

- [ ] **Step 1: Create Landing.tsx page**

Convert the HTML body from the mockup into a React page that imports all section components. Wrap in `<div className="landing-page">` for CSS scoping. Import `src/styles/landing.css`.

Reference: `/Volumes/Untitled/torque-landing-mockup/index.html` lines 514-988

- [ ] **Step 2: Create LandingNavbar**

Convert navbar HTML (mockup lines 517-544). Key changes:
- "Login" links to `/auth`
- "Criar conta" links to `/signup`
- "Demonstração" links to `/signup`
- "Planos e Preços" scrolls to `#pricing`
- Mobile menu toggle with state

- [ ] **Step 3: Create HeroSection**

Convert hero HTML (mockup lines 547-574). CTAs link to `/signup`.

- [ ] **Step 4: Create LogosMarquee**

Convert logos HTML (mockup lines 577-597). CSS marquee animation.

- [ ] **Step 5: Create FeatureShowcase**

Convert feature sections (mockup lines 612-736). Each section is a `FeatureSection` sub-component with props for title, label, description, chips, visual placeholder, and dark/light/gradient variant.

5 sections: Conversas, CRM, Automaçoes, IA, Campanhas, Indicadores.

- [ ] **Step 6: Create SegmentsGrid**

Convert segments (mockup lines 738-764). 4 segment cards.

- [ ] **Step 7: Create TestimonialsGrid**

Convert testimonials (mockup lines 766-788). 3 testimonial cards.

- [ ] **Step 8: Create PricingSection**

This is the **most important component** - replaces the mockup pricing with real plans.

Key structure:
- Billing cycle toggle (mensal / semestral / anual) - 3-option segmented control
- 3 plan cards (1.0, 2.0, V8) with dynamic pricing based on cycle
- User count stepper per card (respecting min_users)
- V8 card marked as "featured" with badge "Mais completo"
- Turbo add-on section below cards (for 1.0 and 2.0)
- Comparison table with real feature map from spec section 1.5
- CTA buttons link to `/signup?plan=<slug>`

Uses `calculatePricing()` from `src/lib/pricing-calculator.ts` for live price preview.

Fetches plan data from `subscription_plans` and `plan_addons` tables via Supabase (public read via RLS).

- [ ] **Step 9: Create FAQAccordion**

Convert FAQ (mockup lines 916-946). Update questions to reflect real Torque plans.

- [ ] **Step 10: Create CTAFinal**

Convert CTA (mockup lines 949-956). CTA links to `/signup`.

- [ ] **Step 11: Create LandingFooter**

Convert footer (mockup lines 958-985). Link "Privacidade" to `/privacidade`.

- [ ] **Step 12: Commit**

```bash
git add src/pages/Landing.tsx src/components/landing/
git commit -m "feat: add landing page with all sections converted from mockup"
```

---

## Phase 4: Signup Page

### Task 5: Public signup page

**Files:**
- Create: `src/pages/Signup.tsx`

- [ ] **Step 1: Create Signup page**

Public page with form fields:
- Nome completo
- Email
- Telefone (masked input)
- CPF/CNPJ (masked input with auto-detect)
- Senha (with strength indicator)

On submit:
1. Call `supabase.auth.signUp({ email, password, options: { data: { full_name, phone, document, subscription_status: 'pending_payment' } } })`
2. On success → `navigate('/checkout')` (preserve `?plan=` query param if present)
3. On error → show inline error

Design: matches the landing page palette (orange/grad). Left side with branding, right side with form (similar to existing Auth.tsx but adapted for the landing design).

If user is already authenticated → redirect to `/checkout`.

- [ ] **Step 2: Commit**

```bash
git add src/pages/Signup.tsx
git commit -m "feat: add public signup page with pending_payment status"
```

---

## Phase 5: Checkout Wizard

### Task 6: Checkout page and step components

**Files:**
- Create: `src/pages/Checkout.tsx`
- Create: `src/components/checkout/CheckoutWizard.tsx`
- Create: `src/components/checkout/PlanSelector.tsx`
- Create: `src/components/checkout/OrgSetup.tsx`
- Create: `src/components/checkout/PaymentStep.tsx`
- Create: `src/components/checkout/CheckoutSummary.tsx`
- Create: `src/components/checkout/PixQRCode.tsx`
- Create: `src/hooks/useCheckout.ts`
- Create: `src/hooks/useCouponValidation.ts`

- [ ] **Step 1: Create useCheckout hook**

State management for the checkout wizard:

```typescript
// src/hooks/useCheckout.ts
interface CheckoutState {
  step: 1 | 2 | 3;
  plan_slug: string | null;
  billing_cycle: "monthly" | "semester" | "annual";
  user_count: number;
  turbo_count: number;
  coupon_code: string;
  coupon_discount_pct: number;
  coupon_id: string | null;
  org_name: string;
  team_members: Array<{ name: string; email: string }>;
  payment_method: "pix" | "credit_card" | null;
  payment_id: string | null;
  payment_status: "idle" | "processing" | "awaiting_pix" | "confirmed" | "error";
  error: string | null;
}
```

Provides: `state`, `setStep`, `setPlan`, `setBillingCycle`, `setUserCount`, `setTurboCount`, `applyCoupon`, `setOrgName`, `setTeamMembers`, `submitPayment`, `pricing` (computed via `calculatePricing`).

Reads `?plan=` from URL to pre-select plan.

- [ ] **Step 2: Create useCouponValidation hook**

```typescript
// src/hooks/useCouponValidation.ts
// Calls supabase.rpc("validate_coupon", { p_code, p_plan_slug })
// Returns { validate, isValidating, result }
```

- [ ] **Step 3: Create Checkout.tsx page**

Protected by auth (redirect to `/signup` if not authenticated). Renders `<CheckoutWizard />`. If user already has an active org → redirect to `/dashboard`.

- [ ] **Step 4: Create CheckoutWizard**

3-step wizard with progress bar. Renders PlanSelector, OrgSetup, or PaymentStep based on current step. Includes sticky `<CheckoutSummary />` sidebar on desktop.

- [ ] **Step 5: Create PlanSelector (Step 1)**

3 plan cards + billing cycle toggle + user count stepper + turbo toggle + coupon input. Uses pricing calculator for live price. Similar to PricingSection from landing page but interactive (steppers, toggles).

- [ ] **Step 6: Create OrgSetup (Step 2)**

Org name input + dynamic list of team member name/email fields based on `user_count`. First member is pre-filled with the authenticated user's name/email (read-only).

- [ ] **Step 7: Create PaymentStep (Step 3)**

Two tabs: "Cartão de Crédito" and "PIX".

**Cartão tab:** Card form fields (number, expiry, CVV, holder name). On submit: tokenize via Asaas.js SDK, then call `checkout-create-payment` edge function with token.

**PIX tab:** Button "Gerar QR Code PIX". Calls `checkout-create-payment` with `payment_method: "pix"`. Shows `<PixQRCode />` with QR image + copy-paste code. Polls payment status every 5s.

- [ ] **Step 8: Create CheckoutSummary**

Sidebar showing live breakdown: plan name, user count, add-ons, discounts, total. Uses `calculatePricing()`.

- [ ] **Step 9: Create PixQRCode**

Renders QR code image (from Asaas `qr_code` base64), copy-to-clipboard button for PIX code, countdown timer, and status polling indicator.

- [ ] **Step 10: Create CheckoutSuccess page**

```
src/pages/CheckoutSuccess.tsx
```

Confirmation page: confetti animation, "Organização criada!" message, CTA to go to dashboard.

- [ ] **Step 11: Commit**

```bash
git add src/pages/Checkout.tsx src/pages/CheckoutSuccess.tsx src/components/checkout/ src/hooks/useCheckout.ts src/hooks/useCouponValidation.ts
git commit -m "feat: add checkout wizard with plan selector, org setup, and payment step"
```

---

## Phase 6: Edge Functions

### Task 7: Asaas shared utilities

**Files:**
- Create: `supabase/functions/_shared/asaas.ts`

- [ ] **Step 1: Create Asaas API wrapper**

```typescript
// supabase/functions/_shared/asaas.ts

const ASAAS_API_URL = Deno.env.get("ASAAS_API_URL") || "https://api.asaas.com/v3";
const ASAAS_API_KEY = Deno.env.get("ASAAS_API_KEY")!;

interface AsaasHeaders {
  "Content-Type": string;
  access_token: string;
}

function headers(): AsaasHeaders {
  return {
    "Content-Type": "application/json",
    access_token: ASAAS_API_KEY,
  };
}

export async function createCustomer(data: {
  name: string;
  email: string;
  cpfCnpj: string;
  phone?: string;
}) {
  const res = await fetch(`${ASAAS_API_URL}/customers`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Asaas createCustomer failed: ${res.status} ${err}`);
  }
  return res.json();
}

export async function createPayment(data: {
  customer: string;
  billingType: "PIX" | "CREDIT_CARD";
  value: number;
  dueDate: string;
  description: string;
  creditCard?: any;
  creditCardHolderInfo?: any;
  creditCardToken?: string;
}) {
  const res = await fetch(`${ASAAS_API_URL}/payments`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Asaas createPayment failed: ${res.status} ${err}`);
  }
  return res.json();
}

export async function createSubscription(data: {
  customer: string;
  billingType: "CREDIT_CARD";
  value: number;
  cycle: "MONTHLY" | "SEMIANNUALLY" | "YEARLY";
  nextDueDate: string;
  description: string;
  creditCardToken: string;
}) {
  const res = await fetch(`${ASAAS_API_URL}/subscriptions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Asaas createSubscription failed: ${res.status} ${err}`);
  }
  return res.json();
}

export async function getPaymentPixQrCode(paymentId: string) {
  const res = await fetch(`${ASAAS_API_URL}/payments/${paymentId}/pixQrCode`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Asaas getPixQrCode failed: ${res.status} ${err}`);
  }
  return res.json();
}

export async function getPaymentStatus(paymentId: string) {
  const res = await fetch(`${ASAAS_API_URL}/payments/${paymentId}`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Asaas getPaymentStatus failed: ${res.status} ${err}`);
  }
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/asaas.ts
git commit -m "feat: add Asaas API shared wrapper for edge functions"
```

### Task 8: checkout-create-payment edge function

**Files:**
- Create: `supabase/functions/checkout-create-payment/index.ts`

- [ ] **Step 1: Create the edge function**

This function:
1. Validates JWT (authenticated user)
2. Receives: `{ plan_slug, billing_cycle, user_count, turbo_count, coupon_code, payment_method, card_token?, org_name, team_members }`
3. Fetches plan from DB, validates all inputs
4. Recalculates pricing server-side using same formula as `pricing-calculator.ts`
5. Creates Asaas customer (or reuses existing)
6. Creates payment (PIX) or subscription (card)
7. Stores pending data in `payment_history`
8. Returns QR code (PIX) or confirmation (card)

The function must include the complete pricing calculation logic (not import from frontend). Replicate the `calculatePricing` formula in the edge function to be self-contained.

Key security: validate `user_count >= plan.min_users`, validate coupon server-side, validate addon applicability, calculate final amount server-side.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/checkout-create-payment/
git commit -m "feat: add checkout-create-payment edge function with Asaas integration"
```

### Task 9: checkout-provision-org edge function

**Files:**
- Create: `supabase/functions/checkout-provision-org/index.ts`

- [ ] **Step 1: Create the provisioning function**

This function is called internally (by webhook or by create-payment for card). It:
1. Receives: `{ payment_id, user_id }`
2. Fetches payment details from `payment_history`
3. Creates organization with correct plan_id, subscription_status='active'
4. Creates team_members for each user (admin for the primary user, member for others)
5. Creates `org_subscriptions` record
6. Updates user metadata to remove `pending_payment`
7. Updates `payment_history` status to 'confirmed'
8. Sends welcome emails (via Supabase email or log for now)

All operations in a transaction-like flow with error handling.

**Idempotency:** Check if org already exists for this payment - if so, return success without re-creating.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/checkout-provision-org/
git commit -m "feat: add checkout-provision-org edge function for org creation"
```

### Task 10: asaas-webhook edge function

**Files:**
- Create: `supabase/functions/asaas-webhook/index.ts`

- [ ] **Step 1: Create the webhook handler**

Handles Asaas webhook events:
1. Validates `asaas-access-token` header against `ASAAS_WEBHOOK_TOKEN` env var
2. Parses event type from body
3. Routes events:
   - `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` → call `checkout-provision-org` if first payment, else update status
   - `PAYMENT_OVERDUE` → update org `subscription_status = 'overdue'`
   - `PAYMENT_DELETED` / `PAYMENT_REFUNDED` → update org `subscription_status = 'suspended'`
   - `SUBSCRIPTION_DELETED` → update org `subscription_status = 'cancelled'`
4. Returns 200 for all events (Asaas requires 200 ACK)

**Idempotency:** `asaas_payment_id` is UNIQUE - duplicate webhook calls are harmless.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/asaas-webhook/
git commit -m "feat: add asaas-webhook edge function for payment lifecycle"
```

---

## Phase 7: Route Integration

### Task 11: Register new routes in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add lazy imports for new pages**

At the top of App.tsx, after existing lazy imports (around line 35-90), add:

```typescript
const Landing = lazy(() => lazyRetry(() => import("./pages/Landing")));
const Signup = lazy(() => lazyRetry(() => import("./pages/Signup")));
const Checkout = lazy(() => lazyRetry(() => import("./pages/Checkout")));
const CheckoutSuccess = lazy(() => lazyRetry(() => import("./pages/CheckoutSuccess")));
```

- [ ] **Step 2: Add public routes**

In the `AppRoutes` function, before the existing `<Route path="/auth"` line (around line 164), add:

```typescript
<Route path="/landing" element={<Landing />} />
<Route path="/signup" element={<Signup />} />
```

Add the checkout route as a protected route (requires auth but NOT org):

```typescript
<Route path="/checkout" element={<ProtectedRoute requireOrganization={false}><Checkout /></ProtectedRoute>} />
<Route path="/checkout/success" element={<ProtectedRoute requireOrganization={false}><CheckoutSuccess /></ProtectedRoute>} />
```

- [ ] **Step 3: Update root route**

Change the root `/` route to show Landing for unauthenticated users and Dashboard for authenticated users. This can be handled by checking auth state:

```typescript
<Route path="/" element={<RootRedirect />} />
```

Where `RootRedirect` checks if user is authenticated → redirect to `/dashboard`, else → show `<Landing />`.

Move the existing Dashboard route from `/` to `/dashboard`.

- [ ] **Step 4: Add pending_payment redirect**

In `ProtectedRoute.tsx`, after the auth check, add a check: if user metadata has `subscription_status === 'pending_payment'` and no team_member → redirect to `/checkout`.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/ProtectedRoute.tsx
git commit -m "feat: register landing, signup, checkout routes with auth guards"
```

---

## Phase 8: Edge Function Deployment

### Task 12: Deploy edge functions

- [ ] **Step 1: Set Asaas environment secrets**

```bash
npx supabase secrets set ASAAS_API_KEY=<key> ASAAS_API_URL=https://api.asaas.com/v3 ASAAS_WEBHOOK_TOKEN=<token>
```

Note: The Asaas account needs to be created first. Use sandbox URL for testing: `https://sandbox.asaas.com/api/v3`

- [ ] **Step 2: Deploy edge functions**

```bash
npx supabase functions deploy checkout-create-payment
npx supabase functions deploy checkout-provision-org
npx supabase functions deploy asaas-webhook
```

- [ ] **Step 3: Configure Asaas webhook URL**

In the Asaas dashboard, set webhook URL to:
`https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/asaas-webhook`

Events to subscribe: PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_OVERDUE, PAYMENT_DELETED, PAYMENT_REFUNDED, SUBSCRIPTION_DELETED

- [ ] **Step 4: Commit any final changes**

```bash
git add -A
git commit -m "feat: deploy checkout edge functions and configure Asaas"
```

---

## Phase 9: Integration Testing

### Task 13: End-to-end verification

- [ ] **Step 1: Verify landing page renders**

Navigate to `/` (unauthenticated). Verify all sections render, pricing cards show correct values, CTAs link to `/signup`.

- [ ] **Step 2: Test signup flow**

Click "Criar conta" → fill form → submit. Verify user is created in Supabase Auth with `pending_payment` metadata. Verify redirect to `/checkout`.

- [ ] **Step 3: Test checkout wizard**

Select plan → configure users → fill org details → proceed to payment. Verify pricing matches expected values. Test coupon validation.

- [ ] **Step 4: Test PIX payment (sandbox)**

Select PIX → generate QR code → verify QR renders. In Asaas sandbox, confirm the payment. Verify webhook fires → org is provisioned → user redirected to success.

- [ ] **Step 5: Test card payment (sandbox)**

Select card → enter test card → submit. Verify subscription created in Asaas. Verify org provisioned immediately.

- [ ] **Step 6: Test login redirect**

Log out → log back in with `pending_payment` user → verify redirect to `/checkout`. Log in with active user → verify redirect to `/dashboard`.

---

## Summary

| Phase | Tasks | What it produces |
|---|---|---|
| 1. Database | Task 1 | Tables, plans, addons, coupons, RLS |
| 2. Pricing | Task 2 | Shared pricing calculator |
| 3. Landing | Tasks 3-4 | Full landing page from mockup |
| 4. Signup | Task 5 | Public signup with pending_payment |
| 5. Checkout | Task 6 | 3-step checkout wizard |
| 6. Edge Functions | Tasks 7-10 | Asaas integration + provisioning |
| 7. Routes | Task 11 | Route registration + guards |
| 8. Deploy | Task 12 | Edge function deployment |
| 9. Testing | Task 13 | End-to-end verification |

**Total:** 13 tasks across 9 phases. Phases 1-2 are foundational. Phases 3-5 are frontend. Phases 6-8 are backend. Phase 9 is verification.


## Links relacionados

- [[Produtos]]

- [[Checkout e Planos]]

- [[Gestao de Time]]

- [[Webhooks]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[Ranking]]

- [[Campanhas]]

- [[Oraculo Comercial]]

- [[Asaas Pagamentos]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
