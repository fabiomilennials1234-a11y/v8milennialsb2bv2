-- Captured production stage mirror/history functions, 2026-10-23.
CREATE OR REPLACE FUNCTION public.pipeline_entries_stage_mirror()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- Espelho stage_id ↔ stage_key (SCRUM-617, D3). Só muta NEW — zero DML, logo
-- zero reentrância; guarda de pg_trigger_depth seria ERRADA aqui (as escritas
-- via INSTEAD OF das pipe_* e via sync de custom_pipe_entries chegam com
-- depth >= 1 e precisam ser espelhadas). Ver D-e no cabeçalho da migration.
DECLARE
  v_stage public.pipeline_stages%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage_id IS NOT NULL THEN
      -- stage_id é o canônico: valida e espelha a key (permite INSERT sem stage_key).
      SELECT * INTO v_stage FROM public.pipeline_stages WHERE id = NEW.stage_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'pipeline_entries: stage_id % não existe em pipeline_stages', NEW.stage_id;
      END IF;
      IF v_stage.pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
        RAISE EXCEPTION 'pipeline_entries: etapa % pertence ao funil %, não ao funil % do card',
          NEW.stage_id, v_stage.pipeline_id, NEW.pipeline_id;
      END IF;
      NEW.stage_key := v_stage.stage_key;
    ELSE
      -- Escritores legados: resolve pela key; miss → NULL (fantasma tolerado, D-a).
      SELECT ps.id INTO NEW.stage_id
      FROM public.pipeline_stages ps
      WHERE ps.pipeline_id = NEW.pipeline_id
        AND ps.stage_key   = NEW.stage_key;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id AND NEW.stage_id IS NOT NULL THEN
    -- Mudou o UUID (canônico, D-d — vence mesmo se stage_key mudou junto).
    SELECT * INTO v_stage FROM public.pipeline_stages WHERE id = NEW.stage_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pipeline_entries: stage_id % não existe em pipeline_stages', NEW.stage_id;
    END IF;
    IF v_stage.pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
      RAISE EXCEPTION 'pipeline_entries: etapa % pertence ao funil %, não ao funil % do card',
        NEW.stage_id, v_stage.pipeline_id, NEW.pipeline_id;
    END IF;
    NEW.stage_key := v_stage.stage_key;
  ELSIF NEW.stage_key    IS DISTINCT FROM OLD.stage_key
     OR NEW.pipeline_id  IS DISTINCT FROM OLD.pipeline_id
     OR (NEW.stage_id IS NULL AND OLD.stage_id IS NULL) THEN
    -- Mudou a key (ou o funil), ou o card é fantasma (stage_id NULL) sendo
    -- reescrito — re-resolve (cura oportunista quando a etapa passa a existir).
    -- No SET NULL da FK (etapa deletada) a resolução falha e o NULL fica,
    -- com stage_key preservado (D-b).
    SELECT ps.id INTO NEW.stage_id
    FROM public.pipeline_stages ps
    WHERE ps.pipeline_id = NEW.pipeline_id
      AND ps.stage_key   = NEW.stage_key;
    IF NOT FOUND THEN
      NEW.stage_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_log_pipeline_stage_change_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug       text;
  v_type       text;
  v_pipe_name  text;
  v_stage_name text;
BEGIN
  IF NEW.stage_key IS NOT DISTINCT FROM OLD.stage_key THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT slug, type, name INTO v_slug, v_type, v_pipe_name
  FROM pipelines WHERE id = NEW.pipeline_id;

  IF v_type = 'custom' THEN
    SELECT name INTO v_stage_name FROM pipeline_stages
     WHERE pipeline_id = NEW.pipeline_id AND stage_key = NEW.stage_key LIMIT 1;
  ELSE
    SELECT name INTO v_stage_name FROM pipeline_stages
     WHERE organization_id = NEW.organization_id
       AND pipeline_type = v_slug AND stage_key = NEW.stage_key LIMIT 1;
  END IF;

  INSERT INTO lead_history (
    lead_id, organization_id, action, description, source, created_by,
    metadata, entity_type, entity_id
  ) VALUES (
    NEW.lead_id,
    NEW.organization_id,
    'stage_changed',
    'Etapa alterada para "' || COALESCE(v_stage_name, NEW.stage_key)
      || '" no funil ' || COALESCE(v_pipe_name, COALESCE(v_slug, 'pipeline')) || ' (automação)',
    'automation',
    NULL,
    jsonb_build_object(
      'pipeline_id', NEW.pipeline_id,
      'pipe_slug', v_slug,
      'to_stage', NEW.stage_key,
      'from_stage', OLD.stage_key,
      'via', 'pipeline_entries_trigger'
    ),
    'lead',
    NEW.lead_id
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;
