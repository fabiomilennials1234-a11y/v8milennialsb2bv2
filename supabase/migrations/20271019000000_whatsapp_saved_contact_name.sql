-- Keep the address-book name independent from last_push_name (profile).
ALTER TABLE public.whatsapp_conversation_summary ADD COLUMN saved_contact_name text;
CREATE FUNCTION public.capture_whatsapp_saved_contact_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved text := nullif(btrim(NEW.raw_payload->>'wa_contactName'), '');
BEGIN
  IF saved IS NOT NULL THEN
    UPDATE public.whatsapp_conversation_summary SET saved_contact_name = saved
    WHERE organization_id = NEW.organization_id AND instance_id = NEW.instance_id
      AND normalized_phone = NEW.normalized_phone;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_whatsapp_saved_contact_name() FROM PUBLIC, anon, authenticated;
-- Runs after trg_whatsapp_conversation_summary has created the row.
CREATE TRIGGER zz_capture_whatsapp_saved_contact_name AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.capture_whatsapp_saved_contact_name();
