-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260710202244  name: support_comment_from_staff
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

ALTER TABLE public.support_ticket_comments
  ADD COLUMN IF NOT EXISTS from_staff boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.support_ticket_comments.from_staff IS
  'True = escrito pelo suporte da Torque (console master). False = mensagem da Organização (painel do cliente). Carimba a ORIGEM, não a identidade do autor — um master escreve dos dois lados.';

UPDATE public.support_ticket_comments
  SET from_staff = true
  WHERE from_staff = false AND public.is_master_user(author_user_id);

ALTER TABLE public.support_ticket_comments
  DROP CONSTRAINT IF EXISTS support_ticket_comments_internal_implies_staff;
ALTER TABLE public.support_ticket_comments
  ADD CONSTRAINT support_ticket_comments_internal_implies_staff
  CHECK (NOT is_internal OR from_staff);

DROP POLICY IF EXISTS support_ticket_comments_insert ON public.support_ticket_comments;
CREATE POLICY support_ticket_comments_insert ON public.support_ticket_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND public.can_read_support_ticket(ticket_id)
    AND (is_internal = false OR public.is_master_user())
    AND (from_staff = false OR public.is_master_user())
  );
