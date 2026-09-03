-- B2d, parte 1 de 2 — ADITIVA. Prepara o terreno para a coluna perder o papel.
--
-- ── A ordem importa, e é por isso que esta fatia existe sozinha ──────────
-- A parte 2 tira `stage_role = won/lost` de 375 etapas. No instante em que
-- isso acontece, `useFunilMetrics` — o cabeçalho de todo funil — passa a
-- somar ZERO vendidos, porque ele deriva ganho/perda das etapas fechadas.
--
-- Migration entra em produção antes do front. Aplicar a parte 2 primeiro
-- deixaria 107 orgs vendo "0 vendidos" no cabeçalho até o próximo deploy.
--
-- Então esta parte é inteiramente ADITIVA e correta nas duas pontas: vale
-- com as etapas ainda governadas e vale depois que elas perderem o papel.
-- Pode ser aplicada a qualquer momento. A parte 2 só depois do deploy.
--
-- ── O que muda de fato ───────────────────────────────────────────────────
-- 1. `get_funil_desfecho_counts` — RPC nova, o cabeçalho passa a perguntar
--    ao negócio quantos ganhou e perdeu.
-- 2. `get_funnel_flow` — o degrau de GANHO e a PERDA saem do negócio; os
--    degraus de reunião continuam vindo da etapa.
-- 3. `_metric_leaf_coorte_etapa` — "teve desfecho" vira propriedade do
--    negócio.
-- 4. `system_stage_role` — para de atribuir won/lost a etapa nova.
-- 5. `seed_default_sales_funnel` — org nova nasce sem etapa governada.
--
-- ── Por que uma RPC nova em vez de estender a existente ──────────────────
-- `get_pipeline_stage_counts_by_id` tem 25 filtros e agrupa por etapa.
-- Reproduzir aquilo para contar desfecho seria duplicar o motor inteiro; e
-- mudar o tipo de retorno quebraria todos os chamadores. O cabeçalho só
-- passa período — então a companheira precisa de período, e mais nada.
--
-- ── A âncora é `outcome_at` ──────────────────────────────────────────────
-- O instante em que a venda foi DECIDIDA, não o último toque no card. É a
-- data que a 20270914000020 devolveu a 543 fechamentos que o B1 havia
-- carimbado com a data da migration.

CREATE OR REPLACE FUNCTION public.get_funil_desfecho_counts(
  p_pipeline_id uuid,
  p_org_id uuid,
  p_period_after timestamptz DEFAULT NULL,
  p_period_before timestamptz DEFAULT NULL
)
RETURNS TABLE(outcome text, cnt bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- DEFINER sem esta linha entrega a contagem de qualquer organização a quem
  -- souber um uuid de funil.
  PERFORM public.assert_org_access(p_org_id);

  RETURN QUERY
  SELECT COALESCE(d.outcome, 'open')::text, count(*)::bigint
  FROM public.pipeline_entries pe
  LEFT JOIN public.deals d ON d.id = pe.deal_id
  WHERE pe.pipeline_id = p_pipeline_id
    AND pe.organization_id = p_org_id
    AND pe.lead_id IS NOT NULL
    -- Decidido ancora em `outcome_at`; aberto ancora em quando o card entrou.
    -- Mesma regra do motor de contagem, com a âncora canônica no lugar de
    -- `metrics_period_at`/`updated_at`.
    AND (p_period_after IS NULL OR
         CASE WHEN d.outcome IN ('won','lost') THEN COALESCE(d.outcome_at, pe.created_at)
              ELSE pe.created_at END >= p_period_after)
    AND (p_period_before IS NULL OR
         CASE WHEN d.outcome IN ('won','lost') THEN COALESCE(d.outcome_at, pe.created_at)
              ELSE pe.created_at END <= p_period_before)
  GROUP BY COALESCE(d.outcome, 'open');
END;
$function$;

COMMENT ON FUNCTION public.get_funil_desfecho_counts(uuid, uuid, timestamptz, timestamptz) IS
  'Quantos negócios de um funil estão ganhos, perdidos e abertos. Companheira de get_pipeline_stage_counts_by_id para o cabeçalho do funil, depois que a etapa deixou de decidir o desfecho (B2d). Ancora em deals.outcome_at.';

REVOKE ALL ON FUNCTION public.get_funil_desfecho_counts(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_funil_desfecho_counts(uuid, uuid, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_funil_desfecho_counts(uuid, uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_funil_desfecho_counts(uuid, uuid, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.get_funnel_flow(p_org_id uuid, p_pipeline_id uuid, p_period text, p_ref date DEFAULT NULL::date, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bounds tstzrange; v_cohort_size integer;
  v_reached_open integer; v_reached_book integer; v_reached_held integer; v_reached_won integer;
  v_lost_count integer; v_pre_cutover boolean;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  IF p_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'get_funnel_flow: p_pipeline_id é obrigatório (funil é por-pipeline)' USING ERRCODE = '22023';
  END IF;
  v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);
  WITH pipe_events AS (
    SELECT e.lead_id, e.from_stage_key, e.occurred_at,
      public.metric_stage_role(p_org_id, p_pipeline_id, e.to_stage_key) AS role
    FROM public.pipeline_stage_events e
    WHERE e.organization_id = p_org_id AND e.pipeline_id = p_pipeline_id
  ),
  entry AS (
    SELECT pe.lead_id, COALESCE(min(pe.occurred_at) FILTER (WHERE pe.from_stage_key IS NULL), min(pe.occurred_at)) AS entry_at
    FROM pipe_events pe GROUP BY pe.lead_id
  ),
  cohort AS (SELECT en.lead_id FROM entry en WHERE en.entry_at <@ v_bounds),
  -- B2d: os degraus de REUNIÃO continuam vindo do papel da etapa — `agendado`
  -- e `compareceu` são posições no funil e seguem sendo. Já GANHO e PERDA
  -- passam a vir do negócio: a coluna deixou de decidir isso.
  desfecho AS (
    SELECT pe2.lead_id,
           bool_or(d.outcome = 'won')  AS ganhou,
           bool_or(d.outcome = 'lost') AS perdeu
    FROM public.pipeline_entries pe2
    JOIN public.deals d ON d.id = pe2.deal_id
    WHERE pe2.organization_id = p_org_id
      AND pe2.pipeline_id = p_pipeline_id
    GROUP BY pe2.lead_id
  ),
  lead_reach AS (
    SELECT pe.lead_id,
      greatest(
        max(CASE pe.role WHEN 'meeting_booked' THEN 1 WHEN 'meeting_held' THEN 2 ELSE 0 END),
        -- Ganho é o topo da escada: quem vendeu passou por tudo, mesmo que o
        -- card nunca tenha encostado numa etapa de reunião.
        CASE WHEN bool_or(COALESCE(df.ganhou, false)) THEN 3 ELSE 0 END
      ) AS max_rank,
      bool_or(COALESCE(df.perdeu, false)) AS ever_lost
    FROM pipe_events pe
    JOIN cohort c ON c.lead_id = pe.lead_id
    LEFT JOIN desfecho df ON df.lead_id = pe.lead_id
    GROUP BY pe.lead_id
  )
  SELECT count(*),
    count(*) FILTER (WHERE lr.max_rank >= 0), count(*) FILTER (WHERE lr.max_rank >= 1),
    count(*) FILTER (WHERE lr.max_rank >= 2), count(*) FILTER (WHERE lr.max_rank >= 3),
    count(*) FILTER (WHERE lr.ever_lost)
  INTO v_cohort_size, v_reached_open, v_reached_book, v_reached_held, v_reached_won, v_lost_count
  FROM lead_reach lr;
  v_cohort_size := COALESCE(v_cohort_size, 0); v_reached_open := COALESCE(v_reached_open, 0);
  v_reached_book := COALESCE(v_reached_book, 0); v_reached_held := COALESCE(v_reached_held, 0);
  v_reached_won := COALESCE(v_reached_won, 0); v_lost_count := COALESCE(v_lost_count, 0);
  v_pre_cutover := lower(v_bounds) < '2026-12-01T00:00:00Z'::timestamptz;
  RETURN jsonb_build_object(
    'period', jsonb_build_object('name', p_period, 'start', lower(v_bounds), 'end', upper(v_bounds)),
    'pipeline_id', p_pipeline_id, 'cohort_size', v_cohort_size, 'lost_count', v_lost_count,
    'pre_cutover_caveat', v_pre_cutover,
    'steps', jsonb_build_array(
      public.fn_funnel_flow_step('open', v_reached_open, v_cohort_size, NULL),
      public.fn_funnel_flow_step('meeting_booked', v_reached_book, v_cohort_size, v_reached_open),
      public.fn_funnel_flow_step('meeting_held', v_reached_held, v_cohort_size, v_reached_book),
      public.fn_funnel_flow_step('won', v_reached_won, v_cohort_size, v_reached_held)
    ),
    'lost', jsonb_build_object('role', 'lost', 'lost_count', v_lost_count,
      'conversion_from_top', CASE WHEN v_cohort_size > 0 THEN round(v_lost_count::numeric / v_cohort_size * 100, 1) ELSE NULL END)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public._metric_leaf_coorte_etapa(p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb, p_modo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- B2d: "teve desfecho" passou a ser propriedade do NEGÓCIO, não do
      -- caminho que o card fez pelas etapas. Antes se perguntava se ele
      -- ENCOSTOU numa etapa governada como won/lost; agora se pergunta se o
      -- negócio foi decidido — que é a pergunta que a coorte sempre quis fazer.
      --
      -- Muda um caso real: o negócio fechado pelo botão, sem o card sair do
      -- lugar, contava como "em aberto" na coorte. Contava errado.
      EXISTS (
        SELECT 1
        FROM public.pipeline_entries pe4
        JOIN public.deals d ON d.id = pe4.deal_id
        WHERE pe4.id = c.entry_id
          AND pe4.organization_id = p_org_id
          AND d.outcome IN ('won','lost')
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
$function$
;

-- ── A etapa nova para de nascer governada ────────────────────────────────
-- `trg_pipeline_stages_system_stage_role` é BEFORE **INSERT** (não UPDATE),
-- então ele não desfaz o UPDATE da parte 2 — conferido. Mas sem esta troca,
-- uma etapa `propostas/vendido` criada amanhã renasceria com papel 'won', e a
-- parte 2 viraria uma limpeza que se desfaz sozinha.
CREATE OR REPLACE FUNCTION public.system_stage_role(p_pipeline_type text, p_stage_key text)
 RETURNS stage_role
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT (
    CASE p_pipeline_type
      WHEN 'whatsapp' THEN
        CASE p_stage_key
          WHEN 'agendado' THEN 'meeting_booked'
          WHEN 'compareceu' THEN 'meeting_held'
          -- `nao_compareceu` era 'lost' aqui. Falta não é perda (20270907000000).
          ELSE 'open'
        END
      WHEN 'confirmacao' THEN
        CASE p_stage_key
          WHEN 'reuniao_marcada' THEN 'meeting_booked'
          WHEN 'confirmar_d5' THEN 'meeting_booked'
          WHEN 'confirmar_d3' THEN 'meeting_booked'
          WHEN 'confirmar_d2' THEN 'meeting_booked'
          WHEN 'confirmar_d1' THEN 'meeting_booked'
          WHEN 'confirmacao_no_dia' THEN 'meeting_booked'
          WHEN 'compareceu' THEN 'meeting_held'
          -- `perdido` era 'lost'. B2d: a coluna não decide mais desfecho.
          ELSE 'open'
        END
      WHEN 'propostas' THEN
        -- `vendido` era 'won' e `perdido` era 'lost'. B2d: as duas colunas
        -- continuam existindo no quadro; o que sai é o poder que elas tinham
        -- de registrar a venda. Os degraus de REUNIÃO seguem governados —
        -- 'agendado' e 'compareceu' são posição no funil, não dinheiro.
        'open'
      ELSE 'open'
    END
  )::public.stage_role
$function$;

CREATE OR REPLACE FUNCTION public.seed_default_sales_funnel(p_org_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline_id uuid;
BEGIN
  -- Autorização por GRANT, não por gate no corpo: EXECUTE só para
  -- service_role (abaixo). O trigger não depende do grant — dentro de
  -- fn_seed_default_funnel_for_org (DEFINER, owner postgres) o current_user
  -- é o owner, então QUALQUER caminho legítimo de INSERT em organizations
  -- (master no front, billing_provision_new_org, create_org_sandbox por
  -- admin) semeia sem tropeçar em permissão. Um gate por is_master_user()
  -- aqui quebraria o sandbox criado por admin comum.
  --
  -- O guard de dinheiro (won/lost) deixa o seed passar por uma das vias já
  -- existentes conforme o caminho: service_role (billing/edge), master
  -- (front), admin da org, ou — via §0 desta migration — session_user
  -- postgres (migration/console). Impersonar service_role aqui é impossível:
  -- `SET "role"` é proibido sob frame SECURITY DEFINER (medido, erro 42501).
  INSERT INTO public.pipelines
    (organization_id, name, slug, type, description, icon, color, display_order, is_active, config)
  VALUES
    (p_org_id, 'Funil de Vendas', 'vendas', 'custom',
     'Funil padrão da organização — renomeie e adapte as etapas ao seu processo.',
     'trending-up', '#f59e0b', 3, true, '{}'::jsonb)
  ON CONFLICT (organization_id, slug) DO NOTHING;

  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE organization_id = p_org_id AND slug = 'vendas';

  IF v_pipeline_id IS NULL THEN
    -- Impossível no caminho do trigger; guarda contra chamada manual esquisita.
    RAISE EXCEPTION 'seed_default_sales_funnel: funil vendas não resolveu para org %', p_org_id;
  END IF;

  -- `pipeline_type` NULL = convenção de funil comum (medido: 556/556 etapas
  -- custom em prod). Papéis explícitos: o trigger de system_stage_role só age
  -- sobre 'open', e aqui o que importa (meeting_booked/won/lost) vai declarado.
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_id, pipeline_type, stage_key, name, color,
     position, is_active, stage_role, is_final_positive, is_final_negative,
     requires_sale_value)
  SELECT p_org_id, v_pipeline_id, NULL, d.stage_key, d.nome, d.cor, d.pos,
         true, d.papel::public.stage_role, d.final_pos, d.final_neg, d.exige_valor
    FROM (VALUES
      ('novo',             'Novo',             '#6366f1', 0, 'open',           false, false, false),
      ('em_conversa',      'Em conversa',      '#3b82f6', 1, 'open',           false, false, false),
      ('reuniao_marcada',  'Reunião marcada',  '#8b5cf6', 2, 'meeting_booked', false, false, false),
      ('proposta_enviada', 'Proposta enviada', '#0ea5e9', 3, 'open',           false, false, false),
      -- B2d: as duas colunas continuam nascendo — a operação usa e reconhece
      -- 'Ganhou'/'Perdeu' no quadro. O que elas NÃO nascem mais é governadas:
      -- papel 'open', como qualquer outra. Quem decide ganho e perda é o
      -- desfecho do negócio, pelo botão ou pela automação.
      --
      -- `is_final_positive`/`is_final_negative` ficam: são o sinal legado de
      -- "etapa terminal", lido em 14 arquivos de front e 6 funções SQL para
      -- coisas que não têm a ver com dinheiro (fechar a entrada, ordenar,
      -- montar template de onboarding). Mexer neles é outra fatia.
      ('ganhou',           'Ganhou',           '#22c55e', 4, 'open',           true,  false, true),
      ('perdeu',           'Perdeu',           '#ef4444', 5, 'open',           false, true,  false)
    ) AS d(stage_key, nome, cor, pos, papel, final_pos, final_neg, exige_valor)
  ON CONFLICT (pipeline_id, stage_key) DO NOTHING;

  -- Já nasce como funil padrão (D4: fallback único das portas). Nunca
  -- sobrescreve um padrão que já exista.
  UPDATE public.organizations
     SET default_pipeline_id = v_pipeline_id
   WHERE id = p_org_id
     AND default_pipeline_id IS NULL;

  RETURN v_pipeline_id;
END;
$function$
;

-- ── Guardas ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_org uuid; v_user uuid; v_pipe uuid; v_n integer; v_flow jsonb;
BEGIN
  -- `system_stage_role` não pode mais devolver dinheiro para nenhuma
  -- combinação de sistema. Os papéis de reunião TÊM de sobreviver — perdê-los
  -- quebraria a agenda, que é o outro arco deste trabalho.
  IF public.system_stage_role('propostas','vendido')::text <> 'open'
     OR public.system_stage_role('propostas','perdido')::text <> 'open'
     OR public.system_stage_role('confirmacao','perdido')::text <> 'open' THEN
    RAISE EXCEPTION 'system_stage_role ainda atribui desfecho a etapa de sistema';
  END IF;
  IF public.system_stage_role('whatsapp','agendado')::text <> 'meeting_booked'
     OR public.system_stage_role('whatsapp','compareceu')::text <> 'meeting_held'
     OR public.system_stage_role('confirmacao','compareceu')::text <> 'meeting_held' THEN
    RAISE EXCEPTION 'os papeis de REUNIAO foram perdidos junto — isso quebra a agenda';
  END IF;

  -- O seed não pode mais criar etapa governada.
  IF pg_get_functiondef('public.seed_default_sales_funnel'::regproc) ~ '''won''|''lost''' THEN
    RAISE EXCEPTION 'seed_default_sales_funnel ainda cria etapa com papel de dinheiro';
  END IF;

  -- Nenhum dos leitores portados pode decidir desfecho por papel de etapa.
  --
  -- 🚨 A primeira versão desta guarda procurava 'won'|'lost' em qualquer
  -- lugar do corpo — e reprovou o PRÓPRIO conserto, porque a versão nova
  -- escreve `d.outcome = 'won'`. Procurar a palavra não distingue "decide
  -- pela etapa" de "lê o desfecho": as duas usam o mesmo vocabulário.
  --
  -- Então a busca é pelos IDIOMAS que só existiam na versão antiga:
  -- comparar o PAPEL contra won/lost, e o degrau `WHEN 'won' THEN 3`.
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.prokind = 'f'
     AND p.proname IN ('get_funnel_flow', '_metric_leaf_coorte_etapa')
     -- Três idiomas, um por forma que a versão antiga tinha de perguntar à
     -- etapa. O do meio precisa de caso próprio: entre `role` e o `IN` cabe a
     -- chamada inteira de `metric_stage_role(org, pipeline, stage_key)`, que
     -- estoura qualquer janela curta — medido, a guarda pegava 1 de 2 sem ele.
     AND pg_get_functiondef(p.oid) ~ '(metric_stage_role\([^)]*\)\s*IN\s*\(''won''|role[^;]{0,40}(=|IN)[^;]{0,20}''(won|lost)''|WHEN ''won'' THEN)';
  IF v_n > 0 THEN
    RAISE EXCEPTION '% leitor(es) ainda decidem desfecho por papel de etapa', v_n;
  END IF;

  -- ── As três precisam responder, sob o papel de quem usa ────────────────
  SELECT tm.organization_id, tm.user_id INTO v_org, v_user
    FROM public.team_members tm
   WHERE tm.user_id IS NOT NULL AND tm.is_active
     AND EXISTS (SELECT 1 FROM public.pipelines p
                  WHERE p.organization_id = tm.organization_id AND p.is_active)
     AND EXISTS (SELECT 1 FROM public.deals d
                  WHERE d.organization_id = tm.organization_id AND d.outcome IN ('won','lost'))
   LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'sem org com membro ativo, funil e negocio fechado para exercitar as guardas';
  END IF;
  SELECT p.id INTO v_pipe FROM public.pipelines p
   WHERE p.organization_id = v_org AND p.is_active LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- A RPC nova tem de contar alguma coisa. Zero linhas aqui significaria
  -- cabeçalho vazio para todo mundo — o defeito que esta fatia veio evitar.
  SELECT count(*) INTO v_n FROM public.get_funil_desfecho_counts(v_pipe, v_org);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'get_funil_desfecho_counts nao devolveu linha nenhuma para um funil com negocio';
  END IF;

  v_flow := public.get_funnel_flow(v_org, v_pipe, 'month', NULL, NULL, NULL);
  IF v_flow IS NULL OR NOT (v_flow ? 'lost') THEN
    RAISE EXCEPTION 'get_funnel_flow nao devolveu o shape esperado';
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;
