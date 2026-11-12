-- 20280111000800_mapa_uf_cliente_e_vendido_canonicos.sql
--
-- Mapa de clientes (aba Mapa do Comando + card "Mapa de clientes" do Estúdio):
-- "Clientes" e "Vendido" passam a vir das fontes que o resto do produto usa.
--
-- ── O defeito ────────────────────────────────────────────────────────────
-- get_uf_heatmap (clients_count, total_sold) e get_leads_by_uf (is_client,
-- sold_value) só contavam o card do funil de sistema 'propostas' parado na
-- etapa 'vendido' (negocio_projetado). Medido em prod em 11/11:
--   • org sem esse funil fica sem nada: a Café Jurerê não o usa, e o mapa
--     mostra Clientes 0 e Vendido R$ 0 nos 26 estados. Para os leads com UF,
--     a Carteira dela lista 3.691 clientes e o caderno tem R$ 886.364,65;
--   • o mapa lê a POSIÇÃO do card, e não o fato: card parado em 'vendido'
--     com o negócio aberto segue "cliente" (numa org medida, 20 de 27).
-- Org com venda gravada no caderno com sale_value NULL vê o Vendido cair por
-- outro motivo: o Comando também não soma esse valor. A correção dessa é no
-- caderno, não no mapa.
--
-- ── A regra ──────────────────────────────────────────────────────────────
-- Vendido = caderno sale_events: venda líquida de estorno, de qualquer
-- funil, na base inteira (o mapa não tem período). É a cláusula de
-- _metric_leaf_sales (Estúdio) e de get_dashboard_metrics / get_sales_metrics
-- (receita do Comando). ADR-0017 e ADR-0034 D4: receita é negócio ganho, em
-- qualquer funil. Na Café Jurerê o caderno líquido é igual aos negócios
-- ganhos: 252 vendas, R$ 926.513,65, 0 divergência.
--
-- Cliente = a regra que a Carteira (client_portfolio_page) e a /leads
-- aplicam à org, na mesma ordem de useLeads / portfolioFilters:
--   1. 'cafe' — piloto da Café Jurerê com a flag leads_cafe_jurere_cadastro_erp
--      (usaClassificacaoCafeJurere: org da CJ e flag === true). O cliente é o
--      cadastro do ERP visível na lista: visivel_lista_cafe_jurere(l) AND
--      classificacao_cafe_jurere(l) = 'cliente'. Na CJ isso é o mesmo que
--      erp_code preenchido AND cafe_jurere_erp_elegivel (0 divergências em
--      13.221 leads);
--   2. 'erp' — org com a lei do ERP ligada (toth_connections.
--      classificar_leads_por_situacao com clientes_situacoes; é o
--      useOrgUsaLeiDoErp): leads.classificacao = 'cliente';
--   3. 'relacao' — as demais orgs, pela Lei da Relação: leads.relacao_negocios
--      = 'cliente', isto é, negócio ganho ou venda líquida. É a projeção que
--      os gatilhos mantêm e a /leads filtra (20271018000001). Nenhuma
--      divergência da função relacao_negocios(l) em 64.374 leads.
-- Os três são colunas do lead, sem subconsulta por linha. A Café Jurerê, com
-- a flag ligada, fica no item 1, que tem precedência sobre a lei do ERP que
-- ela também liga, exatamente como na tela. O UUID da CJ no gate é o mesmo
-- de usaClassificacaoCafeJurere (o piloto é dela); se o piloto crescer, este
-- gate cresce junto.
--
-- ── Cirúrgica de propósito ───────────────────────────────────────────────
-- O caminho é o da 20280111000500. A migration lê o corpo VIVO, troca só os
-- trechos de cliente e vendido e reaplica. Em prod ficam private.*, a trava
-- JRTex, assert_org_access, SECURITY DEFINER, search_path e a ACL.
-- O trecho antigo cita negocio_projetado com o esquema do ambiente: private
-- em prod e na preview, public num banco montado só do repo. O caderno é lido
-- do mesmo jeito que a receita canônica o lê: private.sale_events onde a view
-- do regime dono estrito existe, public.sale_events onde não.
-- As âncoras não tocam a linha do WHERE nem o LIMIT, que 20280111000700
-- troca: o JOIN do caderno entra ANTES do WHERE, e as duas aplicam em
-- qualquer ordem, chegando ao mesmo corpo final.
-- Falha fechada: cada trecho antigo tem de aparecer EXATAMENTE 1 vez.
-- Idempotente: um corpo que já tem v_regra só gera aviso.
-- Desempenho medido em prod (EXPLAIN ANALYZE, réplica do SELECT):
--   • mapa da CJ: 29 ms e 3,3 mil buffers, antes 172–437 ms e 46 mil;
--   • Chique: 18 ms, antes 131–213 ms;
--   • relatório de SC da CJ: 22 ms, antes 50–60 ms.
--
-- ROLLBACK: supabase/migrations/rollback/20280111000800_mapa_uf_cliente_e_vendido_canonicos.sql

DO $migra$
DECLARE
  c_regra constant text := $t$  PERFORM public.assert_org_access(v_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;
  -- Cliente pela regra que a Carteira e a /leads aplicam à org, na mesma
  -- ordem (20280111000800): piloto da Café Jurerê com a flag = cadastro do ERP
  -- visível na lista; lei do ERP ligada = leads.classificacao; demais = Lei da
  -- Relação (leads.relacao_negocios, projeção mantida por gatilho).
  v_regra := CASE
    WHEN v_org_id = '4922638c-4909-494e-ba10-12282ec0b161'::uuid
     AND COALESCE((SELECT o.feature_flags -> 'leads_cafe_jurere_cadastro_erp' = 'true'::jsonb
                     FROM public.organizations o WHERE o.id = v_org_id), false) THEN 'cafe'
    WHEN EXISTS (SELECT 1 FROM public.toth_connections tc
                  WHERE tc.organization_id = v_org_id
                    AND tc.classificar_leads_por_situacao
                    AND nullif(btrim(tc.clientes_situacoes), '') IS NOT NULL) THEN 'erp'
    ELSE 'relacao'
  END;$t$;
  c_vendas constant text := $t$  WITH vendas AS (
    -- Vendido = caderno sale_events, venda líquida de estorno, de qualquer
    -- funil e da base inteira: a cláusula de _metric_leaf_sales (Estúdio) e de
    -- get_dashboard_metrics / get_sales_metrics (receita do Comando). ADR-0017.
    -- A visibilidade vem do JOIN com o lead (em prod, a view private de leads).
    SELECT s.lead_id, SUM(s.sale_value) AS valor
      FROM %1$s.sale_events s
     WHERE s.organization_id = v_org_id
       AND s.event_type = 'sale'
       AND NOT EXISTS (SELECT 1 FROM %1$s.sale_events r
                        WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = s.id)
     GROUP BY s.lead_id
  )
$t$;
  v_sig regprocedure;
  v_def text;
  v_novo text;
  v_np text;
  v_se text;
  v_par text[];
  v_n int;
  i int;
BEGIN
  -- O caderno como a receita canônica o lê no ambiente.
  v_se := CASE WHEN to_regclass('private.sale_events') IS NOT NULL THEN 'private' ELSE 'public' END;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_uf_heatmap(uuid)'::regprocedure,
    'public.get_leads_by_uf(character,integer,uuid)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_sig);
    IF position('v_regra := CASE' IN v_def) > 0 THEN
      RAISE NOTICE '% já conta cliente e vendido pela regra canônica — nada a fazer', v_sig;
      CONTINUE;
    END IF;
    -- negocio_projetado aparece com o esquema do ambiente: private em prod e
    -- na preview, public num banco montado só do repo.
    v_np := CASE WHEN position('private.negocio_projetado' IN v_def) > 0 THEN 'private' ELSE 'public' END;
    IF v_sig = 'public.get_uf_heatmap(uuid)'::regprocedure THEN
      v_par := ARRAY[
        $t$DECLARE v_org_id uuid; v_unmapped bigint;
$t$,
        $t$DECLARE v_org_id uuid; v_unmapped bigint; v_regra text;
$t$,
        $t$  PERFORM public.assert_org_access(v_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;$t$,
        c_regra,
        $t$  RETURN QUERY
  SELECT l.uf, count(*)::bigint,
$t$,
        E'  RETURN QUERY\n' || format(c_vendas, v_se) || E'  SELECT l.uf, count(*)::bigint,\n',
        format($t$    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM (SELECT np.*, np.stage_key AS status FROM %s.negocio_projetado np WHERE np.funil_sistema = 'propostas') pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'))::bigint,
$t$, v_np),
        $t$    count(*) FILTER (WHERE CASE v_regra
      WHEN 'cafe' THEN nullif(btrim(l.erp_code), '') IS NOT NULL AND l.cafe_jurere_erp_elegivel
      WHEN 'erp'  THEN l.classificacao = 'cliente'
      ELSE l.relacao_negocios = 'cliente'
    END)::bigint,
$t$,
        format($t$    COALESCE(SUM((SELECT SUM(pp.sale_value) FROM (SELECT np.*, np.stage_key AS status FROM %s.negocio_projetado np WHERE np.funil_sistema = 'propostas') pp WHERE pp.lead_id = l.id AND pp.status = 'vendido')), 0)::numeric,
$t$, v_np),
        $t$    COALESCE(SUM(v.valor), 0)::numeric,
$t$,
        $t$
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf IS NOT NULL$t$,
        $t$
  LEFT JOIN vendas v ON v.lead_id = l.id
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf IS NOT NULL$t$
      ];
    ELSIF v_sig = 'public.get_leads_by_uf(character,integer,uuid)'::regprocedure THEN
      v_par := ARRAY[
        $t$DECLARE v_org_id uuid;
BEGIN
$t$,
        $t$DECLARE v_org_id uuid; v_regra text;
BEGIN
$t$,
        $t$  PERFORM public.assert_org_access(v_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;$t$,
        c_regra,
        $t$  RETURN QUERY
  SELECT l.id, l.name, l.company, l.phone, l.uf_source,
$t$,
        E'  RETURN QUERY\n' || format(c_vendas, v_se) || E'  SELECT l.id, l.name, l.company, l.phone, l.uf_source,\n',
        format($t$    EXISTS (SELECT 1 FROM (SELECT np.*, np.stage_key AS status FROM %s.negocio_projetado np WHERE np.funil_sistema = 'propostas') pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'),
$t$, v_np),
        $t$    CASE v_regra
      WHEN 'cafe' THEN nullif(btrim(l.erp_code), '') IS NOT NULL AND l.cafe_jurere_erp_elegivel
      WHEN 'erp'  THEN l.classificacao = 'cliente'
      ELSE l.relacao_negocios = 'cliente'
    END,
$t$,
        format($t$    COALESCE((SELECT SUM(pp.sale_value) FROM (SELECT np.*, np.stage_key AS status FROM %s.negocio_projetado np WHERE np.funil_sistema = 'propostas') pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'), 0)::numeric,
$t$, v_np),
        $t$    COALESCE(v.valor, 0)::numeric,
$t$,
        $t$
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf = p_uf$t$,
        $t$
  LEFT JOIN vendas v ON v.lead_id = l.id
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf = p_uf$t$
      ];
    END IF;
    v_novo := v_def;
    FOR i IN 1..array_length(v_par, 1) BY 2 LOOP
      v_n := (length(v_novo) - length(replace(v_novo, v_par[i], ''))) / length(v_par[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION '%: o trecho % aparece % vez(es), e não 1 — o corpo mudou; revise antes de aplicar',
          v_sig, (i + 1) / 2, v_n;
      END IF;
      v_novo := replace(v_novo, v_par[i], v_par[i + 1]);
    END LOOP;
    -- O que não é do mapa fica como estava: trava JRTex, leitura de private.*.
    IF (length(v_def) - length(replace(v_def, 'jrtex_pipeline_scoped', '')))
       <> (length(v_novo) - length(replace(v_novo, 'jrtex_pipeline_scoped', '')))
       OR (length(v_def) - length(replace(v_def, 'FROM private.leads l', '')))
       <> (length(v_novo) - length(replace(v_novo, 'FROM private.leads l', ''))) THEN
      RAISE EXCEPTION '%: a troca mexeu na trava JRTex ou em private.leads', v_sig;
    END IF;
    EXECUTE v_novo;
  END LOOP;
END
$migra$;

-- Prova: regra nova nas duas, nada de propostas, DEFINER e acesso intactos.
DO $verify$
DECLARE
  v_sig regprocedure;
  v_def text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_uf_heatmap(uuid)'::regprocedure,
    'public.get_leads_by_uf(character,integer,uuid)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_sig);
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_sig) THEN
      RAISE EXCEPTION '% deixou de ser SECURITY DEFINER', v_sig;
    END IF;
    IF position('PERFORM public.assert_org_access(v_org_id);' IN v_def) = 0
       OR position('v_regra := CASE' IN v_def) = 0
       OR position('.sale_events s' IN v_def) = 0
       OR position('LEFT JOIN vendas v ON v.lead_id = l.id' IN v_def) = 0
       OR position('negocio_projetado' IN v_def) > 0 THEN
      RAISE EXCEPTION '% não ficou com a regra nova', v_sig;
    END IF;
  END LOOP;
END
$verify$;

NOTIFY pgrst, 'reload schema';
