-- Fix: generate_api_key falhava com "function gen_random_bytes(integer) does not exist".
-- Causa: pgcrypto (digest, gen_random_bytes) vive no schema `extensions` no Supabase,
-- mas a função tinha `SET search_path TO 'public'` — não resolvia as funções pgcrypto.
-- Efeito: criação de API key quebrada em TODAS as orgs (RPC explode; frontend sem onError = falha silenciosa).
-- Fix: incluir `extensions` no search_path. Body inalterado.

CREATE OR REPLACE FUNCTION public.generate_api_key(p_org_id uuid, p_name text, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_raw_key TEXT;
  v_key_hash TEXT;
  v_key_prefix TEXT;
  v_id UUID;
BEGIN
  -- ── Authorization check ──────────────────────────────────────────────────
  -- Caller must be org admin or master user. Without this, any authenticated
  -- user could mint keys for any organization.
  IF NOT (
    public.is_master_user()
    OR EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = auth.uid()
        AND organization_id = p_org_id
        AND role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden: must be org admin';
  END IF;

  -- Generate raw key: tq_live_ + 32 hex chars (16 random bytes)
  v_raw_key := 'tq_live_' || encode(gen_random_bytes(16), 'hex');

  -- SHA-256 hash for storage
  v_key_hash := encode(digest(v_raw_key, 'sha256'), 'hex');

  -- Prefix for fast lookup (first 12 chars: "tq_live_xxxx")
  v_key_prefix := left(v_raw_key, 12);

  -- Insert the key record
  INSERT INTO public.api_keys (organization_id, name, key_hash, key_prefix, created_by)
  VALUES (p_org_id, p_name, v_key_hash, v_key_prefix, p_created_by)
  RETURNING id INTO v_id;

  -- Return the raw key (shown once only) plus metadata
  RETURN jsonb_build_object(
    'key_id', v_id,
    'raw_key', v_raw_key,
    'prefix', v_key_prefix
  );
END;
$function$;
