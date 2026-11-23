-- crm-mcp v1 — tokens pessoais (PAT), autenticação hermética e limite de uso.
--
-- ── Por que ───────────────────────────────────────────────────────────────
-- O crm-mcp (supabase/functions/crm-mcp, ADR 0012) deixa cada usuário ligar a
-- própria IA (Claude, Cursor…) ao CRM dele por MCP. A credencial é um token
-- pessoal: um token = um usuário numa org, com EXATAMENTE a visibilidade de RLS
-- desse usuário. Nunca master, nunca service_role. Esta migration é a parte de
-- banco; a edge function e a UI vêm no mesmo PR.
--
-- Substitui a 20270101000000 (arquivada, nunca aplicada em prod). Diferenças:
--   · o resolver NÃO é mais chamável por anon. Só o papel `crm_mcp_resolver`
--     executa `crm_mcp_authenticate`, e esse papel só é alcançável por um JWT
--     que o crm-mcp assina. Navegador nenhum chega nele (INV-6 não conta);
--   · admin e master NÃO inserem token (inserir com user_id alheio = virar
--     aquele usuário). Eles só leem e revogam;
--   · revogado não volta, validade não estica, escopo é só `read` — no banco,
--     não só na UI;
--   · gestor de portfólio não emite (é principal cross-org, como master);
--   · limite de uso e registro de recusas dentro da própria autenticação: um
--     round-trip, e só quem tem o token consome o balde dele.
--
-- ── O que cria ────────────────────────────────────────────────────────────
--   1. papel crm_mcp_resolver
--   2. public.personal_access_tokens (+ gatilhos de inserção e imutabilidade)
--   3. public.crm_mcp_rate_counters, public.crm_mcp_auth_denials
--   4. crm_mcp_org_enabled · crm_mcp_principal_check · crm_mcp_issue_check
--   5. crm_mcp_authenticate (o único resolver)
--   6. RLS + grants por coluna
--
-- Liberar uma org (piloto):
--   UPDATE organizations SET feature_flags = feature_flags || '{"crm_mcp": true}'::jsonb WHERE id = '<org>';
-- Desligar a flag corta todo token da org na hora (a autenticação relê a flag).
--
-- Rollback: rollback/20280124013100_crm_mcp_tokens.sql

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Papel do resolver
-- ═════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_mcp_resolver') THEN
    CREATE ROLE crm_mcp_resolver NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- O PostgREST troca para o papel do claim `role` do JWT; só consegue se o
-- authenticator for membro. Sem isto, o JWT do resolver dá 401/permission denied.
GRANT crm_mcp_resolver TO authenticator;
GRANT USAGE ON SCHEMA public TO crm_mcp_resolver;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Tokens
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.personal_access_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  -- SHA-256 hex do token inteiro. Sem sal: o token tem ~178 bits aleatórios,
  -- hash lento não compra nada e taxaria toda requisição.
  token_hash      text NOT NULL,
  token_prefix    text NOT NULL,
  audience        text NOT NULL DEFAULT 'crm-mcp',
  scopes          text[] NOT NULL DEFAULT ARRAY['read']::text[],
  last_used_at    timestamptz,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  revoked_reason  text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pat_name_len       CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT pat_hash_format    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pat_prefix_format  CHECK (token_prefix ~ '^tq_mcp_(live|test)_[0-9A-Za-z]{8}$'),
  CONSTRAINT pat_audience       CHECK (audience = 'crm-mcp'),
  -- v1 é só leitura (DESIGN D11). Escopo de escrita exige ADR própria.
  CONSTRAINT pat_scopes_v1      CHECK (cardinality(scopes) >= 1 AND scopes <@ ARRAY['read']::text[]),
  -- Teto de 366 dias, sem "nunca expira" (DESIGN D10).
  CONSTRAINT pat_expiry_window  CHECK (expires_at > created_at AND expires_at <= created_at + interval '366 days'),
  CONSTRAINT pat_revoked_pair   CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT pat_revoked_reason CHECK (revoked_reason IN ('user', 'admin', 'master', 'auto_unused', 'offboarding', 'compromise'))
);

CREATE UNIQUE INDEX IF NOT EXISTS pat_token_hash_uq ON public.personal_access_tokens (token_hash);
CREATE INDEX IF NOT EXISTS pat_user_org_idx ON public.personal_access_tokens (user_id, organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pat_org_idx ON public.personal_access_tokens (organization_id, created_at DESC);
-- A faxina diária varre só os ativos.
CREATE INDEX IF NOT EXISTS pat_active_idx ON public.personal_access_tokens (expires_at) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.personal_access_tokens IS
  'crm-mcp: tokens pessoais (PAT). Guarda só o hash; o texto do token aparece uma vez, na criação (edge fn create-pat). ADR 0012.';

-- ── Inserção: o servidor decide carimbos, e há teto de ativos ────────────
CREATE OR REPLACE FUNCTION public.pat_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ativos integer;
BEGIN
  -- Quem insere não escolhe estes campos: sem created_at no futuro (esticaria a
  -- janela de 366 dias), sem token nascido revogado ou "já usado".
  NEW.created_at     := now();
  NEW.last_used_at   := NULL;
  NEW.revoked_at     := NULL;
  NEW.revoked_reason := NULL;
  NEW.audience       := 'crm-mcp';
  NEW.created_by     := COALESCE(NEW.created_by, NEW.user_id);

  -- Teto de 10 ativos por usuário e org. A trava serializa criações simultâneas
  -- do mesmo usuário, senão duas abas passariam juntas pelo count.
  PERFORM pg_advisory_xact_lock(hashtextextended('pat:' || NEW.user_id::text || ':' || NEW.organization_id::text, 0));
  SELECT count(*) INTO v_ativos
    FROM public.personal_access_tokens t
   WHERE t.user_id = NEW.user_id
     AND t.organization_id = NEW.organization_id
     AND t.revoked_at IS NULL
     AND t.expires_at > now();
  IF v_ativos >= 10 THEN
    RAISE EXCEPTION 'personal_access_tokens: limite de 10 tokens ativos por usuário nesta organização'
      USING ERRCODE = 'P0001', HINT = 'pat_limit';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS pat_before_insert ON public.personal_access_tokens;
CREATE TRIGGER pat_before_insert
  BEFORE INSERT ON public.personal_access_tokens
  FOR EACH ROW EXECUTE FUNCTION public.pat_before_insert();

-- ── Atualização: só renomear e revogar; revogado não volta ───────────────
CREATE OR REPLACE FUNCTION public.pat_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.id              IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_id         IS DISTINCT FROM OLD.user_id
     OR NEW.token_hash      IS DISTINCT FROM OLD.token_hash
     OR NEW.token_prefix    IS DISTINCT FROM OLD.token_prefix
     OR NEW.audience        IS DISTINCT FROM OLD.audience
     OR NEW.scopes          IS DISTINCT FROM OLD.scopes
     OR NEW.expires_at      IS DISTINCT FROM OLD.expires_at
     OR NEW.created_by      IS DISTINCT FROM OLD.created_by
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'personal_access_tokens: só nome e revogação podem mudar'
      USING ERRCODE = 'P0001', HINT = 'pat_immutable';
  END IF;

  -- Revogação é de mão única e carimbada pelo servidor.
  IF OLD.revoked_at IS NOT NULL THEN
    IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason THEN
      RAISE EXCEPTION 'personal_access_tokens: token revogado não pode ser reativado nem re-revogado'
        USING ERRCODE = 'P0001', HINT = 'pat_immutable';
    END IF;
  ELSIF NEW.revoked_at IS NOT NULL OR NEW.revoked_reason IS NOT NULL THEN
    NEW.revoked_at := now();
    -- O motivo segue QUEM revoga. Dono: user|compromise. Admin da org: admin|
    -- compromise. Master: master|compromise. Contexto de sistema — função
    -- DEFINER do desligamento/faxina, ou service_role — informa o motivo, que
    -- precisa existir. O navegador roda como authenticated e nunca é sistema:
    -- não consegue se passar por 'offboarding' nem 'auto_unused'.
    IF current_user NOT IN ('authenticated', 'anon') THEN
      IF NEW.revoked_reason IS NULL THEN
        RAISE EXCEPTION 'personal_access_tokens: revogação de sistema exige motivo'
          USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_uid IS NULL THEN
      RAISE EXCEPTION 'personal_access_tokens: revogação exige sessão'
        USING ERRCODE = 'P0001';
    ELSIF NEW.revoked_reason IS DISTINCT FROM 'compromise' THEN
      NEW.revoked_reason := CASE
        WHEN v_uid = OLD.user_id THEN 'user'
        WHEN public.is_master_user() THEN 'master'
        ELSE 'admin'
      END;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS pat_before_update ON public.personal_access_tokens;
CREATE TRIGGER pat_before_update
  BEFORE UPDATE ON public.personal_access_tokens
  FOR EACH ROW EXECUTE FUNCTION public.pat_before_update();

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Limite de uso e recusas
-- ═════════════════════════════════════════════════════════════════════════
-- Janela fixa por balde. Só `crm_mcp_authenticate` escreve aqui.
CREATE TABLE IF NOT EXISTS public.crm_mcp_rate_counters (
  scope        text        NOT NULL CHECK (scope IN ('token_minute', 'org_minute', 'org_day')),
  subject_id   uuid        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, subject_id, window_start)
);
CREATE INDEX IF NOT EXISTS crm_mcp_rate_counters_window_idx ON public.crm_mcp_rate_counters (window_start);

-- Uso recusado de token CONHECIDO (revogado, expirado, org sem acesso, limite).
-- Token revogado ainda chegando aqui é sinal de vazamento. Uma linha por token,
-- motivo e minuto.
CREATE TABLE IF NOT EXISTS public.crm_mcp_auth_denials (
  pat_id          uuid        NOT NULL REFERENCES public.personal_access_tokens(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL,
  reason          text        NOT NULL CHECK (reason IN ('revoked', 'expired', 'master_principal', 'not_member', 'org_blocked', 'org_disabled', 'rate_limited')),
  window_start    timestamptz NOT NULL,
  hits            integer     NOT NULL DEFAULT 0,
  last_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pat_id, reason, window_start)
);
CREATE INDEX IF NOT EXISTS crm_mcp_auth_denials_org_idx ON public.crm_mcp_auth_denials (organization_id, window_start DESC);

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Quem pode ter token
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.crm_mcp_org_enabled(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT (o.feature_flags -> 'crm_mcp') = 'true'::jsonb
      FROM public.organizations o
     WHERE o.id = p_org
  ), false);
$$;

-- Os fatos que decidem se (usuário, org) pode operar o crm-mcp. Uma fonte só,
-- usada na emissão e em cada requisição. Falha fechado: master NULL conta como
-- master. Gestor de portfólio não é membro (team_members), então não passa.
CREATE OR REPLACE FUNCTION public.crm_mcp_principal_check(p_user uuid, p_org uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_user IS NULL OR p_org IS NULL THEN 'not_member'
    WHEN public.is_master_user(p_user) IS DISTINCT FROM false THEN 'master_principal'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.team_members tm
       WHERE tm.user_id = p_user AND tm.organization_id = p_org AND tm.is_active = true
    ) THEN 'not_member'
    WHEN public.org_access_blocked(p_org) THEN 'org_blocked'
    WHEN NOT public.crm_mcp_org_enabled(p_org) THEN 'org_disabled'
    ELSE 'ok'
  END;
$$;

-- A mesma pergunta para quem está logado: a policy de INSERT e a create-pat
-- (mensagem de erro clara) usam esta.
CREATE OR REPLACE FUNCTION public.crm_mcp_issue_check(p_org uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'unauthenticated';
  END IF;
  RETURN public.crm_mcp_principal_check(auth.uid(), p_org);
END
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. O resolver — único caminho de token → identidade
-- ═════════════════════════════════════════════════════════════════════════
-- Chamado pelo crm-mcp ANTES de existir sessão, com um JWT de 30 s do papel
-- crm_mcp_resolver. Hermético: sem linha para hash desconhecido (não é oráculo
-- de existência; e 178 bits não se adivinham). Para token conhecido devolve os
-- FATOS e o veredito; a edge fn recheca os fatos (falha fechado se divergirem).
--
-- Com veredito 'ok', na mesma transação: consome os três baldes (para no
-- primeiro estourado, para um token desgovernado não queimar o balde diário da
-- org) e carimba last_used_at no máximo uma vez por minuto.
CREATE OR REPLACE FUNCTION public.crm_mcp_authenticate(p_token_hash text)
RETURNS TABLE (
  pat_id              uuid,
  user_id             uuid,
  organization_id     uuid,
  scopes              text[],
  audience            text,
  expires_at          timestamptz,
  revoked_at          timestamptz,
  principal           text,
  outcome             text,
  retry_after_seconds integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
-- As colunas de saída (pat_id, user_id, organization_id…) têm os mesmos nomes das colunas
-- das tabelas; dentro das queries, o nome é sempre a COLUNA. Variáveis locais usam v_/c_.
#variable_conflict use_column
DECLARE
  -- Limites do v1 (DESIGN §7.3). Um agente faz rajadas curtas; o teto por token
  -- segura laço infinito, o da org protege o resto do time.
  c_token_minute constant integer := 120;
  c_org_minute   constant integer := 600;
  c_org_day      constant integer := 20000;

  t         public.personal_access_tokens%ROWTYPE;
  v_now     timestamptz := now();
  v_min     timestamptz := date_trunc('minute', now());
  v_day     timestamptz := date_trunc('day', now(), 'UTC');
  v_who     text;
  v_outcome text;
  v_retry   integer;
  v_hits    integer;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  SELECT * INTO t FROM public.personal_access_tokens pat WHERE pat.token_hash = p_token_hash;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_who := public.crm_mcp_principal_check(t.user_id, t.organization_id);
  v_outcome := CASE
    WHEN t.revoked_at IS NOT NULL THEN 'revoked'
    WHEN t.expires_at <= v_now    THEN 'expired'
    WHEN v_who <> 'ok'            THEN v_who
    ELSE 'ok'
  END;

  IF v_outcome = 'ok' THEN
    INSERT INTO public.crm_mcp_rate_counters AS c (scope, subject_id, window_start, hits)
    VALUES ('token_minute', t.id, v_min, 1)
    ON CONFLICT (scope, subject_id, window_start) DO UPDATE SET hits = c.hits + 1
    RETURNING c.hits INTO v_hits;
    IF v_hits > c_token_minute THEN
      v_outcome := 'rate_limited';
      v_retry := GREATEST(1, ceil(extract(epoch FROM (v_min + interval '1 minute' - v_now)))::integer);
    END IF;
  END IF;

  IF v_outcome = 'ok' THEN
    INSERT INTO public.crm_mcp_rate_counters AS c (scope, subject_id, window_start, hits)
    VALUES ('org_minute', t.organization_id, v_min, 1)
    ON CONFLICT (scope, subject_id, window_start) DO UPDATE SET hits = c.hits + 1
    RETURNING c.hits INTO v_hits;
    IF v_hits > c_org_minute THEN
      v_outcome := 'rate_limited';
      v_retry := GREATEST(1, ceil(extract(epoch FROM (v_min + interval '1 minute' - v_now)))::integer);
    END IF;
  END IF;

  IF v_outcome = 'ok' THEN
    INSERT INTO public.crm_mcp_rate_counters AS c (scope, subject_id, window_start, hits)
    VALUES ('org_day', t.organization_id, v_day, 1)
    ON CONFLICT (scope, subject_id, window_start) DO UPDATE SET hits = c.hits + 1
    RETURNING c.hits INTO v_hits;
    IF v_hits > c_org_day THEN
      v_outcome := 'rate_limited';
      v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_now)))::integer);
    END IF;
  END IF;

  IF v_outcome = 'ok' THEN
    IF t.last_used_at IS NULL OR t.last_used_at < v_now - interval '1 minute' THEN
      UPDATE public.personal_access_tokens SET last_used_at = v_now WHERE id = t.id;
    END IF;
  ELSE
    INSERT INTO public.crm_mcp_auth_denials AS d
      (pat_id, organization_id, user_id, reason, window_start, hits, last_at)
    VALUES (t.id, t.organization_id, t.user_id, v_outcome, v_min, 1, v_now)
    ON CONFLICT (pat_id, reason, window_start) DO UPDATE SET hits = d.hits + 1, last_at = v_now;
  END IF;

  RETURN QUERY SELECT t.id, t.user_id, t.organization_id, t.scopes, t.audience,
                      t.expires_at, t.revoked_at, v_who, v_outcome, v_retry;
END
$$;

COMMENT ON FUNCTION public.crm_mcp_authenticate(text) IS
  'crm-mcp: token → identidade + veredito + limite de uso. Só o papel crm_mcp_resolver executa (JWT assinado pelo crm-mcp). Hermético: hash desconhecido não devolve linha.';

-- ═════════════════════════════════════════════════════════════════════════
-- 6. RLS e grants
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public.personal_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_mcp_rate_counters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_mcp_auth_denials   ENABLE ROW LEVEL SECURITY;

-- Dono: vê e revoga os próprios. Admin da org: vê e revoga os da org
-- (governança). Master: vê e revoga. NINGUÉM além do dono insere.
DROP POLICY IF EXISTS pat_owner_select ON public.personal_access_tokens;
CREATE POLICY pat_owner_select ON public.personal_access_tokens
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS pat_admin_select ON public.personal_access_tokens;
CREATE POLICY pat_admin_select ON public.personal_access_tokens
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()));

DROP POLICY IF EXISTS pat_master_select ON public.personal_access_tokens;
CREATE POLICY pat_master_select ON public.personal_access_tokens
  FOR SELECT TO authenticated
  USING ((SELECT public.is_master_user()));

DROP POLICY IF EXISTS pat_owner_insert ON public.personal_access_tokens;
CREATE POLICY pat_owner_insert ON public.personal_access_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND created_by = (SELECT auth.uid())
    AND public.crm_mcp_issue_check(organization_id) = 'ok'
  );

DROP POLICY IF EXISTS pat_owner_update ON public.personal_access_tokens;
CREATE POLICY pat_owner_update ON public.personal_access_tokens
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS pat_admin_update ON public.personal_access_tokens;
CREATE POLICY pat_admin_update ON public.personal_access_tokens
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));

DROP POLICY IF EXISTS pat_master_update ON public.personal_access_tokens;
CREATE POLICY pat_master_update ON public.personal_access_tokens
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_master_user()))
  WITH CHECK ((SELECT public.is_master_user()));

-- Recusas: dono, admin da org e master leem. Ninguém do navegador escreve.
DROP POLICY IF EXISTS crm_mcp_denials_select ON public.crm_mcp_auth_denials;
CREATE POLICY crm_mcp_denials_select ON public.crm_mcp_auth_denials
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR organization_id IN (SELECT public.get_my_admin_organization_ids())
    OR (SELECT public.is_master_user())
  );

-- O Supabase concede ALL a anon/authenticated em tabela nova do public. Tira
-- tudo e devolve só o necessário, por coluna: o hash nunca é legível pelo
-- navegador, e UPDATE só alcança nome e revogação.
REVOKE ALL ON public.personal_access_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, organization_id, user_id, name, token_prefix, audience, scopes,
              last_used_at, expires_at, revoked_at, revoked_reason, created_by, created_at)
  ON public.personal_access_tokens TO authenticated;
GRANT INSERT (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at, created_by)
  ON public.personal_access_tokens TO authenticated;
GRANT UPDATE (name, revoked_at, revoked_reason)
  ON public.personal_access_tokens TO authenticated;

REVOKE ALL ON public.crm_mcp_rate_counters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_mcp_auth_denials  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_mcp_auth_denials TO authenticated;

GRANT ALL ON public.personal_access_tokens, public.crm_mcp_rate_counters, public.crm_mcp_auth_denials TO service_role;

-- Funções: só issue_check é do navegador (tem gate de auth.uid()). As demais
-- respondem sobre QUALQUER usuário/org e ficam fechadas.
REVOKE ALL ON FUNCTION public.crm_mcp_org_enabled(uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_mcp_principal_check(uuid, uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_mcp_issue_check(uuid)            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_mcp_issue_check(uuid)         TO authenticated;
REVOKE ALL ON FUNCTION public.crm_mcp_authenticate(text)           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mcp_authenticate(text)        TO crm_mcp_resolver;
REVOKE ALL ON FUNCTION public.pat_before_insert()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pat_before_update()                  FROM PUBLIC, anon, authenticated;
