-- 20271226000000_boas_vindas_semana.sql
--
-- Abertura de segunda-feira: o resumo da SEMANA ANTERIOR da org, entregue uma
-- única vez por usuário por semana.
--
-- O QUE ISTO ENTREGA
--
--   · boas_vindas_semana_vistas      quem já viu a abertura de qual semana
--   · boas_vindas_semana_resumo()    os números da semana anterior (interna)
--   · boas_vindas_semana_reivindicar()  a porta do front: confere, calcula e
--                                       marca "visto" numa chamada só
--
-- POR QUE UMA RPC SÓ PARA CONFERIR E MARCAR
--
-- "Já viu esta semana?" + "marque que viu" em duas chamadas deixa a janela em
-- que duas abas, ou o celular e o computador, abrem no mesmo segundo e as duas
-- tocam a animação. Aqui o INSERT ... ON CONFLICT é a decisão: quem insere
-- (ROW_COUNT = 1) recebe o resumo; quem não insere, não.
--
-- O custo dessa escolha, de propósito: se a animação quebrar depois de marcada,
-- a pessoa a perde naquela semana. É o lado certo do erro — o oposto é repetir
-- uma abertura de 30 s a cada recarga.
--
-- DE ONDE VÊM OS NÚMEROS — AS MESMAS REGRAS DO PAINEL, NÃO UMA CÓPIA PRÓPRIA
--
-- Um número da abertura que diverge do painel é pior que nenhum número.
--
--   Vendas / receita   `sale_events` com event_type = 'sale', sem estorno
--                      (NOT EXISTS sale_reversed → reversed_event_id). É a
--                      mesma regra de get_sales_metrics ("fonte ÚNICA de
--                      receita, líquida de estornos", ADR-0017).
--   Leads novos        o predicado de get_dashboard_metrics: não-sombra, não
--                      `excluded_from_metrics`, não apagado, e
--                      COALESCE(metrics_period_at, created_at) no período.
--   Semana             ISO (segunda a domingo), cortada no fuso da ORG por
--                      metric_period_bounds — o front nunca converte data
--                      (ADR-0017 §5). É o fuso da org, não o do aparelho.
--
--   E o que é do Torque (blocos OPCIONAIS — cada um pode faltar):
--   Automações         `workflow_executions` iniciadas na semana, e a automação
--                      que mais rodou. Sem índice de data na tabela: por isso a
--                      falha branda abaixo.
--   Movimentação       `pipeline_stage_events` com `actor` (auth.uid(), nulo
--                      para automação/webhook) e `from_stage_key` não nulo
--                      (nulo = cartão criado, não movido). Só membro ATIVO.
--   Ranking do mês     `get_ranking_data`, o ranking do painel — o número bate
--                      com o que a pessoa vê lá. Chamado só DEPOIS de
--                      assert_org_access: essa função, sozinha, não confere
--                      acesso (ver o relatório desta entrega).
--
--   Falha branda: os três blocos opcionais capturam o erro, avisam (WARNING) e
--   seguem. Um estouro neles não pode derrubar a abertura, desfazer o "visto" e
--   fazer a pessoa repetir uma consulta pesada a cada abertura do app.
--
-- QUEM VÊ O QUÊ
--
-- A RPC exige assert_org_access (membro ativo, master ou gestor da org). Isso
-- é o mesmo gate de get_sales_metrics, então a API não passa a expor nada novo.
-- Quem decide se a ABERTURA aparece é o front, com a permissão `metrics.view`
-- (a mesma que tranca a tela de Métricas): sem ela o front nem chama, e portanto
-- nada é reivindicado. Resolver permissão em SQL duplicaria regras que mudam
-- (padrão da org, sobrescrita por membro, papel).
--
-- SÓ SEGUNDA-FEIRA. `v_so_segunda` abaixo é a única linha a mudar caso a regra
-- passe a ser "primeiro acesso da semana, qualquer dia".
--
-- ROLLBACK pareado: rollback/20271226000000_boas_vindas_semana.sql

-- ===========================================================================
-- 1 — O CADERNO DE "JÁ VIU"
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.boas_vindas_semana_vistas (
  user_id         uuid        NOT NULL REFERENCES auth.users(id)         ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- A segunda-feira da semana em que viu, no fuso da org.
  semana          date        NOT NULL,
  visto_em        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id, semana)
);

COMMENT ON TABLE public.boas_vindas_semana_vistas IS
  'Quem já viu a abertura de segunda-feira de qual semana. Escrita só por boas_vindas_semana_reivindicar().';

-- RLS ligada e SEM policy: ninguém lê nem escreve direto. A única porta é a RPC
-- (SECURITY DEFINER). Policy aberta aqui seria só mais um lugar para errar.
ALTER TABLE public.boas_vindas_semana_vistas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.boas_vindas_semana_vistas FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 2 — O RESUMO (interna: recebe a data local, para poder ser testada)
-- ===========================================================================
-- `p_hoje` é a data LOCAL da org (segunda-feira de hoje). A semana contada é a
-- anterior: [segunda-7, segunda). Devolve NULL quando a semana não teve lead
-- nem venda — não há o que contar, e uma abertura vazia é pior que nenhuma.
CREATE OR REPLACE FUNCTION public.boas_vindas_semana_resumo(p_org_id uuid, p_hoje date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz        text;
  v_b         tstzrange;
  v_b_ant     tstzrange;
  v_ini       date;
  v_leads     integer[];
  v_vendas    integer[];
  v_receita   numeric[];
  v_leads_t   integer;
  v_vendas_t  integer;
  v_receita_t numeric;
  v_leads_a   integer;
  v_vendas_a  integer;
  v_receita_a numeric;
  v_out       jsonb;
  -- Blocos opcionais: cada um pode faltar sem derrubar a abertura.
  v_aut       jsonb;
  v_aut_ant   integer;
  v_mov       jsonb;
  v_rank      jsonb;
  v_arr       jsonb;
  v_mes       integer;
  v_ano       integer;
  v_meu       uuid;
  v_soma      numeric;
BEGIN
  SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = p_org_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'boas_vindas_semana_resumo: organização % não encontrada', p_org_id
      USING ERRCODE = 'P0002';
  END IF;

  v_b     := public.metric_period_bounds(p_org_id, 'week', p_hoje - 7);
  v_b_ant := public.metric_period_bounds(p_org_id, 'week', p_hoje - 14);
  v_ini   := (lower(v_b) AT TIME ZONE v_tz)::date;

  -- Por dia (segunda = 0 … domingo = 6), no fuso da org.
  SELECT array_agg(COALESCE(x.n, 0) ORDER BY d.i)
    INTO v_leads
  FROM generate_series(0, 6) AS d(i)
  LEFT JOIN (
    SELECT ((COALESCE(l.metrics_period_at, l.created_at) AT TIME ZONE v_tz)::date - v_ini) AS i,
           count(*)::int AS n
    FROM public.leads l
    WHERE l.organization_id = p_org_id
      AND (l.is_shadow IS NULL OR l.is_shadow = false)
      AND COALESCE(l.excluded_from_metrics, false) = false
      AND l.deleted_at IS NULL
      AND COALESCE(l.metrics_period_at, l.created_at) <@ v_b
    GROUP BY 1
  ) x ON x.i = d.i;

  SELECT array_agg(COALESCE(x.n, 0) ORDER BY d.i),
         array_agg(COALESCE(x.v, 0) ORDER BY d.i)
    INTO v_vendas, v_receita
  FROM generate_series(0, 6) AS d(i)
  LEFT JOIN (
    SELECT ((w.sold_at AT TIME ZONE v_tz)::date - v_ini) AS i,
           count(*)::int AS n,
           COALESCE(sum(w.sale_value), 0) AS v
    FROM public.sale_events w
    WHERE w.organization_id = p_org_id
      AND w.event_type = 'sale'
      AND w.sold_at <@ v_b
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_events r
        WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id
      )
    GROUP BY 1
  ) x ON x.i = d.i;

  SELECT COALESCE(sum(n), 0) INTO v_leads_t   FROM unnest(v_leads)   AS n;
  SELECT COALESCE(sum(n), 0) INTO v_vendas_t  FROM unnest(v_vendas)  AS n;
  SELECT COALESCE(sum(n), 0) INTO v_receita_t FROM unnest(v_receita) AS n;

  IF v_leads_t = 0 AND v_vendas_t = 0 THEN
    RETURN NULL;
  END IF;

  -- A semana antes dela, só em totais: serve à variação ("↑ 12% sobre a anterior").
  SELECT count(*)::int INTO v_leads_a
  FROM public.leads l
  WHERE l.organization_id = p_org_id
    AND (l.is_shadow IS NULL OR l.is_shadow = false)
    AND COALESCE(l.excluded_from_metrics, false) = false
    AND l.deleted_at IS NULL
    AND COALESCE(l.metrics_period_at, l.created_at) <@ v_b_ant;

  SELECT count(*)::int, COALESCE(sum(w.sale_value), 0)
    INTO v_vendas_a, v_receita_a
  FROM public.sale_events w
  WHERE w.organization_id = p_org_id
    AND w.event_type = 'sale'
    AND w.sold_at <@ v_b_ant
    AND NOT EXISTS (
      SELECT 1 FROM public.sale_events r
      WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id
    );

  v_out := jsonb_build_object(
    'inicio',  v_ini,
    'fim',     v_ini + 6,
    'leads',   v_leads_t,
    'vendas',  v_vendas_t,
    'receita', v_receita_t,
    'por_dia', jsonb_build_object(
      'leads',   to_jsonb(v_leads),
      'vendas',  to_jsonb(v_vendas),
      'receita', to_jsonb(v_receita)
    ),
    'anterior', jsonb_build_object(
      'leads',   v_leads_a,
      'vendas',  v_vendas_a,
      'receita', v_receita_a
    )
  );

  -- ── O que é do Torque: automações, movimentação e ranking ─────────────────
  -- Cada bloco é FALHA BRANDA: se estourar (workflow_executions não tem índice
  -- de data, só de org), aquele pedaço some e o resto da abertura segue. Sem
  -- isso um estouro derrubaria tudo, desfaria a marcação de "visto" e a pessoa
  -- repetiria a consulta pesada a cada abertura do app, num banco que já teve
  -- swap.

  -- Automações: quantas vezes rodaram na semana, e qual rodou mais.
  BEGIN
    WITH ex AS (
      SELECT e.workflow_id, count(*)::int AS n
      FROM public.workflow_executions e
      WHERE e.organization_id = p_org_id AND e.started_at <@ v_b
      GROUP BY e.workflow_id
    )
    SELECT jsonb_build_object(
             'execucoes', COALESCE((SELECT sum(n) FROM ex), 0)::int,
             'top', (SELECT jsonb_build_object('nome', w.name, 'execucoes', ex.n)
                       FROM ex
                       JOIN public.workflows w ON w.id = ex.workflow_id AND w.organization_id = p_org_id
                      ORDER BY ex.n DESC, w.name
                      LIMIT 1))
      INTO v_aut;

    SELECT count(*)::int INTO v_aut_ant
    FROM public.workflow_executions e
    WHERE e.organization_id = p_org_id AND e.started_at <@ v_b_ant;

    IF (v_aut->>'execucoes')::int > 0 THEN
      v_out := v_out || jsonb_build_object('automacoes', v_aut || jsonb_build_object('anterior', v_aut_ant));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'boas_vindas_semana_resumo: automações indisponíveis (%)', SQLERRM;
  END;

  -- Movimentação: quem mais moveu lead de etapa. Só GENTE: `actor` é o auth.uid()
  -- de quem mexeu, nulo para automação/webhook; e só movimento de verdade
  -- (`from_stage_key` nulo é o cartão sendo criado, não movido).
  BEGIN
    WITH mv AS (
      SELECT tm.id, tm.name, tm.user_id, count(*)::int AS n
      FROM public.pipeline_stage_events e
      JOIN public.team_members tm
        ON tm.user_id = e.actor AND tm.organization_id = p_org_id AND tm.is_active
      WHERE e.organization_id = p_org_id
        AND e.occurred_at <@ v_b
        AND e.actor IS NOT NULL
        AND e.from_stage_key IS NOT NULL
      GROUP BY tm.id, tm.name, tm.user_id
    )
    SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
             'total', sum(n)::int,
             'top', (SELECT jsonb_build_object('nome', m.name, 'movimentos', m.n, 'voce', m.user_id = auth.uid())
                       FROM mv m ORDER BY m.n DESC, m.name LIMIT 1)) END
      INTO v_mov
    FROM mv;

    IF v_mov IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('movimentacao', v_mov);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'boas_vindas_semana_resumo: movimentação indisponível (%)', SQLERRM;
  END;

  -- Ranking do mês: o MESMO do painel (get_ranking_data), para o número bater.
  -- Segunda no começo do mês: o mês corrente ainda não vendeu nada. Mostrar um
  -- ranking de zeros seria pior que mostrar o do mês fechado, então, nos 7
  -- primeiros dias sem venda, vale o mês anterior — e o `mes` vai no payload
  -- para a tela dizer qual é.
  BEGIN
    v_mes := extract(month FROM p_hoje)::int;
    v_ano := extract(year  FROM p_hoje)::int;
    v_arr := public.get_ranking_data(v_mes, v_ano, p_org_id) -> 'salesRanking';
    SELECT COALESCE(sum((x->>'value')::numeric), 0) INTO v_soma FROM jsonb_array_elements(v_arr) AS t(x);

    IF v_soma = 0 AND extract(day FROM p_hoje) <= 7 THEN
      v_mes := extract(month FROM (date_trunc('month', p_hoje::timestamp) - interval '1 month'))::int;
      v_ano := extract(year  FROM (date_trunc('month', p_hoje::timestamp) - interval '1 month'))::int;
      v_arr := public.get_ranking_data(v_mes, v_ano, p_org_id) -> 'salesRanking';
      SELECT COALESCE(sum((x->>'value')::numeric), 0) INTO v_soma FROM jsonb_array_elements(v_arr) AS t(x);
    END IF;

    IF v_soma > 0 THEN
      SELECT tm.id INTO v_meu
      FROM public.team_members tm
      WHERE tm.organization_id = p_org_id AND tm.user_id = auth.uid() AND tm.is_active
      LIMIT 1;

      v_rank := jsonb_build_object(
        'mes', v_mes,
        'ano', v_ano,
        'corrente', (v_mes = extract(month FROM p_hoje)::int AND v_ano = extract(year FROM p_hoje)::int),
        'pessoas', jsonb_array_length(v_arr),
        'top', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'nome',    r.x->>'name',
                   'valor',   (r.x->>'value')::numeric,
                   'vendas',  (r.x->>'conversions')::int,
                   'posicao', (r.x->>'position')::int,
                   'voce',    v_meu IS NOT NULL AND (r.x->>'id')::uuid = v_meu
                 ) ORDER BY (r.x->>'position')::int), '[]'::jsonb)
          FROM (SELECT t.x FROM jsonb_array_elements(v_arr) AS t(x)
                 WHERE (t.x->>'value')::numeric > 0
                 ORDER BY (t.x->>'position')::int LIMIT 3) r),
        'voce', (
          SELECT jsonb_build_object('posicao', (t.x->>'position')::int,
                                    'valor',   (t.x->>'value')::numeric,
                                    'vendas',  (t.x->>'conversions')::int)
          FROM jsonb_array_elements(v_arr) AS t(x)
          WHERE v_meu IS NOT NULL AND (t.x->>'id')::uuid = v_meu
          LIMIT 1)
      );
      v_out := v_out || jsonb_build_object('ranking', v_rank);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'boas_vindas_semana_resumo: ranking indisponível (%)', SQLERRM;
  END;

  RETURN v_out;
END;
$$;

-- Interna: nem o front nem o anon chegam aqui. Quem a chama é a RPC abaixo.
REVOKE ALL ON FUNCTION public.boas_vindas_semana_resumo(uuid, date) FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 3 — A PORTA DO FRONT
-- ===========================================================================
-- Devolve sempre um objeto com `elegivel`. Quando é true, vêm junto os campos
-- de boas_vindas_semana_resumo(). Quando é false, `motivo` diz por quê:
--   nao_e_segunda   hoje, no fuso da org, não é segunda-feira
--   ja_vista        este usuário já recebeu a abertura desta semana
--   sem_dados       a semana anterior não teve lead nem venda (nada é marcado)
CREATE OR REPLACE FUNCTION public.boas_vindas_semana_reivindicar(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_tz         text;
  v_hoje       date;
  v_semana     date;
  v_resumo     jsonb;
  v_inseriu    integer;
  -- A regra de negócio: só na segunda-feira. Trocar por `false` para valer o
  -- primeiro acesso da semana, em qualquer dia.
  v_so_segunda constant boolean := true;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'boas_vindas_semana: login necessário' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_org_access(p_org_id);

  SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = p_org_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'boas_vindas_semana: organização % não encontrada', p_org_id
      USING ERRCODE = 'P0002';
  END IF;

  v_hoje   := (now() AT TIME ZONE v_tz)::date;
  v_semana := date_trunc('week', v_hoje::timestamp)::date;

  IF v_so_segunda AND extract(isodow FROM v_hoje) <> 1 THEN
    RETURN jsonb_build_object('elegivel', false, 'motivo', 'nao_e_segunda');
  END IF;

  -- Barato primeiro: quem já viu sai aqui, sem somar nada.
  IF EXISTS (
    SELECT 1 FROM public.boas_vindas_semana_vistas v
    WHERE v.user_id = v_uid AND v.organization_id = p_org_id AND v.semana = v_semana
  ) THEN
    RETURN jsonb_build_object('elegivel', false, 'motivo', 'ja_vista');
  END IF;

  v_resumo := public.boas_vindas_semana_resumo(p_org_id, v_semana);
  IF v_resumo IS NULL THEN
    RETURN jsonb_build_object('elegivel', false, 'motivo', 'sem_dados');
  END IF;

  -- A decisão: quem insere, recebe. Quem perde a corrida (outra aba, outro
  -- aparelho, no mesmo instante) não insere e não recebe.
  INSERT INTO public.boas_vindas_semana_vistas (user_id, organization_id, semana)
  VALUES (v_uid, p_org_id, v_semana)
  ON CONFLICT (user_id, organization_id, semana) DO NOTHING;
  GET DIAGNOSTICS v_inseriu = ROW_COUNT;

  IF v_inseriu = 0 THEN
    RETURN jsonb_build_object('elegivel', false, 'motivo', 'ja_vista');
  END IF;

  RETURN jsonb_build_object('elegivel', true, 'semana', v_semana) || v_resumo;
END;
$$;

-- anon tem EXECUTE por herança de PUBLIC: tirar de PUBLIC E de anon, e só então conceder.
REVOKE ALL ON FUNCTION public.boas_vindas_semana_reivindicar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.boas_vindas_semana_reivindicar(uuid) TO authenticated;
