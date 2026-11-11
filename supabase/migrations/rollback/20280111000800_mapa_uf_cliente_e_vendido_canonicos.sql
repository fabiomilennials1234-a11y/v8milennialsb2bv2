-- Rollback de 20280111000800_mapa_uf_cliente_e_vendido_canonicos.sql
--
-- Devolve "Clientes" e "Vendido" do mapa ao funil 'propostas' (etapa
-- 'vendido' em negocio_projetado), pelo mesmo caminho cirúrgico: corpo vivo,
-- troca só dos trechos, falha fechada. Em prod, private.*, a trava JRTex,
-- assert_org_access e o espelho de 20280111000700 (se aplicado) continuam.
-- Volta o defeito: a Café Jurerê mostra Clientes 0 e Vendido R$ 0 em todo
-- estado.
--
-- O esquema do caderno é lido do corpo; o de negocio_projetado volta igual ao
-- de leads no corpo (private.leads -> private; leads -> public), que é como os
-- dois andavam antes da troca.

DO $volta$
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
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_uf_heatmap(uuid)'::regprocedure,
    'public.get_leads_by_uf(character,integer,uuid)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_sig);
    IF position('v_regra := CASE' IN v_def) = 0 THEN
      RAISE NOTICE '% não tem a regra nova — nada a desfazer', v_sig;
      CONTINUE;
    END IF;
    v_np := CASE WHEN position('private.leads l' IN v_def) > 0 THEN 'private' ELSE 'public' END;
    v_se := CASE WHEN position('FROM private.sale_events s' IN v_def) > 0 THEN 'private' ELSE 'public' END;
    IF v_sig = 'public.get_uf_heatmap(uuid)'::regprocedure THEN
      v_par := ARRAY[
        $t$DECLARE v_org_id uuid; v_unmapped bigint; v_regra text;
$t$,
        $t$DECLARE v_org_id uuid; v_unmapped bigint;
$t$,
        c_regra,
        $t$  PERFORM public.assert_org_access(v_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;$t$,
        E'  RETURN QUERY\n' || format(c_vendas, v_se) || E'  SELECT l.uf, count(*)::bigint,\n',
        $t$  RETURN QUERY
  SELECT l.uf, count(*)::bigint,
$t$,
        $t$    count(*) FILTER (WHERE CASE v_regra
      WHEN 'cafe' THEN nullif(btrim(l.erp_code), '') IS NOT NULL AND l.cafe_jurere_erp_elegivel
      WHEN 'erp'  THEN l.classificacao = 'cliente'
      ELSE l.relacao_negocios = 'cliente'
    END)::bigint,
$t$,
        format($t$    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM (SELECT np.*, np.stage_key AS status FROM %s.negocio_projetado np WHERE np.funil_sistema = 'propostas') pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'))::bigint,
$t$, v_np),
        $t$    COALESCE(SUM(v.valor), 0)::numeric,
$t$,
        format($t$    COALESCE(SUM((SELECT SUM(pp.sale_value) FROM (SELECT np.*, np.stage_key AS status FROM %s.negocio_projetado np WHERE np.funil_sistema = 'propostas') pp WHERE pp.lead_id = l.id AND pp.status = 'vendido')), 0)::numeric,
$t$, v_np),
        $t$
  LEFT JOIN vendas v ON v.lead_id = l.id
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf IS NOT NULL$t$,
        $t$
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf IS NOT NULL$t$
      ];
    ELSIF v_sig = 'public.get_leads_by_uf(character,integer,uuid)'::regprocedure THEN
      v_par := ARRAY[
        $t$DECLARE v_org_id uuid; v_regra text;
BEGIN
$t$,
        $t$DECLARE v_org_id uuid;
BEGIN
$t$,
        c_regra,
        $t$  PERFORM public.assert_org_access(v_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;$t$,
        E'  RETURN QUERY\n' || format(c_vendas, v_se) || E'  SELECT l.id, l.name, l.company, l.phone, l.uf_source,\n',
        $t$  RETURN QUERY
  SELECT l.id, l.name, l.company, l.phone, l.uf_source,
$t$,
        $t$    CASE v_regra
      WHEN 'cafe' THEN nullif(btrim(l.erp_code), '') IS NOT NULL AND l.cafe_jurere_erp_elegivel
      WHEN 'erp'  THEN l.classificacao = 'cliente'
      ELSE l.relacao_negocios = 'cliente'
    END,
$t$,
        format($t$    EXISTS (SELECT 1 FROM (SELECT np.*, np.stage_key AS status FROM %s.negocio_projetado np WHERE np.funil_sistema = 'propostas') pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'),
$t$, v_np),
        $t$    COALESCE(v.valor, 0)::numeric,
$t$,
        format($t$    COALESCE((SELECT SUM(pp.sale_value) FROM (SELECT np.*, np.stage_key AS status FROM %s.negocio_projetado np WHERE np.funil_sistema = 'propostas') pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'), 0)::numeric,
$t$, v_np),
        $t$
  LEFT JOIN vendas v ON v.lead_id = l.id
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf = p_uf$t$,
        $t$
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf = p_uf$t$
      ];
    END IF;
    v_novo := v_def;
    FOR i IN 1..array_length(v_par, 1) BY 2 LOOP
      v_n := (length(v_novo) - length(replace(v_novo, v_par[i], ''))) / length(v_par[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION '%: o trecho % aparece % vez(es), e não 1 — o corpo mudou; revise', v_sig, (i + 1) / 2, v_n;
      END IF;
      v_novo := replace(v_novo, v_par[i], v_par[i + 1]);
    END LOOP;
    EXECUTE v_novo;
  END LOOP;
END
$volta$;

NOTIFY pgrst, 'reload schema';
