-- Importação em funil custom para de duplicar o lead em Oportunidades.
--
-- Sintoma: importar uma planilha para um funil custom criava o card no funil
-- escolhido E no funil de Oportunidades (pipe whatsapp, stage "novo").
--
-- Causa: `trg_auto_assign_lead_default_pipe` é AFTER INSERT em `leads` e semeia
-- todo lead novo em whatsapp/novo. O guard existente ("já está em
-- custom_pipe_entries? skip") nunca ajudava neste fluxo porque a edge function
-- `import-leads` insere o lead PRIMEIRO e a entry custom DEPOIS, em statements
-- separados — o trigger sempre vence a corrida.
--
-- Correção, em duas partes:
--   1. O trigger passa a respeitar o GUC `app.skip_default_pipe`, que só quem
--      já sabe onde o lead vai parar consegue setar.
--   2. `import_lead_into_custom_pipeline()` insere lead + entry custom na MESMA
--      transação com o GUC ligado (escopo local, some no fim da transação).
--      Sem corrida, sem entry compensatória pra deletar depois — e sem disparar
--      os 13 triggers de `pipeline_entries` (stage_event, dispatch, checklist,
--      sync_lead) só pra desfazer em seguida.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Trigger: escape hatch explícito
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_assign_lead_default_pipe()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pipeline_id uuid;
  v_stage_exists boolean;
BEGIN
  -- (-1) Chamador declarou que já vai colocar o lead num funil nesta mesma
  -- transação (ver import_lead_into_custom_pipeline). O guard (2) abaixo não
  -- cobre esse caso: quando o trigger roda, a entry custom ainda não existe.
  IF coalesce(current_setting('app.skip_default_pipe', true), '') = '1' THEN
    RETURN NULL;
  END IF;

  -- (0) Cal.com: lead já entra em confirmacao (reunião agendada) — nunca semear whatsapp/novo.
  IF NEW.origin = 'cal' THEN
    RETURN NULL;
  END IF;

  -- (1) já está em pipeline_entries? skip
  IF EXISTS (
    SELECT 1 FROM public.pipeline_entries
    WHERE lead_id = NEW.id
    LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  -- (2) já está em custom_pipe_entries? skip
  IF EXISTS (
    SELECT 1 FROM public.custom_pipe_entries
    WHERE lead_id = NEW.id
    LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  -- (3) org tem pipeline system whatsapp ativo?
  SELECT id
    INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = NEW.organization_id
    AND type = 'system'  -- metric-lint-allow: seed de funil, não métrica — o pipe de entrada É o system whatsapp
    AND slug = 'whatsapp'
    AND is_active = true
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- (4) stage 'novo' existe e está ativo nesse pipeline?
  SELECT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = NEW.organization_id
      AND pipeline_type = 'whatsapp'
      AND stage_key = 'novo'
      AND is_active = true
  ) INTO v_stage_exists;

  IF NOT v_stage_exists THEN
    RETURN NULL;
  END IF;

  -- (5) cria entry whatsapp/novo
  INSERT INTO public.pipeline_entries (
    organization_id,
    pipeline_id,
    lead_id,
    stage_key,
    entered_at,
    stage_changed_at
  ) VALUES (
    NEW.organization_id,
    v_pipeline_id,
    NEW.id,
    'novo',
    NOW(),
    NOW()
  );

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_auto_assign_lead_default_pipe() IS
  'Semeia lead novo em whatsapp/novo. Pulado quando: origin=cal, lead já tem entry '
  '(padrão ou custom), ou o GUC app.skip_default_pipe=1 está setado na transação.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC transacional de import em funil custom
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_lead_into_custom_pipeline(
  p_organization_id uuid,
  p_lead jsonb,
  p_pipeline_id uuid,
  p_stage_id uuid,
  p_assigned_to uuid DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead_id uuid;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id é obrigatório';
  END IF;

  -- Guard de tenant: o funil tem que ser da org que está importando. Sem isto,
  -- um organization_id de uma org e um pipeline_id de outra criariam o card no
  -- funil do vizinho.
  IF NOT EXISTS (
    SELECT 1 FROM public.custom_pipelines
    WHERE id = p_pipeline_id
      AND organization_id = p_organization_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Pipeline custom % não pertence à organização % ou está inativo',
      p_pipeline_id, p_organization_id;
  END IF;

  -- Guard de integridade: a etapa tem que ser DESTE funil.
  IF NOT EXISTS (
    SELECT 1 FROM public.custom_pipeline_stages
    WHERE id = p_stage_id
      AND pipeline_id = p_pipeline_id
  ) THEN
    RAISE EXCEPTION 'Etapa % não pertence ao pipeline %', p_stage_id, p_pipeline_id;
  END IF;

  -- Guard de tenant no responsável: impede carimbar um membro de outra org.
  IF p_assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE id = p_assigned_to
      AND organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Responsável % não pertence à organização %',
      p_assigned_to, p_organization_id;
  END IF;

  -- Escopo `true` = LOCAL: vale só até o fim desta transação. Não vaza pra
  -- próxima query da mesma conexão (pooler reusa conexão entre requests).
  PERFORM set_config('app.skip_default_pipe', '1', true);

  INSERT INTO public.leads (
    organization_id, name, company, phone, email,
    faturamento, segment, notes, origin, rating,
    utm_campaign, utm_source, utm_medium, utm_content, utm_term,
    responsible_id, sdr_id
  ) VALUES (
    p_organization_id,
    p_lead->>'name',
    p_lead->>'company',
    p_lead->>'phone',
    p_lead->>'email',
    p_lead->>'faturamento',
    p_lead->>'segment',
    p_lead->>'notes',
    coalesce((p_lead->>'origin')::public.lead_origin, 'outro'::public.lead_origin),
    coalesce((p_lead->>'rating')::int, 0),
    p_lead->>'utm_campaign',
    p_lead->>'utm_source',
    p_lead->>'utm_medium',
    p_lead->>'utm_content',
    p_lead->>'utm_term',
    p_assigned_to,
    p_assigned_to
  )
  RETURNING id INTO v_lead_id;

  INSERT INTO public.custom_pipe_entries (
    organization_id, pipeline_id, lead_id, stage_id, assigned_to,
    entered_at, stage_changed_at
  ) VALUES (
    p_organization_id, p_pipeline_id, v_lead_id, p_stage_id, p_assigned_to,
    NOW(), NOW()
  );

  RETURN v_lead_id;
END;
$function$;

COMMENT ON FUNCTION public.import_lead_into_custom_pipeline(uuid, jsonb, uuid, uuid, uuid) IS
  'Cria lead + entry em funil custom numa transação só, suprimindo o seed automático '
  'em whatsapp/novo. Usada por import-leads. service_role apenas.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Grants
-- ─────────────────────────────────────────────────────────────────────────────
-- REVOKE FROM PUBLIC, não FROM anon: o EXECUTE chega via GRANT TO PUBLIC que
-- toda função nova recebe por default. Revogar de `anon` seria no-op e a função
-- continuaria chamável sem autenticação — com SECURITY DEFINER, isso seria
-- escrita irrestrita em `leads`.
REVOKE ALL ON FUNCTION public.import_lead_into_custom_pipeline(uuid, jsonb, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_lead_into_custom_pipeline(uuid, jsonb, uuid, uuid, uuid) TO service_role;
