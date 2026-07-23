-- ================================================================
-- Migration: Add 'overdue' to subscription_status allowed values
-- Required by asaas-webhook to reflect PAYMENT_OVERDUE events.
-- Date: 2026-08-30
-- ================================================================

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_subscription_status_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_subscription_status_check
  CHECK (subscription_status IN ('trial', 'active', 'overdue', 'suspended', 'cancelled', 'expired'));

COMMENT ON COLUMN public.organizations.subscription_status IS
  'Estado da assinatura: trial | active | overdue | suspended | cancelled | expired';
