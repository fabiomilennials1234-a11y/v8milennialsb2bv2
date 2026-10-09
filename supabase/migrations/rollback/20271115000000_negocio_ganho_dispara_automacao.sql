-- rollback/20271115000000_negocio_ganho_dispara_automacao.sql
--
-- Volta ao estado vivo em prod em 2026-10-09:
--   · sem gatilho nativo de desfecho (`trg_workflow_deal_outcome` sai);
--   · matcher sem ramo deal_won/deal_lost (= 20271016001000, ELSE TRUE);
--   · admissão HTTP de stage_changed retendo também deal_won/deal_lost
--     (= 20271021000030);
--   · Riofix: adaptador `riofix_deal_outcome_event` recriado com o corpo de
--     `pg_get_functiondef` lido de prod em 2026-10-09, e o workflow 0d60af90
--     com `trigger_config`/`data.config` de volta a `{}`.
--
-- ⚠ Rollback devolve o gatilho de desfecho ao estado "nunca dispara" para
-- todas as orgs exceto Riofix. Execuções já criadas ficam (append-only).
-- ⚠ O par do rollback no CÓDIGO é reverter `_shared/workflow-trigger.ts` e
-- `action-handlers/deal-operations.ts` + redeploy das edge functions; sem isso
-- o TS não deriva deal_* e o matcher TS reprova o que o SQL aceitaria.
-- Ordem: o gatilho nativo sai primeiro, o adaptador entra por último. É uma
-- transação só, então nenhuma outra sessão vê os dois vivos (disparo duplo)
-- nem nenhum dos dois.
--
-- Reaplicar é no-op. Seguro em ambiente sem os objetos Riofix (dev/PGlite).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1 — Sai o gatilho nativo.
DROP TRIGGER IF EXISTS trg_workflow_deal_outcome ON public.deals;
DROP FUNCTION IF EXISTS public.trigger_workflow_deal_outcome();

-- 2 — Matcher volta ao corpo de 20271016001000 (vivo em prod 2026-10-09).
CREATE OR REPLACE FUNCTION public.matches_workflow_trigger_config(
  p_trigger_type text,
  p_config jsonb,
  p_context jsonb
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_stages jsonb;
  v_to_stage text;
  v_stage_id text;
BEGIN
  CASE p_trigger_type

  WHEN 'stage_changed' THEN
    IF COALESCE(p_config->>'pipe_type', '') != ''
       AND p_config->>'pipe_type' IS DISTINCT FROM p_context->>'pipe_type'
    THEN RETURN FALSE; END IF;

    IF COALESCE(p_config->>'pipeline_id', '') != ''
       AND p_config->>'pipeline_id' IS DISTINCT FROM p_context->>'pipeline_id'
    THEN RETURN FALSE; END IF;

    IF COALESCE(p_config->>'from_stage', '') != ''
       AND p_config->>'from_stage' IS DISTINCT FROM p_context->>'from_stage'
       AND p_config->>'from_stage' IS DISTINCT FROM p_context->>'from_stage_id'
    THEN RETURN FALSE; END IF;

    v_stages := p_config->'stages';
    v_to_stage := p_context->>'to_stage';
    v_stage_id := p_context->>'stage_id';
    IF v_stages IS NOT NULL AND jsonb_typeof(v_stages) != 'array' THEN
      RETURN FALSE;
    ELSIF v_stages IS NOT NULL AND jsonb_array_length(v_stages) > 0 THEN
      IF NOT (
        (v_to_stage IS NOT NULL AND v_stages ? v_to_stage)
        OR (v_stage_id IS NOT NULL AND v_stages ? v_stage_id)
      ) THEN RETURN FALSE; END IF;
    ELSIF COALESCE(p_config->>'to_stage', '') != ''
          AND p_config->>'to_stage' IS DISTINCT FROM v_to_stage
          AND p_config->>'to_stage' IS DISTINCT FROM v_stage_id
    THEN RETURN FALSE; END IF;

    RETURN TRUE;

  WHEN 'field_changed' THEN
    IF p_config->>'field_name' IS NOT NULL AND p_config->>'field_name' != ''
       AND p_context->>'field_name' IS NOT NULL
       AND p_config->>'field_name' != p_context->>'field_name'
    THEN RETURN FALSE; END IF;
    RETURN TRUE;

  WHEN 'lead_created' THEN
    IF COALESCE(p_config->>'filter_origin', '') != '' THEN
      IF COALESCE(btrim(p_context->>'origin'), '') = ''
         OR lower(btrim(p_config->>'filter_origin')) != lower(btrim(p_context->>'origin'))
      THEN RETURN FALSE; END IF;
    END IF;

    -- Contrato canônico: UUID de pipelines para qualquer funil. Config canônica
    -- prevalece sobre o campo legado caso uma definição antiga carregue ambos.
    IF COALESCE(p_config->>'filter_pipeline_id', '') != '' THEN
      IF COALESCE(p_context->>'pipeline_id', '') = ''
         OR p_config->>'filter_pipeline_id' != p_context->>'pipeline_id'
      THEN RETURN FALSE; END IF;
    ELSIF COALESCE(p_config->>'filter_pipe', '') = ''
          AND COALESCE(p_context->>'pipeline_id', '') != '' THEN
      -- O INSERT do lead já dispara a automação genérica. A entrada no funil
      -- não deve criar uma segunda execução para o mesmo evento lógico.
      RETURN FALSE;
    END IF;

    -- Compatibilidade: pipe_whatsapp e whatsapp representam o mesmo seed.
    IF COALESCE(p_config->>'filter_pipeline_id', '') = ''
       AND COALESCE(p_config->>'filter_pipe', '') != '' THEN
      IF COALESCE(btrim(COALESCE(p_context->>'pipe', p_context->>'pipe_type')), '') = ''
         OR regexp_replace(lower(btrim(p_config->>'filter_pipe')), '^pipe_', '')
            != regexp_replace(
                 lower(btrim(COALESCE(p_context->>'pipe', p_context->>'pipe_type'))),
                 '^pipe_',
                 ''
               )
      THEN RETURN FALSE; END IF;
    END IF;

    RETURN TRUE;

  WHEN 'tag_added' THEN
    IF p_config->>'tag_name' IS NOT NULL AND p_config->>'tag_name' != ''
       AND p_context->>'tag_name' IS NOT NULL
       AND lower(p_config->>'tag_name') != lower(p_context->>'tag_name')
    THEN RETURN FALSE; END IF;
    RETURN TRUE;

  WHEN 'score_reached' THEN
    IF COALESCE((p_config->>'min_score')::int, 0) > 0
       AND COALESCE((p_context->>'score')::int, 0) < (p_config->>'min_score')::int
    THEN RETURN FALSE; END IF;
    RETURN TRUE;

  WHEN 'deal_created' THEN
    IF p_config ? 'require_lead'
       AND jsonb_typeof(p_config->'require_lead') != 'boolean'
    THEN RETURN FALSE; END IF;

    IF COALESCE((p_config->>'require_lead')::boolean, TRUE)
       AND COALESCE(p_context->>'lead_id', '') = ''
    THEN RETURN FALSE; END IF;

    IF p_config ? 'source' AND jsonb_typeof(p_config->'source') != 'string'
    THEN RETURN FALSE; END IF;

    IF COALESCE(NULLIF(p_config->>'source', ''), 'any') != 'any'
       AND p_config->>'source' IS DISTINCT FROM p_context->>'deal_source'
    THEN RETURN FALSE; END IF;

    IF p_config ? 'pipeline_ids' THEN
      IF jsonb_typeof(p_config->'pipeline_ids') != 'array' THEN
        RETURN FALSE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_config->'pipeline_ids') AS item(value)
        WHERE jsonb_typeof(item.value) != 'string'
           OR btrim(item.value #>> '{}') = ''
      ) THEN
        RETURN FALSE;
      END IF;

      IF jsonb_array_length(p_config->'pipeline_ids') > 0 THEN
        IF COALESCE(p_context->>'pipeline_id', '') = ''
           OR NOT (p_config->'pipeline_ids' ? (p_context->>'pipeline_id'))
        THEN RETURN FALSE; END IF;
      END IF;
    END IF;

    IF p_config ? 'stage_ids' THEN
      IF jsonb_typeof(p_config->'stage_ids') != 'array' THEN
        RETURN FALSE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_config->'stage_ids') AS item(value)
        WHERE jsonb_typeof(item.value) != 'string'
           OR btrim(item.value #>> '{}') = ''
      ) THEN
        RETURN FALSE;
      END IF;

      IF jsonb_array_length(p_config->'stage_ids') > 0 THEN
        IF NOT (p_config ? 'pipeline_ids')
           OR jsonb_array_length(p_config->'pipeline_ids') = 0
           OR COALESCE(p_context->>'stage_id', '') = ''
           OR NOT (p_config->'stage_ids' ? (p_context->>'stage_id'))
        THEN RETURN FALSE; END IF;
      END IF;
    END IF;

    IF p_config ? 'filter_owner_id'
       AND jsonb_typeof(p_config->'filter_owner_id') != 'string'
    THEN RETURN FALSE; END IF;

    IF COALESCE(p_config->>'filter_owner_id', '') != ''
       AND p_config->>'filter_owner_id' IS DISTINCT FROM p_context->>'owner_id'
    THEN RETURN FALSE; END IF;

    BEGIN
      IF p_config ? 'min_value' AND p_config->>'min_value' IS NOT NULL
         AND COALESCE((p_context->>'deal_value')::numeric, 0)
             < (p_config->>'min_value')::numeric
      THEN RETURN FALSE; END IF;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN FALSE;
    END;

    RETURN TRUE;

  ELSE
    RETURN TRUE;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.matches_workflow_trigger_config(text, jsonb, jsonb) IS
  'Filtra gatilhos no banco; lead_created usa pipeline_id para qualquer funil e deal_created combina funil e etapa congelados.';

-- 3 — Admissão HTTP volta a reter deal_won/deal_lost (= 20271021000030).
CREATE OR REPLACE FUNCTION public.trigger_workflow_pipeline_stage_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url TEXT;
  v_secret TEXT;
  v_pipe_type TEXT;
  v_actor_user_id UUID;
  v_actor_member_id UUID;
BEGIN
  SELECT pip.slug INTO v_pipe_type
  FROM public.pipelines pip
  WHERE pip.id = NEW.pipeline_id AND pip.type = 'system';  -- metric-lint-allow: despacho de gatilho (ver cabeçalho)

  IF v_pipe_type IS NULL THEN RETURN NEW; END IF;

  -- Admission uses the workflow configuration visible when the event happens.
  -- stage_changed also derives deal_won/deal_lost in the Edge handler; retain
  -- every event if ANY of those classes is active, regardless of stage/config.
  IF NOT EXISTS (
    SELECT 1 FROM public.workflows w
    WHERE w.organization_id = NEW.organization_id
      AND w.is_active = true
      AND w.trigger_type IN ('stage_changed', 'deal_won', 'deal_lost')
  ) THEN RETURN NEW; END IF;

  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  v_url := replace(v_url, 'campaign-rule-dispatch', 'process-workflow-executions');

  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;

  v_actor_user_id := auth.uid();
  IF v_actor_user_id IS NOT NULL THEN
    SELECT id INTO v_actor_member_id
    FROM public.team_members
    WHERE user_id = v_actor_user_id
      AND organization_id = NEW.organization_id
      AND is_active = true
    LIMIT 1;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object(
      'mode', 'fire_trigger',
      'organization_id', NEW.organization_id,
      'trigger_type', 'stage_changed',
      'lead_id', NEW.lead_id,
      -- ── CONTEXTO ÚNICO (SCRUM-627, D-1) ──
      -- Mesmo shape do gatilho custom abaixo; `pipe_type` é ECO legado (slug,
      -- só existe aqui porque este funil é de sistema) e some na W6.
      'context', jsonb_build_object(
        'trigger', 'stage_changed',
        'pipeline_id', NEW.pipeline_id,
        'pipe_type', v_pipe_type,
        'pipeline_entry_id', NEW.id,
        'deal_id', NEW.deal_id,
        'stage_id', NEW.stage_id,
        'stage_key', NEW.stage_key,
        'from_stage', OLD.stage_key,
        'from_stage_id', OLD.stage_id,
        'to_stage', NEW.stage_key,
        'changed_by_user_id', v_actor_user_id,
        'changed_by_member_id', v_actor_member_id
      )
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

-- 4 — Riofix: config de volta a {} e adaptador recriado (só onde o resto do
-- adaptador existe — prod). Corpo = pg_get_functiondef de prod, 2026-10-09.
UPDATE public.workflows w
   SET trigger_config = '{}'::jsonb,
       definition = jsonb_set(
         w.definition,
         '{nodes}',
         (SELECT COALESCE(jsonb_agg(
                   CASE WHEN n.node->>'type' = 'trigger'
                        THEN jsonb_set(n.node, '{data,config}', '{}'::jsonb, true)
                        ELSE n.node
                   END ORDER BY n.ord), '[]'::jsonb)
            FROM jsonb_array_elements(w.definition->'nodes') WITH ORDINALITY AS n(node, ord))
       )
 WHERE w.id = '0d60af90-3407-400f-8000-e0f59aa65068'
   AND w.organization_id = '36971ff5-fd73-4f30-a733-04bf8c90e5b6'
   AND w.trigger_type = 'deal_won'
   AND jsonb_typeof(w.definition->'nodes') = 'array';

DO $rollback$
BEGIN
  IF to_regprocedure('private.riofix_enqueue_workflow(uuid,uuid,uuid,uuid,jsonb,text)') IS NULL THEN
    RETURN;  -- ambiente sem o adaptador Riofix (dev/PGlite): nada a recriar.
  END IF;

  EXECUTE $def$
CREATE OR REPLACE FUNCTION private.riofix_deal_outcome_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE entry public.pipeline_entries%ROWTYPE; wf uuid; kind text;
BEGIN
  IF NEW.organization_id <> '36971ff5-fd73-4f30-a733-04bf8c90e5b6' OR NEW.deleted_at IS NOT NULL
    OR OLD.outcome IS NOT DISTINCT FROM NEW.outcome OR NEW.outcome NOT IN('won','lost') THEN RETURN NEW; END IF;
  SELECT * INTO entry FROM public.pipeline_entries WHERE organization_id=NEW.organization_id AND deal_id=NEW.id AND lead_id=NEW.source_lead_id
  ORDER BY closed_at NULLS FIRST,entered_at DESC,id LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.outcome='won' THEN
    IF entry.pipeline_id <> 'a9a2f3cb-63fe-4ca1-a453-f27002cc4944' THEN RETURN NEW; END IF;
    wf:='0d60af90-3407-400f-8000-e0f59aa65068'; kind:='deal_won';
  ELSE wf:='5ce6255d-59ed-4f22-9340-91ab688c8515'; kind:='deal_lost'; END IF;
  PERFORM private.riofix_enqueue_workflow(wf,NEW.source_lead_id,entry.id,NEW.id,
    jsonb_build_object('trigger',kind,'lead_id',NEW.source_lead_id,'pipeline_entry_id',entry.id,'pipeline_id',entry.pipeline_id,'stage_id',entry.stage_id,'deal_id',NEW.id,'negocio_id',NEW.id,'outcome',NEW.outcome),
    kind||':'||NEW.id::text||':'||COALESCE(NEW.outcome_at,NEW.updated_at,clock_timestamp())::text);
  RETURN NEW;
END $function$
$def$;

  -- ACL viva em prod: {postgres=X/postgres} — só o dono.
  EXECUTE 'REVOKE ALL ON FUNCTION private.riofix_deal_outcome_event() FROM PUBLIC, anon, authenticated, service_role';

  EXECUTE 'DROP TRIGGER IF EXISTS riofix_deal_outcome_event ON public.deals';
  EXECUTE $trg$
CREATE TRIGGER riofix_deal_outcome_event AFTER UPDATE OF outcome ON public.deals
  FOR EACH ROW
  WHEN (((new.organization_id = '36971ff5-fd73-4f30-a733-04bf8c90e5b6'::uuid) AND (old.outcome IS DISTINCT FROM new.outcome)))
  EXECUTE FUNCTION private.riofix_deal_outcome_event()
$trg$;
END $rollback$;

-- 5 — Guardas do rollback.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = 'public.deals'::regclass
                AND t.tgname = 'trg_workflow_deal_outcome') THEN
    RAISE EXCEPTION 'trg_workflow_deal_outcome sobreviveu ao rollback';
  END IF;
  IF to_regprocedure('private.riofix_enqueue_workflow(uuid,uuid,uuid,uuid,jsonb,text)') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                      WHERE t.tgrelid = 'public.deals'::regclass
                        AND t.tgname = 'riofix_deal_outcome_event') THEN
    RAISE EXCEPTION 'adaptador Riofix nao foi recriado — deal_won da Riofix pararia de disparar';
  END IF;
END $$;
