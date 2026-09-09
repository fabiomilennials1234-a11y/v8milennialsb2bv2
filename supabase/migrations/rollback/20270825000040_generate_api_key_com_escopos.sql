-- Rollback: volta a função de 3 argumentos (a tela precisaria voltar junto).
DROP FUNCTION IF EXISTS public.generate_api_key(uuid, text, uuid, text[], integer, timestamptz);

CREATE FUNCTION public.generate_api_key(p_org_id uuid, p_name text, p_created_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_raw_key TEXT; v_key_hash TEXT; v_key_prefix TEXT; v_id UUID;
BEGIN
  IF NOT (public.is_master_user() OR EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid() AND organization_id = p_org_id AND role = 'admin'
  )) THEN
    RAISE EXCEPTION 'Forbidden: must be org admin';
  END IF;
  v_raw_key := 'tq_live_' || encode(gen_random_bytes(16), 'hex');
  v_key_hash := encode(digest(v_raw_key, 'sha256'), 'hex');
  v_key_prefix := left(v_raw_key, 12);
  INSERT INTO public.api_keys (organization_id, name, key_hash, key_prefix, created_by)
  VALUES (p_org_id, p_name, v_key_hash, v_key_prefix, p_created_by) RETURNING id INTO v_id;
  RETURN jsonb_build_object('key_id', v_id, 'raw_key', v_raw_key, 'prefix', v_key_prefix);
END; $$;

REVOKE ALL ON FUNCTION public.generate_api_key(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_api_key(uuid, text, uuid) TO authenticated, service_role;
