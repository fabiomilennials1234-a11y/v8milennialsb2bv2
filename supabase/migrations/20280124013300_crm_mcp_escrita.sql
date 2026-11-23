-- crm-mcp v2 — fundação de ESCRITA: escopos no token, plano de uso único e auditoria.
--
-- ── Por que ───────────────────────────────────────────────────────────────
-- O v1 era só leitura (ADR 0012, D11). As fatias 2–4 do v2 deixam a IA do cliente
-- mover cards, disparar mensagens e montar automações. Escrever por IA amplia o
-- risco; este é o chão comum que toda ferramenta de escrita usa:
--
--   1. ESCOPO no token, escolhido na criação: read (sempre) + crm:write,
--      messages:send, automations:write. Só entra escopo que a pessoa já pode exercer
--      no app, e só em org com a flag `crm_mcp_write`. Revalidado a cada chamada.
--   2. PLANO de uso único: toda escrita é `plan` → `confirm`. O plano fica guardado
--      aqui (não volta do cliente), vale 5 min, só o MESMO token confirma, e uma vez.
--   3. AUDITORIA: cada ação (plano, aplicação, resultado, desfazer) é uma linha que o
--      admin da org vê. Só o caminho do MCP escreve nela — o navegador não forja
--      registro: as funções são executáveis só pelo papel crm_mcp_resolver.
--
-- Rollback: rollback/20280124013300_crm_mcp_escrita.sql

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Escopos
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public.personal_access_tokens DROP CONSTRAINT IF EXISTS pat_scopes_v1;
ALTER TABLE public.personal_access_tokens DROP CONSTRAINT IF EXISTS pat_scopes_v2;
ALTER TABLE public.personal_access_tokens ADD CONSTRAINT pat_scopes_v2 CHECK (
  'read' = ANY (scopes)
  AND scopes <@ ARRAY['read', 'crm:write', 'messages:send', 'automations:write']::text[]
);

CREATE OR REPLACE FUNCTION public.crm_mcp_write_enabled(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT (o.feature_flags -> 'crm_mcp_write') = 'true'::jsonb
      FROM public.organizations o
     WHERE o.id = p_org
  ), false);
$$;

-- Pode (usuário, org) exercer este escopo? Mesma régua do app:
--   crm:write         → permissão pipeline.move_cards
--   automations:write → permissão workflows.create
--   messages:send     → admin da org (Disparos não tem chave própria; disparar em massa
--                       pela IA fica com quem responde pela org)
-- Responde sobre QUALQUER usuário: fechada ao navegador (só DEFINER chamam).
CREATE OR REPLACE FUNCTION public.crm_mcp_scope_check(p_user uuid, p_org uuid, p_scope text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tm uuid;
  v_admin boolean;
BEGIN
  IF p_scope = 'read' THEN
    RETURN 'ok';
  END IF;
  IF NOT public.crm_mcp_write_enabled(p_org) THEN
    RETURN 'write_disabled';
  END IF;
  SELECT tm.id, tm.role = 'admin' INTO v_tm, v_admin
    FROM public.team_members tm
   WHERE tm.user_id = p_user AND tm.organization_id = p_org AND tm.is_active = true
   LIMIT 1;
  IF v_tm IS NULL THEN
    RETURN 'not_member';
  END IF;
  IF p_scope = 'messages:send' THEN
    RETURN CASE WHEN v_admin THEN 'ok' ELSE 'scope_admin_only' END;
  END IF;
  IF v_admin THEN
    RETURN 'ok';
  END IF;
  RETURN CASE p_scope
    WHEN 'crm:write' THEN
      CASE WHEN public._crm_mcp_member_feature(v_tm, 'pipeline.move_cards') THEN 'ok' ELSE 'scope_permission' END
    WHEN 'automations:write' THEN
      CASE WHEN public._crm_mcp_member_feature(v_tm, 'workflows.create') THEN 'ok' ELSE 'scope_permission' END
    ELSE 'scope_unknown'
  END;
END
$$;

-- A mesma resolução de has_feature_permission (override do membro → padrão da org →
-- padrão da chave), mas para um team_member explícito, sem depender de auth.uid():
-- a revalidação acontece também no resolver, onde não há sessão.
CREATE OR REPLACE FUNCTION public._crm_mcp_member_feature(p_team_member_id uuid, p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org uuid;
  v_enabled boolean;
  v_default boolean;
  v_admin_only boolean;
BEGIN
  SELECT tm.organization_id INTO v_org FROM public.team_members tm WHERE tm.id = p_team_member_id;
  SELECT fp.is_admin_only, fp.default_value INTO v_admin_only, v_default
    FROM public.feature_permissions fp WHERE fp.key = p_key;
  IF NOT FOUND OR v_admin_only THEN
    RETURN false;
  END IF;
  -- Ordem idêntica a has_feature_permission(text, uuid): override do membro, padrão
  -- da org (organization_feature_defaults), padrão da chave.
  SELECT mfp.enabled INTO v_enabled
    FROM public.member_feature_permissions mfp
   WHERE mfp.team_member_id = p_team_member_id AND mfp.feature_key = p_key
   LIMIT 1;
  IF v_enabled IS NOT NULL THEN
    RETURN v_enabled;
  END IF;
  SELECT ofd.enabled INTO v_enabled
    FROM public.organization_feature_defaults ofd
   WHERE ofd.organization_id = v_org AND ofd.feature_key = p_key;
  IF v_enabled IS NOT NULL THEN
    RETURN v_enabled;
  END IF;
  RETURN COALESCE(v_default, false);
END
$$;

-- issue_check ganha os escopos pedidos (a policy de INSERT passa os da linha).
DROP POLICY IF EXISTS pat_owner_insert ON public.personal_access_tokens;
DROP FUNCTION IF EXISTS public.crm_mcp_issue_check(uuid);

CREATE OR REPLACE FUNCTION public.crm_mcp_issue_check(p_org uuid, p_scopes text[] DEFAULT ARRAY['read']::text[])
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_base text;
  v_scope text;
  v_r text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'unauthenticated';
  END IF;
  v_base := public.crm_mcp_principal_check(auth.uid(), p_org);
  IF v_base <> 'ok' THEN
    RETURN v_base;
  END IF;
  FOREACH v_scope IN ARRAY COALESCE(p_scopes, ARRAY['read']::text[]) LOOP
    v_r := public.crm_mcp_scope_check(auth.uid(), p_org, v_scope);
    IF v_r <> 'ok' THEN
      RETURN v_r || ':' || v_scope;
    END IF;
  END LOOP;
  RETURN 'ok';
END
$$;

CREATE POLICY pat_owner_insert ON public.personal_access_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND created_by = (SELECT auth.uid())
    AND public.crm_mcp_issue_check(organization_id, scopes) = 'ok'
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 2 e 3. Ações: plano de uso único + auditoria
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.crm_mcp_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pat_id          uuid NOT NULL REFERENCES public.personal_access_tokens(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  tool            text NOT NULL CHECK (tool ~ '^[a-z]+(\.[a-z_]+)+$'),
  scope           text NOT NULL CHECK (scope IN ('crm:write', 'messages:send', 'automations:write')),
  summary         text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 2000),
  plan            jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned', 'confirming', 'applied', 'partial', 'failed', 'expired', 'undone')),
  result          jsonb,
  undo_of         uuid REFERENCES public.crm_mcp_actions(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  applied_at      timestamptz
);
CREATE INDEX IF NOT EXISTS crm_mcp_actions_org_idx ON public.crm_mcp_actions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_mcp_actions_pat_idx ON public.crm_mcp_actions (pat_id, created_at DESC);

ALTER TABLE public.crm_mcp_actions ENABLE ROW LEVEL SECURITY;

-- Leitura: quem agiu, o admin da org e o master. Escrita: ninguém do navegador.
DROP POLICY IF EXISTS crm_mcp_actions_select ON public.crm_mcp_actions;
CREATE POLICY crm_mcp_actions_select ON public.crm_mcp_actions
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR organization_id IN (SELECT public.get_my_admin_organization_ids())
    OR (SELECT public.is_master_user())
  );

REVOKE ALL ON public.crm_mcp_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_mcp_actions TO authenticated;
GRANT ALL ON public.crm_mcp_actions TO service_role;

-- O token (pelo hash) precisa estar válido e ser do usuário/org de agora: a ação
-- nasce amarrada a ELE. Devolve o pat ou NULL.
CREATE OR REPLACE FUNCTION public._crm_mcp_live_pat(p_token_hash text)
RETURNS public.personal_access_tokens
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t.*
    FROM public.personal_access_tokens t
   WHERE t.token_hash = p_token_hash
     AND t.revoked_at IS NULL
     AND t.expires_at > now()
     AND public.crm_mcp_principal_check(t.user_id, t.organization_id) = 'ok';
$$;

-- Abre um plano. O escopo é revalidado AGORA (a permissão pode ter mudado depois
-- da emissão do token).
CREATE OR REPLACE FUNCTION public.crm_mcp_action_open(
  p_token_hash text, p_tool text, p_scope text, p_summary text, p_plan jsonb
)
RETURNS TABLE (action_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  t public.personal_access_tokens;
  v_scope text;
  v_id uuid;
  v_exp timestamptz;
BEGIN
  t := public._crm_mcp_live_pat(p_token_hash);
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'crm_mcp: token inválido' USING ERRCODE = '28000';
  END IF;
  IF NOT (p_scope = ANY (t.scopes)) THEN
    RAISE EXCEPTION 'crm_mcp: token sem o escopo %', p_scope USING ERRCODE = '42501';
  END IF;
  v_scope := public.crm_mcp_scope_check(t.user_id, t.organization_id, p_scope);
  IF v_scope <> 'ok' THEN
    RAISE EXCEPTION 'crm_mcp: escopo % negado (%)', p_scope, v_scope USING ERRCODE = '42501';
  END IF;
  IF pg_column_size(p_plan) > 512 * 1024 THEN
    RAISE EXCEPTION 'crm_mcp: plano grande demais' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.crm_mcp_actions (organization_id, pat_id, user_id, tool, scope, summary, plan)
  VALUES (t.organization_id, t.id, t.user_id, p_tool, p_scope, left(p_summary, 2000), p_plan)
  RETURNING id, crm_mcp_actions.expires_at INTO v_id, v_exp;

  RETURN QUERY SELECT v_id, v_exp;
END
$$;

-- Confirma: devolve o plano UMA vez (planned → confirming), só para o mesmo token,
-- só dentro da validade. Qualquer outra coisa → nenhuma linha.
CREATE OR REPLACE FUNCTION public.crm_mcp_action_take(p_token_hash text, p_action_id uuid)
RETURNS TABLE (action_id uuid, tool text, plan jsonb)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  t public.personal_access_tokens;
BEGIN
  t := public._crm_mcp_live_pat(p_token_hash);
  IF t.id IS NULL THEN
    RETURN;
  END IF;
  -- Revalida o escopo também na confirmação.
  RETURN QUERY
  UPDATE public.crm_mcp_actions a
     SET status = 'confirming'
   WHERE a.id = p_action_id
     AND a.pat_id = t.id
     AND a.status = 'planned'
     AND a.expires_at > now()
     AND public.crm_mcp_scope_check(t.user_id, t.organization_id, a.scope) = 'ok'
  RETURNING a.id, a.tool, a.plan;
END
$$;

-- Fecha a ação com o resultado. Só sai de 'confirming' (ou registra o desfazer).
CREATE OR REPLACE FUNCTION public.crm_mcp_action_finish(
  p_token_hash text, p_action_id uuid, p_status text, p_result jsonb
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  t public.personal_access_tokens;
  v_n integer;
BEGIN
  IF p_status NOT IN ('applied', 'partial', 'failed') THEN
    RAISE EXCEPTION 'crm_mcp: status inválido %', p_status USING ERRCODE = '22023';
  END IF;
  t := public._crm_mcp_live_pat(p_token_hash);
  IF t.id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.crm_mcp_actions a
     SET status = p_status, result = p_result, applied_at = now()
   WHERE a.id = p_action_id AND a.pat_id = t.id AND a.status = 'confirming';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END
$$;

-- Para desfazer: lê uma ação aplicada do MESMO token, nas últimas 24 h, ainda não desfeita.
CREATE OR REPLACE FUNCTION public.crm_mcp_action_get_applied(p_token_hash text, p_action_id uuid)
RETURNS TABLE (action_id uuid, tool text, plan jsonb, result jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  t public.personal_access_tokens;
BEGIN
  t := public._crm_mcp_live_pat(p_token_hash);
  IF t.id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT a.id, a.tool, a.plan, a.result
    FROM public.crm_mcp_actions a
   WHERE a.id = p_action_id
     AND a.pat_id = t.id
     AND a.status IN ('applied', 'partial')
     AND a.applied_at > now() - interval '24 hours';
END
$$;

CREATE OR REPLACE FUNCTION public.crm_mcp_action_mark_undone(p_token_hash text, p_action_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  t public.personal_access_tokens;
  v_n integer;
BEGIN
  t := public._crm_mcp_live_pat(p_token_hash);
  IF t.id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.crm_mcp_actions a SET status = 'undone'
   WHERE a.id = p_action_id AND a.pat_id = t.id AND a.status IN ('applied', 'partial');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END
$$;

-- Faxina: planos vencidos viram 'expired'; ações com mais de 1 ano saem.
CREATE OR REPLACE FUNCTION public.crm_mcp_housekeeping()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_revogados integer;
  v_contadores integer;
  v_recusas integer;
  v_planos integer;
  v_acoes integer;
BEGIN
  UPDATE public.personal_access_tokens
     SET revoked_at = now(), revoked_reason = 'auto_unused'
   WHERE revoked_at IS NULL
     AND expires_at > now()
     AND COALESCE(last_used_at, created_at) < now() - interval '90 days';
  GET DIAGNOSTICS v_revogados = ROW_COUNT;

  DELETE FROM public.crm_mcp_rate_counters WHERE window_start < now() - interval '2 days';
  GET DIAGNOSTICS v_contadores = ROW_COUNT;

  DELETE FROM public.crm_mcp_auth_denials WHERE window_start < now() - interval '90 days';
  GET DIAGNOSTICS v_recusas = ROW_COUNT;

  UPDATE public.crm_mcp_actions SET status = 'expired'
   WHERE status IN ('planned', 'confirming') AND expires_at < now() - interval '1 hour';
  GET DIAGNOSTICS v_planos = ROW_COUNT;

  DELETE FROM public.crm_mcp_actions WHERE created_at < now() - interval '1 year';
  GET DIAGNOSTICS v_acoes = ROW_COUNT;

  RETURN jsonb_build_object(
    'revogados_sem_uso', v_revogados,
    'contadores_apagados', v_contadores,
    'recusas_apagadas', v_recusas,
    'planos_expirados', v_planos,
    'acoes_apagadas', v_acoes
  );
END
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- Grants
-- ═════════════════════════════════════════════════════════════════════════
REVOKE ALL ON FUNCTION public.crm_mcp_write_enabled(uuid)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_mcp_scope_check(uuid, uuid, text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._crm_mcp_member_feature(uuid, text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._crm_mcp_live_pat(text)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_mcp_issue_check(uuid, text[])              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_mcp_issue_check(uuid, text[])           TO authenticated;

REVOKE ALL ON FUNCTION public.crm_mcp_action_open(text, text, text, text, jsonb)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_mcp_action_take(text, uuid)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_mcp_action_finish(text, uuid, text, jsonb)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_mcp_action_get_applied(text, uuid)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_mcp_action_mark_undone(text, uuid)               FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mcp_action_open(text, text, text, text, jsonb) TO crm_mcp_resolver;
GRANT EXECUTE ON FUNCTION public.crm_mcp_action_take(text, uuid)                    TO crm_mcp_resolver;
GRANT EXECUTE ON FUNCTION public.crm_mcp_action_finish(text, uuid, text, jsonb)     TO crm_mcp_resolver;
GRANT EXECUTE ON FUNCTION public.crm_mcp_action_get_applied(text, uuid)             TO crm_mcp_resolver;
GRANT EXECUTE ON FUNCTION public.crm_mcp_action_mark_undone(text, uuid)             TO crm_mcp_resolver;
