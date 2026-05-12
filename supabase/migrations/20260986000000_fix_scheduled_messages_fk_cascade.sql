-- Fix FK on scheduled_user_messages that blocks whatsapp_instances deletion.
-- Change from NO ACTION (implicit default) to SET NULL — a scheduled message
-- can still reference the lead/org without needing the instance row.

ALTER TABLE public.scheduled_user_messages
  DROP CONSTRAINT IF EXISTS scheduled_user_messages_whatsapp_instance_id_fkey;

ALTER TABLE public.scheduled_user_messages
  ADD CONSTRAINT scheduled_user_messages_whatsapp_instance_id_fkey
    FOREIGN KEY (whatsapp_instance_id)
    REFERENCES public.whatsapp_instances(id)
    ON DELETE SET NULL;
