-- Durable, bounded retry state for temporary guided-condition failures.
BEGIN;

ALTER TABLE public.workflow_executions
  ADD COLUMN guided_condition_retry_node_id text,
  ADD COLUMN guided_condition_retry_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN guided_condition_retry_error text,
  ADD CONSTRAINT workflow_executions_guided_condition_retry_state_check CHECK (
    (
      guided_condition_retry_node_id IS NULL
      AND guided_condition_retry_count = 0
      AND guided_condition_retry_error IS NULL
    ) OR (
      guided_condition_retry_node_id IS NOT NULL
      AND guided_condition_retry_node_id = current_node_id
      AND status IN ('running', 'processing', 'failed')
      AND char_length(guided_condition_retry_node_id) BETWEEN 1 AND 256
      AND guided_condition_retry_count BETWEEN 1 AND 3
      AND guided_condition_retry_error IN ('temporarily_unavailable', 'history_sync_in_progress')
    )
  );

COMMENT ON COLUMN public.workflow_executions.guided_condition_retry_node_id IS
  'Guided condition awaiting a retry. Null when no guided-condition retry is active.';
COMMENT ON COLUMN public.workflow_executions.guided_condition_retry_count IS
  'Number of guided-condition retries already scheduled for the active node; hard limit 3.';
COMMENT ON COLUMN public.workflow_executions.guided_condition_retry_error IS
  'Last retryable guided-condition error: temporarily_unavailable or history_sync_in_progress.';

NOTIFY pgrst, 'reload schema';
COMMIT;
