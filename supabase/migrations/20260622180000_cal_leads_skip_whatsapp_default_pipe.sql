-- Cal.com leads pulam o seed automático em whatsapp/novo.
--
-- Contexto: trg_auto_assign_lead_default_pipe (AFTER INSERT em leads) semeia todo
-- lead novo em pipeline_entries(whatsapp/novo). Para leads vindos do Cal.com (origin='cal'),
-- a reunião já está agendada e o lead-webhook os coloca direto em confirmacao/reuniao_marcada.
-- Como o trigger roda no INSERT (antes do app inserir a entry de confirmacao), ele sempre
-- vencia a corrida e o lead aparecia DUPLICADO na coluna "Novo" do funil WhatsApp.
--
-- Fix: skip determinístico quando NEW.origin = 'cal'. Cal = sempre reunião → nunca qualificação.
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
    AND type = 'system'
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
