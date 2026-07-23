-- 20270723000000_org_has_feature.sql
-- Backstop server-side de gating por plano.
--
-- Substitui 20270103000000_org_has_feature_and_guards.sql, que NUNCA foi
-- aplicada: três migrations dividiam o prefixo 20270103000000 e o ledger
-- registrou apenas `plan_gating_feature_flag_defaults`. `supabase db push`
-- considera a versão aplicada e pula as demais em silêncio — mesma classe do
-- incidente #640 (ver scripts/check-migration-versions.sh). Resultado em prod:
-- `org_has_feature` nunca existiu, e `cadastro-externo-push` — que a chama via
-- assertOrgFeature — falhou em 100% das tentativas desde 2026-07-13.
--
-- org_has_feature reusa org_get_features_and_limits (mesma resolução que o
-- frontend: plano base + organization_features overrides + feature_flags
-- default), então nunca diverge do hasFeature do cliente.
-- search_path pinado (classe dos 58 definers — hardening).

CREATE OR REPLACE FUNCTION public.org_has_feature(p_org_id uuid, p_feature_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    (public.org_get_features_and_limits(p_org_id) -> 'features' ->> p_feature_key)::boolean,
    false
  );
$$;

COMMENT ON FUNCTION public.org_has_feature(uuid, text) IS
  'True se a org tem a feature liberada no plano (reusa org_get_features_and_limits).';

-- ── Trigger genérico de guard de INSERT ──────────────────────
-- Mantido como ferramenta, deliberadamente NÃO anexado a nenhuma tabela.
-- Cada trigger passaria a feature_key esperada via TG_ARGV[0].
CREATE OR REPLACE FUNCTION public.enforce_feature_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_feature text := TG_ARGV[0];
BEGIN
  IF NOT public.org_has_feature(NEW.organization_id, v_feature) THEN
    RAISE EXCEPTION 'feature_locked: % indisponível no plano da organização', v_feature
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ── Guards NÃO anexados — e por quê ──────────────────────────
-- A migration original anexava enforce_feature_on_insert a copilot_agents
-- ('copilot'), custom_pipelines ('funnels_custom') e message_templates
-- ('message_templates'). Medido contra a prod em 2026-07-22:
--
--   custom_pipelines   37 orgs usam, 37 (100%) seriam bloqueadas, 20 inserts/30d
--   copilot_agents     42 orgs usam,  0 bloqueadas
--   message_templates   2 orgs usam,  0 bloqueadas
--
-- Anexar o guard de 'funnels_custom' hoje quebraria a criação de funil
-- customizado para TODAS as orgs que a usam — a feature key não é concedida por
-- nenhum plano vigente. Os guards só voltam depois que a matriz de planos for
-- calibrada e a medição acima der zero bloqueadas.
--
-- DROP defensivo: converge qualquer ambiente onde a migration original chegou a
-- rodar (prod nunca rodou; dev não verificável por permissão).
DROP TRIGGER IF EXISTS trg_enforce_feature_copilot ON public.copilot_agents;
DROP TRIGGER IF EXISTS trg_enforce_feature_custom_funnels ON public.custom_pipelines;
DROP TRIGGER IF EXISTS trg_enforce_feature_templates ON public.message_templates;
