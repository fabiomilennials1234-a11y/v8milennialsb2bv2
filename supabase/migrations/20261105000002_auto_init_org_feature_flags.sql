-- =============================================================================
-- Hotfix: novas orgs nascem sem `new_lead_modal_v2` → renderizam modal V1
-- Issue: bug report CTO 2026-05-28
-- Date: 2026-05-28
-- =============================================================================
--
-- Contexto:
--   Migration 20261031000003 ligou `new_lead_modal_v2 = true` em todas as
--   orgs existentes via UPDATE. Como `organizations.feature_flags` tem default
--   `'{}'::jsonb` e não há trigger de inicialização, orgs criadas APÓS aquela
--   migration nascem com flag ausente → hook `useFeatureFlag` retorna false →
--   `LeadDetailDialog` renderiza V1 (legacy).
--
--   Verificado em prod (2026-05-28): 8 de 61 orgs sem o flag.
--
-- Fix em duas partes (mesma migration, atômica):
--   1. Trigger BEFORE INSERT que merge defaults em `feature_flags` para qualquer
--      org nova. Idempotente — só preenche keys ausentes (`||` left-side
--      preserva valores já setados explicitamente).
--   2. UPDATE de catch-up nas 8 orgs órfãs (rows entre a 20261031000003 e
--      hoje). Idempotente — merge não sobrescreve valores existentes.
--
-- Defaults centralizados em função `public.default_org_feature_flags()` para
-- escalar: novo flag em rollout = adicionar key aqui + UPDATE catch-up
-- separado se quiser ativar pro legado.
--
-- Reversível:
--   DROP TRIGGER trg_default_org_feature_flags ON public.organizations;
--   DROP FUNCTION public.set_default_org_feature_flags();
--   DROP FUNCTION public.default_org_feature_flags();

CREATE OR REPLACE FUNCTION public.default_org_feature_flags()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'new_lead_modal_v2', true
  );
$$;

COMMENT ON FUNCTION public.default_org_feature_flags() IS
  'Defaults de feature flags aplicados a novas orgs via trigger. Source of truth — adicionar keys aqui pra ligar feature por default em orgs novas.';

CREATE OR REPLACE FUNCTION public.set_default_org_feature_flags()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Defaults primeiro, override com qualquer valor explícito no INSERT.
  -- `||` direito vence em conflito → preserva intenção explícita.
  NEW.feature_flags := public.default_org_feature_flags()
                       || COALESCE(NEW.feature_flags, '{}'::jsonb);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_default_org_feature_flags() IS
  'Trigger BEFORE INSERT em organizations — popula feature_flags com defaults de default_org_feature_flags(). Valores explícitos no INSERT vencem defaults.';

DROP TRIGGER IF EXISTS trg_default_org_feature_flags ON public.organizations;

CREATE TRIGGER trg_default_org_feature_flags
  BEFORE INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_default_org_feature_flags();

-- Catch-up das orgs órfãs (criadas após 20261031000003 sem o flag).
-- Merge à direita preserva qualquer valor já setado explicitamente.
UPDATE public.organizations
   SET feature_flags = public.default_org_feature_flags() || COALESCE(feature_flags, '{}'::jsonb),
       updated_at = now()
 WHERE NOT (feature_flags ? 'new_lead_modal_v2');

-- Validação — log inline pra audit.
DO $$
DECLARE
  v_total int;
  v_v2 int;
  v_missing int;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.organizations;
  SELECT COUNT(*) INTO v_v2
    FROM public.organizations
   WHERE feature_flags->>'new_lead_modal_v2' = 'true';
  SELECT COUNT(*) INTO v_missing
    FROM public.organizations
   WHERE NOT (feature_flags ? 'new_lead_modal_v2');
  RAISE NOTICE 'orgs total=% | new_lead_modal_v2 on=% | missing=%', v_total, v_v2, v_missing;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'catch-up incompleto: % orgs ainda sem new_lead_modal_v2', v_missing;
  END IF;
END $$;
