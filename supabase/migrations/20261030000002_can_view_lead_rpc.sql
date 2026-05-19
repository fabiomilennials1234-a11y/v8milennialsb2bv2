-- =============================================================================
-- Migration: RPC can_view_lead(lead_id uuid) + enum lead_visibility_status
-- Issue: #290 (PRD #284 — Modal Lead v2, error states do useLeadDetail)
-- Date: 2026-10-30 (filename) / authored 2026-05-19
-- =============================================================================
--
-- Hoje o modal de lead lida com 3 cenários falhos indistinguíveis:
--   1. Lead não existe (uuid digitado errado / link velho)
--   2. Lead foi soft-deletado (lixeira, 30d retention — migration 20261006)
--   3. Lead pertence a outra org (RLS bloqueia SELECT)
--
-- Frontend recebe `null`/`undefined` em todos e renderiza "lead não
-- encontrado" — mensagem errada quando o real é "sem permissão" ou
-- "lead na lixeira". Este RPC encapsula a checagem 1x server-side com
-- SECURITY DEFINER (bypass RLS) e retorna o status + metadata pro
-- frontend renderizar mensagem certa.
--
-- Master role bypass: vê tudo como `exists`. Metadata sinaliza
-- `cross_org: true` quando master abre lead fora das suas orgs ativas.

-- 1. Enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_visibility_status') THEN
    CREATE TYPE public.lead_visibility_status AS ENUM (
      'exists',
      'not_found',
      'deleted',
      'permission_denied'
    );
  END IF;
END $$;

-- 2. RPC
CREATE OR REPLACE FUNCTION public.can_view_lead(p_lead_id uuid)
RETURNS TABLE (
  status public.lead_visibility_status,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_master boolean := false;
  v_lead RECORD;
  v_in_org boolean := false;
BEGIN
  -- Auth required
  IF v_user_id IS NULL THEN
    status := 'permission_denied'::public.lead_visibility_status;
    metadata := jsonb_build_object('reason', 'unauthenticated');
    RETURN NEXT;
    RETURN;
  END IF;

  -- Master check
  SELECT EXISTS (
    SELECT 1 FROM public.master_users
    WHERE user_id = v_user_id AND is_active = true
  ) INTO v_is_master;

  -- Lookup lead bypassing RLS
  SELECT id, organization_id, deleted_at, deleted_by
    INTO v_lead
    FROM public.leads
    WHERE id = p_lead_id;

  IF NOT FOUND THEN
    status := 'not_found'::public.lead_visibility_status;
    metadata := '{}'::jsonb;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Master sees everything as `exists`; flag cross_org when applicable.
  IF v_is_master THEN
    SELECT EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = v_user_id
        AND organization_id = v_lead.organization_id
        AND is_active = true
    ) INTO v_in_org;

    -- Master sees deleted leads too — flag both in metadata so UI can
    -- show "lead na lixeira" overlay without changing the gate.
    status := 'exists'::public.lead_visibility_status;
    metadata := jsonb_build_object(
      'master', true,
      'cross_org', NOT v_in_org,
      'organization_id', v_lead.organization_id,
      'deleted_at', v_lead.deleted_at,
      'deleted_by', v_lead.deleted_by
    );
    RETURN NEXT;
    RETURN;
  END IF;

  -- Regular user — must share org with the lead.
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = v_user_id
      AND organization_id = v_lead.organization_id
      AND is_active = true
  ) INTO v_in_org;

  IF NOT v_in_org THEN
    -- Don't leak existence of cross-org lead. Permission denied is the
    -- correct response — UI shows "peça acesso ao admin".
    status := 'permission_denied'::public.lead_visibility_status;
    metadata := '{}'::jsonb;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_lead.deleted_at IS NOT NULL THEN
    status := 'deleted'::public.lead_visibility_status;
    metadata := jsonb_build_object(
      'deleted_at', v_lead.deleted_at,
      'deleted_by', v_lead.deleted_by
    );
    RETURN NEXT;
    RETURN;
  END IF;

  status := 'exists'::public.lead_visibility_status;
  metadata := jsonb_build_object('organization_id', v_lead.organization_id);
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.can_view_lead(uuid) IS
  'Distingue not_found / deleted / permission_denied / exists para o modal de lead. SECURITY DEFINER bypassa RLS. Master vê tudo como exists com cross_org+deleted_at em metadata. PRD #284 Fase 3 error states.';

-- 3. Permissões
REVOKE ALL ON FUNCTION public.can_view_lead(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_view_lead(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_lead(uuid) TO service_role;
