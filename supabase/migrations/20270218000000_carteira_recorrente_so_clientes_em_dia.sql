-- carteira: "Receita Recorrente" passa a contar só cliente em dia com a recompra
--
-- Problema (reportado 2026-08-12, org Grafica Cauta): depois de importar a base
-- histórica pra carteira, o KPI "Receita Recorrente" somava venda de 2020/2022
-- como receita DESTE mês. A soma não tinha filtro de recência nenhum — todo
-- cliente is_active entrava, para sempre, independente de quando comprou.
--
-- Agravante: com order_count = 1 o reorder_cycle_days cai no default da org
-- (30 dias, ver recalc_upsell_client_metrics). Ou seja, uma venda avulsa de
-- R$ 20k em 2022 virava "R$ 20k/mês recorrente" indefinidamente.
--
-- Medido no PROD antes do fix (Grafica Cauta, 112 clientes com ticket):
--   exibido ................................. R$ 868.424,85
--   parados há 1-2 anos (16 clientes) ....... R$  77.925,80
--   parados há 2+ anos  (55 clientes) ....... R$ 190.722,55  (média 1.399 dias)
--   → 31% do KPI vinha de quem não compra há mais de um ano.
--
-- Fix: total_recurring soma só quem está dentro do próprio ciclo de recompra,
-- com a MESMA tolerância de 1.15 que overdue_count/overdue_revenue já usam.
-- Os dois filtros viram complementares: um cliente aparece em "Recompra
-- Atrasada" OU em "Receita Recorrente", nunca nos dois. Cliente sem histórico
-- (days_since_last_order = 999 quando nunca comprou) fica fora naturalmente.
--
-- Decisão de produto (CTO, 2026-08-12): cliente com 1 pedido só CONTINUA
-- contando, usando o ciclo default da org. Exigir order_count >= 2 seria o
-- número mais honesto, mas zeraria a carteira de quem só importou histórico
-- (Cauta: 0 de 112 clientes têm 2+ pedidos).
--
-- Efeito esperado no PROD: Cauta 868.424,85 → 438.194,48 (19 clientes).
--
-- Escopo: só total_recurring. overdue_revenue segue somando avg_ticket CRU
-- (sem normalizar por ciclo) — inconsistência pré-existente, não tocada aqui.
--
-- Base: versão VIVA no PROD (com assert_org_access + assert_org_member +
-- handler de access_denied), não a versão de 20261018000000_portfolio_rpcs.sql,
-- que está defasada em disco.

CREATE OR REPLACE FUNCTION public.get_portfolio_kpis(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  PERFORM assert_org_member(p_org_id);

  RETURN (
    SELECT jsonb_build_object(
      'total_clients',      COUNT(*)::int,
      -- só cliente em dia com a recompra: complemento exato do filtro de overdue
      'total_recurring',    COALESCE(SUM(
                              avg_ticket * (30.0 / GREATEST(COALESCE(reorder_cycle_days, 30), 1))
                            ) FILTER (
                              WHERE days_since_last_order IS NOT NULL
                                AND reorder_cycle_days IS NOT NULL
                                AND days_since_last_order <= reorder_cycle_days * 1.15
                            ), 0)::numeric,
      'overdue_count',      COUNT(*) FILTER (
                              WHERE days_since_last_order IS NOT NULL
                                AND reorder_cycle_days IS NOT NULL
                                AND days_since_last_order > reorder_cycle_days * 1.15
                            )::int,
      'overdue_revenue',    COALESCE(SUM(avg_ticket) FILTER (
                              WHERE days_since_last_order IS NOT NULL
                                AND reorder_cycle_days IS NOT NULL
                                AND days_since_last_order > reorder_cycle_days * 1.15
                            ), 0)::numeric,
      'avg_health',         COALESCE(ROUND(AVG(health_score)), 0)::int,
      'avg_ticket',         CASE WHEN COUNT(*) > 0
                              THEN ROUND(COALESCE(SUM(avg_ticket), 0) / COUNT(*))::numeric
                              ELSE 0
                            END,
      'expected_this_week', COUNT(*) FILTER (
                              WHERE next_order_expected IS NOT NULL
                                AND next_order_expected >= NOW()
                                AND next_order_expected <= NOW() + INTERVAL '7 days'
                            )::int,
      'segment_counts',     jsonb_build_object(
                              'ouro',     COUNT(*) FILTER (WHERE segment = 'ouro')::int,
                              'prata',    COUNT(*) FILTER (WHERE segment = 'prata')::int,
                              'novo',     COUNT(*) FILTER (WHERE segment = 'novo')::int,
                              'resgate',  COUNT(*) FILTER (WHERE segment = 'resgate')::int,
                              'dormindo', COUNT(*) FILTER (WHERE segment = 'dormindo')::int
                            )
    )
    FROM upsell_clients
    WHERE organization_id = p_org_id
      AND is_active = true
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'access_denied' THEN RETURN NULL; END IF;
    RAISE;
END;
$function$;
