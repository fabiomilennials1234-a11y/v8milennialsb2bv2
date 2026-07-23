-- Fix: pipe_proposta_items RLS policies joined leads.id instead of pipeline_entries.id
-- pipe_proposta_id references pipeline_entries, not leads

DROP POLICY IF EXISTS pipe_proposta_items_all_org ON pipe_proposta_items;
DROP POLICY IF EXISTS pipe_proposta_items_select_org ON pipe_proposta_items;

CREATE POLICY pipe_proposta_items_all_org ON pipe_proposta_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM pipeline_entries pe
      WHERE pe.id = pipe_proposta_items.pipe_proposta_id
        AND pe.organization_id IN (SELECT get_my_organization_ids())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM pipeline_entries pe
      WHERE pe.id = pipe_proposta_items.pipe_proposta_id
        AND pe.organization_id IN (SELECT get_my_organization_ids())
    )
  );

CREATE POLICY pipe_proposta_items_select_org ON pipe_proposta_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM pipeline_entries pe
      WHERE pe.id = pipe_proposta_items.pipe_proposta_id
        AND pe.organization_id IN (SELECT get_my_organization_ids())
    )
  );
