-- ============================================================================
-- Camada de default de permissao POR ORGANIZACAO (PRD #1629, fatia #1630)
--
-- CAUSA RAIZ: `feature_permissions` e catalogo GLOBAL -- nao tem
-- organization_id. O unico ponto de ajuste por org era
-- `member_feature_permissions`, que e POR MEMBRO. Duas consequencias:
--
--   1. o admin desliga uma permissao membro a membro;
--   2. todo contratado novo entra herdando o default_value GLOBAL, desfazendo
--      em silencio a politica que a org escolheu. E o buraco que aparece
--      exatamente quando ninguem esta olhando: na contratacao.
--
-- A camada nova resolve ENTRE as duas:
--
--   master                                  -> true
--   admin da org                            -> true
--   feature admin-only                      -> false
--   override do membro   (se existir linha)  -> vence
--   default da ORG       (se existir linha)  -> vence            <-- NOVO
--   default_value do catalogo global         -> ultimo recurso
--
-- Por que uma tabela e nao uma coluna jsonb em `organizations`: a resolucao
-- roda dentro de has_feature_permission(), que e chamada por policy de RLS em
-- leads, lead_history, campanha_leads e pelo predicado do chat. Um lookup
-- indexado por (organization_id, feature_key) e previsivel; desempacotar jsonb
-- por linha nao e.
--
-- NAO altera comportamento de ninguem sozinha: sem linha na tabela, a cascata
-- e identica a de antes. As 104 orgs comecam sem linha nenhuma.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organization_feature_defaults (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_key     text NOT NULL REFERENCES public.feature_permissions(key) ON DELETE CASCADE,
  enabled         boolean NOT NULL,
  updated_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_feature_defaults_unique UNIQUE (organization_id, feature_key)
);

COMMENT ON TABLE public.organization_feature_defaults IS
  'Default de permissao por organizacao. Resolve ENTRE o override do membro (member_feature_permissions) e o catalogo global (feature_permissions.default_value). E o que faz contratado novo herdar a politica da org em vez do default do produto.';

-- O UNIQUE ja cobre a busca por (org, key); este indice existe para o caminho
-- "todos os defaults da org", que a UI faz a cada abertura da tela.
CREATE INDEX IF NOT EXISTS idx_org_feature_defaults_org
  ON public.organization_feature_defaults (organization_id);

ALTER TABLE public.organization_feature_defaults ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer membro da org. A UI precisa mostrar o EFETIVO, e esconder
-- o default tornaria a tela mentirosa para quem nao e admin.
DROP POLICY IF EXISTS "org_feature_defaults_read_own_org" ON public.organization_feature_defaults;
CREATE POLICY "org_feature_defaults_read_own_org"
  ON public.organization_feature_defaults FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- Escrita: admin da PROPRIA org. get_my_admin_organization_ids() e
-- SECURITY DEFINER e org-aware -- admin de outra org nao alcanca.
DROP POLICY IF EXISTS "org_feature_defaults_admin_write" ON public.organization_feature_defaults;
CREATE POLICY "org_feature_defaults_admin_write"
  ON public.organization_feature_defaults FOR ALL
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));

DROP POLICY IF EXISTS "org_feature_defaults_master" ON public.organization_feature_defaults;
CREATE POLICY "org_feature_defaults_master"
  ON public.organization_feature_defaults FOR ALL
  USING ((SELECT public.is_master_user()))
  WITH CHECK ((SELECT public.is_master_user()));

DROP POLICY IF EXISTS "org_feature_defaults_service_role" ON public.organization_feature_defaults;
CREATE POLICY "org_feature_defaults_service_role"
  ON public.organization_feature_defaults FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.organization_feature_defaults FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_feature_defaults TO authenticated;
GRANT ALL ON public.organization_feature_defaults TO service_role;

-- ============================================================
-- Auditoria
-- ============================================================
ALTER TABLE public.permission_audit_log
  DROP CONSTRAINT IF EXISTS permission_audit_log_table_name_check;

ALTER TABLE public.permission_audit_log
  ADD CONSTRAINT permission_audit_log_table_name_check
  CHECK (table_name = ANY (ARRAY[
    'organization_role_permissions'::text,
    'feature_permissions'::text,
    'organizations'::text,
    'organization_feature_defaults'::text
  ]));

CREATE OR REPLACE FUNCTION public.tg_audit_org_feature_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.permission_audit_log
    (organization_id, changed_by_user_id, changed_by_role, table_name,
     permission_key, role, old_enabled, new_enabled)
  VALUES (
    COALESCE(NEW.organization_id, OLD.organization_id),
    auth.uid(),
    CASE WHEN public.is_master_user() THEN 'master' ELSE 'admin' END,
    'organization_feature_defaults',
    COALESCE(NEW.feature_key, OLD.feature_key),
    'member',
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.enabled END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.enabled END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_org_feature_default ON public.organization_feature_defaults;
CREATE TRIGGER trg_audit_org_feature_default
  AFTER INSERT OR UPDATE OR DELETE ON public.organization_feature_defaults
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_org_feature_default();

CREATE OR REPLACE FUNCTION public.tg_touch_org_feature_default()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_org_feature_default ON public.organization_feature_defaults;
CREATE TRIGGER trg_touch_org_feature_default
  BEFORE INSERT OR UPDATE ON public.organization_feature_defaults
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_org_feature_default();

-- ============================================================
-- A cascata ganha o degrau do meio
-- ============================================================
-- Unica mudanca de comportamento: o SELECT em organization_feature_defaults
-- entre o override do membro e o default do catalogo. Sem linha na tabela, o
-- resultado e byte a byte o de antes.
CREATE OR REPLACE FUNCTION public.has_feature_permission(p_feature_key text, p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_member_id UUID;
  v_is_admin       BOOLEAN;
  v_enabled        BOOLEAN;
  v_org_default    BOOLEAN;
  v_default        BOOLEAN;
  v_admin_only     BOOLEAN;
BEGIN
  IF public.is_master_user() THEN RETURN true; END IF;

  IF p_org_id IS NULL THEN RETURN false; END IF;

  SELECT id, (role = 'admin') INTO v_team_member_id, v_is_admin
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND organization_id = p_org_id
    AND is_active = true
  LIMIT 1;

  IF v_team_member_id IS NULL THEN RETURN false; END IF;
  IF v_is_admin THEN RETURN true; END IF;

  SELECT fp.is_admin_only, fp.default_value INTO v_admin_only, v_default
  FROM public.feature_permissions fp WHERE fp.key = p_feature_key;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_admin_only THEN RETURN false; END IF;

  -- 1) override individual
  SELECT mfp.enabled INTO v_enabled
  FROM public.member_feature_permissions mfp
  WHERE mfp.team_member_id = v_team_member_id
    AND mfp.feature_key = p_feature_key;

  IF v_enabled IS NOT NULL THEN RETURN v_enabled; END IF;

  -- 2) default da organizacao
  SELECT ofd.enabled INTO v_org_default
  FROM public.organization_feature_defaults ofd
  WHERE ofd.organization_id = p_org_id
    AND ofd.feature_key = p_feature_key;

  IF v_org_default IS NOT NULL THEN RETURN v_org_default; END IF;

  -- 3) catalogo global
  RETURN COALESCE(v_default, false);
END;
$$;

COMMENT ON FUNCTION public.has_feature_permission(text, uuid) IS
  'Permissao efetiva do usuario atual na org. Cascata: master -> admin da org -> admin-only nega -> override do membro -> default da ORG -> default_value do catalogo global.';

REVOKE ALL ON FUNCTION public.has_feature_permission(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_feature_permission(text, uuid) TO authenticated, service_role;
