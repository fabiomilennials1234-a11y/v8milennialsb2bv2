-- Quick Blast (Disparo Rápido) org-level lead cap — ADR-0002.
-- The cap is the sole safety guardrail (no role gate): an authenticated member
-- can fire a blast, but never above this ceiling. Default 200; resolveOrgCap()
-- fails closed to 200 for NULL/invalid values, so a missing config is never
-- "unlimited".
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS quick_blast_max_leads INTEGER NOT NULL DEFAULT 200;

COMMENT ON COLUMN public.organizations.quick_blast_max_leads IS
  'Max leads per Quick Blast (Disparo Rápido). Server-enforced safety ceiling — ADR-0002. Default 200.';
