-- Chat authorization functions captured from production on 2026-10-23.
-- Used with synthetic users/leads to exercise the real RLS predicate.
CREATE OR REPLACE FUNCTION private.chat_scope_for_recipient(p_user_id uuid, p_org_id uuid, p_lead_id uuid, p_normalized_phone text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_team_member_id uuid;
  v_restricted     boolean;
BEGIN
  IF public.is_master_user(p_user_id) THEN RETURN true; END IF;
  IF p_org_id IS NULL THEN RETURN false; END IF;

  SELECT id INTO v_team_member_id
  FROM public.team_members
  WHERE user_id = p_user_id
    AND organization_id = p_org_id
    AND is_active = true
  LIMIT 1;

  IF v_team_member_id IS NULL THEN RETURN false; END IF;

  IF EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org_id AND feature_flags @> '{"strict_lead_owner_access":true}'::jsonb) THEN
    RETURN EXISTS(SELECT 1 FROM public.team_members WHERE id=v_team_member_id AND role='admin')
      OR EXISTS(SELECT 1 FROM public.leads l WHERE l.organization_id=p_org_id
        AND ((p_lead_id IS NOT NULL AND l.id=p_lead_id) OR (p_lead_id IS NULL AND l.normalized_phone=p_normalized_phone))
        AND private.strict_lead_owned_by(p_org_id,l.id,p_user_id));
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin') OR EXISTS (SELECT 1 FROM public.team_members WHERE user_id = p_user_id AND role = 'admin' AND is_active) THEN RETURN true; END IF;

  SELECT chat_restrict_to_owner INTO v_restricted
  FROM public.organizations WHERE id = p_org_id;

  -- Politica desligada: comportamento identico ao de antes.
  IF COALESCE(v_restricted, false) = false THEN RETURN true; END IF;

  -- Excecao nominal: com a politica ligada o default_value do catalogo GLOBAL
  -- deixa de valer, so override EXPLICITO abre.
  IF EXISTS (
    SELECT 1 FROM public.member_feature_permissions
    WHERE team_member_id = v_team_member_id
      AND feature_key = 'leads.view_all'
      AND enabled
  ) THEN
    RETURN true;
  END IF;

  IF p_lead_id IS NULL AND p_normalized_phone IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.organization_id = p_org_id
      AND l.deleted_at IS NULL
      AND (
        (p_lead_id IS NOT NULL AND l.id = p_lead_id)
        OR (p_lead_id IS NULL AND l.normalized_phone = p_normalized_phone)
      )
      AND (
        COALESCE(
          v_team_member_id IN (
            l.pre_sale_responsible_id,
            l.sale_responsible_id,
            l.sdr_id,
            l.closer_id
          ), false)
        -- Co-dono (Chamado 793f4b05 · PR4b, decisão 5): o aviso de mensagem vai
        -- a TODOS os donos. Linha 'co' só existe em org com lead_owners_n_donos.
        OR EXISTS (
          SELECT 1 FROM public.lead_owners lo
          WHERE lo.lead_id = l.id AND lo.team_member_id = v_team_member_id AND lo.role = 'co'
        )
        OR (
          COALESCE(
            l.pre_sale_responsible_id,
            l.sale_responsible_id,
            l.sdr_id,
            l.closer_id
          ) IS NULL
          AND EXISTS (
            SELECT 1 FROM public.member_feature_permissions
            WHERE team_member_id = v_team_member_id
              AND feature_key = 'leads.view_unassigned'
              AND enabled
          )
        )
      )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_see_chat_scope(p_org_id uuid, p_lead_id uuid, p_normalized_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT (NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=p_org_id
           AND o.feature_flags @> '{"strict_lead_owner_access":true}'::jsonb)
         OR private.strict_phone_visible(p_org_id,p_lead_id,p_normalized_phone))
   AND private.chat_scope_for_recipient(auth.uid(),p_org_id,p_lead_id,p_normalized_phone);
$function$;

CREATE OR REPLACE FUNCTION public.can_see_chat(p_org_id uuid, p_normalized_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.can_see_chat_scope(p_org_id, NULL, p_normalized_phone)
$function$;

CREATE OR REPLACE FUNCTION private.chat_unrestricted_org_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(array_agg(o.id), ARRAY[]::uuid[])
    FROM public.get_my_organization_ids() AS m(org_id)
    JOIN public.organizations o ON o.id = m.org_id
   WHERE NOT COALESCE(o.chat_restrict_to_owner, false);
$function$;
