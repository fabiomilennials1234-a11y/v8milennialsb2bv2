-- Bug: um master não conseguia abrir chamado. A policy de INSERT exigia
-- org ∈ get_my_organization_ids() (que filtra is_active=true), sem o bypass de
-- master que o SELECT e o UPDATE já têm. Um master cuja membership na org está
-- inativa (ou que não é membro dela) era barrado pela RLS.
--
-- O autor continua obrigatoriamente = auth.uid(): ninguém abre chamado no nome
-- de outro. Só a checagem de org é relaxada para master, alinhando ao resto das
-- policies da tabela.
--
-- Aplicada e verificada em produção por sonda em transação revertida: master
-- (membership inativa) passa a inserir; usuário comum não-membro segue negado.
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
