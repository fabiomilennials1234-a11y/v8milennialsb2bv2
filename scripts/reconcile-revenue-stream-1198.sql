-- scripts/reconcile-revenue-stream-1198.sql
--
-- RECONCILIAÇÃO da etiqueta de fluxo de receita (#1198, PRD #1194 · #986).
--
-- Compara, linha a linha do livro-razão de vendas:
--
--   ATUAL     = sale_events.revenue_stream, como está gravado hoje. Produzido
--               por fn_capture_sale_event e fn_backfill_state_sales, ambos com
--               a mesma expressão:
--                 EXISTS (upsell_clients uc WHERE uc.lead_id = … AND uc.is_active)
--               ou seja "este lead É CLIENTE DE CARTEIRA", e ainda por cima
--               avaliado sobre o estado de AGORA.
--
--   CANÔNICO  = public.metric_revenue_stream(org, lead, sold_at, id) — decisão 6
--               do CTO: existe venda ANTERIOR e NÃO-ESTORNADA para este lead?
--               sim = carteira (recompra), não = novo_negocio (1ª compra).
--
-- SOMENTE LEITURA. Nenhum UPDATE, nenhum INSERT. Quem reetiqueta é a #1203.
--
-- POPULAÇÃO: apenas vendas VIVAS — event_type='sale' sem sale_reversed
-- apontando para elas. Misturar viva com estornada é como se produz um número
-- que não fecha com nada: a contagem vem de uma população e o valor de outra.
--
-- PRÉ-REQUISITO: a migration 20260722230000_metric_revenue_stream_canonical.sql
-- precisa estar aplicada no alvo. Em PRODUÇÃO ela NÃO estava quando este
-- relatório foi gerado (a fatia é read-only), então os números do .deltas.md
-- foram obtidos rodando o predicado equivalente inline. O pgTAP
-- metric_revenue_stream_test.sql é o que prende função e predicado à mesma
-- regra — se divergirem, ele reprova.
--
-- USO:
--   psql "$DATABASE_URL" -f scripts/reconcile-revenue-stream-1198.sql

\pset pager off

-- ---------------------------------------------------------------------------
-- Vendas vivas + a etiqueta que a regra canônica daria a cada uma.
-- ---------------------------------------------------------------------------
CREATE TEMP VIEW recon_rs_1198 AS
SELECT
  e.id,
  e.organization_id,
  e.lead_id,
  e.sold_at,
  e.sale_value,
  e.source,
  e.revenue_stream AS etiqueta_atual,
  public.metric_revenue_stream(e.organization_id, e.lead_id, e.sold_at, e.id)
    AS etiqueta_canonica
FROM public.sale_events e
WHERE e.event_type = 'sale'
  AND NOT EXISTS (
    SELECT 1 FROM public.sale_events r
    WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = e.id
  );

-- ---------------------------------------------------------------------------
-- 1. POR ORG — quantas linhas divergem e quanto dinheiro está em cada lado.
-- ---------------------------------------------------------------------------
\echo '== 1. Divergência por organização =='
SELECT
  o.name                                                                   AS org,
  count(*)                                                                 AS vendas_vivas,
  count(*) FILTER (WHERE etiqueta_atual <> etiqueta_canonica)              AS divergentes,
  count(*) FILTER (WHERE etiqueta_atual='carteira'
                     AND etiqueta_canonica='novo_negocio')                 AS carteira_vira_novo,
  count(*) FILTER (WHERE etiqueta_atual='novo_negocio'
                     AND etiqueta_canonica='carteira')                     AS novo_vira_carteira,
  round(coalesce(sum(sale_value) FILTER (WHERE etiqueta_atual='carteira'),0),2)
                                                                           AS valor_carteira_hoje,
  round(coalesce(sum(sale_value) FILTER (WHERE etiqueta_canonica='carteira'),0),2)
                                                                           AS valor_carteira_canonico,
  round(coalesce(sum(sale_value) FILTER (WHERE etiqueta_atual <> etiqueta_canonica),0),2)
                                                                           AS valor_em_disputa
FROM recon_rs_1198 r
JOIN public.organizations o ON o.id = r.organization_id
GROUP BY o.name
ORDER BY valor_em_disputa DESC;

-- ---------------------------------------------------------------------------
-- 2. TOTAL — o número que vai pro CTO decidir a #1203.
-- ---------------------------------------------------------------------------
\echo ''
\echo '== 2. Total =='
SELECT
  count(*)                                                    AS vendas_vivas,
  count(*) FILTER (WHERE etiqueta_atual <> etiqueta_canonica) AS divergentes,
  round(100.0 * count(*) FILTER (WHERE etiqueta_atual <> etiqueta_canonica)
        / nullif(count(*),0), 1)                              AS pct_divergente,
  round(coalesce(sum(sale_value),0),2)                        AS receita_viva_total,
  round(coalesce(sum(sale_value) FILTER (WHERE etiqueta_atual='carteira'),0),2)
                                                              AS carteira_hoje,
  round(coalesce(sum(sale_value) FILTER (WHERE etiqueta_canonica='carteira'),0),2)
                                                              AS carteira_canonica
FROM recon_rs_1198;

-- ---------------------------------------------------------------------------
-- 3. POR PRODUTOR — separa o que veio do backfill do que veio do trigger.
--    Se a divergência fosse só do backfill, o defeito estaria no histórico e
--    não no fluxo vivo. Se aparece nos dois, o produtor vivo também erra.
-- ---------------------------------------------------------------------------
\echo ''
\echo '== 3. Divergência por produtor =='
SELECT
  source                                                      AS produtor,
  count(*)                                                    AS vendas_vivas,
  count(*) FILTER (WHERE etiqueta_atual <> etiqueta_canonica) AS divergentes,
  round(coalesce(sum(sale_value) FILTER (WHERE etiqueta_atual <> etiqueta_canonica),0),2)
                                                              AS valor_em_disputa
FROM recon_rs_1198
GROUP BY source
ORDER BY produtor;

-- ---------------------------------------------------------------------------
-- 4. CONTRAPROVA — existe ALGUMA recompra no livro?
--    Se zero, então nenhuma venda deveria estar etiquetada 'carteira' hoje, e
--    toda etiqueta 'carteira' existente é divergente por construção.
-- ---------------------------------------------------------------------------
\echo ''
\echo '== 4. Contraprova: recompras reais no livro =='
SELECT
  count(*)                                     AS leads_com_venda,
  count(*) FILTER (WHERE vendas > 1)           AS leads_com_recompra,
  coalesce(sum(vendas - 1) FILTER (WHERE vendas > 1), 0)
                                               AS vendas_que_seriam_carteira
FROM (
  SELECT lead_id, count(*) AS vendas
  FROM recon_rs_1198
  GROUP BY lead_id
) x;

-- ---------------------------------------------------------------------------
-- 5. AMOSTRA das divergentes de maior valor — para conferência manual.
-- ---------------------------------------------------------------------------
\echo ''
\echo '== 5. Top 10 divergências por valor =='
SELECT
  o.name AS org, r.sold_at::date AS data, r.source AS produtor,
  r.etiqueta_atual, r.etiqueta_canonica, r.sale_value
FROM recon_rs_1198 r
JOIN public.organizations o ON o.id = r.organization_id
WHERE r.etiqueta_atual <> r.etiqueta_canonica
ORDER BY r.sale_value DESC NULLS LAST
LIMIT 10;
