-- ============================================================
-- Migration: Uazapi Secrets Table
-- Date: 2026-04-22
-- Branch: feat/migrate-uazapi-whatsapp
-- Description:
--   Resolve BLOCKER de segurança da migration anterior (20260422000000_uazapi_foundation.sql):
--   column-level REVOKE em Supabase managed é ineficaz — table-level GRANT domina.
--   Verificado via: has_column_privilege('authenticated','whatsapp_instances','uazapi_token','SELECT') = true.
--
--   Solução:
--   1. Criar tabela separada whatsapp_instance_secrets com RLS que nega acesso
--      total a authenticated/anon (nenhuma policy = deny por default do RLS).
--   2. Remover colunas uazapi_token e uazapi_instance_id de whatsapp_instances.
--   3. Helper RPC get_uazapi_credentials — SECURITY DEFINER, service_role only.
--   4. Helper RPC set_uazapi_credentials — SECURITY DEFINER, service_role only.
--
-- ROLLBACK:
--   -- Restaurar colunas em whatsapp_instances
--   ALTER TABLE public.whatsapp_instances
--     ADD COLUMN IF NOT EXISTS uazapi_token TEXT,
--     ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT;
--   -- Migrar dados de volta (se houver)
--   UPDATE public.whatsapp_instances wi
--     SET uazapi_token = s.uazapi_token,
--         uazapi_instance_id = s.uazapi_instance_id
--   FROM public.whatsapp_instance_secrets s
--   WHERE s.instance_id = wi.id;
--   -- Dropar objetos desta migration
--   DROP FUNCTION IF EXISTS public.set_uazapi_credentials(UUID, UUID, TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.get_uazapi_credentials(UUID);
--   DROP TABLE IF EXISTS public.whatsapp_instance_secrets;
-- ============================================================

-- ============================================================
-- 1. TABELA whatsapp_instance_secrets
--    Armazena credenciais sensíveis fora de whatsapp_instances.
--    RLS ativo + nenhuma policy para authenticated/anon = deny all.
--    Apenas service_role acessa.
-- ============================================================

CREATE TABLE public.whatsapp_instance_secrets (
  instance_id      UUID        PRIMARY KEY REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  uazapi_token     TEXT        NOT NULL,
  uazapi_instance_id TEXT,
  webhook_secret   TEXT,  -- shared secret por instância (complementa global UAZAPI_WEBHOOK_SECRET)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_instance_secrets IS
  'Credenciais sensíveis de instâncias WhatsApp (uazapi_token, webhook_secret). '
  'Acessível apenas via service_role. Isolado de whatsapp_instances para evitar '
  'vazamento via column-level GRANT no Supabase managed.';

COMMENT ON COLUMN public.whatsapp_instance_secrets.uazapi_token IS
  'Token de autenticação da instância Uazapi. Nunca exposto ao cliente.';
COMMENT ON COLUMN public.whatsapp_instance_secrets.uazapi_instance_id IS
  'ID da instância retornado pela Uazapi ao criar/conectar.';
COMMENT ON COLUMN public.whatsapp_instance_secrets.webhook_secret IS
  'Shared secret por instância para validação de webhooks. Opcional — complementa global UAZAPI_WEBHOOK_SECRET.';

-- Index para lookup por org (auditoria, rotação de tokens em batch)
CREATE INDEX idx_whatsapp_instance_secrets_org ON public.whatsapp_instance_secrets(organization_id);

-- ============================================================
-- 2. RLS — deny all por default + policy exclusiva service_role
--    Sem policy para authenticated/anon = nenhuma row retorna.
--    Defesa em profundidade: REVOKE explícito também aplicado.
-- ============================================================

ALTER TABLE public.whatsapp_instance_secrets ENABLE ROW LEVEL SECURITY;

-- Única policy: service_role tem acesso total
-- authenticated/anon não têm nenhuma policy → deny all por RLS default
CREATE POLICY "Service role full access whatsapp_instance_secrets"
  ON public.whatsapp_instance_secrets
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- REVOKE explícito como defesa em profundidade
-- (Em Supabase managed, table-level GRANTs existem — o REVOKE aqui reforça
-- intenção e protege em caso de mudança de comportamento do bootstrap)
REVOKE ALL ON public.whatsapp_instance_secrets FROM authenticated;
REVOKE ALL ON public.whatsapp_instance_secrets FROM anon;
GRANT ALL ON public.whatsapp_instance_secrets TO service_role;

-- Trigger updated_at
CREATE TRIGGER trg_whatsapp_instance_secrets_updated_at
  BEFORE UPDATE ON public.whatsapp_instance_secrets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3. MIGRAR DADOS EXISTENTES
--    Se houver rows em whatsapp_instances com uazapi_token preenchido,
--    mover para whatsapp_instance_secrets antes de dropar as colunas.
-- ============================================================

INSERT INTO public.whatsapp_instance_secrets (instance_id, organization_id, uazapi_token, uazapi_instance_id)
SELECT id, organization_id, uazapi_token, uazapi_instance_id
FROM public.whatsapp_instances
WHERE uazapi_token IS NOT NULL
ON CONFLICT (instance_id) DO UPDATE
  SET uazapi_token       = EXCLUDED.uazapi_token,
      uazapi_instance_id = COALESCE(EXCLUDED.uazapi_instance_id, whatsapp_instance_secrets.uazapi_instance_id),
      updated_at         = now();

-- ============================================================
-- 4. REMOVER COLUNAS INSEGURAS DE whatsapp_instances
--    Após migração de dados. provider e provider_config permanecem
--    (metadados não-sensíveis, necessários para queries de routing).
-- ============================================================

ALTER TABLE public.whatsapp_instances DROP COLUMN IF EXISTS uazapi_token;
ALTER TABLE public.whatsapp_instances DROP COLUMN IF EXISTS uazapi_instance_id;

-- ============================================================
-- 5. HELPER RPC: get_uazapi_credentials
--    Edge functions buscam token via RPC — não via SELECT direto.
--    Minimiza superfície de auditoria; SECURITY DEFINER executa
--    com privilégios do definer (superuser-equivalent no Supabase).
--    Proteção: checa auth.role() = 'service_role' explicitamente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_uazapi_credentials(p_instance_id UUID)
RETURNS TABLE(
  uazapi_token       TEXT,
  uazapi_instance_id TEXT,
  webhook_secret     TEXT,
  organization_id    UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Guarda: só service_role pode chamar esta função
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.uazapi_token,
    s.uazapi_instance_id,
    s.webhook_secret,
    s.organization_id
  FROM public.whatsapp_instance_secrets s
  WHERE s.instance_id = p_instance_id;
END;
$$;

COMMENT ON FUNCTION public.get_uazapi_credentials(UUID) IS
  'Retorna credenciais Uazapi de uma instância. Exclusivo service_role. '
  'SECURITY DEFINER — não expõe a tabela whatsapp_instance_secrets diretamente.';

-- Revogar de todos, conceder só a service_role
REVOKE EXECUTE ON FUNCTION public.get_uazapi_credentials(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_uazapi_credentials(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_uazapi_credentials(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_uazapi_credentials(UUID) TO service_role;

-- ============================================================
-- 6. HELPER RPC: set_uazapi_credentials
--    Upsert de credenciais Uazapi. SECURITY DEFINER, service_role only.
--    Campos opcionais (uazapi_instance_id, webhook_secret) preservam
--    valor existente via COALESCE se não fornecidos.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_uazapi_credentials(
  p_instance_id      UUID,
  p_organization_id  UUID,
  p_uazapi_token     TEXT,
  p_uazapi_instance_id TEXT DEFAULT NULL,
  p_webhook_secret   TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Guarda: só service_role pode chamar esta função
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.whatsapp_instance_secrets(
    instance_id,
    organization_id,
    uazapi_token,
    uazapi_instance_id,
    webhook_secret
  )
  VALUES (
    p_instance_id,
    p_organization_id,
    p_uazapi_token,
    p_uazapi_instance_id,
    p_webhook_secret
  )
  ON CONFLICT (instance_id) DO UPDATE
    SET uazapi_token       = EXCLUDED.uazapi_token,
        uazapi_instance_id = COALESCE(EXCLUDED.uazapi_instance_id, whatsapp_instance_secrets.uazapi_instance_id),
        webhook_secret     = COALESCE(EXCLUDED.webhook_secret, whatsapp_instance_secrets.webhook_secret),
        updated_at         = now();
END;
$$;

COMMENT ON FUNCTION public.set_uazapi_credentials(UUID, UUID, TEXT, TEXT, TEXT) IS
  'Upsert de credenciais Uazapi para uma instância. Exclusivo service_role. '
  'Preserva uazapi_instance_id e webhook_secret existentes se não fornecidos.';

-- Revogar de todos, conceder só a service_role
REVOKE EXECUTE ON FUNCTION public.set_uazapi_credentials(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_uazapi_credentials(UUID, UUID, TEXT, TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_uazapi_credentials(UUID, UUID, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_uazapi_credentials(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
