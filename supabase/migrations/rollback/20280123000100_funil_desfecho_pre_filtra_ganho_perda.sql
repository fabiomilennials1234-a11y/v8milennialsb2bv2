-- Rollback de 20280123000100: volta ao corpo de prod (md5 c0f48d0f…), sem o pré-filtro.
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
