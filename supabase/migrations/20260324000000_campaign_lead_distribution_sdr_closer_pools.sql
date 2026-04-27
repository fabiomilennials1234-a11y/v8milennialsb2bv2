-- Migration: Distribuição de leads com pools separados SDR/Closer
-- 1. Adiciona role em campanha_members (sdr | closer)
-- 2. Adiciona closer_id em campanha_leads
-- 3. Adiciona closer_distribution_mode e closer_assigned_to em campanhas
-- 4. Cria RPC get_next_campaign_closer
-- 5. Atualiza RPC get_next_campaign_sdr para filtrar por role
-- Date: 2026-03-24

-- ============================================
-- 1. campanha_members: role (sdr | closer)
-- ============================================

ALTER TABLE public.campanha_members
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'sdr'
  CHECK (role IN ('sdr', 'closer'));

COMMENT ON COLUMN public.campanha_members.role IS 'Papel do membro nesta campanha: sdr (qualifica) ou closer (fecha). Mutuamente exclusivos.';

-- ============================================
-- 2. campanha_leads: closer_id
-- ============================================

ALTER TABLE public.campanha_leads
ADD COLUMN IF NOT EXISTS closer_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campanha_leads_closer ON public.campanha_leads(closer_id) WHERE closer_id IS NOT NULL;

COMMENT ON COLUMN public.campanha_leads.closer_id IS 'Closer responsável por este lead na campanha. Distribuído automaticamente ou manualmente.';

-- ============================================
-- 3. campanhas: closer distribution config
-- ============================================

ALTER TABLE public.campanhas
ADD COLUMN IF NOT EXISTS closer_distribution_mode TEXT DEFAULT NULL
  CHECK (closer_distribution_mode IS NULL OR closer_distribution_mode IN ('random', 'round_robin', 'single')),
ADD COLUMN IF NOT EXISTS closer_assigned_to UUID REFERENCES public.team_members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.campanhas.closer_distribution_mode IS 'Modo de distribuição de Closers: random, round_robin, single, ou NULL (manual).';
COMMENT ON COLUMN public.campanhas.closer_assigned_to IS 'Closer fixo quando closer_distribution_mode = single.';

-- ============================================
-- 4. RPC: get_next_campaign_closer
-- ============================================

CREATE OR REPLACE FUNCTION public.get_next_campaign_closer(p_campaign_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_assigned_to UUID;
  v_member_ids UUID[];
  v_count BIGINT;
  v_next_index INT;
BEGIN
  -- Get campaign closer distribution settings
  SELECT c.closer_distribution_mode, c.closer_assigned_to
    INTO v_mode, v_assigned_to
  FROM public.campanhas c
  WHERE c.id = p_campaign_id
  LIMIT 1;

  IF v_mode IS NULL THEN
    RETURN v_assigned_to;
  END IF;

  IF v_mode = 'single' AND v_assigned_to IS NOT NULL THEN
    RETURN v_assigned_to;
  END IF;

  -- For random and round_robin: use campanha_members WHERE role = 'closer'
  SELECT ARRAY_AGG(cm.team_member_id ORDER BY cm.created_at, cm.team_member_id)
    INTO v_member_ids
  FROM public.campanha_members cm
  WHERE cm.campanha_id = p_campaign_id
    AND cm.role = 'closer';

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL OR array_length(v_member_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    SELECT count(*) INTO v_count
    FROM public.campanha_leads cl
    WHERE cl.campanha_id = p_campaign_id
      AND cl.closer_id IS NOT NULL;
    v_next_index := (COALESCE(v_count, 0) % array_length(v_member_ids, 1)) + 1;
    RETURN v_member_ids[v_next_index];
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.get_next_campaign_closer(UUID) IS
  'Returns team_member_id to assign as closer to the next lead in the campaign (round_robin, random, or single).';

-- ============================================
-- 5. Update get_next_campaign_sdr to filter by role = 'sdr'
-- ============================================

CREATE OR REPLACE FUNCTION public.get_next_campaign_sdr(p_campaign_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_assigned_to UUID;
  v_member_ids UUID[];
  v_count BIGINT;
  v_next_index INT;
BEGIN
  -- Get campaign distribution settings
  SELECT c.lead_distribution_mode, c.lead_assigned_to
    INTO v_mode, v_assigned_to
  FROM public.campanhas c
  WHERE c.id = p_campaign_id
  LIMIT 1;

  IF v_mode IS NULL THEN
    RETURN v_assigned_to;
  END IF;

  IF v_mode = 'single' AND v_assigned_to IS NOT NULL THEN
    RETURN v_assigned_to;
  END IF;

  -- For random and round_robin: use campanha_members WHERE role = 'sdr'
  SELECT ARRAY_AGG(cm.team_member_id ORDER BY cm.created_at, cm.team_member_id)
    INTO v_member_ids
  FROM public.campanha_members cm
  WHERE cm.campanha_id = p_campaign_id
    AND cm.role = 'sdr';

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL OR array_length(v_member_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    SELECT count(*) INTO v_count
    FROM public.campanha_leads cl
    WHERE cl.campanha_id = p_campaign_id;
    v_next_index := (COALESCE(v_count, 0) % array_length(v_member_ids, 1)) + 1;
    RETURN v_member_ids[v_next_index];
  END IF;

  RETURN NULL;
END;
$$;
