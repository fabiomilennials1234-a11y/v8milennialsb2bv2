-- C1 + C2: Atomic, race-safe coupon usage increment
CREATE OR REPLACE FUNCTION public.increment_coupon_uses(p_coupon_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE coupons
  SET current_uses = current_uses + 1
  WHERE id = p_coupon_id
    AND is_active = true
    AND (max_uses IS NULL OR current_uses < max_uses);
  RETURN FOUND;  -- true if a row was updated (within limits), false if limit reached
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_coupon_uses(UUID) TO service_role;
