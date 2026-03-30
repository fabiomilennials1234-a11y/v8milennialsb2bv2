-- ================================================================
-- Migration: Add CHECK constraints on monetary columns
--
-- Prevents negative prices, amounts, and invalid user counts
-- from being inserted into financial tables.
-- Date: 2026-08-30
-- ================================================================

-- subscription_plans: all price columns must be non-negative
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT chk_prices_non_negative CHECK (
    COALESCE(price_per_user_monthly, 0) >= 0
    AND COALESCE(base_price_monthly, 0) >= 0
    AND COALESCE(extra_user_price, 0) >= 0
  );

-- org_subscriptions: amounts must be non-negative, user_count >= 1
ALTER TABLE public.org_subscriptions
  ADD CONSTRAINT chk_sub_amounts CHECK (base_amount >= 0 AND final_amount >= 0),
  ADD CONSTRAINT chk_sub_user_count CHECK (user_count >= 1);

-- payment_history: amount must be non-negative
ALTER TABLE public.payment_history
  ADD CONSTRAINT chk_payment_amount_positive CHECK (amount >= 0);

-- plan_addons: price must be non-negative
ALTER TABLE public.plan_addons
  ADD CONSTRAINT chk_addon_price_positive CHECK (price_monthly >= 0);
