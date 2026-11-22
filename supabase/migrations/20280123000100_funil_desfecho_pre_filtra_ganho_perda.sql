-- ════════════════════════════════════════════════════════════════════════════
-- Funil: get_funil_desfecho_por_mes pré-filtra ganho/perda antes do JOIN
-- ════════════════════════════════════════════════════════════════════════════
--
-- SINTOMA (prod, 21/11/2026): admin da org 38f3, funil sem nenhum ganho/perda:
-- 153 ms, 28,8 k buffers, 0 linhas. A CTE `card` junta TODAS as entries do
-- funil com leads (RLS por linha) e só no fim filtra `desfecho IN ('won','lost')`.
--
-- CORREÇÃO: mesma função, mesma assinatura, mesmo retorno; uma conjunção a mais
-- no WHERE da CTE `card`: `pe.deal_id IS NOT NULL OR pe.stage_key IN (etapas
-- won/lost do funil)`. É condição NECESSÁRIA do desfecho won/lost:
--   desfecho = d.outcome        quando o negócio existe (exige pe.deal_id);
--            = ps.stage_role    caso contrário (exige etapa won/lost).
-- Card com deal_id apontando para negócio apagado cai no papel da etapa e
-- continua coberto (deal_id não é nulo). Saída idêntica; prova em
-- supabase/tests/desfecho_pre_filtro_test.sql (md5 antes == depois).
--
-- BASE: corpo VIVO de prod (md5 do prosrc c0f48d0f4cf455bd5f6f2e638ac62ce7,
-- 21/11/2026 = repo 20271210000000). Pré-voo abaixo recusa outra base.
-- Mesma assinatura ⇒ CREATE OR REPLACE preserva a ACL; reafirmada no fim.
--
-- Rollback: supabase/migrations/rollback/20280123000100_funil_desfecho_pre_filtra_ganho_perda.sql

DO $preflight$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.get_funil_desfecho_por_mes(uuid,uuid,text)');
  IF v_md5 IS DISTINCT FROM 'c0f48d0f4cf455bd5f6f2e638ac62ce7' THEN
    RAISE EXCEPTION 'pré-voo: get_funil_desfecho_por_mes diverge da base revisada (md5 %), abortado', v_md5;
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.get_funil_desfecho_por_mes(p_pipeline_id uuid, p_org_id uuid, p_tz text DEFAULT 'America/Sao_Paulo'::text)
 RETURNS TABLE(stage_key text, outcome text, month_key text, cnt bigint, total numeric)
 LANGUAGE plpgsql
 STABLE
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
      -- Pré-filtro (20280123000100): só pode ter desfecho won/lost o card com
      -- negócio (o desfecho é o do deal) ou numa etapa won/lost (o desfecho é
      -- o papel da etapa). Superconjunto exato do `desfecho IN ('won','lost')`
      -- abaixo, avaliado ANTES do JOIN com leads — a RLS por linha de leads
      -- deixa de rodar para todo card em etapa aberta sem negócio.
      AND (pe.deal_id IS NOT NULL
           OR pe.stage_key IN (
                SELECT ps2.stage_key FROM public.pipeline_stages ps2
                 WHERE ps2.pipeline_id = v_pipeline_id
                   AND ps2.stage_role::text IN ('won', 'lost')))
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

REVOKE ALL ON FUNCTION public.get_funil_desfecho_por_mes(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_funil_desfecho_por_mes(uuid, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
