-- Trigger de workflow `deal_created` — dispara automações quando um negócio
-- (`public.deals`) é criado.
--
-- Contrato:
--   * lead do workflow = `deals.source_lead_id` (nullable → execução sem lead;
--     o filtro `require_lead` do trigger_config barra esse caso por padrão,
--     validado em `_shared/workflow-trigger.ts::matchesTriggerConfig`).
--   * o contexto carrega o negócio (`deal_id`/`negocio_*`) para os nós seguintes.
--   * negócio criado pelo próprio nó `create_deal` grava
--     `metadata.workflow_execution_id`; propagamos como parent execution para
--     que o guard de chain_depth (máx. 5) corte o laço
--     create_deal → deal_created → create_deal.

CREATE OR REPLACE FUNCTION public.trigger_workflow_deal_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_execution_id uuid;
BEGIN
  -- Negócio já nascido excluído (import/backfill) não dispara automação.
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
      -- aliases pt-BR consumidos por resolveVariables nos templates dos nós
      'negocio_id', NEW.id,
      'negocio_titulo', NEW.title,
      'negocio_valor', COALESCE(NEW.value, 0)
    ),
    v_parent_execution_id
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_workflow_deal_created() IS
  'Dispara workflows com trigger_type = deal_created quando um negócio é criado. Lead = deals.source_lead_id.';

DROP TRIGGER IF EXISTS trg_workflow_deal_created ON public.deals;

CREATE TRIGGER trg_workflow_deal_created
  AFTER INSERT ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_deal_created();
