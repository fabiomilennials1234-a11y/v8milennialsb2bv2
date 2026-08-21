-- ===========================================================================
-- SCRUM-316 — Conversão entre etapas, por COORTE
-- ===========================================================================
-- Migration: 20270821120000_metric_conversao_entre_etapas.sql
--
-- A DECISÃO QUE ESTA MIGRATION ENCARNA (CTO, 2026-08-20)
--
-- "Conversão de X para Y" tem três leituras possíveis, e elas dão números
-- diferentes para o MESMO funil. O ticket levantou a pergunta e não a fechou;
-- ela foi fechada assim:
--
--   1. ESTOQUE      quantos estão em Y hoje ÷ quantos estão em X hoje
--                   → recusada: é o formato do funil num instante, não taxa.
--                     Muda quando alguém arrasta um card.
--   2. FLUXO/JANELA entraram em Y na janela ÷ entraram em X na janela
--                   → recusada: os dois grupos são PESSOAS DIFERENTES. Passa
--                     de 100% quando a entrada cai. Era o escopo literal do
--                     ticket, e é o que teria saído sem perguntar.
--   3. FLUXO/COORTE dos que entraram em X na janela, quantos CHEGARAM a Y
--                   → ESCOLHIDA. Numerador é SUBCONJUNTO do denominador, então
--                     a razão vive em [0, 100] por construção — mesma disciplina
--                     de `taxa_qualidade` (20270812100000).
--
-- MATURAÇÃO: a coorte recente ainda não teve tempo de converter, então o mês
-- corrente parece pior que o anterior. Decisão: ROTULAR, não corrigir. O número
-- é o número; `negocios_coorte_em_aberto` existe para a janela dizer quantos
-- ainda estão sem desfecho. Excluir coorte imatura foi recusado — sumiria com o
-- dado recente e a régua viraria mais uma decisão escondida.
--
-- POR QUE TRÊS MEDIDAS E NÃO UMA QUE JÁ DEVOLVE O PERCENTUAL
-- A razão é composta pelo ramo `kind='ratio'` que já existe. Uma medida que
-- devolvesse `percent` pronto teria de multiplicar por 100 no corpo, e o front
-- apenas SUFIXA '%' — é exatamente o par incoerente que imprime erro de 100×
-- sem nada detectar (ver 20270812100000). Deixando `count ÷ count` para o motor,
-- a derivação de unidade e o ×100 acontecem no caminho já provado por pgTAP.
--
-- FONTE: `pipeline_stage_events`, o caderno append-only de transições (ADR-0017
-- / #992). É a única tabela que sabe QUEM ATRAVESSOU — `pipeline_entries` só
-- sabe onde cada um está agora, que é a leitura de estoque recusada acima.
--
-- ⚠ RECORTE: só `total`. Coorte por bucket exigiria uma coorte por bucket, e o
-- ramo `ratio` do motor força `total` nos dois filhos de qualquer forma.
-- ===========================================================================

-- ===========================================================================
-- 1 — ALLOWLIST DE FILTROS ganha as duas chaves de etapa
-- ===========================================================================
-- A allowlist é FRONTEIRA DE SEGURANÇA: é ela que impede a composição de nomear
-- coluna. As duas chaves novas entram como VALOR de parâmetro ligado, nunca
-- concatenadas — `from_stage_key` e `to_stage_key` são comparadas com `=` contra
-- `pipeline_stage_events.to_stage_key`, que é texto de slug.
--
-- O espelho no front é `MetricFilters` em `lib/metric-vocabulary.ts` e a
-- validação em `lib/metric-tree.ts`. Os três precisam concordar — o pgTAP
-- `metric_conversao_etapas_test.sql` guarda o lado SQL.
--
-- ⚠ `fn_metric_tree_validate` NÃO é tocada aqui de propósito: ela só delega
-- para `_metric_tree_unit`, e recriá-la sem necessidade é superfície de erro
-- de graça.
--
-- 🔴 O QUE SEGUE É CÓPIA LITERAL do corpo vigente (20270813110000:129), com
-- EXATAMENTE UMA alteração: as duas chaves novas no `NOT IN` da allowlist.
-- Nada mais mudou, e a fidelidade não é estilo — é a lição da 20260727140000,
-- que reescreveu um despachante "de memória" e apagou o roteamento de 6
-- medidas. Rewrite parcial deste corpo perderia, em silêncio: o teto de
-- literal (1e12), a exigência de que operando aceite recorte `total`, a
-- presença de `left`/`right`, e a checagem de TIPO do literal. Ao editar,
-- DIFERENCIE contra o original — não reconstrua a partir do que você lembra.
CREATE OR REPLACE FUNCTION public._metric_tree_unit(p_node jsonb, p_depth int)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_tipo text; v_op text; v_id text; v_unit text;
  v_left text; v_right text; v_chave text; v_valor numeric;
BEGIN
  IF p_node IS NULL OR jsonb_typeof(p_node) <> 'object' THEN
    RAISE EXCEPTION 'nó da árvore não é objeto' USING ERRCODE = '22023';
  END IF;

  v_tipo := p_node->>'type';

  -- --- folha: número literal -------------------------------------------
  IF v_tipo = 'literal' THEN
    IF jsonb_typeof(p_node->'value') <> 'number' THEN
      RAISE EXCEPTION 'literal sem valor numérico' USING ERRCODE = '22023';
    END IF;
    v_valor := (p_node->>'value')::numeric;
    -- Teto que existe para impedir payload absurdo, não para limitar o
    -- usuário: "por dia útil" usa 22, "por milheiro" usa 1000.
    IF abs(v_valor) > 1e12 THEN
      RAISE EXCEPTION 'literal % fora do intervalo permitido (|x| ≤ 1e12)', v_valor
        USING ERRCODE = '22023';
    END IF;
    RETURN 'number';
  END IF;

  -- --- folha: medida do catálogo ---------------------------------------
  IF v_tipo = 'measure' THEN
    v_id := p_node->>'id';
    SELECT m.unit INTO v_unit FROM public.metric_catalog_measures m WHERE m.id = v_id;
    IF v_unit IS NULL THEN
      RAISE EXCEPTION 'medida % não existe no catálogo', COALESCE(v_id, '(nula)')
        USING ERRCODE = '22023';
    END IF;

    -- O motor força `total` nos operandos. Medida sem `total` levantaria 22023
    -- só na abertura da janela; aqui a escrita já recusa.
    IF NOT EXISTS (
      SELECT 1 FROM public.metric_catalog_measure_recortes mr
      WHERE mr.measure_id = v_id AND mr.recorte_id = 'total'
    ) THEN
      RAISE EXCEPTION 'medida % não aceita o recorte total e não serve de operando', v_id
        USING ERRCODE = '22023';
    END IF;

    -- Filtro é OPCIONAL e vem da allowlist. Chave fora dela é rejeitada — é a
    -- fronteira que impede a composição de nomear coluna. `organization_id`
    -- NUNCA entra: ele vem do parâmetro do servidor.
    --
    -- SCRUM-316 acrescentou `from_stage_key` e `to_stage_key` — ESTA é a única
    -- linha que a 20270821120000 muda neste corpo.
    IF p_node ? 'filters' THEN
      IF jsonb_typeof(p_node->'filters') <> 'object' THEN
        RAISE EXCEPTION 'filtros da medida % não são objeto', v_id USING ERRCODE = '22023';
      END IF;
      FOR v_chave IN SELECT jsonb_object_keys(p_node->'filters') LOOP
        IF v_chave NOT IN ('pipeline_id','member_id','origin','tag_id','product_id','stream',
                           'from_stage_key','to_stage_key') THEN
          RAISE EXCEPTION 'filtro % não está na allowlist', v_chave USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;

    RETURN v_unit;
  END IF;

  -- --- nó de operação ---------------------------------------------------
  IF v_tipo = 'op' THEN
    -- O TETO. Profundidade 3 é o menor número que cobre os três pedidos
    -- medidos no grill (por dia útil, aproveitamento, projeção). Validado aqui
    -- E de novo em runtime, porque um lado só não basta.
    IF p_depth > 3 THEN
      RAISE EXCEPTION 'árvore excede a profundidade máxima de 3' USING ERRCODE = '22023';
    END IF;

    v_op := p_node->>'op';
    IF NOT (p_node ? 'left' AND p_node ? 'right') THEN
      RAISE EXCEPTION 'operação % sem os dois operandos', COALESCE(v_op, '(nulo)')
        USING ERRCODE = '22023';
    END IF;

    v_left  := public._metric_tree_unit(p_node->'left',  p_depth + 1);
    v_right := public._metric_tree_unit(p_node->'right', p_depth + 1);
    RETURN public._metric_tree_op_unit(v_op, v_left, v_right);
  END IF;

  RAISE EXCEPTION 'tipo de nó % desconhecido (use measure, literal ou op)',
    COALESCE(v_tipo, '(nulo)') USING ERRCODE = '22023';
END;
$$;

-- ===========================================================================
-- 2 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('negocios_coorte_origem', 'Negócios que entraram na etapa de origem', 'count', 'entradas',
   'COORTE: negócios cuja PRIMEIRA chegada à etapa `from_stage_key` caiu na janela. '
   'Denominador da conversão entre etapas. Primeira chegada, não qualquer chegada — '
   'reentrada não recria coorte nem infla o denominador.', 60),
  ('negocios_coorte_convertidos', 'Negócios da coorte que chegaram à etapa destino', 'count', 'entradas',
   'Subconjunto de `negocios_coorte_origem` que alcançou `to_stage_key` em QUALQUER '
   'momento posterior à entrada na origem — inclusive fora da janela. É o que torna a '
   'razão honesta: a coorte é seguida até o desfecho, não recortada pela janela.', 61),
  ('negocios_coorte_em_aberto', 'Negócios da coorte ainda sem desfecho', 'count', 'entradas',
   'Subconjunto de `negocios_coorte_origem` que não chegou ao destino E não teve '
   'desfecho (nenhuma etapa com stage_role won/lost). É a MATURAÇÃO: enquanto for '
   'alto, a conversão da janela ainda vai subir. Existe para a janela rotular, '
   'não para corrigir o número.', 62)
ON CONFLICT (id) DO NOTHING;

-- Só `total`. Ver o cabeçalho: coorte por bucket exigiria coorte por bucket.
INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('negocios_coorte_origem', 'total'),
  ('negocios_coorte_convertidos', 'total'),
  ('negocios_coorte_em_aberto', 'total')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('negocios_coorte_origem', 'integer'),
  ('negocios_coorte_convertidos', 'integer'),
  ('negocios_coorte_em_aberto', 'integer')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_ratios (id, label, num_measure_id, den_measure_id, format_id, sort) VALUES
  ('conversao_entre_etapas', 'Conversão entre etapas',
   'negocios_coorte_convertidos', 'negocios_coorte_origem', 'percent_1', 60)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- 3 — A COORTE
-- ===========================================================================
-- Uma função para as três medidas: elas partilham a definição de coorte, e
-- partilhar o corpo é o que impede numerador e denominador de divergirem numa
-- edição futura. `p_modo` escolhe o recorte da MESMA coorte.
CREATE OR REPLACE FUNCTION public._metric_leaf_coorte_etapa(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb, p_modo text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_from text := p_filters->>'from_stage_key';
  v_to   text := p_filters->>'to_stage_key';
  v_pipe uuid := NULLIF(p_filters->>'pipeline_id', '')::uuid;
  v_base bigint; v_val bigint;
BEGIN
  -- Sem as duas etapas a pergunta não existe. Falhar ALTO — devolver 0 aqui
  -- seria um zero que parece resposta (obrigação da Emenda 1).
  IF v_from IS NULL OR v_to IS NULL THEN
    RAISE EXCEPTION
      'conversão entre etapas exige os filtros from_stage_key e to_stage_key'
      USING ERRCODE = '22023';
  END IF;
  IF v_from = v_to THEN
    RAISE EXCEPTION 'origem e destino são a mesma etapa (%)', v_from USING ERRCODE = '22023';
  END IF;

  -- p_modo é interno (só o despachante o escreve), e mesmo assim é conferido
  -- AQUI. Motivo mecânico: o `CASE` do FILTER abaixo não tem ELSE, então modo
  -- desconhecido devolveria NULL, e `FILTER (WHERE NULL)` EXCLUI a linha — a
  -- função retornaria 0 calada. Zero que parece resposta é o defeito que a
  -- Emenda 1 manda evitar, e não deixa de ser defeito por ser interno.
  IF p_modo NOT IN ('origem','convertidos','em_aberto') THEN
    RAISE EXCEPTION 'modo de coorte desconhecido: %', p_modo USING ERRCODE = '22023';
  END IF;

  -- STABLE é somente-leitura: CTE, nunca CREATE TEMP TABLE (levanta 25006).
  WITH coorte AS (
    SELECT e.entry_id, min(e.occurred_at) AS entrou_em
    FROM public.pipeline_stage_events e
    WHERE e.organization_id = p_org_id
      AND e.to_stage_key = v_from
      AND e.entry_id IS NOT NULL
      AND (v_pipe IS NULL OR e.pipeline_id = v_pipe)
    GROUP BY e.entry_id
    -- PRIMEIRA chegada dentro da janela. Quem já estava na etapa antes não
    -- entra: a coorte é de quem CHEGOU no período, não de quem estava lá.
    HAVING min(e.occurred_at) <@ p_bounds
  ),
  classificada AS (
    SELECT
      c.entry_id,
      EXISTS (
        SELECT 1 FROM public.pipeline_stage_events e2
        WHERE e2.organization_id = p_org_id
          AND e2.entry_id = c.entry_id
          AND e2.to_stage_key = v_to
          AND e2.occurred_at >= c.entrou_em
      ) AS chegou,
      EXISTS (
        SELECT 1
        FROM public.pipeline_stage_events e3
        WHERE e3.organization_id = p_org_id
          AND e3.entry_id = c.entry_id
          AND e3.occurred_at >= c.entrou_em
          -- metric_stage_role é o ponto ÚNICO de extensão (ADR-0017 §1):
          -- despacha system vs custom. NULL = nenhum governa ≙ ainda aberto.
          AND public.metric_stage_role(p_org_id, e3.pipeline_id, e3.to_stage_key)
              IN ('won','lost')
      ) AS teve_desfecho
    FROM coorte c
  )
  SELECT
    count(*),
    count(*) FILTER (
      WHERE CASE p_modo
              WHEN 'origem'      THEN true
              WHEN 'convertidos' THEN chegou
              WHEN 'em_aberto'   THEN NOT chegou AND NOT teve_desfecho
            END
    )
  INTO v_base, v_val
  FROM classificada;

  RETURN jsonb_build_object(
    'value', v_val,
    'series', NULL,
    -- `no_rows` é da COORTE, não do recorte: coorte vazia significa que ninguém
    -- entrou na etapa de origem na janela, e aí a conversão não tem denominador.
    -- Sem isto, 0 ÷ 0 apareceria como 0% em vez de travessão.
    'empty_reason', CASE WHEN v_base = 0 THEN 'no_rows' ELSE NULL END
  );
END;
$$;

-- ===========================================================================
-- 4 — DESPACHANTE
-- ===========================================================================
-- Reescrita FIEL do corpo de 20270813100000, com três ramos a mais. O bloco de
-- `target` vem junto — reescrever o despachante sem ele é exatamente como a
-- 20260727140000 apagou a meta.
CREATE OR REPLACE FUNCTION public._metric_leaf(
  p_org_id uuid, p_measure_id text, p_recorte text,
  p_period text, p_ref date, p_start date, p_end date, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_unit text; v_anchor text; v_goal_type text; v_tz text;
  v_bounds tstzrange; v_leaf jsonb; v_target numeric;
BEGIN
  SELECT m.unit, m.anchor, m.goal_type INTO v_unit, v_anchor, v_goal_type
  FROM public.metric_catalog_measures m WHERE m.id = p_measure_id;
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'unknown measure %', p_measure_id USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.metric_catalog_measure_recortes mr
    WHERE mr.measure_id = p_measure_id AND mr.recorte_id = p_recorte
  ) THEN
    RAISE EXCEPTION 'recorte % incompatible with measure %', p_recorte, p_measure_id
      USING ERRCODE = '22023';
  END IF;

  IF v_anchor <> 'hoje' THEN
    SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = p_org_id;
    v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);
  END IF;

  v_leaf := CASE p_measure_id
    WHEN 'receita'                THEN public._metric_leaf_sales(p_org_id, 'revenue', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas'             THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'negocios_perdidos'      THEN public._metric_leaf_sales_lost(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'          THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'      THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas'    THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_no_show'       THEN public._metric_leaf_no_show(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'negocios_na_etapa'      THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters, 'negocio')
    WHEN 'leads_na_etapa'         THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters, 'lead')
    WHEN 'negocios_abertos'       THEN public._metric_leaf_negocios_abertos(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'tempo_medio_etapa'      THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
    WHEN 'leads_sem_responsavel'  THEN public._metric_leaf_leads_sem_dono(p_org_id, p_recorte, p_filters)
    WHEN 'leads_avaliados'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'avaliados')
    WHEN 'leads_nao_avaliados'    THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'nao_avaliados')
    WHEN 'boas_avaliacoes'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'bons')
    WHEN 'tempo_resposta_equipe'  THEN public._metric_leaf_tempo_resposta(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    -- SCRUM-316. As três partilham a MESMA coorte; ver o cabeçalho da 20270821120000.
    WHEN 'negocios_coorte_origem'      THEN public._metric_leaf_coorte_etapa(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'origem')
    WHEN 'negocios_coorte_convertidos' THEN public._metric_leaf_coorte_etapa(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'convertidos')
    WHEN 'negocios_coorte_em_aberto'   THEN public._metric_leaf_coorte_etapa(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'em_aberto')
  END;

  IF v_leaf IS NULL THEN
    RAISE EXCEPTION 'measure % has no leaf implementation', p_measure_id
      USING ERRCODE = '22023';
  END IF;

  IF v_goal_type IS NOT NULL AND v_bounds IS NOT NULL THEN
    SELECT sum(g.target_value) INTO v_target
    FROM public.goals g
    WHERE g.organization_id = p_org_id
      AND g.type = v_goal_type
      AND g.month = extract(month FROM (lower(v_bounds) AT TIME ZONE v_tz))::int
      AND g.year  = extract(year  FROM (lower(v_bounds) AT TIME ZONE v_tz))::int
      AND (
        ((p_filters->>'member_id') IS NULL AND g.team_member_id IS NULL)
        OR g.team_member_id = (p_filters->>'member_id')::uuid
      );
  END IF;

  RETURN jsonb_build_object(
    'measure_id', p_measure_id,
    'unit', v_unit,
    'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
    'anchor', v_anchor,
    'recorte', COALESCE(v_leaf->>'effective_recorte', p_recorte),
    'value',   v_leaf->'value',
    'series',  v_leaf->'series',
    'target',  v_target,
    'empty_reason', v_leaf->>'empty_reason'
  );
END;
$$;

-- ===========================================================================
-- 5 — ÍNDICE
-- ===========================================================================
-- A coorte agrupa por entry_id filtrando to_stage_key, e o EXISTS reentra por
-- (entry_id, to_stage_key). Sem isto, cada janela varre o caderno inteiro.
CREATE INDEX IF NOT EXISTS idx_pipeline_stage_events_coorte
  ON public.pipeline_stage_events (organization_id, to_stage_key, entry_id, occurred_at)
  WHERE entry_id IS NOT NULL;

-- ===========================================================================
-- 6 — GRANTS
-- ===========================================================================
-- Interna: alcançável só pelo despachante, que é chamado por fn_metric_measure,
-- que gateia com assert_org_access. Quem manda o org_id não pode chegar aqui.
-- Os TRÊS caminhos, porque REVOKE de um só deixa a função aberta pelo outro.
REVOKE ALL     ON FUNCTION public._metric_leaf_coorte_etapa(uuid, text, tstzrange, text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_coorte_etapa(uuid, text, tstzrange, text, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_coorte_etapa(uuid, text, tstzrange, text, jsonb, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_coorte_etapa(uuid, text, tstzrange, text, jsonb, text) TO service_role;

-- ===========================================================================
-- 7 — GUARDA (aborta a transação)
-- ===========================================================================
DO $guard$
DECLARE
  v_fn regprocedure := 'public._metric_leaf_coorte_etapa(uuid, text, tstzrange, text, jsonb, text)'::regprocedure;
  v_orfas text;
  v_prosrc text;
BEGIN
  -- (a) O grant é concedido pelo BANCO no CREATE, não por este SQL. Conferir.
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: anon executa % — REVOKE não pegou', v_fn;
  END IF;
  IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated executa % — interno não pode', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: service_role NÃO executa % — o motor não roda', v_fn;
  END IF;

  -- (b) A allowlist precisa ter ganhado as duas chaves, senão a métrica é
  -- inexprimível pela árvore e esta migration não serviu para nada.
  SELECT p.prosrc INTO v_prosrc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_metric_tree_unit';
  IF position('from_stage_key' IN v_prosrc) = 0 OR position('to_stage_key' IN v_prosrc) = 0 THEN
    RAISE EXCEPTION 'GUARDA: allowlist da árvore não ganhou as chaves de etapa';
  END IF;

  -- (c) TODA medida do catálogo tem de estar no CASE do despachante — a mesma
  -- checagem que a 20260727140000 não fez, e por isso apagou o roteamento.
  SELECT p.prosrc INTO v_prosrc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_metric_leaf' AND p.pronargs = 8;

  SELECT string_agg(m.id, ', ' ORDER BY m.id) INTO v_orfas
  FROM public.metric_catalog_measures m
  WHERE position('''' || m.id || '''' IN v_prosrc) = 0;
  IF v_orfas IS NOT NULL THEN
    RAISE EXCEPTION 'GUARDA: medida catalogada sem ramo no despachante: %', v_orfas;
  END IF;

  -- (d) A razão precisa apontar para as duas medidas certas, nesta ordem. Uma
  -- razão invertida daria o número recíproco e ninguém notaria.
  IF NOT EXISTS (
    SELECT 1 FROM public.metric_catalog_ratios
    WHERE id = 'conversao_entre_etapas'
      AND num_measure_id = 'negocios_coorte_convertidos'
      AND den_measure_id = 'negocios_coorte_origem'
  ) THEN
    RAISE EXCEPTION 'GUARDA: conversao_entre_etapas com numerador/denominador errados';
  END IF;
END
$guard$;

COMMENT ON FUNCTION public._metric_leaf_coorte_etapa(uuid, text, tstzrange, text, jsonb, text) IS
  'SCRUM-316 — coorte de conversão entre etapas. Denominador = primeira chegada '
  'à etapa de origem dentro da janela; numerador = subconjunto que alcançou o '
  'destino DEPOIS, inclusive fora da janela. Numerador é subconjunto do '
  'denominador, então a razão vive em [0,100] por construção. p_modo: '
  'origem | convertidos | em_aberto. Interna: só service_role.';
