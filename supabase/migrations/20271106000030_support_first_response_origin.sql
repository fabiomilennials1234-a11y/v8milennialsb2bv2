-- A master can also submit a customer-side comment. Only a public staff
-- response starts the SLA clock; author privileges alone are insufficient.
CREATE OR REPLACE FUNCTION public.stamp_support_ticket_first_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_internal OR NEW.from_staff IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_master_user(NEW.author_user_id) THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('torque.support_clock', 'on', true);
  UPDATE public.support_tickets
  SET first_response_at = NEW.created_at
  WHERE id = NEW.ticket_id
    AND first_response_at IS NULL;
  PERFORM set_config('torque.support_clock', 'off', true);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_support_ticket_first_response() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_support_ticket_first_response() TO service_role;
