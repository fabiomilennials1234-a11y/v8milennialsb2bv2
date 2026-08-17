-- 20270817100000_toth_foundation.sql
--
-- ERP Toth (Café Jurerê) — ciclo de vida da conexão + cofre deny-all.
-- Terceira implementação da camada neutra de ERP (ADR-0020); espelha
-- `20270203000000_omie_foundation.sql`, com duas diferenças que vêm da forma do
-- Toth:
--
--   1. `base_url` por organização. Omie e Tiny são SaaS de URL constante; o Toth
--      roda DENTRO da rede de cada cliente. O endereço é configuração da org, e
--      fica na tabela de conexão (não é segredo — a UI precisa exibi-lo para o
--      admin conferir). A validação anti-SSRF do valor mora em
--      `_shared/erp/toth-url.ts`; aqui só garantimos que é http(s) e não vazio.
--
--   2. O cofre guarda usuário + senha, não app_key + app_secret. O Toth
--      autentica por sessão (`POST /users/login` → token de TTL desconhecido),
--      então a credencial de longa duração é o par de login.
--
-- Todo statement é idempotente (`IF NOT EXISTS` / `DROP ... IF EXISTS`) para que
-- a árvore de migrations siga reproduzível do zero — é o que mantém vivos os
-- jobs de CI que dependem de `supabase start`.

-- ============================================================
-- 1. toth_connections (1 por org) — sem segredo aqui
-- ============================================================
CREATE TABLE IF NOT EXISTS public.toth_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),

  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'expired', 'disconnected')),

  -- Endereço público da API do Toth desta org, já normalizado pela edge function.
  -- Ex.: https://erp.cliente.com.br/toth/services
  base_url TEXT NOT NULL
    CHECK (base_url ~ '^https?://[^[:space:]]+$'),

  -- Como o token viaja na requisição. `query` é o que a coleção Postman
  -- documenta; `header` é o que pedimos ao fornecedor (token em query string
  -- fica gravado em log de proxy e no cabeçalho Referer). Quando eles mudarem,
  -- é UPDATE nesta coluna — nenhum código muda.
  token_transport TEXT NOT NULL DEFAULT 'query'
    CHECK (token_transport IN ('query', 'header')),

  -- Quão agressivamente o ERP reconcilia campos do cliente (ADR-0020 §2).
  erp_sync_mode TEXT NOT NULL DEFAULT 'enrich_only'
    CHECK (erp_sync_mode IN ('off', 'enrich_only', 'canonical')),

  -- Cursor resumível + marcadores da última sincronização.
  clientes_cursor INTEGER,
  last_clientes_sync_at TIMESTAMPTZ,
  last_error TEXT,

  connected_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT unique_toth_org UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS idx_toth_connections_organization_id
  ON public.toth_connections(organization_id);

COMMENT ON TABLE public.toth_connections IS
  'Conexão com o ERP Toth, uma por organização. ERP on-premise: cada org traz a '
  'própria base_url. Nenhum segredo aqui — credenciais em toth_connection_secrets.';

ALTER TABLE public.toth_connections ENABLE ROW LEVEL SECURITY;

-- Membros da org leem a conexão (status + modo de sync alimentam a UI).
DROP POLICY IF EXISTS "toth_connections_member_select" ON public.toth_connections;
CREATE POLICY "toth_connections_member_select" ON public.toth_connections
  FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- Só admin da org administra a conexão. Nunca subquery inline em team_members:
-- causa recursão quando o Realtime avalia apply_rls().
DROP POLICY IF EXISTS "toth_connections_admin_all" ON public.toth_connections;
CREATE POLICY "toth_connections_admin_all" ON public.toth_connections
  FOR ALL
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.toth_connections TO authenticated;
-- `anon` nunca lê esta tabela. A RLS já negaria (as funções de org devolvem
-- vazio sem sessão), mas o projeto concede privilégio nominal a `anon` por
-- ALTER DEFAULT PRIVILEGES, então o REVOKE explícito é o que garante que uma
-- policy futura escrita sem cuidado não abra a linha para não autenticado.
REVOKE ALL ON public.toth_connections FROM anon;

DROP TRIGGER IF EXISTS trg_toth_connections_updated_at ON public.toth_connections;
CREATE TRIGGER trg_toth_connections_updated_at
  BEFORE UPDATE ON public.toth_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. toth_connection_secrets — DENY-ALL, só service_role
--    RLS ligada + nenhuma policy para authenticated/anon = nega por padrão.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.toth_connection_secrets (
  connection_id UUID PRIMARY KEY
    REFERENCES public.toth_connections(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  user_ciphertext TEXT NOT NULL,
  user_nonce TEXT NOT NULL,
  password_ciphertext TEXT NOT NULL,
  password_nonce TEXT NOT NULL,
  encryption_key_id TEXT NOT NULL DEFAULT 'v1',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_toth_connection_secrets_org
  ON public.toth_connection_secrets(organization_id);

COMMENT ON TABLE public.toth_connection_secrets IS
  'Usuário e senha do ERP Toth, cifrados em AES-256-GCM. Acessível apenas por '
  'service_role. Isolado de toth_connections para que nenhum SELECT de membro '
  'possa vazar a credencial.';

ALTER TABLE public.toth_connection_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access toth_connection_secrets"
  ON public.toth_connection_secrets;
CREATE POLICY "Service role full access toth_connection_secrets"
  ON public.toth_connection_secrets
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Defesa em profundidade: o Supabase mantém GRANTs de tabela por padrão.
REVOKE ALL ON public.toth_connection_secrets FROM authenticated;
REVOKE ALL ON public.toth_connection_secrets FROM anon;
GRANT ALL ON public.toth_connection_secrets TO service_role;

DROP TRIGGER IF EXISTS trg_toth_connection_secrets_updated_at ON public.toth_connection_secrets;
CREATE TRIGGER trg_toth_connection_secrets_updated_at
  BEFORE UPDATE ON public.toth_connection_secrets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
