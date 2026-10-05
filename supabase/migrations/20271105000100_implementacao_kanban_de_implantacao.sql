-- Implementação (Área Dev): do contrato à primeira venda, um card por cliente.
-- Regras IM-1…IM-7 do board "Área Dev: 18 telas → 5 centrais".
--
--   Cliente novo ─(plano e responsável)→ Construção de Org
--     ─(WhatsApp conectado e funis com etapa de ganho E de perda)→ Call de Apresentação
--     ─(1ª venda registrada)→ Concluído (a org segue em Organizações)
--
-- IM-7: a etapa é um campo PRÓPRIO. `organizations.onboarding_state` não serve:
-- nasce 'completed' por padrão e descreve o wizard do cliente, não o trabalho
-- da Torque.
--
-- IM-4 lê `sale_events` (a fonte única de receita, append-only), e NÃO
-- `org_onboarding_progress.step_first_sale`: aquele passo só é gravado pelo
-- front do próprio cliente — `complete_step_first_sale()` existe no baseline
-- mas nenhum trigger a chama. O checklist (IM-6) é mostrado como está; o gate
-- usa o fato.
--
-- Escrita só pelas RPCs SECURITY DEFINER abaixo: o gate mora no banco, não na
-- tela, e cada mudança de etapa vai para `master_audit_logs` (PE-3).
BEGIN;

CREATE TABLE public.org_implementations (
  -- IM-1: uma implantação por org. A PK é a própria org.
  organization_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  stage                text NOT NULL DEFAULT 'cliente_novo'
                         CHECK (stage IN ('cliente_novo', 'construcao', 'call', 'concluido')),
  owner_master_user_id uuid REFERENCES public.master_users(id) ON DELETE SET NULL,
  call_scheduled_at    timestamptz,
  call_participants    text CHECK (call_participants IS NULL OR length(call_participants) <= 500),
  -- IM-5: "mais de 7 dias na mesma etapa" conta a partir daqui.
  stage_entered_at     timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_implementations_completed_coherent CHECK ((stage = 'concluido') = (completed_at IS NOT NULL))
);

COMMENT ON TABLE public.org_implementations IS
  'Etapa da implantacao de cada org (Area Dev > Implementacao). So master le; escrita so via '
  'master_advance_implementation / master_update_implementation, que aplicam os gates IM-2..IM-4.';

CREATE INDEX org_implementations_stage_idx ON public.org_implementations (stage) WHERE stage <> 'concluido';

CREATE TRIGGER trg_org_implementations_updated_at
  BEFORE UPDATE ON public.org_implementations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.org_implementations ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_implementations_master_select ON public.org_implementations
  FOR SELECT TO authenticated USING (public.is_master_user());

REVOKE ALL ON public.org_implementations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.org_implementations TO authenticated;
GRANT ALL ON public.org_implementations TO service_role;

-- ─── IM-1: toda org nova entra como Cliente novo ─────────────────────────────
-- Sandbox é cópia de org existente para teste, não cliente: fica de fora.
CREATE OR REPLACE FUNCTION public.org_implementation_on_org_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT NEW.is_sandbox THEN
    INSERT INTO public.org_implementations (organization_id) VALUES (NEW.id)
    ON CONFLICT (organization_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.org_implementation_on_org_created() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_org_implementation_on_org_created
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.org_implementation_on_org_created();

-- ─── Os fatos que os gates leem ──────────────────────────────────────────────
-- Uma função só, usada pela listagem E pelo avanço: a tela mostra exatamente o
-- que o banco vai cobrar.
CREATE OR REPLACE FUNCTION public.org_implementation_gates(p_org_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH funis AS (
    SELECT p.id,
           bool_or(s.stage_role = 'won')  AS tem_ganho,
           bool_or(s.stage_role = 'lost') AS tem_perda
      FROM public.pipelines p
      LEFT JOIN public.pipeline_stages s ON s.pipeline_id = p.id AND COALESCE(s.is_active, true)
     WHERE p.organization_id = p_org_id AND COALESCE(p.is_active, true)
     GROUP BY p.id
  )
  SELECT jsonb_build_object(
    -- OR-1: o plano é gravado na própria org. Aceita id OU texto até o OR-4.
    -- `plan_id` lido via to_jsonb: existe no baseline do repo mas NÃO em prod
    -- (medido em 05/10/2026). `o.plan_id` direto quebraria o apply em prod.
    'has_plan', EXISTS (
      SELECT 1 FROM public.organizations o
       WHERE o.id = p_org_id
         AND (o.subscription_plan IS NOT NULL OR to_jsonb(o) ->> 'plan_id' IS NOT NULL)),
    'whatsapp_connected', EXISTS (
      SELECT 1 FROM public.whatsapp_instances w
       WHERE w.organization_id = p_org_id AND w.status = 'connected' AND w.session_dead_since IS NULL),
    -- Todo funil ativo precisa das duas pontas; sem funil nenhum, não passa.
    'pipelines_total', (SELECT count(*) FROM funis),
    'pipelines_won_lost', (SELECT count(*) FROM funis WHERE tem_ganho AND tem_perda),
    'first_sale', EXISTS (
      SELECT 1 FROM public.sale_events e
       WHERE e.organization_id = p_org_id AND e.event_type = 'sale'
         AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.reversed_event_id = e.id)),
    -- IM-6: o checklist do cliente, como o cliente vê.
    'checklist', (
      SELECT jsonb_build_object(
               'whatsapp',   p.step_connect_whatsapp,
               'lead',       p.step_import_lead,
               'copilot',    p.step_configure_copilot,
               'automacao',  p.step_create_workflow,
               'membro',     p.step_add_member,
               'venda',      p.step_first_sale)
        FROM public.org_onboarding_progress p WHERE p.organization_id = p_org_id)
  );
$$;

REVOKE ALL ON FUNCTION public.org_implementation_gates(uuid) FROM PUBLIC, anon, authenticated;

-- ─── Leitura do kanban ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.master_list_implementations()
RETURNS TABLE (
  organization_id      uuid,
  org_name             text,
  org_created_at       timestamptz,
  subscription_plan    text,
  stage                text,
  owner_master_user_id uuid,
  owner_name           text,
  call_scheduled_at    timestamptz,
  call_participants    text,
  stage_entered_at     timestamptz,
  completed_at         timestamptz,
  gates                jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT i.organization_id, o.name, o.created_at, o.subscription_plan, i.stage,
         i.owner_master_user_id, COALESCE(pr.full_name, mu.notes),
         i.call_scheduled_at, i.call_participants, i.stage_entered_at, i.completed_at,
         public.org_implementation_gates(i.organization_id)
    FROM public.org_implementations i
    JOIN public.organizations o ON o.id = i.organization_id
    LEFT JOIN public.master_users mu ON mu.id = i.owner_master_user_id
    LEFT JOIN public.profiles pr ON pr.id = mu.user_id
   -- Concluído há mais de 30 dias já seguiu para Organizações.
   WHERE i.stage <> 'concluido' OR i.completed_at > now() - interval '30 days'
   ORDER BY i.stage_entered_at;
END;
$$;

REVOKE ALL ON FUNCTION public.master_list_implementations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_list_implementations() TO authenticated;

-- Quem pode ser responsável: o staff ativo.
CREATE OR REPLACE FUNCTION public.master_list_staff()
RETURNS TABLE (master_user_id uuid, name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT mu.id, COALESCE(pr.full_name, mu.notes, 'Master')
    FROM public.master_users mu
    LEFT JOIN public.profiles pr ON pr.id = mu.user_id
   WHERE mu.is_active
   ORDER BY 2;
END;
$$;

REVOKE ALL ON FUNCTION public.master_list_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_list_staff() TO authenticated;

-- ─── Escrita ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.master_update_implementation(
  p_org_id               uuid,
  p_owner_master_user_id uuid,
  p_call_scheduled_at    timestamptz,
  p_call_participants    text
)
RETURNS public.org_implementations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.org_implementations;
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF p_owner_master_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.master_users WHERE id = p_owner_master_user_id AND is_active
  ) THEN
    RAISE EXCEPTION 'responsavel precisa ser do staff ativo' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.org_implementations
     SET owner_master_user_id = p_owner_master_user_id,
         call_scheduled_at    = p_call_scheduled_at,
         call_participants    = NULLIF(btrim(p_call_participants), '')
   WHERE organization_id = p_org_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'org sem implantacao' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.master_update_implementation(uuid, uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_update_implementation(uuid, uuid, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.master_advance_implementation(p_org_id uuid, p_to_stage text)
RETURNS public.org_implementations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  CONSTANT text[] := ARRAY['cliente_novo', 'construcao', 'call', 'concluido'];
  v_cur    public.org_implementations;
  v_gates  jsonb;
  v_from_i int;
  v_to_i   int;
  v_master uuid;
BEGIN
  SELECT id INTO v_master FROM public.master_users WHERE user_id = auth.uid() AND is_active;
  IF v_master IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cur FROM public.org_implementations WHERE organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org sem implantacao' USING ERRCODE = 'no_data_found';
  END IF;

  v_from_i := array_position(v_order, v_cur.stage);
  v_to_i   := array_position(v_order, p_to_stage);
  IF v_to_i IS NULL THEN
    RAISE EXCEPTION 'etapa desconhecida: %', p_to_stage USING ERRCODE = 'check_violation';
  END IF;
  IF v_to_i = v_from_i THEN
    RETURN v_cur;
  END IF;
  IF v_cur.stage = 'concluido' THEN
    RAISE EXCEPTION 'implantacao concluida: a org segue em Organizacoes' USING ERRCODE = 'check_violation';
  END IF;
  -- Para frente, uma etapa por vez: cada gate é cobrado na sua passagem.
  IF v_to_i > v_from_i + 1 THEN
    RAISE EXCEPTION 'avance uma etapa por vez' USING ERRCODE = 'check_violation';
  END IF;

  IF v_to_i > v_from_i THEN
    v_gates := public.org_implementation_gates(p_org_id);
    -- IM-2
    IF p_to_stage = 'construcao' AND (NOT (v_gates->>'has_plan')::boolean OR v_cur.owner_master_user_id IS NULL) THEN
      RAISE EXCEPTION 'sai de Cliente novo so com plano e responsavel' USING ERRCODE = 'check_violation';
    END IF;
    -- IM-3
    IF p_to_stage = 'call' AND (
         NOT (v_gates->>'whatsapp_connected')::boolean
         OR (v_gates->>'pipelines_total')::int = 0
         OR (v_gates->>'pipelines_won_lost')::int < (v_gates->>'pipelines_total')::int) THEN
      RAISE EXCEPTION 'Call de Apresentacao so com WhatsApp conectado e funis com etapa de ganho e de perda'
        USING ERRCODE = 'check_violation';
    END IF;
    -- IM-4
    IF p_to_stage = 'concluido' AND NOT (v_gates->>'first_sale')::boolean THEN
      RAISE EXCEPTION 'Concluido so com a 1a venda registrada' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.org_implementations
     SET stage            = p_to_stage,
         stage_entered_at = now(),
         completed_at     = CASE WHEN p_to_stage = 'concluido' THEN now() END
   WHERE organization_id = p_org_id
  RETURNING * INTO v_cur;

  INSERT INTO public.master_audit_logs (master_user_id, user_id, action, target_type, target_id, target_name, details)
  SELECT v_master, auth.uid(), 'IMPLEMENTATION_STAGE', 'organization', p_org_id, o.name,
         jsonb_build_object('from', v_order[v_from_i], 'to', p_to_stage, 'gates', v_gates)
    FROM public.organizations o WHERE o.id = p_org_id;

  RETURN v_cur;
END;
$$;

REVOKE ALL ON FUNCTION public.master_advance_implementation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_advance_implementation(uuid, text) TO authenticated;

-- ─── Carga inicial ───────────────────────────────────────────────────────────
-- Org criada nos últimos 60 dias ainda pode estar em implantação. Mais antiga
-- já é cliente rodando: não entra no quadro (segue em Organizações). Quem já
-- vendeu entra como Concluído — o fato do IM-4 está lá.
INSERT INTO public.org_implementations (organization_id, stage, stage_entered_at, completed_at)
SELECT o.id,
       CASE WHEN g.first_sale THEN 'concluido' ELSE 'cliente_novo' END,
       COALESCE(o.created_at, now()),
       CASE WHEN g.first_sale THEN now() END
  FROM public.organizations o
  CROSS JOIN LATERAL (
    SELECT (public.org_implementation_gates(o.id)->>'first_sale')::boolean AS first_sale
  ) g
 WHERE NOT o.is_sandbox
   AND o.created_at > now() - interval '60 days'
ON CONFLICT (organization_id) DO NOTHING;

COMMIT;
