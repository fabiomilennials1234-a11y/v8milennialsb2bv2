-- scripts/reconcile-carteira-backfill-1200.sql
--
-- RECONCILIAÇÃO dos 273 pedidos de Carteira contra o livro-razão (#1200).
--
-- SOMENTE LEITURA. Nenhum INSERT, UPDATE ou DELETE — nem em tabela auxiliar.
-- O artefato desta fatia é o relatório versionado, não linha em banco.
--
-- Existe para dar insumo a duas decisões:
--   · #1202 (backfill)  — quanto entra, com que etiqueta, em que ordem.
--   · O CTO             — o que fazer com as sobreposições com o funil.
--
-- USO:
--   psql "$DATABASE_URL" -f scripts/reconcile-carteira-backfill-1200.sql
--
-- NOTA: roda contra prod sem a #1199 aplicada (a coluna `producer` não existe
-- lá). Por isso o script NÃO filtra por produtor: em produção, 100% do livro é
-- de funil por definição, já que Carteira nunca emitiu.

\pset pager off

CREATE TEMP VIEW recon_1200 AS
SELECT
  o.id                AS order_id,
  o.organization_id,
  c.lead_id,
  o.sold_at,
  o.sale_value,
  o.approval_status,
  o.pipe_proposta_id,
  o.sale_responsible_id,
  -- Etiqueta CANÔNICA avaliada contra o livro COMO ESTÁ HOJE (cenário 1)
  EXISTS (
    SELECT 1 FROM public.sale_events p
    WHERE p.organization_id = o.organization_id AND p.lead_id = c.lead_id
      AND p.event_type = 'sale' AND p.sold_at < o.sold_at
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                      WHERE r.event_type='sale_reversed' AND r.reversed_event_id = p.id)
  ) AS carteira_vs_livro_atual,
  -- Etiqueta CANÔNICA na CASCATA cronológica (cenário 2): o pedido anterior do
  -- mesmo lead também terá entrado no livro. `<` estrito porque a regra da
  -- #1198 diz que empate exato NÃO conta como anterior.
  EXISTS (
    SELECT 1 FROM public.upsell_orders o2
    JOIN public.upsell_clients c2 ON c2.id = o2.client_id AND c2.organization_id = o2.organization_id
    WHERE o2.organization_id = o.organization_id AND c2.lead_id = c.lead_id
      AND o2.approval_status = 'approved' AND o2.sold_at < o.sold_at
  ) AS carteira_na_cascata,
  -- Está num grupo de EMPATE de sold_at? É o que separa os dois cenários.
  EXISTS (
    SELECT 1 FROM public.upsell_orders o3
    JOIN public.upsell_clients c3 ON c3.id = o3.client_id AND c3.organization_id = o3.organization_id
    WHERE o3.organization_id = o.organization_id AND c3.lead_id = c.lead_id
      AND o3.approval_status = 'approved' AND o3.sold_at = o.sold_at AND o3.id <> o.id
  ) AS em_grupo_de_empate,
  -- Sobreposição com o funil
  (SELECT count(*) FROM public.sale_events se
    WHERE se.organization_id = o.organization_id AND se.lead_id = c.lead_id
      AND se.event_type='sale'
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                      WHERE r.event_type='sale_reversed' AND r.reversed_event_id = se.id)
  ) AS vendas_funil_do_lead,
  (SELECT count(*) FROM public.sale_events se
    WHERE se.organization_id = o.organization_id AND se.lead_id = c.lead_id
      AND se.event_type='sale'
      AND abs(extract(epoch FROM (se.sold_at - o.sold_at))) < 604800   -- 7 dias
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                      WHERE r.event_type='sale_reversed' AND r.reversed_event_id = se.id)
  ) AS funil_na_mesma_semana
FROM public.upsell_orders o
JOIN public.upsell_clients c
  ON c.id = o.client_id AND c.organization_id = o.organization_id;

\echo '== 1. Universo =='
SELECT approval_status, count(*) AS pedidos, round(sum(sale_value),2) AS valor
FROM recon_1200 GROUP BY approval_status ORDER BY 1;

\echo ''
\echo '== 2. Etiqueta: cenário 1 (contra livro atual) vs cenário 2 (cascata) =='
SELECT
  count(*)                                                  AS aprovados,
  count(*) FILTER (WHERE carteira_vs_livro_atual)           AS c1_carteira,
  count(*) FILTER (WHERE carteira_na_cascata)               AS c2_carteira,
  round(coalesce(sum(sale_value) FILTER (WHERE carteira_na_cascata),0),2) AS c2_valor_carteira,
  count(*) FILTER (WHERE em_grupo_de_empate)                AS em_empate,
  round(coalesce(sum(sale_value) FILTER (WHERE em_grupo_de_empate),0),2)  AS valor_em_empate
FROM recon_1200 WHERE approval_status='approved';

\echo ''
\echo '== 3. Sobreposição com o funil =='
SELECT
  count(*) FILTER (WHERE pipe_proposta_id IS NOT NULL)                            AS com_vinculo,
  round(coalesce(sum(sale_value) FILTER (WHERE pipe_proposta_id IS NOT NULL),0),2) AS valor_com_vinculo,
  count(*) FILTER (WHERE funil_na_mesma_semana > 0)                                AS sobrepoe_7d,
  round(coalesce(sum(sale_value) FILTER (WHERE funil_na_mesma_semana > 0),0),2)    AS valor_sobrepoe_7d,
  count(*) FILTER (WHERE vendas_funil_do_lead = 0)                                 AS sem_funil_algum
FROM recon_1200 WHERE approval_status='approved';

\echo ''
\echo '== 4. A LISTA — sobreposições na mesma semana (é sobre esta que o CTO decide) =='
SELECT org.name AS org, r.order_id, r.sold_at::date AS data_pedido, r.sale_value,
       r.pipe_proposta_id IS NOT NULL AS tem_vinculo,
       r.funil_na_mesma_semana AS vendas_funil_7d
FROM recon_1200 r JOIN public.organizations org ON org.id = r.organization_id
WHERE r.approval_status='approved' AND r.funil_na_mesma_semana > 0
ORDER BY r.sale_value DESC;

\echo ''
\echo '== 5. Delta por org, antes e depois lado a lado =='
SELECT o.name AS org,
  (SELECT count(*) FROM public.sale_events se WHERE se.organization_id=o.id AND se.event_type='sale'
     AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type='sale_reversed' AND r.reversed_event_id=se.id)) AS livro_antes,
  round((SELECT coalesce(sum(se.sale_value),0) FROM public.sale_events se WHERE se.organization_id=o.id AND se.event_type='sale'
     AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type='sale_reversed' AND r.reversed_event_id=se.id)),2) AS valor_antes,
  (SELECT count(*) FROM recon_1200 r WHERE r.organization_id=o.id AND r.approval_status='approved') AS entram,
  round((SELECT coalesce(sum(r.sale_value),0) FROM recon_1200 r WHERE r.organization_id=o.id AND r.approval_status='approved'),2) AS valor_entra
FROM public.organizations o
WHERE EXISTS (SELECT 1 FROM recon_1200 r WHERE r.organization_id=o.id AND r.approval_status='approved')
ORDER BY valor_entra DESC;

\echo ''
\echo '== 6. Impacto no NÃO-ATRIBUÍDO por org =='
SELECT o.name AS org,
  round((SELECT coalesce(sum(se.sale_value),0) FROM public.sale_events se
     WHERE se.organization_id=o.id AND se.event_type='sale' AND se.sale_responsible_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type='sale_reversed' AND r.reversed_event_id=se.id)),2) AS nao_atrib_antes,
  round((SELECT coalesce(sum(r.sale_value),0) FROM recon_1200 r
     WHERE r.organization_id=o.id AND r.approval_status='approved' AND r.sale_responsible_id IS NULL),2) AS nao_atrib_que_entra
FROM public.organizations o
WHERE EXISTS (SELECT 1 FROM recon_1200 r WHERE r.organization_id=o.id AND r.approval_status='approved')
ORDER BY nao_atrib_que_entra DESC;
