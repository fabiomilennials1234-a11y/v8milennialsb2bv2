-- Fix RLS policies for workflow tables
-- Old policies used auth.jwt() ->> 'organization_id' which doesn't exist in the JWT
-- New policies use team_members pattern consistent with the rest of the app

-- 1. workflows
DROP POLICY IF EXISTS "workflows_select" ON public.workflows;
DROP POLICY IF EXISTS "workflows_insert" ON public.workflows;
DROP POLICY IF EXISTS "workflows_update" ON public.workflows;
DROP POLICY IF EXISTS "workflows_delete" ON public.workflows;

CREATE POLICY "workflows_select" ON public.workflows
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workflows_insert" ON public.workflows
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workflows_update" ON public.workflows
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workflows_delete" ON public.workflows
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- 2. workflow_executions
DROP POLICY IF EXISTS "workflow_executions_select" ON public.workflow_executions;
DROP POLICY IF EXISTS "workflow_executions_insert" ON public.workflow_executions;
DROP POLICY IF EXISTS "workflow_executions_update" ON public.workflow_executions;

CREATE POLICY "workflow_executions_select" ON public.workflow_executions
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workflow_executions_insert" ON public.workflow_executions
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workflow_executions_update" ON public.workflow_executions
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- 3. workflow_execution_steps
DROP POLICY IF EXISTS "workflow_execution_steps_select" ON public.workflow_execution_steps;
DROP POLICY IF EXISTS "workflow_execution_steps_insert" ON public.workflow_execution_steps;

CREATE POLICY "workflow_execution_steps_select" ON public.workflow_execution_steps
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workflow_executions we
      WHERE we.id = execution_id
        AND we.organization_id IN (
          SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
        )
    )
  );

CREATE POLICY "workflow_execution_steps_insert" ON public.workflow_execution_steps
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workflow_executions we
      WHERE we.id = execution_id
        AND we.organization_id IN (
          SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
        )
    )
  );
