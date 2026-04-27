-- ============================================================================
-- Pipe Distribution: Round Robin, Aleatório e Fixo para SDRs/Closers em Pipes
-- Replica o padrão de campanhas (campaign-distribution) para pipes.
-- ============================================================================

-- ─── 1. Tabela de regras de distribuição por pipe ──────────────────────────

CREATE TABLE IF NOT EXISTS public.pipe_distribution_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipe_type TEXT NOT NULL CHECK (pipe_type IN ('whatsapp', 'confirmacao', 'propostas')),

  -- SDR distribution
  sdr_mode TEXT DEFAULT NULL CHECK (sdr_mode IS NULL OR sdr_mode IN ('round_robin', 'random', 'single')),
  sdr_assigned_to UUID REFERENCES public.team_members(id) ON DELETE SET NULL,

  -- Closer distribution (relevante para confirmacao e propostas)
  closer_mode TEXT DEFAULT NULL CHECK (closer_mode IS NULL OR closer_mode IN ('round_robin', 'random', 'single')),
  closer_assigned_to UUID REFERENCES public.team_members(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(organization_id, pipe_type)
);

ALTER TABLE public.pipe_distribution_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipe_dist_rules_org_isolation" ON public.pipe_distribution_rules
  FOR ALL USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- ─── 2. Pool de membros por regra ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pipe_distribution_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.pipe_distribution_rules(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'sdr' CHECK (role IN ('sdr', 'closer')),
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(rule_id, team_member_id, role)
);

ALTER TABLE public.pipe_distribution_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipe_dist_members_org_isolation" ON public.pipe_distribution_members
  FOR ALL USING (
    rule_id IN (
      SELECT pdr.id FROM public.pipe_distribution_rules pdr
      WHERE pdr.organization_id IN (
        SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id = auth.uid()
      )
    )
  );

-- ─── 3. RPC: get_next_pipe_sdr ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_next_pipe_sdr(
  p_pipe_type TEXT,
  p_organization_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rule_id UUID;
  v_mode TEXT;
  v_assigned_to UUID;
  v_member_ids UUID[];
  v_count BIGINT;
  v_next_index INT;
BEGIN
  -- Buscar regra de distribuição para este pipe + org
  SELECT id, sdr_mode, sdr_assigned_to
    INTO v_rule_id, v_mode, v_assigned_to
  FROM pipe_distribution_rules
  WHERE organization_id = p_organization_id
    AND pipe_type = p_pipe_type
  LIMIT 1;

  -- Sem regra ou modo NULL → sem distribuição automática
  IF v_rule_id IS NULL OR v_mode IS NULL THEN
    RETURN NULL;
  END IF;

  -- Modo single → retorna pessoa fixa
  IF v_mode = 'single' AND v_assigned_to IS NOT NULL THEN
    RETURN v_assigned_to;
  END IF;

  -- Para random e round_robin: buscar pool de SDRs ordenado por created_at
  SELECT ARRAY_AGG(pdm.team_member_id ORDER BY pdm.created_at, pdm.team_member_id)
    INTO v_member_ids
  FROM pipe_distribution_members pdm
  WHERE pdm.rule_id = v_rule_id
    AND pdm.role = 'sdr';

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL OR array_length(v_member_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  -- Modo random
  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  -- Modo round_robin: contar registros no pipe e rotacionar
  IF v_mode = 'round_robin' THEN
    IF p_pipe_type = 'whatsapp' THEN
      SELECT count(*) INTO v_count FROM pipe_whatsapp WHERE organization_id = p_organization_id;
    ELSIF p_pipe_type = 'confirmacao' THEN
      SELECT count(*) INTO v_count FROM pipe_confirmacao WHERE organization_id = p_organization_id;
    ELSIF p_pipe_type = 'propostas' THEN
      SELECT count(*) INTO v_count FROM pipe_propostas WHERE organization_id = p_organization_id;
    ELSE
      v_count := 0;
    END IF;

    v_next_index := (COALESCE(v_count, 0) % array_length(v_member_ids, 1)) + 1;
    RETURN v_member_ids[v_next_index];
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.get_next_pipe_sdr(TEXT, UUID) IS
  'Retorna team_member_id do próximo SDR a atribuir no pipe (round_robin, random ou single).';

-- ─── 4. RPC: get_next_pipe_closer ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_next_pipe_closer(
  p_pipe_type TEXT,
  p_organization_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rule_id UUID;
  v_mode TEXT;
  v_assigned_to UUID;
  v_member_ids UUID[];
  v_count BIGINT;
  v_next_index INT;
BEGIN
  SELECT id, closer_mode, closer_assigned_to
    INTO v_rule_id, v_mode, v_assigned_to
  FROM pipe_distribution_rules
  WHERE organization_id = p_organization_id
    AND pipe_type = p_pipe_type
  LIMIT 1;

  IF v_rule_id IS NULL OR v_mode IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'single' AND v_assigned_to IS NOT NULL THEN
    RETURN v_assigned_to;
  END IF;

  SELECT ARRAY_AGG(pdm.team_member_id ORDER BY pdm.created_at, pdm.team_member_id)
    INTO v_member_ids
  FROM pipe_distribution_members pdm
  WHERE pdm.rule_id = v_rule_id
    AND pdm.role = 'closer';

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL OR array_length(v_member_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    -- Contar registros com closer_id preenchido
    IF p_pipe_type = 'confirmacao' THEN
      SELECT count(*) INTO v_count FROM pipe_confirmacao
        WHERE organization_id = p_organization_id AND closer_id IS NOT NULL;
    ELSIF p_pipe_type = 'propostas' THEN
      SELECT count(*) INTO v_count FROM pipe_propostas
        WHERE organization_id = p_organization_id AND closer_id IS NOT NULL;
    ELSE
      v_count := 0;
    END IF;

    v_next_index := (COALESCE(v_count, 0) % array_length(v_member_ids, 1)) + 1;
    RETURN v_member_ids[v_next_index];
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.get_next_pipe_closer(TEXT, UUID) IS
  'Retorna team_member_id do próximo Closer a atribuir no pipe (round_robin, random ou single).';
