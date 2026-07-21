-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260710200702  name: support_ticket_insert_master_bypass
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Bug: um master não conseguia abrir chamado. A policy de INSERT exigia
-- org ∈ get_my_organization_ids() (que filtra is_active=true), sem o bypass de
-- master que o SELECT e o UPDATE já têm. Um master cuja membership na org está
-- inativa (ou que não é membro dela) era barrado pela RLS.
--
-- O autor continua obrigatoriamente = auth.uid(): ninguém abre chamado no nome
-- de outro. Só a checagem de org é relaxada para master, alinhando ao resto das
-- policies da tabela.
DROP POLICY IF EXISTS support_tickets_insert ON public.support_tickets;
CREATE POLICY support_tickets_insert ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND (
      organization_id IN (SELECT public.get_my_organization_ids())
      OR public.is_master_user()
    )
  );
