-- Isolated test database only; extends cron-idle-dispatch-schema.sql.
INSERT INTO public.cron_config VALUES
  ('pipe_rule_dispatch_url', 'https://fixture.invalid/functions/v1/pipe-rule-dispatch');
CREATE TABLE public.scheduled_pipe_messages(status text, scheduled_at timestamptz, wait_timeout_at timestamptz);
CREATE TABLE public.scheduled_campaign_messages(status text, scheduled_at timestamptz, wait_timeout_at timestamptz);
CREATE TABLE public.oraculo_feedback_alerts(status text, next_attempt_at timestamptz, lease_until timestamptz);
CREATE TABLE public.whatsapp_instances(id integer PRIMARY KEY, provider text);
CREATE TABLE public.blast_plans(id integer PRIMARY KEY, instance_id integer, status text, template jsonb, lots_released integer);
CREATE TABLE public.blast_plan_recipients(plan_id integer, status text, claimed_at timestamptz, lot_index integer);
