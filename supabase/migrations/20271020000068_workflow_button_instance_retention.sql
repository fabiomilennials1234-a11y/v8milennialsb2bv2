-- Instance identity is part of the immutable occurrence snapshot. Deleting an
-- integration must not erase admitted replies or strand its paused executions.
-- Admission validates tenant ownership against the live instance; subsequent
-- reconciliation remains scoped by organization and the original instance UUID.
-- Organization/execution deletion still cascades normally.
ALTER TABLE public.workflow_button_questions
  DROP CONSTRAINT workflow_button_questions_instance_id_fkey;
ALTER TABLE public.workflow_button_ingress
  DROP CONSTRAINT workflow_button_ingress_instance_id_fkey;
