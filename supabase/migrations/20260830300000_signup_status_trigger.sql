-- ================================================================
-- Migration: Trigger to set subscription_status on new user signup
--
-- This ensures the client cannot control subscription_status via
-- the signUp metadata. The trigger always sets pending_payment on
-- new user creation unless an admin/master process has already
-- set a different status.
-- Date: 2026-08-30
-- ================================================================

CREATE OR REPLACE FUNCTION public.set_pending_payment_on_signup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only set if not already set by an admin/master process
  IF NEW.raw_user_meta_data->>'subscription_status' IS NULL OR
     NEW.raw_user_meta_data->>'subscription_status' = 'pending_payment' THEN
    NEW.raw_user_meta_data = COALESCE(NEW.raw_user_meta_data, '{}'::jsonb) ||
      '{"subscription_status": "pending_payment"}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_pending_payment_on_signup IS
  'Trigger function: ensures every new user gets subscription_status=pending_payment '
  'in their metadata. Prevents client-side paywall bypass.';

-- Apply to auth.users on INSERT
CREATE TRIGGER trg_set_pending_payment
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_pending_payment_on_signup();
