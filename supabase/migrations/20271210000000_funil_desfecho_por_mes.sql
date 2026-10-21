-- Chamado 172ef046 — a pilha de Ganhos/Perdidos da coluna conta a ETAPA, não a
-- página. ADITIVA: só cria uma função; nada existente muda.
--
-- ── O defeito ────────────────────────────────────────────────────────────
-- No board do funil (/funil/:slug), cada coluna empilha os negócios ganhos e
-- perdidos num grupo por desfecho, subdividido por mês (#2206). O grupo era
-- calculado no NAVEGADOR sobre os cards carregados — 20 por página, ordenados
-- por created_at — e, com a pilha fechada, a coluna não pagina sozinha. Café
-- Jurerê, funil Envase, coluna Vendido (20/10/2026): a pilha dizia "20+" e
-- R$ 105.583,14, e setembro "8"; a etapa tinha 104 ganhos, R$ 527.708,92, e
-- setembro 69.
--
-- ── O conserto ───────────────────────────────────────────────────────────
-- `get_funil_desfecho_por_mes` devolve, por (etapa, desfecho, mês), quantos
-- negócios encerrados a etapa tem e quanto somam. O front
-- (`useFunilDesfechoPorMes` + `closed-outcome-groups`) usa os NÚMEROS daqui e
-- os CARDS da paginação. RPC ausente ou com erro = o front volta ao modo
-- parcial ("+", "≥"); por isso a migration pode subir antes ou depois do front.
--
-- ── Espelho do card — cada regra tem um dono no front ────────────────────
--   desfecho: `deals.outcome` quando o card tem negócio visível; sem negócio,
--             o papel da etapa (`pipeline_stages.stage_role` won/lost)
--             — `cardOutcome`, funil-card-outcome.ts.
--   data:     `deals.outcome_at`, senão stage_changed_at › entered_at ›
--             created_at — `cardClosedAt`, funil-card-outcome.ts.
--   mês:      a data no fuso do NAVEGADOR (`p_tz`), `YYYY-MM`; sem data,
--             'sem-data' — `monthKeyOf`/`UNDATED_MONTH_KEY`,
--             closed-outcome-groups.ts.
--   valor:    `deals.value`, senão `metadata.sale_value` numérico; negativo
--             ou ilegível não soma — `projectSaleValue`, funil-card-value.ts.
--   linhas:   as MESMAS que `get_pipeline_page` pagina, sem os filtros
--             opcionais: o WHERE base e as junções da definição vigente em
--             prod (md5 do prosrc 996f958ef0b5ace51b2641c732ab5824, 20/10/2026,
--             idêntico ao corpo de 20271124000000_lead_owners_filtro_qualquer_dono.sql).
--   As chaves `deal_outcome`/`deal_outcome_at` do metadata são PROJEÇÃO do
--   `get_pipeline_page` na saída, não dado gravado (0 entradas em prod as têm
--   no metadata cru, 20/10/2026) — por isso não são lidas aqui.
--
-- ── Por que SECURITY INVOKER (a irmã get_funil_desfecho_counts é DEFINER) ──
-- O cabeçalho soma a org inteira; a COLUNA não. `get_pipeline_page` (os
-- cards) e `get_pipeline_stage_counts_by_id` (o número da coluna) são ambas
-- INVOKER em prod (prosecdef = false, 20/10/2026): a coluna mostra só o que a
-- RLS deixa o usuário ver — member sem `leads.view_all` vê os próprios leads,
-- e o regime de dono estrito tem policies RESTRICTIVE em leads,
-- pipeline_entries e deals. Uma pilha DEFINER mostraria à vendedora quantos e
-- quanto venderam os leads que ela não enxerga — vazamento de valor, e um
-- número que não bate com a coluna logo acima. INVOKER: a RLS decide, igual à
-- coluna. `assert_org_access` continua no começo: recusa cedo, com o mesmo
-- erro das irmãs, quem nem é da org — e é o único portão para o service_role,
-- que tem BYPASSRLS.
--
-- ── Não é receita ────────────────────────────────────────────────────────
-- A soma é a dos valores que os CARDS mostram — o mesmo número que o navegador
-- já somava, agora sobre a etapa inteira. Receita (líquida de estornos)
-- continua vindo do caderno `sale_events`, no cabeçalho e nas métricas.

CREATE OR REPLACE FUNCTION public.get_funil_desfecho_por_mes(
  p_pipeline_id uuid,
  p_org_id uuid,
  p_tz text DEFAULT 'America/Sao_Paulo'
)
RETURNS TABLE(stage_key text, outcome text, month_key text, cnt bigint, total numeric)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline_id uuid;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  -- Fuso: nome IANA (Região/Cidade) ou UTC — o que `Intl.DateTimeFormat`
  -- devolve. Abreviação ('BRT') e especificação POSIX ('UTC+3', sinal
  -- invertido) o AT TIME ZONE aceitaria com outra regra: ficam fora pelo
  -- formato. Nome com formato certo e inexistente cai no próprio AT TIME ZONE,
  -- que também levanta 22023 ("time zone ... not recognized").
  -- Não é `pg_timezone_names`: aquela view varre o diretório de fusos a cada
  -- chamada — 57 ms medidos em prod (20/10/2026), contra < 0,4 ms do AT TIME
  -- ZONE, que usa o cache de fusos do servidor. Esta RPC roda a cada abertura
  -- do board e a cada move.
  IF p_tz IS NULL OR p_tz !~ '^(UTC|[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)+)$' THEN
    RAISE EXCEPTION 'fuso horario invalido: %', p_tz USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.now() AT TIME ZONE p_tz;

  IF p_pipeline_id IS NULL THEN
    RETURN;
  END IF;
  -- Mesmo resolvedor do get_pipeline_page: funil de outra org não existe aqui.
  SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
   WHERE p.organization_id = p_org_id
     AND p.id = p_pipeline_id;
  IF v_pipeline_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH card AS (
    SELECT
      pe.stage_key AS etapa,
      CASE WHEN d.id IS NOT NULL THEN d.outcome ELSE ps.stage_role::text END AS desfecho,
      COALESCE(d.outcome_at, pe.stage_changed_at, pe.entered_at, pe.created_at) AS fechado_em,
      COALESCE(
        d.value,
        -- Cast seguro: só número JSON, ou texto que é número sem expoente.
        -- Qualquer outra coisa é NULL (não soma), nunca erro de cast.
        CASE jsonb_typeof(pe.metadata -> 'sale_value')
          WHEN 'number' THEN (pe.metadata ->> 'sale_value')::numeric
          WHEN 'string' THEN
            CASE WHEN (pe.metadata ->> 'sale_value')
                      ~ '^[[:space:]]*[+]?([0-9]{1,30}([.][0-9]{0,30})?|[.][0-9]{1,30})[[:space:]]*$'
                 THEN btrim(pe.metadata ->> 'sale_value')::numeric
            END
        END
      ) AS valor
    -- WHERE base e junções de get_pipeline_page (vigente em prod), sem os
    -- filtros opcionais. O JOIN em leads é deliberado: sob a RLS do usuário,
    -- card de lead que ele não vê não aparece na coluna — nem aqui.
    FROM public.pipeline_entries pe
    JOIN public.leads l ON l.id = pe.lead_id
    LEFT JOIN public.deals d
      ON d.id = pe.deal_id
     AND d.organization_id = pe.organization_id
     AND d.deleted_at IS NULL
    LEFT JOIN public.pipeline_stages ps
      ON ps.pipeline_id = pe.pipeline_id
     AND ps.stage_key = pe.stage_key
    WHERE pe.pipeline_id = v_pipeline_id
      AND pe.organization_id = p_org_id
      AND pe.lead_id IS NOT NULL
  )
  SELECT
    c.etapa,
    c.desfecho,
    COALESCE(to_char(c.fechado_em AT TIME ZONE p_tz, 'YYYY-MM'), 'sem-data'),
    count(*)::bigint,
    sum(CASE WHEN c.valor >= 0 THEN c.valor END)
  FROM card c
  WHERE c.desfecho IN ('won', 'lost')
  GROUP BY 1, 2, 3;
END;
$function$;

COMMENT ON FUNCTION public.get_funil_desfecho_por_mes(uuid, uuid, text) IS
  'Negocios encerrados de cada etapa de um funil por (etapa, desfecho, mes no fuso p_tz): quantos e quanto somam. Numeros da pilha de Ganhos/Perdidos da coluna do board (Chamado 172ef046). SECURITY INVOKER de proposito: a RLS do usuario decide, igual a get_pipeline_page e get_pipeline_stage_counts_by_id.';

REVOKE ALL ON FUNCTION public.get_funil_desfecho_por_mes(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_funil_desfecho_por_mes(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_funil_desfecho_por_mes(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_funil_desfecho_por_mes(uuid, uuid, text) TO service_role;

-- ── Guardas ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_secdef   boolean;
  v_volatile "char";
  v_config   text[];
  v_org      uuid;
  v_pipe     uuid;
  v_rpc_n    bigint;
  v_dir_n    bigint;
  v_diff     bigint;
  v_ruins    bigint;
BEGIN
  -- ── Estrutura: vale em qualquer banco ──────────────────────────────────
  SELECT p.prosecdef, p.provolatile, p.proconfig
    INTO v_secdef, v_volatile, v_config
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_funil_desfecho_por_mes(uuid,uuid,text)'::regprocedure;
  IF v_secdef THEN
    RAISE EXCEPTION 'get_funil_desfecho_por_mes virou SECURITY DEFINER: a pilha mostraria o que a RLS esconde da coluna';
  END IF;
  IF v_volatile <> 's' OR v_config IS NULL OR NOT ('search_path=public' = ANY (v_config)) THEN
    RAISE EXCEPTION 'get_funil_desfecho_por_mes sem STABLE ou sem search_path fixo (%)', v_config;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     AND has_function_privilege('anon', 'public.get_funil_desfecho_por_mes(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon executa get_funil_desfecho_por_mes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     AND NOT has_function_privilege('authenticated', 'public.get_funil_desfecho_por_mes(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated nao executa get_funil_desfecho_por_mes';
  END IF;

  -- `assert_org_access` deixa passar o service_role. A migration roda como
  -- postgres (BYPASSRLS): a RLS não recorta nada aqui, então a RPC e o
  -- agregado direto veem as mesmas linhas e a comparação abaixo é exata.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

  -- Fuso inexistente e fuso fora do formato IANA: 22023, nunca resultado.
  BEGIN
    PERFORM 1 FROM public.get_funil_desfecho_por_mes(
      '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'Marte/Olimpo');
    RAISE EXCEPTION 'get_funil_desfecho_por_mes aceitou fuso inexistente';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.get_funil_desfecho_por_mes(
      '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'BRT');
    RAISE EXCEPTION 'get_funil_desfecho_por_mes aceitou abreviacao de fuso';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  -- ── Sonda com dado real ────────────────────────────────────────────────
  SELECT pe.organization_id, pe.pipeline_id INTO v_org, v_pipe
    FROM public.pipeline_entries pe
    JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.organization_id = pe.organization_id
    JOIN public.leads l ON l.id = pe.lead_id
    JOIN public.deals d
      ON d.id = pe.deal_id AND d.organization_id = pe.organization_id AND d.deleted_at IS NULL
   WHERE d.outcome IN ('won', 'lost')
   LIMIT 1;
  -- Banco vazio não tem o que exercitar (ver a nota em 20270916000020). As
  -- verificações estruturais acima já rodaram e valem em qualquer banco.
  IF v_pipe IS NULL THEN
    RAISE NOTICE 'sem negocio encerrado em funil nenhum — sonda de get_funil_desfecho_por_mes pulada (banco novo?)';
    PERFORM set_config('request.jwt.claims', NULL, true);
    RETURN;
  END IF;

  -- Agregado direto, escrito por outro caminho (COALESCE no desfecho, FILTER
  -- na soma), comparado linha a linha com a RPC nos dois sentidos.
  WITH rpc AS (
    SELECT r.stage_key, r.outcome, r.month_key, r.cnt, r.total
      FROM public.get_funil_desfecho_por_mes(v_pipe, v_org, 'America/Sao_Paulo') r
  ), base AS (
    SELECT pe.stage_key AS etapa,
           COALESCE(d.outcome, ps.stage_role::text) AS desfecho,
           COALESCE(d.outcome_at, pe.stage_changed_at, pe.entered_at, pe.created_at) AS quando,
           COALESCE(d.value,
             CASE WHEN jsonb_typeof(pe.metadata -> 'sale_value') = 'number'
                  THEN (pe.metadata ->> 'sale_value')::numeric
                  WHEN jsonb_typeof(pe.metadata -> 'sale_value') = 'string'
                   AND (pe.metadata ->> 'sale_value')
                       ~ '^[[:space:]]*[+]?([0-9]{1,30}([.][0-9]{0,30})?|[.][0-9]{1,30})[[:space:]]*$'
                  THEN btrim(pe.metadata ->> 'sale_value')::numeric
             END) AS valor
      FROM public.pipeline_entries pe
      JOIN public.leads l ON l.id = pe.lead_id
      LEFT JOIN public.deals d
        ON d.id = pe.deal_id AND d.organization_id = pe.organization_id AND d.deleted_at IS NULL
      LEFT JOIN public.pipeline_stages ps
        ON ps.pipeline_id = pe.pipeline_id AND ps.stage_key = pe.stage_key
     WHERE pe.pipeline_id = v_pipe
       AND pe.organization_id = v_org
  ), direto AS (
    SELECT b.etapa AS stage_key,
           b.desfecho AS outcome,
           COALESCE(to_char(b.quando AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM'), 'sem-data') AS month_key,
           count(*)::bigint AS cnt,
           sum(b.valor) FILTER (WHERE b.valor >= 0) AS total
      FROM base b
     WHERE b.desfecho IN ('won', 'lost')
     GROUP BY 1, 2, 3
  )
  SELECT (SELECT count(*) FROM (SELECT * FROM rpc EXCEPT SELECT * FROM direto) a)
       + (SELECT count(*) FROM (SELECT * FROM direto EXCEPT SELECT * FROM rpc) b),
         (SELECT COALESCE(sum(rpc.cnt), 0) FROM rpc),
         (SELECT COALESCE(sum(direto.cnt), 0) FROM direto),
         (SELECT count(*) FROM rpc
           WHERE rpc.stage_key IS NULL OR rpc.month_key IS NULL OR rpc.outcome NOT IN ('won', 'lost'))
    INTO v_diff, v_rpc_n, v_dir_n, v_ruins;

  IF v_diff <> 0 OR v_rpc_n <> v_dir_n THEN
    RAISE EXCEPTION 'get_funil_desfecho_por_mes diverge do agregado direto no funil % (rpc: % negocios, direto: %; % linha(s) diferentes)',
      v_pipe, v_rpc_n, v_dir_n, v_diff;
  END IF;
  IF v_rpc_n = 0 THEN
    RAISE EXCEPTION 'get_funil_desfecho_por_mes nao contou nada num funil com negocio encerrado (%)', v_pipe;
  END IF;
  IF v_ruins > 0 THEN
    RAISE EXCEPTION 'get_funil_desfecho_por_mes devolveu % linha(s) sem etapa, sem mes ou com desfecho fora de won/lost', v_ruins;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;
