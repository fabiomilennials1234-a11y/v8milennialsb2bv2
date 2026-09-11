-- Rollback removes only transient retry bookkeeping. Workflow definitions,
-- executions, steps and actions remain intact. Run while the worker is paused so
-- no execution is between attempts.
BEGIN;
ALTER TABLE public.workflow_executions
  DROP CONSTRAINT IF EXISTS workflow_executions_guided_condition_retry_state_check,
  DROP COLUMN IF EXISTS guided_condition_retry_error,
  DROP COLUMN IF EXISTS guided_condition_retry_count,
  DROP COLUMN IF EXISTS guided_condition_retry_node_id;
NOTIFY pgrst, 'reload schema';
COMMIT;
