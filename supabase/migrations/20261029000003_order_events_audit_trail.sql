-- =============================================================================
-- Audit trail for order approval decisions + trigger for auto-insert
-- =============================================================================

-- 1. Create order_events table (append-only audit log)
CREATE TABLE IF NOT EXISTS public.order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.upsell_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'approved', 'rejected')),
  actor_id UUID REFERENCES auth.users(id),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_events_org ON public.order_events(organization_id);
CREATE INDEX idx_order_events_order ON public.order_events(order_id);

ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

-- Read-only for org members (no update, no delete = immutable)
CREATE POLICY "order_events_select_org" ON public.order_events
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "order_events_insert_org" ON public.order_events
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

GRANT SELECT, INSERT ON public.order_events TO authenticated;

-- 2. Trigger: auto-insert event on approval_status change
CREATE OR REPLACE FUNCTION handle_order_event_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO order_events (organization_id, order_id, event_type, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'created', auth.uid());
  ELSIF TG_OP = 'UPDATE' AND OLD.approval_status IS DISTINCT FROM NEW.approval_status THEN
    IF NEW.approval_status IN ('approved', 'rejected') THEN
      INSERT INTO order_events (organization_id, order_id, event_type, actor_id, comment)
      VALUES (
        NEW.organization_id,
        NEW.id,
        NEW.approval_status,
        COALESCE(NEW.approved_by, auth.uid()),
        NEW.approval_comment
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_event_audit ON upsell_orders;
CREATE TRIGGER trg_order_event_audit
  AFTER INSERT OR UPDATE OF approval_status ON upsell_orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_order_event_audit();

-- 3. Realtime for notifications
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE order_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
