BEGIN;

-- Snapshots preserve the route even after funnels/stages are renamed.
ALTER TABLE public.pipeline_stage_events
  ADD COLUMN IF NOT EXISTS from_pipeline_id uuid,
  ADD COLUMN IF NOT EXISTS from_pipeline_name text,
  ADD COLUMN IF NOT EXISTS to_pipeline_name text,
  ADD COLUMN IF NOT EXISTS from_stage_name text,
  ADD COLUMN IF NOT EXISTS to_stage_name text,
  ADD COLUMN IF NOT EXISTS actor_name text;

CREATE OR REPLACE FUNCTION public.fn_capture_pipeline_stage_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from_pipe uuid;
  v_from_key text;
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.pipeline_id IS NOT DISTINCT FROM NEW.pipeline_id
       AND OLD.stage_key IS NOT DISTINCT FROM NEW.stage_key THEN RETURN NEW; END IF;
    v_from_pipe := OLD.pipeline_id;
    v_from_key := OLD.stage_key;
  END IF;
  INSERT INTO public.pipeline_stage_events
    (organization_id, lead_id, pipeline_id, entry_id, from_stage_key, to_stage_key,
     occurred_at, actor, source, from_pipeline_id, from_pipeline_name, to_pipeline_name,
     from_stage_name, to_stage_name, actor_name)
  VALUES
    (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.id, v_from_key, NEW.stage_key,
     clock_timestamp(), v_actor, CASE WHEN v_actor IS NULL THEN 'trigger' ELSE 'manual' END,
     v_from_pipe,
     (SELECT name FROM public.pipelines WHERE id = v_from_pipe AND organization_id = NEW.organization_id),
     (SELECT name FROM public.pipelines WHERE id = NEW.pipeline_id AND organization_id = NEW.organization_id),
     (SELECT name FROM public.pipeline_stages WHERE pipeline_id = v_from_pipe AND stage_key = v_from_key AND organization_id = NEW.organization_id LIMIT 1),
     (SELECT name FROM public.pipeline_stages WHERE pipeline_id = NEW.pipeline_id AND stage_key = NEW.stage_key AND organization_id = NEW.organization_id LIMIT 1),
     (SELECT name FROM public.team_members WHERE user_id = v_actor AND organization_id = NEW.organization_id LIMIT 1));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_capture_pipeline_stage_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pipeline_entries_stage_event_update ON public.pipeline_entries;
CREATE TRIGGER trg_pipeline_entries_stage_event_update
AFTER UPDATE OF stage_key, pipeline_id ON public.pipeline_entries
FOR EACH ROW WHEN ((OLD.stage_key IS DISTINCT FROM NEW.stage_key OR OLD.pipeline_id IS DISTINCT FROM NEW.pipeline_id) AND NEW.lead_id IS NOT NULL)
EXECUTE FUNCTION public.fn_capture_pipeline_stage_event();

-- Switching between equally named stage keys also starts a new stage period.
DROP TRIGGER IF EXISTS trg_pipeline_entries_stage_changed_at ON public.pipeline_entries;
CREATE TRIGGER trg_pipeline_entries_stage_changed_at BEFORE UPDATE ON public.pipeline_entries
FOR EACH ROW WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key OR OLD.pipeline_id IS DISTINCT FROM NEW.pipeline_id)
EXECUTE FUNCTION public.update_stage_changed_at();

CREATE OR REPLACE FUNCTION public.mover_negocio(
  p_entry_id           uuid,
  p_target_pipeline_id uuid,
  p_target_stage_key   text,
  p_stage_origem       text DEFAULT NULL,
  p_assigned_to        uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_org        uuid;
  v_lead       uuid;
  v_pipe_atual uuid;
  v_stage_atual text;
  v_tipo_alvo  text;
  v_org_alvo   uuid;
  v_stage_key  text;
BEGIN
  SELECT pe.organization_id, pe.lead_id, pe.pipeline_id, pe.stage_key
    INTO v_org, v_lead, v_pipe_atual, v_stage_atual
    FROM public.pipeline_entries pe
   WHERE pe.id = p_entry_id FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Negócio % não encontrado.', p_entry_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT p.type, p.organization_id INTO v_tipo_alvo, v_org_alvo
    FROM public.pipelines p WHERE p.id = p_target_pipeline_id;

  IF v_tipo_alvo IS NULL THEN
    RAISE EXCEPTION 'Funil de destino % não existe.', p_target_pipeline_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Cross-org pelo destino seria mover o negócio para fora da própria empresa. A
  -- RLS já esconderia o funil de outra org, mas mensagem própria vale mais que
  -- "não encontrado".
  IF v_org_alvo <> v_org THEN
    RAISE EXCEPTION 'Funil de destino pertence a outra organização.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_target_stage_key IS NULL OR btrim(p_target_stage_key) = '' THEN
    RAISE EXCEPTION 'Etapa de destino é obrigatória.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_stage_key := btrim(p_target_stage_key);

  -- Etapa por uuid (qualquer destino) resolve para a key; por key, destino
  -- custom valida pertencimento. Um uuid que não é etapa do destino era, na
  -- prática antiga, gravado cru em stage_key — o bug do card invisível que o
  -- reparo 2b da SCRUM-617 teve que curar. Errar alto aqui evita a recaída.
  IF v_stage_key ~ v_uuid_re THEN
    SELECT ps.stage_key INTO v_stage_key
      FROM public.pipeline_stages ps
     WHERE ps.id = v_stage_key::uuid AND ps.pipeline_id = p_target_pipeline_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Etapa "%" não existe no funil %.', p_target_stage_key, p_target_pipeline_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages ps
                    WHERE ps.pipeline_id = p_target_pipeline_id
                      AND ps.stage_key = v_stage_key) THEN
      RAISE EXCEPTION 'Etapa "%" não existe no funil %.', p_target_stage_key, p_target_pipeline_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  IF v_pipe_atual = p_target_pipeline_id AND v_stage_atual = v_stage_key THEN
    IF p_assigned_to IS NOT NULL THEN
      UPDATE public.pipeline_entries SET assigned_to = p_assigned_to
       WHERE id = p_entry_id AND assigned_to IS DISTINCT FROM p_assigned_to;
    END IF;
    RETURN p_entry_id; -- retry da transferência não passa novamente pelo ganho
  END IF;
  IF NULLIF(btrim(p_stage_origem), '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages WHERE pipeline_id = v_pipe_atual
      AND stage_key = p_stage_origem AND organization_id = v_org
  ) THEN RAISE EXCEPTION 'Etapa de origem inválida.' USING ERRCODE = '22023'; END IF;

  -- ── Passo 1: passar pela etapa de sucesso da origem ─────────────────────
  -- É o UPDATE que já acontece hoje, e é dele que saem `meeting_booked` e
  -- `meeting_held`. Pular quando o card já está lá evita evento duplicado — os
  -- gatilhos exigem `OLD.stage_key IS DISTINCT FROM NEW.stage_key`, então
  -- reescrever o mesmo valor seria inerte de qualquer forma; a guarda aqui é
  -- para não gastar um UPDATE e um round de gatilhos à toa.
  IF p_stage_origem IS NOT NULL
     AND btrim(p_stage_origem) <> ''
     AND p_stage_origem IS DISTINCT FROM v_stage_atual THEN
    UPDATE public.pipeline_entries
       SET stage_key = p_stage_origem
     WHERE id = p_entry_id;
  END IF;

  -- ── Passo 2: a troca de funil ───────────────────────────────────────────
  -- `assigned_to` só é tocado quando veio explícito: `COALESCE` cegamente
  -- apagaria o responsável do card quando o chamador não informa nada.
  -- O espelho (trg_pe_stage_mirror) re-resolve stage_id ao ver o funil mudar.
  UPDATE public.pipeline_entries
     SET pipeline_id = p_target_pipeline_id,
         stage_key   = v_stage_key,
         assigned_to = COALESCE(p_assigned_to, assigned_to)
   WHERE id = p_entry_id;

  RETURN p_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_capture_sale_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_from_role public.stage_role; v_to_role public.stage_role;
  v_deal_id uuid; v_outcome_atual text; v_novo text;
BEGIN
  v_from_role := public.metric_stage_role(NEW.organization_id, COALESCE(NEW.from_pipeline_id, NEW.pipeline_id), NEW.from_stage_key);
  v_to_role   := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.to_stage_key);

  -- A venda ganha segue para pós-venda sem estorno implícito.
  -- Mover para etapa comum DENTRO do mesmo funil ainda reabre como antes.
  IF NEW.from_pipeline_id IS NOT NULL AND NEW.from_pipeline_id <> NEW.pipeline_id
     AND v_from_role = 'won' AND v_to_role IS DISTINCT FROM 'won'
     AND v_to_role IS DISTINCT FROM 'lost' THEN
    RETURN NEW;
  END IF;

  IF v_from_role IS DISTINCT FROM 'won'
     AND v_to_role IS DISTINCT FROM 'won'
     AND v_to_role IS DISTINCT FROM 'lost' THEN
    RETURN NEW;
  END IF;

  v_novo := CASE
    WHEN v_to_role = 'won'  THEN 'won'
    WHEN v_to_role = 'lost' THEN 'lost'
    ELSE 'open'   -- saiu de ganho para etapa comum: reabre
  END;

  SELECT pe.deal_id INTO v_deal_id
    FROM public.pipeline_entries pe WHERE pe.id = NEW.entry_id;

  IF v_deal_id IS NOT NULL THEN
    -- Um escritor: mexe no desfecho e deixa o trigger de `deals` gravar. Se o
    -- negócio JÁ está neste desfecho, o UPDATE não muda nada e nenhum evento
    -- nasce — é aqui que a receita dobrada morre por construção.
    SELECT d.outcome INTO v_outcome_atual FROM public.deals d WHERE d.id = v_deal_id;
    IF v_outcome_atual IS DISTINCT FROM v_novo THEN
      UPDATE public.deals
         SET outcome = v_novo, outcome_source = 'stage', outcome_at = now()
       WHERE id = v_deal_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Card sem negócio (26,6% em prod): caminho direto, como sempre foi.
  PERFORM public._registrar_desfecho_no_caderno(
    NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.to_stage_key,
    NEW.id, NULL,
    CASE WHEN v_from_role = 'won' THEN 'won'
         WHEN v_from_role = 'lost' THEN 'lost' ELSE 'open' END,
    v_novo, NEW.actor, 'trigger');

  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF has_function_privilege('anon', 'public.mover_negocio(uuid,uuid,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not move deals';
  END IF;
END $$;
COMMIT;
