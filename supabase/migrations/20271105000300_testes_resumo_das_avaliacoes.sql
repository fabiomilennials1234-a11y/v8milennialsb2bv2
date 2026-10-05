-- Testes (Área Dev): a nota do avaliador automático por copilot (regra TE-5).
--
-- `evaluate-agent-conversation` já dá nota a cada turno dos copilots e grava
-- em `copilot_conversation_evaluations` — nenhuma tela mostrava. Uma linha por
-- turno avaliado: agregar no front estouraria o teto de 1.000 linhas do
-- PostgREST em poucos dias de uso. A agregação mora aqui.
--
-- `previous_*` é a mesma janela imediatamente anterior: a tela mostra se o
-- copilot melhorou ou piorou, não só onde está.
BEGIN;

CREATE OR REPLACE FUNCTION public.master_copilot_eval_summary(p_days integer DEFAULT 30)
RETURNS TABLE (
  agent_id              uuid,
  agent_name            text,
  organization_id       uuid,
  org_name              text,
  evaluations           integer,
  below_6               integer,
  avg_overall           numeric,
  avg_relevance         numeric,
  avg_tone              numeric,
  avg_goal_align        numeric,
  avg_conciseness       numeric,
  previous_evaluations  integer,
  previous_avg_overall  numeric,
  last_evaluated_at     timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 180);
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH janela AS (
    SELECT e.*,
           e.evaluated_at >= now() - make_interval(days => v_days) AS atual
      FROM public.copilot_conversation_evaluations e
     WHERE e.evaluated_at >= now() - make_interval(days => v_days * 2)
       AND e.agent_id IS NOT NULL
  )
  SELECT j.agent_id,
         a.name,
         j.organization_id,
         o.name,
         (count(*) FILTER (WHERE j.atual))::int,
         (count(*) FILTER (WHERE j.atual AND j.score_overall < 6))::int,
         round(avg(j.score_overall)     FILTER (WHERE j.atual), 2),
         round(avg(j.score_relevance)   FILTER (WHERE j.atual), 2),
         round(avg(j.score_tone)        FILTER (WHERE j.atual), 2),
         round(avg(j.score_goal_align)  FILTER (WHERE j.atual), 2),
         round(avg(j.score_conciseness) FILTER (WHERE j.atual), 2),
         (count(*) FILTER (WHERE NOT j.atual))::int,
         round(avg(j.score_overall)     FILTER (WHERE NOT j.atual), 2),
         max(j.evaluated_at)
    FROM janela j
    LEFT JOIN public.copilot_agents a ON a.id = j.agent_id
    LEFT JOIN public.organizations o ON o.id = j.organization_id
   GROUP BY j.agent_id, a.name, j.organization_id, o.name
  HAVING count(*) FILTER (WHERE j.atual) > 0
   ORDER BY 7 ASC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.master_copilot_eval_summary(integer) IS
  'Area Dev > Testes: nota media do avaliador automatico por copilot na janela (dias) e na janela anterior. So master.';

REVOKE ALL ON FUNCTION public.master_copilot_eval_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_copilot_eval_summary(integer) TO authenticated;

COMMIT;
