-- Push notification subscriptions (Web Push API)
-- Cada browser/device registra um endpoint único por user+org.

CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint)
);

CREATE INDEX idx_push_subscriptions_organization_id ON public.push_subscriptions(organization_id);
CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON public.push_subscriptions
  FOR SELECT USING (organization_id IN (SELECT get_my_organization_ids()));

CREATE POLICY "own_subscriptions_insert" ON public.push_subscriptions
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (SELECT get_my_organization_ids())
  );

CREATE POLICY "own_subscriptions_delete" ON public.push_subscriptions
  FOR DELETE USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
