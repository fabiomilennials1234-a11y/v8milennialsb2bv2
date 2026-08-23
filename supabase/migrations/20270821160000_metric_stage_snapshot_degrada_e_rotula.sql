-- 20270821160000_metric_stage_snapshot_degrada_e_rotula.sql
--
-- 🔴 REGRESSÃO da fatia 9 (20270813100000), achada ao destravar o pgTAP.
--
-- Ao reescrever `_metric_leaf_stage_snapshot` para receber a UNIDADE
-- (negócio × lead), duas coisas do #1254 S2 se perderam no caminho — e nenhuma
-- delas tem a ver com unidade:
--
--   1. A DEGRADAÇÃO de `etapa` sem funil escolhido. Antes, recorte `etapa` sem
--      `pipeline_id` devolvia o total e SINALIZAVA `effective_recorte='total'`.
--      Depois da fatia 9, devolve série — e a série mistura etapas de funis
--      diferentes. A tela mostra "por Etapa / 2151" onde 2151 é a soma de N
--      funis: um número que não existe em lugar nenhum.
--
--   2. O RÓTULO HUMANO. `public._stage_key_label(org, pipeline, stage_key)` foi
--      trocado pelo `bucket_key` cru, então a parede volta a exibir "novo" e
--      "compareceu" em vez de "Novo Lead" e "Compareceu" — o defeito exato que
--      o #1254 S2 corrigiu.
--
-- `supabase/tests/tv_s2_stage_label_scope_test.sql` guardava as duas, e
-- reprovava desde então: 9 asserções de 13. Ninguém viu porque o job de pgTAP
-- estava vermelho por outro motivo e a suíte abortava antes (SCRUM-361).
--
-- O QUE ESTA MIGRATION FAZ
--
-- Recoloca as duas, mantendo tudo que a fatia 9 trouxe: o parâmetro de unidade,
-- a validação do conjunto fechado, `count(*)` para negócio e
-- `count(DISTINCT lead_id)` para lead — nos DOIS caminhos, o escalar e a série.
--
-- O corpo não foi reconstruído de memória. É o da fatia 9 com os dois blocos do
-- 20260727120000 reinseridos, diferenciado linha a linha contra os dois.
--
-- ROLLBACK pareado: rollback/20270821160000_metric_stage_snapshot_degrada_e_rotula.sql

CREATE OR REPLACE FUNCTION public._metric_leaf_stage_snapshot(
  p_org_id uuid, p_recorte text, p_filters jsonb, p_unidade text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint; v_scoped boolean;
BEGIN
  IF p_unidade NOT IN ('negocio', 'lead') THEN
    RAISE EXCEPTION 'unidade % desconhecida no snapshot de etapa', p_unidade
      USING ERRCODE = '22023';
  END IF;

  v_scoped := (p_filters->>'pipeline_id') IS NOT NULL;

  -- Base para `empty_reason`: existe LINHA na janela? Conta entrada nos dois
  -- modos de propósito — "sem dado" é sobre a existência do funil, não sobre a
  -- unidade escolhida.
  SELECT count(*) INTO v_base_count
  FROM public.pipeline_entries pe
  WHERE pe.organization_id = p_org_id
    AND pe.closed_at IS NULL
    AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid);

  -- `total`, OU `etapa` sem escopo de funil → devolve o número honesto e CONTA
  -- que degradou. O front lê `effective_recorte` para rotular, não a intenção
  -- do widget: sem isso a janela diz "por Etapa" sobre um total de N funis.
  IF p_recorte = 'total' OR (p_recorte = 'etapa' AND NOT v_scoped) THEN
    -- COUNT(DISTINCT lead_id) ignora NULL por definição do SQL, e é o que se
    -- quer: entrada órfã de lead não é pessoa nenhuma.
    SELECT CASE p_unidade
             WHEN 'negocio' THEN count(*)
             ELSE                count(DISTINCT pe.lead_id)
           END
    INTO v_val
    FROM public.pipeline_entries pe
    WHERE pe.organization_id = p_org_id
      AND pe.closed_at IS NULL
      AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid);

    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END,
      'effective_recorte', 'total');
  END IF;

  -- pipeline | etapa(escopado) — série com RÓTULO HUMANO.
  --
  -- ⚠ Em `lead`, a soma da série NÃO é o total. Uma pessoa com negócio em duas
  -- etapas conta 1 em cada balde e 1 no total. É a aritmética correta de
  -- distinct por balde, e é por isso que a janela lê o escalar do motor em vez
  -- de somar a série (`headValueFromMeasure` só soma quando o escalar não veio
  -- — recorte não-total sempre traz série, então o caminho não se cruza).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', g.bucket_key,
           'label', COALESCE(
             CASE p_recorte
               WHEN 'pipeline' THEN (SELECT p.name FROM public.pipelines p WHERE p.id = g.bucket_key::uuid)
               WHEN 'etapa'    THEN public._stage_key_label(p_org_id, (p_filters->>'pipeline_id')::uuid, g.bucket_key)
               ELSE g.bucket_key
             END, 'Sem valor'),
           'value', g.val
         ) ORDER BY g.val DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte
        WHEN 'pipeline' THEN pe.pipeline_id::text
        WHEN 'etapa'    THEN pe.stage_key
      END AS bucket_key,
      CASE p_unidade
        WHEN 'negocio' THEN count(*)
        ELSE                count(DISTINCT pe.lead_id)
      END AS val
    FROM public.pipeline_entries pe
    WHERE pe.organization_id = p_org_id
      AND pe.closed_at IS NULL
      AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    GROUP BY 1
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

COMMENT ON FUNCTION public._metric_leaf_stage_snapshot(uuid, text, jsonb, text) IS
  'Snapshot por etapa/funil, na unidade pedida (negocio = COUNT(*), lead = COUNT(DISTINCT lead_id)). Degrada etapa-sem-funil para total e SINALIZA em effective_recorte; rótulo humano via _stage_key_label (#1254 S2, restaurado em SCRUM-361).';

-- Grants: `CREATE OR REPLACE` preserva, mas provar é mais barato que descobrir
-- em produção que o motor parou.
DO $guard$
DECLARE
  v_fn regprocedure := 'public._metric_leaf_stage_snapshot(uuid, text, jsonb, text)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: anon executa % — interno do motor não pode', v_fn;
  END IF;
  IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated executa % — interno do motor não pode', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: service_role NÃO executa % — o motor não roda', v_fn;
  END IF;
END
$guard$;
