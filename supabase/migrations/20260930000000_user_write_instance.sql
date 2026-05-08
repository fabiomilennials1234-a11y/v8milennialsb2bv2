-- Migration: User Write Instance (Etapa A)
-- Description: Vincula cada usuário a 1 instância de escrita ativa por org.
--   Schema:
--     - whatsapp_instances.owner_team_member_id (FK team_members)
--     - leads.responsible_user_id (FK team_members) — fecha gap docs↔schema
--     - whatsapp_instance_owner_history (auditoria)
--     - feature_flag user_write_instance_strict
--   RPCs:
--     - get_user_write_instance(p_user_id, p_organization_id)
--     - get_lead_write_instance(p_lead_id) — error_code estruturado
--     - can_user_write_instance(p_user_id, p_instance_id) — admin/master bypass
--     - set_instance_owner(p_instance_id, p_new_owner_team_member_id, p_reason)
--   Backfill:
--     - leads.responsible_user_id := COALESCE(closer_id, sdr_id)
--     - whatsapp_instances.owner_team_member_id := único allowed_member quando count = 1
-- Date: 2026-09-30

-- ============================================================
-- 1. SCHEMA — whatsapp_instances.owner_team_member_id
-- ============================================================

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS owner_team_member_id uuid
  REFERENCES public.team_members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.whatsapp_instances.owner_team_member_id IS
  'Vínculo 1:1 user (team_member) → instância de escrita ativa nesta org. NULL = sem owner (admin/master ainda pode escrever).';

-- Garante 1 owner ativo por org (vínculo único). NULLs liberados.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_instances_owner_per_org
  ON public.whatsapp_instances(organization_id, owner_team_member_id)
  WHERE owner_team_member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_owner_team_member_id
  ON public.whatsapp_instances(owner_team_member_id)
  WHERE owner_team_member_id IS NOT NULL;

-- ============================================================
-- 2. SCHEMA — leads.responsible_user_id
-- ============================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS responsible_user_id uuid
  REFERENCES public.team_members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.leads.responsible_user_id IS
  'Responsável definitivo do lead (team_member). Usado para resolver instância de escrita. Backfill: COALESCE(closer_id, sdr_id).';

CREATE INDEX IF NOT EXISTS idx_leads_responsible_user_id
  ON public.leads(responsible_user_id)
  WHERE responsible_user_id IS NOT NULL;

-- ============================================================
-- 3. AUDITORIA — whatsapp_instance_owner_history
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_instance_owner_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  previous_owner_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  new_owner_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

COMMENT ON TABLE public.whatsapp_instance_owner_history IS
  'Auditoria de troca de owner em whatsapp_instances. Escrita exclusiva via service_role (set_instance_owner RPC).';

CREATE INDEX IF NOT EXISTS idx_wioh_instance_id
  ON public.whatsapp_instance_owner_history(instance_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_wioh_organization_id
  ON public.whatsapp_instance_owner_history(organization_id, changed_at DESC);

ALTER TABLE public.whatsapp_instance_owner_history ENABLE ROW LEVEL SECURITY;

-- SELECT: membros da org via team_members (filtro org)
DROP POLICY IF EXISTS "wioh_select" ON public.whatsapp_instance_owner_history;
CREATE POLICY "wioh_select"
  ON public.whatsapp_instance_owner_history
  FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id
      FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
    OR public.is_master_user()
  );

-- INSERT/UPDATE/DELETE: somente service_role (RPC set_instance_owner é a única origem)
DROP POLICY IF EXISTS "wioh_service_write" ON public.whatsapp_instance_owner_history;
CREATE POLICY "wioh_service_write"
  ON public.whatsapp_instance_owner_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 4. FEATURE FLAG — user_write_instance_strict
-- ============================================================

INSERT INTO public.feature_flags (key, name, description, category, default_enabled)
VALUES (
  'user_write_instance_strict',
  'Vínculo estrito user-instância de escrita',
  'Quando ativo, envio só ocorre via instância vinculada ao responsável do lead. Admin/master sempre permitidos.',
  'whatsapp',
  false
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 5. RPC — get_user_write_instance
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_write_instance(
  p_user_id uuid,
  p_organization_id uuid
)
RETURNS TABLE(instance_id uuid, instance_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT wi.id, wi.instance_name
  FROM public.whatsapp_instances wi
  INNER JOIN public.team_members tm ON tm.id = wi.owner_team_member_id
  WHERE tm.user_id = p_user_id
    AND wi.organization_id = p_organization_id
    AND tm.is_active = true
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_user_write_instance(uuid, uuid) IS
  'Retorna a instância de escrita vinculada ao usuário na org. Vazio quando não há vínculo.';

-- ============================================================
-- 6. RPC — get_lead_write_instance (error_code estruturado)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_lead_write_instance(p_lead_id uuid)
RETURNS TABLE(
  instance_id uuid,
  instance_name text,
  owner_team_member_id uuid,
  responsible_user_id uuid,
  error_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org_id uuid;
  v_resp_tm_id uuid;
BEGIN
  SELECT l.organization_id, l.responsible_user_id
    INTO v_org_id, v_resp_tm_id
  FROM public.leads l
  WHERE l.id = p_lead_id;

  IF v_org_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, 'LEAD_NOT_FOUND'::text;
    RETURN;
  END IF;

  IF v_resp_tm_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, 'NO_RESPONSIBLE'::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT wi.id, wi.instance_name, wi.owner_team_member_id, v_resp_tm_id, NULL::text
  FROM public.whatsapp_instances wi
  WHERE wi.organization_id = v_org_id
    AND wi.owner_team_member_id = v_resp_tm_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::uuid, v_resp_tm_id, 'NO_INSTANCE'::text;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.get_lead_write_instance(uuid) IS
  'Resolve a instância de escrita do lead via responsible_user_id. error_code: LEAD_NOT_FOUND | NO_RESPONSIBLE | NO_INSTANCE | NULL (sucesso).';

-- ============================================================
-- 7. RPC — can_user_write_instance (admin/master bypass)
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_user_write_instance(
  p_user_id uuid,
  p_instance_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org_id uuid;
  v_owner_tm_id uuid;
  v_user_tm_id uuid;
  v_role text;
BEGIN
  SELECT wi.organization_id, wi.owner_team_member_id
    INTO v_org_id, v_owner_tm_id
  FROM public.whatsapp_instances wi
  WHERE wi.id = p_instance_id;

  IF v_org_id IS NULL THEN
    RETURN false;
  END IF;

  -- Master plataforma: sempre permitido
  IF public.is_master_user(p_user_id) THEN
    RETURN true;
  END IF;

  SELECT tm.id, tm.role
    INTO v_user_tm_id, v_role
  FROM public.team_members tm
  WHERE tm.user_id = p_user_id
    AND tm.organization_id = v_org_id
    AND tm.is_active = true
  LIMIT 1;

  IF v_user_tm_id IS NULL THEN
    RETURN false;
  END IF;

  -- Admin da org: sempre permitido
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  -- Owner da instância: permitido
  IF v_owner_tm_id IS NOT NULL AND v_owner_tm_id = v_user_tm_id THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.can_user_write_instance(uuid, uuid) IS
  'Verifica se usuário pode escrever via instância. True para owner, admin da org, ou master da plataforma.';

-- ============================================================
-- 8. RPC — set_instance_owner (admin/master only + auditoria)
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_instance_owner(
  p_instance_id uuid,
  p_new_owner_team_member_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_prev uuid;
  v_caller uuid := auth.uid();
  v_caller_role text;
  v_audit_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT wi.organization_id, wi.owner_team_member_id
    INTO v_org_id, v_prev
  FROM public.whatsapp_instances wi
  WHERE wi.id = p_instance_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'INSTANCE_NOT_FOUND';
  END IF;

  -- Autorização: master OU admin da org
  IF NOT public.is_master_user(v_caller) THEN
    SELECT tm.role INTO v_caller_role
    FROM public.team_members tm
    WHERE tm.user_id = v_caller
      AND tm.organization_id = v_org_id
      AND tm.is_active = true
    LIMIT 1;

    IF v_caller_role IS NULL OR v_caller_role <> 'admin' THEN
      RAISE EXCEPTION 'FORBIDDEN: only admin/master can change instance owner';
    END IF;
  END IF;

  -- Valida novo owner pertence à mesma org e está ativo (quando não-NULL)
  IF p_new_owner_team_member_id IS NOT NULL THEN
    PERFORM 1
    FROM public.team_members tm
    WHERE tm.id = p_new_owner_team_member_id
      AND tm.organization_id = v_org_id
      AND tm.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_OWNER: team_member not in org or inactive';
    END IF;
  END IF;

  UPDATE public.whatsapp_instances
  SET owner_team_member_id = p_new_owner_team_member_id,
      updated_at = NOW()
  WHERE id = p_instance_id;

  INSERT INTO public.whatsapp_instance_owner_history (
    instance_id,
    organization_id,
    previous_owner_id,
    new_owner_id,
    changed_by,
    reason
  )
  VALUES (
    p_instance_id,
    v_org_id,
    v_prev,
    p_new_owner_team_member_id,
    v_caller,
    p_reason
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

COMMENT ON FUNCTION public.set_instance_owner(uuid, uuid, text) IS
  'Troca owner_team_member_id da instância + grava auditoria. Apenas admin da org ou master.';

-- ============================================================
-- 9. GRANTS (mínimo necessário)
-- ============================================================

REVOKE ALL ON FUNCTION public.set_instance_owner(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_instance_owner(uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_write_instance(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_write_instance(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_lead_write_instance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lead_write_instance(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_user_write_instance(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_user_write_instance(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 10. BACKFILL
-- ============================================================

-- Backfill 1: leads.responsible_user_id := COALESCE(closer_id, sdr_id)
UPDATE public.leads
SET responsible_user_id = COALESCE(closer_id, sdr_id)
WHERE responsible_user_id IS NULL
  AND (closer_id IS NOT NULL OR sdr_id IS NOT NULL);

-- Backfill 2: whatsapp_instances.owner_team_member_id ← único allowed_member (quando count = 1)
UPDATE public.whatsapp_instances wi
SET owner_team_member_id = sub.team_member_id,
    updated_at = NOW()
FROM (
  SELECT
    waam.whatsapp_instance_id,
    MIN(waam.team_member_id) AS team_member_id,
    COUNT(*) AS c
  FROM public.whatsapp_instance_allowed_members waam
  GROUP BY waam.whatsapp_instance_id
  HAVING COUNT(*) = 1
) sub
WHERE wi.id = sub.whatsapp_instance_id
  AND wi.owner_team_member_id IS NULL;

-- ============================================================
-- FIM DA MIGRATION
-- ============================================================
