-- Catálogo de leitura estrutural do Oráculo: funil, ranking, perdas e leads.
-- SCRUM-596, ADR-0032 §4, ADR-0017.
--
-- 🚨 AS QUATRO RECEBEM A ORGANIZAÇÃO POR PARÂMETRO, e é por isso que NENHUMA
-- é alcançável por `authenticated`. Quem resolve o Escopo é a edge function, a
-- partir do JWT; ela chama com `service_role`. Conceder EXECUTE a
-- `authenticated` recriaria letra por letra o vetor cross-tenant que esta base
-- já teve que fechar em 14 funções.
--
-- `p_team_member_id` NULL = Escopo de organização. Não-NULL = a pessoa só
-- alcança o que atende.

-- ── 1. funil ──────────────────────────────────────────────────────────────
-- Conversão etapa a etapa, para localizar onde trava.
--
-- O NOME E A ORDEM DA ETAPA VÊM DE DOIS CATÁLOGOS, e o elo não é óbvio:
--   · pipeline custom  → `custom_pipeline_stages` por (pipeline_id, stage_key);
--   · pipeline sistema → `pipeline_stages` por (organization_id, pipeline_type,
--     stage_key), onde `pipeline_type` casa com `pipelines.SLUG`.
--
-- Medido em produção: `pipelines.type` vale 'system'/'custom' e NÃO casa com
-- `pipeline_stages.pipeline_type` (whatsapp/propostas/confirmacao) — o join
-- pelo `type` devolve ZERO linhas. Pelo slug, a cobertura das 45.587 entradas
-- abertas vai de 36% para 99,88%. Quem usar o join óbvio constrói um funil que
-- enxerga um terço da operação e não avisa.
CREATE OR REPLACE FUNCTION public.oraculo_funil(
  p_organization_id uuid,
  p_team_member_id  uuid,
  p_periodo_dias    integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH periodo AS (
    SELECT now() - make_interval(days => greatest(1, least(coalesce(p_periodo_dias, 30), 365))) AS desde
  ),
  entradas AS (
    SELECT
      pe.id,
      pe.stage_key,
      p.name  AS pipeline_nome,
      p.slug  AS pipeline_slug,
      coalesce(cps.name, ps.name)                     AS etapa_nome,
      coalesce(cps.position, ps.position)             AS etapa_ordem,
      coalesce(cps.is_final_positive, ps.is_final_positive, false) AS ganha,
      coalesce(cps.is_final_negative, ps.is_final_negative, false) AS perdida
    FROM public.pipeline_entries pe
    JOIN public.pipelines p ON p.id = pe.pipeline_id
    LEFT JOIN public.custom_pipeline_stages cps
      ON cps.pipeline_id = pe.pipeline_id AND cps.stage_key = pe.stage_key
    LEFT JOIN public.pipeline_stages ps
      ON ps.organization_id = pe.organization_id
     AND ps.pipeline_type   = p.slug
     AND ps.stage_key       = pe.stage_key
    CROSS JOIN periodo pr
    WHERE pe.organization_id = p_organization_id
      AND pe.closed_at IS NULL
      AND pe.entered_at >= pr.desde
      AND (p_team_member_id IS NULL OR pe.assigned_to = p_team_member_id)
  ),
  por_etapa AS (
    SELECT
      pipeline_nome,
      pipeline_slug,
      stage_key,
      etapa_nome,
      etapa_ordem,
      ganha,
      perdida,
      count(*) AS negocios
    FROM entradas
    GROUP BY 1, 2, 3, 4, 5, 6, 7
  )
  SELECT jsonb_build_object(
    'escopo',       CASE WHEN p_team_member_id IS NULL THEN 'organizacao' ELSE 'pessoa' END,
    'periodo_dias', greatest(1, least(coalesce(p_periodo_dias, 30), 365)),
    'total_aberto', (SELECT coalesce(sum(negocios), 0) FROM por_etapa),
    -- Etapa sem nome no catálogo aparece com a chave crua e `etapa_nome` nulo,
    -- em vez de sumir: 55 das 45.587 entradas abertas estão nessa situação, e
    -- omiti-las faria a soma do funil não bater com o total da operação.
    'etapas', (
      SELECT coalesce(jsonb_agg(e ORDER BY e.pipeline_nome, e.etapa_ordem NULLS LAST, e.stage_key), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'pipeline',  pipeline_nome,
          'etapa',     etapa_nome,
          'chave',     stage_key,
          'ordem',     etapa_ordem,
          'desfecho',  CASE WHEN ganha THEN 'ganha' WHEN perdida THEN 'perdida' ELSE NULL END,
          'negocios',  negocios
        ) AS e, pipeline_nome, etapa_ordem, stage_key
        FROM por_etapa
      ) e
    )
  );
$$;

COMMENT ON FUNCTION public.oraculo_funil(uuid, uuid, integer) IS
  'Ferramenta `funil` do Oráculo. Etapa vem de dois catálogos: custom_pipeline_stages por pipeline_id, e pipeline_stages por pipelines.SLUG (não por pipelines.type, que é system/custom e casa zero). EXECUTE exclusivo de service_role.';

REVOKE ALL ON FUNCTION public.oraculo_funil(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oraculo_funil(uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.oraculo_funil(uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_funil(uuid, uuid, integer) TO service_role;

-- ── 2. ranking ────────────────────────────────────────────────────────────
-- Pessoas. Só existe em Escopo de organização — a recusa do `member` acontece
-- na ferramenta, ANTES de chegar aqui, mas esta função também não tem por onde
-- recortar por pessoa: o ranking é a comparação em si.
--
-- Receita do caderno `sale_events`, líquida de estornos (ADR-0017), com a mesma
-- chave canônica de atribuição que `oraculo_metricas` usa — senão o Oráculo
-- responde dois números diferentes para a mesma pergunta.
CREATE OR REPLACE FUNCTION public.oraculo_ranking(
  p_organization_id uuid,
  p_periodo_dias    integer,
  p_limite          integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH periodo AS (
    SELECT now() - make_interval(days => greatest(1, least(coalesce(p_periodo_dias, 30), 365))) AS desde
  ),
  vendas AS (
    SELECT se.sale_responsible_id AS tm, se.sale_value
    FROM public.sale_events se, periodo p
    WHERE se.organization_id = p_organization_id
      AND se.event_type = 'sale'
      AND se.sold_at >= p.desde
      AND se.sale_responsible_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_events r
        WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id
      )
  ),
  perdas AS (
    SELECT se.sale_responsible_id AS tm, count(*) AS n
    FROM public.sale_events se, periodo p
    WHERE se.organization_id = p_organization_id
      AND se.event_type = 'sale_lost'
      AND se.sold_at >= p.desde
      AND se.sale_responsible_id IS NOT NULL
    GROUP BY 1
  ),
  consolidado AS (
    SELECT
      tm.id   AS team_member_id,
      tm.name AS pessoa,
      (SELECT count(*)                     FROM vendas v WHERE v.tm = tm.id) AS vendas,
      (SELECT coalesce(sum(v.sale_value),0) FROM vendas v WHERE v.tm = tm.id) AS receita,
      (SELECT coalesce(pd.n, 0)            FROM perdas pd WHERE pd.tm = tm.id) AS perdas
    FROM public.team_members tm
    WHERE tm.organization_id = p_organization_id
      AND tm.is_active
  )
  SELECT jsonb_build_object(
    'escopo',       'organizacao',
    'periodo_dias', greatest(1, least(coalesce(p_periodo_dias, 30), 365)),
    -- Quem não vendeu nem perdeu no período NÃO entra: conta de teste apareceria
    -- como o pior desempenho da organização todo dia, para sempre.
    'pessoas', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.receita DESC, x.vendas DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'pessoa',  pessoa,
          'vendas',  vendas,
          'receita', receita,
          'perdas',  perdas
        ) AS x, receita, vendas
        FROM consolidado
        WHERE vendas > 0 OR perdas > 0
        ORDER BY receita DESC, vendas DESC
        LIMIT greatest(1, least(coalesce(p_limite, 20), 50))
      ) x
    )
  );
$$;

COMMENT ON FUNCTION public.oraculo_ranking(uuid, integer, integer) IS
  'Ferramenta `ranking` do Oráculo. Só Escopo de organização; a recusa do member acontece na ferramenta, antes daqui. Receita de sale_events líquida de estornos (ADR-0017). Quem não teve movimento no período não entra, para conta de teste não virar o pior desempenho perpétuo. EXECUTE exclusivo de service_role.';

REVOKE ALL ON FUNCTION public.oraculo_ranking(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oraculo_ranking(uuid, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.oraculo_ranking(uuid, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_ranking(uuid, integer, integer) TO service_role;

-- ── 3. perdas ─────────────────────────────────────────────────────────────
-- ALCANCE DELIBERADAMENTE MENOR QUE O DO TICKET, decidido pelo CTO em
-- 01/09/2026. A issue pede "motivos reais de negócio perdido"; motivo NÃO
-- EXISTE em produção. Medido: `deals.loss_reason_id` e `deals.loss_reason`
-- vazios nas 35.230 linhas, o mesmo em `pipe_propostas`, e as 209 chaves
-- `loss_reason_id` em `pipeline_entries.metadata` têm valor nulo. O catálogo
-- `loss_reasons` é seed de sistema: 108 organizações, zero customizações.
--
-- Então esta função responde QUANTO e ONDE se perdeu, e não POR QUÊ. Quando
-- alguém passar a registrar motivo, a dimensão entra sem mudar a assinatura.
CREATE OR REPLACE FUNCTION public.oraculo_perdas(
  p_organization_id uuid,
  p_team_member_id  uuid,
  p_periodo_dias    integer,
  p_limite          integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH periodo AS (
    SELECT now() - make_interval(days => greatest(1, least(coalesce(p_periodo_dias, 30), 365))) AS desde
  ),
  perdidas AS (
    SELECT se.id, se.sale_value, se.sale_responsible_id, se.sold_at
    FROM public.sale_events se, periodo p
    WHERE se.organization_id = p_organization_id
      AND se.event_type = 'sale_lost'
      AND se.sold_at >= p.desde
      AND (
        p_team_member_id IS NULL
        OR se.sale_responsible_id     = p_team_member_id
        OR se.pre_sale_responsible_id = p_team_member_id
      )
  )
  SELECT jsonb_build_object(
    'escopo',        CASE WHEN p_team_member_id IS NULL THEN 'organizacao' ELSE 'pessoa' END,
    'periodo_dias',  greatest(1, least(coalesce(p_periodo_dias, 30), 365)),
    'perdas',        (SELECT count(*) FROM perdidas),
    'valor_perdido', (SELECT coalesce(sum(sale_value), 0) FROM perdidas),
    -- O motivo não é omitido em silêncio: o Oráculo precisa saber que a
    -- dimensão não existe, senão o modelo preenche o buraco sozinho.
    'motivo_disponivel', false,
    'motivo_observacao',
      'Motivo de perda não é registrado nesta base: nenhum dos negócios perdidos tem motivo preenchido. Responda quanto e onde se perdeu, e diga que o porquê não está registrado.',
    'por_pessoa', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.perdas DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'pessoa', tm.name,
          'perdas', count(*),
          'valor',  coalesce(sum(pd.sale_value), 0)
        ) AS x, count(*) AS perdas
        FROM perdidas pd
        JOIN public.team_members tm ON tm.id = pd.sale_responsible_id
        GROUP BY tm.name
        ORDER BY count(*) DESC
        LIMIT greatest(1, least(coalesce(p_limite, 20), 50))
      ) x
    )
  );
$$;

COMMENT ON FUNCTION public.oraculo_perdas(uuid, uuid, integer, integer) IS
  'Ferramenta `perdas` do Oráculo. Responde quanto e onde se perdeu, NÃO por quê: motivo de perda não é registrado em produção (medido 01/09/2026 — zero preenchidos em deals, pipe_propostas e metadata). `motivo_disponivel: false` avisa o modelo em vez de deixá-lo preencher o buraco. EXECUTE exclusivo de service_role.';

REVOKE ALL ON FUNCTION public.oraculo_perdas(uuid, uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oraculo_perdas(uuid, uuid, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.oraculo_perdas(uuid, uuid, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_perdas(uuid, uuid, integer, integer) TO service_role;

-- ── 4. leads ──────────────────────────────────────────────────────────────
-- Listas recortadas. DOIS recortes, e não os três do ticket: "sem próximo
-- passo" sairia de `follow_ups` sem conclusão, e há 574 follow-ups abertos
-- para 57.834 leads — devolveria quase a base inteira, o que não é recorte.
CREATE OR REPLACE FUNCTION public.oraculo_leads(
  p_organization_id uuid,
  p_team_member_id  uuid,
  p_recorte         text,
  p_dias            integer,
  p_limite          integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH corte AS (
    SELECT
      CASE WHEN coalesce(p_recorte, 'parados') IN ('parados', 'sem_contato')
           THEN coalesce(p_recorte, 'parados') ELSE 'parados' END AS recorte,
      greatest(1, least(coalesce(p_dias, 14), 365))  AS dias,
      greatest(1, least(coalesce(p_limite, 20), 50)) AS limite
  ),
  candidatos AS (
    SELECT l.id, l.name, l.company, l.updated_at
    FROM public.leads l, corte c
    WHERE l.organization_id = p_organization_id
      AND l.deleted_at IS NULL
      AND coalesce(l.is_shadow, false) = false
      AND (
        p_team_member_id IS NULL
        OR l.responsible_id = p_team_member_id
        OR l.sdr_id         = p_team_member_id
        OR l.closer_id      = p_team_member_id
      )
      AND (
        (c.recorte = 'parados'
          AND l.updated_at < now() - make_interval(days => c.dias)
          AND EXISTS (SELECT 1 FROM public.pipeline_entries pe
                      WHERE pe.lead_id = l.id AND pe.closed_at IS NULL))
        OR
        -- "Sem contato" = nunca saiu da etapa em que entrou. É o sinal mais
        -- barato e o único que não depende de varrer 2,68M de mensagens.
        (c.recorte = 'sem_contato'
          AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe
                          WHERE pe.lead_id = l.id AND pe.stage_changed_at IS NOT NULL))
      )
  )
  SELECT jsonb_build_object(
    'escopo',       CASE WHEN p_team_member_id IS NULL THEN 'organizacao' ELSE 'pessoa' END,
    'recorte',      (SELECT recorte FROM corte),
    'dias',         (SELECT dias FROM corte),
    'total',        (SELECT count(*) FROM candidatos),
    'leads', (
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'nome',           name,
          'empresa',        company,
          'parado_desde',   updated_at
        ) AS x
        FROM candidatos
        ORDER BY updated_at ASC
        LIMIT (SELECT limite FROM corte)
      ) x
    )
  );
$$;

COMMENT ON FUNCTION public.oraculo_leads(uuid, uuid, text, integer, integer) IS
  'Ferramenta `leads` do Oráculo. Dois recortes (parados, sem_contato); recorte desconhecido cai no padrão em vez de virar consulta livre. "Sem próximo passo" ficou de fora: 574 follow-ups abertos para 57.834 leads devolveria quase a base. EXECUTE exclusivo de service_role.';

REVOKE ALL ON FUNCTION public.oraculo_leads(uuid, uuid, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oraculo_leads(uuid, uuid, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.oraculo_leads(uuid, uuid, text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_leads(uuid, uuid, text, integer, integer) TO service_role;
