-- ============================================================================
-- blast_plan_recipients.status gains 'failed' (ADR-0016, #947)
-- ============================================================================
-- ADDITIVE, non-destructive. `sent` is written at dispatch time and is
-- deliberately optimistic — it means "handed to the sending queue", not
-- "reached the Lead's WhatsApp" (ADR-0016 §4). The mass-send-status poll may
-- reclassify a row minutes later when the provider reports a delivery failure:
-- status flips sent → failed and `reason` receives the canonical failure code
-- (invalid_number | instance_disconnected | provider_rejected | provider_error,
-- classified from the provider's free-text error by the failure-sync core in
-- supabase/functions/_shared/quick-blast/failure-sync.ts).
--
-- Idempotent and safe on live data: the new CHECK is a strict superset of the
-- old one (pending | sent | skipped), so every existing row already satisfies
-- it — re-validation on ADD cannot fail. DROP IF EXISTS + ADD makes a re-run
-- a no-op in effect.
--
-- APLICAR dev → prod com aval explícito do CTO (regra do projeto). Não aplicado
-- automaticamente por esta slice.
-- ============================================================================

ALTER TABLE public.blast_plan_recipients
  DROP CONSTRAINT IF EXISTS blast_plan_recipients_status_check;

-- pending | sent | skipped | failed
ALTER TABLE public.blast_plan_recipients
  ADD CONSTRAINT blast_plan_recipients_status_check
  CHECK (status IN ('pending', 'sent', 'skipped', 'failed'));

COMMENT ON COLUMN public.blast_plan_recipients.status IS
  'pending | sent | skipped | failed. `sent` = accepted by the sending queue at '
  'dispatch (optimistic, ADR-0016 §4); the mass-send-status poll may reclassify '
  'it to `failed` when the provider reports a delivery failure, with `reason` = '
  'canonical failure code.';
