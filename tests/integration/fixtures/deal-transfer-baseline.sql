-- Minimal isolated fixture; production mover and sale capture definitions, no customer data.
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.uid',true),'')::uuid $$;
CREATE TABLE pipelines(id uuid primary key, organization_id uuid, type text, name text);
CREATE TYPE stage_role AS ENUM ('open','won','lost');
CREATE TABLE pipeline_stages(id uuid primary key,organization_id uuid,pipeline_id uuid,stage_key text,name text,stage_role stage_role);
CREATE TABLE team_members(user_id uuid, organization_id uuid, name text);
CREATE TABLE deals(id uuid primary key,outcome text,outcome_source text,outcome_at timestamptz);
CREATE TABLE pipeline_entries(id uuid primary key,organization_id uuid,lead_id uuid,pipeline_id uuid,stage_key text,assigned_to uuid,deal_id uuid,stage_changed_at timestamptz default now());
CREATE TABLE pipeline_stage_events(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,pipeline_id uuid,entry_id uuid,from_stage_key text,to_stage_key text,occurred_at timestamptz,actor uuid,source text);
CREATE FUNCTION metric_stage_role(uuid,uuid,text) RETURNS stage_role LANGUAGE sql AS $$ SELECT stage_role FROM pipeline_stages WHERE organization_id=$1 AND pipeline_id=$2 AND stage_key=$3 $$;
CREATE FUNCTION update_stage_changed_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.stage_changed_at:=clock_timestamp(); RETURN NEW; END $$;
CREATE TABLE legacy_sales(outcome text);
CREATE FUNCTION _registrar_desfecho_no_caderno(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO legacy_sales VALUES($8); END $$;
ALTER TABLE pipeline_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_entries ON pipeline_entries TO authenticated USING (organization_id = NULLIF(current_setting('test.org',true),'')::uuid) WITH CHECK (organization_id = NULLIF(current_setting('test.org',true),'')::uuid);
CREATE POLICY org_pipelines ON pipelines TO authenticated USING (organization_id = NULLIF(current_setting('test.org',true),'')::uuid);
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,UPDATE ON pipeline_entries TO authenticated;
GRANT SELECT ON pipelines,pipeline_stages TO authenticated;
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
   WHERE pe.id = p_entry_id;

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
  ELSIF v_tipo_alvo = 'custom' THEN
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages ps
                    WHERE ps.pipeline_id = p_target_pipeline_id
                      AND ps.stage_key = v_stage_key) THEN
      RAISE EXCEPTION 'Etapa "%" não existe no funil %.', p_target_stage_key, p_target_pipeline_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

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
REVOKE ALL ON FUNCTION mover_negocio(uuid,uuid,text,text,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION mover_negocio(uuid,uuid,text,text,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.fn_capture_sale_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_from_role public.stage_role; v_to_role public.stage_role;
  v_deal_id uuid; v_outcome_atual text; v_novo text;
BEGIN
  v_from_role := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.from_stage_key);
  v_to_role   := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.to_stage_key);

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
CREATE FUNCTION fn_capture_pipeline_stage_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN INSERT INTO pipeline_stage_events(organization_id,lead_id,pipeline_id,entry_id,from_stage_key,to_stage_key,occurred_at,actor,source) VALUES(NEW.organization_id,NEW.lead_id,NEW.pipeline_id,NEW.id,CASE WHEN TG_OP='UPDATE' THEN OLD.stage_key END,NEW.stage_key,now(),auth.uid(),'trigger'); RETURN NEW; END $$;
CREATE TRIGGER trg_pipeline_entries_stage_event_insert AFTER INSERT ON pipeline_entries FOR EACH ROW EXECUTE FUNCTION fn_capture_pipeline_stage_event();
CREATE TRIGGER trg_pipeline_entries_stage_event_update AFTER UPDATE OF stage_key ON pipeline_entries FOR EACH ROW WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key) EXECUTE FUNCTION fn_capture_pipeline_stage_event();
CREATE TRIGGER capture_sale AFTER INSERT ON pipeline_stage_events FOR EACH ROW EXECUTE FUNCTION fn_capture_sale_event();
