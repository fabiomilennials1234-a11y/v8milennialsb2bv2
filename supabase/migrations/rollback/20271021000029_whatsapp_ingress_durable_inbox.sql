-- Disable dedicated ingress / route back to Edge FIRST. Preserve durable events:
-- never drop the inbox or stop reconciliation while outstanding work exists.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.whatsapp_ingress_events WHERE status<>'completed') THEN
    RAISE EXCEPTION 'Ingress rollback requires draining or explicitly preserving pending/dead-letter events';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.enqueue_whatsapp_ingress_event(uuid,uuid,text,jsonb,text) FROM service_role;
-- Claim/finish/cleanup remain available for operator reconciliation. Data and
-- schema deliberately retained; destructive removal is not part of rollback.
