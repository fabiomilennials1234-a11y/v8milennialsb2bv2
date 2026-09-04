-- ============================================================================
-- BACKFILL de `leads.primeiro_pedido_erp_at` (DML — não é migration, guarda F4)
--
-- Pré-requisito: migration `20270933000000` aplicada.
--
-- É a segunda perna da lei da Relação. Sem ela, 178 leads que a coluna
-- "Relação" da lista chama de **Cliente** continuam caindo em **Leads** no
-- filtro — a mesma linha da mesma tela dizendo duas coisas (medido em prod
-- 2026-09-04, sobre 56.859 leads vivos).
-- ============================================================================

-- ── 0) GRANTS. Esperado: false, false, true. ────────────────────────────────
--    A função é SECURITY DEFINER e escreve em `leads` bypassando RLS.
SELECT has_function_privilege('anon',
         'public.fn_lead_recalcula_pedido_erp(uuid)', 'EXECUTE')  AS anon,
       has_function_privilege('authenticated',
         'public.fn_lead_recalcula_pedido_erp(uuid)', 'EXECUTE')  AS authenticated,
       has_function_privilege('service_role',
         'public.fn_lead_recalcula_pedido_erp(uuid)', 'EXECUTE')  AS service_role;

-- ── 1) O que será marcado. Esperado: 377. ───────────────────────────────────
SELECT count(DISTINCT c.lead_id) AS leads_a_marcar
FROM public.upsell_clients c
JOIN public.leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
WHERE coalesce(c.order_count, 0) > 0;

-- ── 2) O backfill, pela MESMA função do trigger. ────────────────────────────
SELECT count(*) AS leads_processados
FROM (
  SELECT public.fn_lead_recalcula_pedido_erp(alvo.lead_id)
  FROM (SELECT DISTINCT c.lead_id
          FROM public.upsell_clients c
         WHERE c.lead_id IS NOT NULL) AS alvo
) AS execucao;

-- ── 3) A lei inteira, agora. Esperado: 1.935 clientes. ──────────────────────
SELECT
  count(*) FILTER (WHERE primeira_venda_at IS NOT NULL
                      OR primeiro_pedido_erp_at IS NOT NULL)  AS clientes,
  count(*) FILTER (WHERE primeira_venda_at IS NULL
                     AND primeiro_pedido_erp_at IS NULL)      AS leads,
  count(*) FILTER (WHERE primeira_venda_at IS NULL
                     AND primeiro_pedido_erp_at IS NOT NULL)  AS so_pelo_erp,
  count(*)                                                    AS total
FROM public.leads
WHERE deleted_at IS NULL;

-- ── 4) A prova de que a materialização bate com a lei do FRONT. ─────────────
--    Divergência aqui = a lista discordando da coluna "Relação". Esperado: 0.
SELECT count(*) AS divergencias
FROM public.leads l
WHERE l.deleted_at IS NULL
  AND (
        (l.primeira_venda_at IS NOT NULL OR l.primeiro_pedido_erp_at IS NOT NULL)
        <> (
          EXISTS (SELECT 1 FROM public.sale_events s
                   WHERE s.lead_id = l.id
                     AND s.reversed_event_id IS NULL
                     AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                                      WHERE r.reversed_event_id = s.id))
          OR
          EXISTS (SELECT 1 FROM public.upsell_clients c
                   WHERE c.lead_id = l.id
                     AND coalesce(c.order_count, 0) > 0)
        )
      );
