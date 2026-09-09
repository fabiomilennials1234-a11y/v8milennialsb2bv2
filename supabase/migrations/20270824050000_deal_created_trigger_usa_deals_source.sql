-- `deals.source` virou a procedência canônica (CHECK deals_source_check +
-- trigger fn_deals_exige_procedencia, ambos posteriores ao trigger deal_created).
-- O contexto do workflow passa a carregar `deal_source` e a derivar
-- `created_by_workflow` dela, em vez de `metadata->>created_by`.
--
-- Pego pelo smoke em prod: o node create_deal falhava com
-- "Procedência é obrigatória ao abrir um Negócio".

CREATE OR REPLACE FUNCTION public.trigger_workflow_deal_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_execution_id uuid;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_parent_execution_id := NULLIF(NEW.metadata->>'workflow_execution_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_parent_execution_id := NULL;
  END;

  PERFORM public.fire_workflow_trigger(
    NEW.organization_id,
    'deal_created',
    NEW.source_lead_id,
    jsonb_build_object(
      'trigger', 'deal_created',
      'lead_id', NEW.source_lead_id,
      'deal_id', NEW.id,
      'deal_title', NEW.title,
      'deal_value', COALESCE(NEW.value, 0),
      'owner_id', NEW.owner_id,
      'deal_source', NEW.source,
      'created_by_workflow', (NEW.source = 'workflow'),
      'negocio_id', NEW.id,
      'negocio_titulo', NEW.title,
      'negocio_valor', COALESCE(NEW.value, 0)
    ),
    v_parent_execution_id
  );

  RETURN NEW;
END;
$$;
