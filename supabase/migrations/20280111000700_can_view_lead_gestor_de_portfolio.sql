-- can_view_lead só reconhecia team_members da org do lead. Gestor de portfólio
-- (ADR-0021: gestores + gestor_organizations) lê o lead pela RLS de `leads`,
-- mas esta RPC devolvia permission_denied e a ficha abria
-- "Você não tem acesso a este lead." para ele.
-- Única mudança: v_in_org também é verdadeiro para org do portfólio do gestor ativo.

CREATE OR REPLACE FUNCTION public.can_view_lead(p_lead_id uuid)
 RETURNS TABLE(status lead_visibility_status, metadata jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    FROM private.leads
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

  -- Regular user — membro ativo da org do lead OU gestor ativo com a org no portfólio.
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = v_user_id
      AND organization_id = v_lead.organization_id
      AND is_active = true
  ) OR EXISTS (
    SELECT 1 FROM public.get_my_gestor_organization_ids() AS g(org_id)
    WHERE g.org_id = v_lead.organization_id
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
$function$;
