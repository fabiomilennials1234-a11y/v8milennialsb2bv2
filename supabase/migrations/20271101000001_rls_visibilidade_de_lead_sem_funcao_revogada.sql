-- Duas policies de leitura chamavam `can_link_or_read_lead()`, que `authenticated`
-- NÃO executa — de propósito (20270817090000_lead_social_identities.sql): ela é
-- SECURITY DEFINER e recorta por parâmetro do cliente, então exposta viraria um
-- oráculo ("este lead existe nesta org?"). A expressão de uma policy roda como o
-- usuário que consulta, então toda leitura dessas tabelas por usuário comum falhava
-- com `42501: permission denied for function can_link_or_read_lead`.
--
-- Achado pelo Sentry no primeiro minuto em produção (2026-10-01 15:56 UTC, issue
-- TORQUE-WEB-1): abrir o card de um negócio → `GET deal_order_adjustments` 403.
-- `historical_sale_batches` tinha a mesma construção.
--
-- A função existe para uso DENTRO de DEFINER, que bypassa RLS — ela é o espelho da
-- policy de `leads`. Numa policy o espelho é desnecessário: `EXISTS` em `leads` passa
-- pela RLS de `leads` do próprio usuário, que é a regra original (lixeira, org,
-- admin, `leads.view_all`, responsável, SDR/closer, responsável em funil, gestor de
-- portfólio, master). Fiel por construção — e mais fiel que a função, que não
-- conhece o gestor. A função continua revogada de `authenticated`.
--
-- `ALTER POLICY` (não DROP + CREATE): troca atômica, sem janela sem policy, mantém
-- papéis e nome. Nenhuma das duas tabelas está em `supabase_realtime`.
--
-- Só schema (guarda F4).

ALTER POLICY deal_order_adjustments_read ON public.deal_order_adjustments
  USING (
    (public.is_master_user() OR organization_id IN (SELECT public.get_my_organization_ids()))
    AND EXISTS (
      SELECT 1
        FROM public.deals d
       WHERE d.id = deal_order_adjustments.deal_id
         AND d.organization_id = deal_order_adjustments.organization_id
         AND EXISTS (
           SELECT 1
             FROM public.leads l
            WHERE l.id = d.source_lead_id
              AND l.organization_id = d.organization_id
         )
    )
  );

ALTER POLICY tenant_isolation_select ON public.historical_sale_batches
  USING (
    (organization_id IN (SELECT public.get_my_organization_ids()) OR public.is_master_user())
    AND EXISTS (
      SELECT 1
        FROM public.leads l
       WHERE l.id = historical_sale_batches.lead_id
         AND l.organization_id = historical_sale_batches.organization_id
    )
  );
