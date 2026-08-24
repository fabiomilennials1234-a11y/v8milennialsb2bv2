-- ============================================================================
-- A chave de API nasce JÁ com os escopos escolhidos.
--
-- ── O DEFEITO, MEDIDO ─────────────────────────────────────────────────────
-- `generate_api_key` só aceitava org, nome e autor. A tela criava a chave e
-- depois fazia um `UPDATE api_keys SET scopes = …` pelo cliente — sujeito à RLS.
--
-- As políticas de `api_keys` não combinam entre si:
--   INSERT  → `is_master_user() OR (admin em team_members)`      ← sem is_active
--   UPDATE  → idem, MAIS a política ALL que exige
--             `organization_id IN get_my_admin_organization_ids()`, e essa
--             função filtra `is_active = true`
--
-- Resultado, reproduzido em produção com o uid real do CTO (master, com o
-- vínculo na organização inativo): o INSERT passa, o UPDATE afeta ZERO linhas, e
-- o supabase-js não trata "0 linhas filtradas pela RLS" como erro. A tela diz
-- que criou, e a chave fica com o default da coluna —
-- `{lead:write, webhook:read}`. Aconteceu duas vezes seguidas, com chaves
-- diferentes, e o sintoma aparece longe daqui: dropdown vazio no Make, 403 em
-- funis, etapas, campos personalizados e responsáveis.
--
-- ── A CORREÇÃO ───────────────────────────────────────────────────────────
-- Os escopos entram no MESMO INSERT, dentro da função SECURITY DEFINER que já
-- valida quem pode criar. Sem segundo passo, não há segundo passo para falhar.
--
-- DROP + CREATE em vez de CREATE OR REPLACE: a assinatura muda, e `OR REPLACE`
-- criaria uma SOBRECARGA — o PostgREST poderia continuar resolvendo para a
-- versão de 3 argumentos em silêncio. Os grants são repostos abaixo porque o
-- DROP os leva junto.
-- ============================================================================

DROP FUNCTION IF EXISTS public.generate_api_key(uuid, text, uuid);

CREATE FUNCTION public.generate_api_key(
  p_org_id uuid,
  p_name text,
  p_created_by uuid,
  p_scopes text[] DEFAULT NULL,
  p_rate_limit_per_minute integer DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_raw_key TEXT;
  v_key_hash TEXT;
  v_key_prefix TEXT;
  v_id UUID;
  v_scopes TEXT[];
  v_invalidos TEXT[];
BEGIN
  -- Autorização: a mesma de antes. Master, ou admin da organização.
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

  -- Escopo desconhecido é erro, não silêncio: chave com escopo inventado passa
  -- na criação e falha na primeira chamada, longe daqui.
  IF p_scopes IS NOT NULL THEN
    SELECT array_agg(s) INTO v_invalidos
    FROM unnest(p_scopes) AS s
    WHERE s NOT IN ('lead:read','lead:write','lead:ingest','pipeline:read',
                    'metadata:read','metadata:write','webhook:read',
                    'deal:read','deal:write','team:read');
    IF v_invalidos IS NOT NULL THEN
      RAISE EXCEPTION 'Escopo inválido: %', array_to_string(v_invalidos, ', ');
    END IF;
  END IF;

  v_scopes := COALESCE(NULLIF(p_scopes, '{}'), ARRAY['lead:write','webhook:read']);

  v_raw_key := 'tq_live_' || encode(gen_random_bytes(16), 'hex');
  v_key_hash := encode(digest(v_raw_key, 'sha256'), 'hex');
  v_key_prefix := left(v_raw_key, 12);

  INSERT INTO public.api_keys (
    organization_id, name, key_hash, key_prefix, created_by,
    scopes, rate_limit_per_minute, expires_at
  )
  VALUES (
    p_org_id, p_name, v_key_hash, v_key_prefix, p_created_by,
    v_scopes,
    COALESCE(p_rate_limit_per_minute, 60),
    p_expires_at
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'key_id', v_id,
    'raw_key', v_raw_key,
    'prefix', v_key_prefix,
    -- Devolve o que ficou gravado. A tela mostra isto em vez de assumir que o
    -- que foi pedido é o que existe.
    'scopes', to_jsonb(v_scopes)
  );
END;
$$;

COMMENT ON FUNCTION public.generate_api_key(uuid, text, uuid, text[], integer, timestamptz) IS
  'Cria chave de API com escopos, limite e validade no mesmo INSERT. Substitui o padrão INSERT + UPDATE do cliente, que a RLS filtrava em silêncio para master com vínculo inativo.';

-- O DROP levou os grants junto.
REVOKE ALL ON FUNCTION public.generate_api_key(uuid, text, uuid, text[], integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_api_key(uuid, text, uuid, text[], integer, timestamptz) TO authenticated, service_role;
