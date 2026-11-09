-- Retire the organization-wide default designation; preserve every funnel and card.
-- Keep the nullable column for older clients during rollout. A compatibility
-- trigger prevents stale clients and integrations from reintroducing a default.
-- New clients no longer read or write it; set_org_settings rejects the retired key.
CREATE OR REPLACE FUNCTION public.fn_retire_org_default_pipeline()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.default_pipeline_id := NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_retire_org_default_pipeline() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_retire_org_default_pipeline
BEFORE INSERT OR UPDATE OF default_pipeline_id ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.fn_retire_org_default_pipeline();

UPDATE public.organizations SET default_pipeline_id = NULL WHERE default_pipeline_id IS NOT NULL;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_no_default_pipeline
CHECK (default_pipeline_id IS NULL);
COMMENT ON COLUMN public.organizations.default_pipeline_id IS
'Retired. Compatibility column; always NULL. No funnel is the organization default.';
DROP TRIGGER IF EXISTS trg_guard_default_pipeline_delete ON public.pipelines;
DROP FUNCTION IF EXISTS public.fn_guard_default_pipeline_delete();

CREATE OR REPLACE FUNCTION public.seed_default_sales_funnel(p_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pipeline_id uuid;
BEGIN
  -- Autorização por GRANT, não por gate no corpo: EXECUTE só para
  -- service_role (abaixo). O trigger não depende do grant — dentro de
  -- fn_seed_default_funnel_for_org (DEFINER, owner postgres) o current_user
  -- é o owner, então QUALQUER caminho legítimo de INSERT em organizations
  -- (master no front, billing_provision_new_org, create_org_sandbox por
  -- admin) semeia sem tropeçar em permissão. Um gate por is_master_user()
  -- aqui quebraria o sandbox criado por admin comum.
  --
  -- O guard de dinheiro (won/lost) deixa o seed passar por uma das vias já
  -- existentes conforme o caminho: service_role (billing/edge), master
  -- (front), admin da org, ou — via §0 desta migration — session_user
  -- postgres (migration/console). Impersonar service_role aqui é impossível:
  -- `SET "role"` é proibido sob frame SECURITY DEFINER (medido, erro 42501).
  INSERT INTO public.pipelines
    (organization_id, name, slug, type, description, icon, color, display_order, is_active, config)
  VALUES
    (p_org_id, 'Funil de Vendas', 'vendas', 'custom',
     'Funil de vendas — renomeie e adapte as etapas ao seu processo.',
     'trending-up', '#f59e0b', 3, true, '{}'::jsonb)
  ON CONFLICT (organization_id, slug) DO NOTHING;

  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE organization_id = p_org_id AND slug = 'vendas';

  IF v_pipeline_id IS NULL THEN
    -- Impossível no caminho do trigger; guarda contra chamada manual esquisita.
    RAISE EXCEPTION 'seed_default_sales_funnel: funil vendas não resolveu para org %', p_org_id;
  END IF;

  -- `pipeline_type` NULL = convenção de funil comum (medido: 556/556 etapas
  -- custom em prod). Papéis explícitos: o trigger de system_stage_role só age
  -- sobre 'open', e aqui o que importa (meeting_booked/won/lost) vai declarado.
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_id, pipeline_type, stage_key, name, color,
     position, is_active, stage_role, is_final_positive, is_final_negative,
     requires_sale_value)
  SELECT p_org_id, v_pipeline_id, NULL, d.stage_key, d.nome, d.cor, d.pos,
         true, d.papel::public.stage_role, d.final_pos, d.final_neg, d.exige_valor
    FROM (VALUES
      ('novo',             'Novo',             '#6366f1', 0, 'open',           false, false, false),
      ('em_conversa',      'Em conversa',      '#3b82f6', 1, 'open',           false, false, false),
      ('reuniao_marcada',  'Reunião marcada',  '#8b5cf6', 2, 'meeting_booked', false, false, false),
      ('proposta_enviada', 'Proposta enviada', '#0ea5e9', 3, 'open',           false, false, false),
      ('ganhou',           'Ganhou',           '#22c55e', 4, 'won',            true,  false, true),
      ('perdeu',           'Perdeu',           '#ef4444', 5, 'lost',           false, true,  false)
    ) AS d(stage_key, nome, cor, pos, papel, final_pos, final_neg, exige_valor)
  ON CONFLICT (pipeline_id, stage_key) DO NOTHING;


  RETURN v_pipeline_id;
END;
$$;
COMMENT ON FUNCTION public.seed_default_sales_funnel(uuid) IS
'Creates an ordinary sales funnel with six stages for a new organization. No default designation.';
UPDATE public.pipelines
SET description = 'Funil de vendas — renomeie e adapte as etapas ao seu processo.'
WHERE description = 'Funil padrão da organização — renomeie e adapte as etapas ao seu processo.';

CREATE OR REPLACE FUNCTION public.set_org_settings(
  p_org_id uuid,
  p_patch  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Allowlist EXPLÍCITA. Chave fora daqui é recusada com erro, nunca ignorada
  -- em silêncio: ignorar transformaria um patch com `subscription_plan` numa
  -- tentativa que "passou" sem efeito, e ninguém investiga o que passou.
  c_permitidas constant text[] := ARRAY[
    'confirmacao_overdue_days',
    'default_reorder_cycle_days',
    'ui_v5_enabled'
  ];
  v_chave      text;
  v_intrusas   text[] := '{}';
  v_old        jsonb;
  v_dias       int;
  v_ciclo      int;
BEGIN
  IF p_org_id IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'set_org_settings: argumentos obrigatórios' USING ERRCODE = '22023';
  END IF;

  FOR v_chave IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_chave = ANY (c_permitidas)) THEN
      v_intrusas := v_intrusas || v_chave;
    END IF;
  END LOOP;
  IF array_length(v_intrusas, 1) > 0 THEN
    RAISE EXCEPTION 'set_org_settings: campo(s) não permitido(s): %. Esta função só ajusta configuração de operação; plano, cobrança, limites e flags não passam por aqui.',
      array_to_string(v_intrusas, ', ') USING ERRCODE = '42501';
  END IF;

  -- Autorização no molde de set_org_chat_restriction.
  IF NOT (
    public.is_master_user()
    OR EXISTS (
      SELECT 1 FROM public.team_members
       WHERE user_id = auth.uid()
         AND organization_id = p_org_id
         AND role = 'admin'
         AND is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'forbidden: apenas admin da organização ajusta estas configurações'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'confirmacao_overdue_days',   o.confirmacao_overdue_days,
           'default_reorder_cycle_days', o.default_reorder_cycle_days,
           'ui_v5_enabled',              o.ui_v5_enabled)
    INTO v_old
    FROM public.organizations o WHERE o.id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organização não encontrada' USING ERRCODE = '02000';
  END IF;

  -- Faixas validadas no SERVIDOR. O front já limita 1..365, mas limite que só
  -- existe no cliente não é limite.
  IF p_patch ? 'confirmacao_overdue_days' THEN
    v_dias := (p_patch->>'confirmacao_overdue_days')::int;
    IF v_dias IS NULL OR v_dias < 1 OR v_dias > 365 THEN
      RAISE EXCEPTION 'confirmacao_overdue_days fora da faixa (1..365): %', v_dias
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.organizations SET confirmacao_overdue_days = v_dias WHERE id = p_org_id;
  END IF;

  IF p_patch ? 'default_reorder_cycle_days' THEN
    v_ciclo := (p_patch->>'default_reorder_cycle_days')::int;
    IF v_ciclo IS NULL OR v_ciclo < 1 OR v_ciclo > 365 THEN
      RAISE EXCEPTION 'default_reorder_cycle_days fora da faixa (1..365): %', v_ciclo
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.organizations SET default_reorder_cycle_days = v_ciclo WHERE id = p_org_id;
  END IF;

  -- Booleano de verdade: `"true"` em string, `1` ou `null` são recusados — um
  -- `::boolean` frouxo aceitaria 'yes'/'on' e um null apagaria a escolha.
  IF p_patch ? 'ui_v5_enabled' THEN
    IF jsonb_typeof(p_patch->'ui_v5_enabled') <> 'boolean' THEN
      RAISE EXCEPTION 'ui_v5_enabled precisa ser booleano: %', p_patch->'ui_v5_enabled'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.organizations
       SET ui_v5_enabled = (p_patch->>'ui_v5_enabled')::boolean
     WHERE id = p_org_id;
  END IF;

  INSERT INTO public.permission_audit_log
    (organization_id, changed_by_user_id, changed_by_role, table_name,
     permission_key, role, old_enabled, new_enabled)
  VALUES
    (p_org_id, auth.uid(),
     CASE WHEN public.is_master_user() THEN 'master' ELSE 'admin' END,
     'organizations', 'set_org_settings:' || array_to_string(ARRAY(SELECT jsonb_object_keys(p_patch)), ','),
     'admin', NULL, NULL);

  RETURN jsonb_build_object(
    'antes', v_old,
    'depois', (SELECT jsonb_build_object(
                 'confirmacao_overdue_days',   o.confirmacao_overdue_days,
                 'default_reorder_cycle_days', o.default_reorder_cycle_days,
                 'ui_v5_enabled',              o.ui_v5_enabled)
                 FROM public.organizations o WHERE o.id = p_org_id));
END;
$$;
