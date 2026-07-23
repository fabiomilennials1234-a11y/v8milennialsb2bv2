-- Human Pause v2 — torna a pausa PHONE-KEYED (fonte de verdade em
-- phone_ai_preferences, espelhando ai_disabled).
--
-- Motivação (RC 2026-05-29, org SacoEcoMulti): a pausa v1 armava
-- conversations.human_paused_until via trigger, mas isso exige que lead+conversa
-- já existam. Em prospecção cold (humano manda vídeo/áudio ANTES do lead existir)
-- as mensagens entram com lead_id NULL e sem conversa → trigger não armava →
-- IA disparava greeting mesmo com humano conduzindo (Furo B).
--
-- Além disso o gate só era lido 1x no início do agent-message; a rajada de
-- chunks já enfileirada continuava saindo após o humano assumir (Furo A).
--
-- Fix: armar a pausa por TELEFONE em phone_ai_preferences (não depende de
-- lead/conversa). isCopilotCanceled (phone-keyed, re-checado per-chunk em todos
-- os 13 call-sites) passa a ler human_paused_until → cobre Furo A e Furo B.

-- 1. Coluna phone-keyed (fonte de verdade)
ALTER TABLE public.phone_ai_preferences
  ADD COLUMN IF NOT EXISTS human_paused_until TIMESTAMPTZ;

-- Índice parcial: só linhas com pausa ativa (gate query performance)
CREATE INDEX IF NOT EXISTS idx_phone_ai_prefs_human_paused_until
  ON public.phone_ai_preferences (organization_id, normalized_phone)
  WHERE human_paused_until IS NOT NULL;

-- 2. Trigger function reescrita: arma pausa PHONE-KEYED, sem depender de
--    lead/conversa existirem. Dual-write em conversations só pra display da UI.
CREATE OR REPLACE FUNCTION public.fn_human_pause_on_manual_send()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone     text;
  v_duration  integer;
  v_lead_id   uuid;
  v_conv_id   uuid;
  v_agent_id  uuid;
BEGIN
  -- Só mensagens outgoing MANUAIS (humano) — não IA, não workflow.
  IF NEW.direction != 'outgoing'
     OR COALESCE(NEW.sent_source, 'manual') != 'manual'
     OR COALESCE(NEW.sent_by_ai, false) = true
  THEN
    RETURN NEW;
  END IF;

  -- Telefone canônico (11 díg, sem 55) — MESMA normalização do gate de leitura
  -- (normalizePhoneForSearch em TS). Mismatch aqui = fail-open silencioso.
  v_phone := public.normalize_brazilian_phone(NEW.phone_number);
  IF v_phone IS NULL OR length(v_phone) = 0 THEN
    RETURN NEW;
  END IF;

  -- Resolve lead (explicit lead_id ou fallback por telefone).
  v_lead_id := NEW.lead_id;
  IF v_lead_id IS NULL THEN
    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE organization_id = NEW.organization_id
      AND normalized_phone = v_phone
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- Resolve conversa + agente que a conduz (quando existe).
  IF v_lead_id IS NOT NULL THEN
    SELECT id, agent_id INTO v_conv_id, v_agent_id
    FROM public.conversations
    WHERE lead_id = v_lead_id
      AND organization_id = NEW.organization_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- Duração/enablement: PREFERE o agente específico da conversa (semântica v1).
  -- Só cai pro agente ativo da org em COLD-START (sem conversa) — Furo B.
  IF v_agent_id IS NOT NULL THEN
    -- Conversa conhecida → respeita SÓ a config desse agente (sem fallback:
    -- se o agente da conversa tem pause off, não arma mesmo que outro agente
    -- da org tenha on).
    SELECT human_pause_duration_minutes
    INTO v_duration
    FROM public.copilot_agents
    WHERE id = v_agent_id
      AND human_pause_enabled = true;
  ELSE
    -- Cold-start: nenhuma conversa ainda. Usa o agente ativo da org com pause on.
    SELECT human_pause_duration_minutes
    INTO v_duration
    FROM public.copilot_agents
    WHERE organization_id = NEW.organization_id
      AND human_pause_enabled = true
    ORDER BY is_active DESC, created_at DESC
    LIMIT 1;
  END IF;

  -- Feature desligada pro agente/org → não arma.
  IF v_duration IS NULL THEN
    RETURN NEW;
  END IF;

  -- Arma pausa PHONE-KEYED (fonte de verdade). Funciona mesmo sem lead/conversa.
  INSERT INTO public.phone_ai_preferences (organization_id, normalized_phone, human_paused_until)
  VALUES (NEW.organization_id, v_phone, now() + (v_duration * interval '1 minute'))
  ON CONFLICT (organization_id, normalized_phone)
  DO UPDATE SET human_paused_until = EXCLUDED.human_paused_until,
                updated_at = now();

  -- Dual-write em conversations só pra display da UI (useCopilotPause).
  IF v_conv_id IS NOT NULL THEN
    UPDATE public.conversations
    SET human_paused_until = now() + (v_duration * interval '1 minute'),
        updated_at = now()
    WHERE id = v_conv_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger já existe (trg_human_pause_on_manual_send em whatsapp_messages);
-- CREATE OR REPLACE FUNCTION acima troca o corpo sem recriar o trigger.

-- 3. clear_human_pause: limpa AMBOS (fonte phone-keyed + espelho conversa).
CREATE OR REPLACE FUNCTION public.clear_human_pause(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   uuid;
  v_lead_id  uuid;
  v_phone    text;
BEGIN
  SELECT organization_id, lead_id
  INTO v_org_id, v_lead_id
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid()
      AND organization_id = v_org_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;

  -- Espelho da conversa
  UPDATE public.conversations
  SET human_paused_until = NULL,
      updated_at = now()
  WHERE id = p_conversation_id;

  -- Fonte de verdade phone-keyed (resolve telefone do lead da conversa)
  SELECT normalize_brazilian_phone(phone)
  INTO v_phone
  FROM public.leads
  WHERE id = v_lead_id;

  IF v_phone IS NOT NULL AND length(v_phone) > 0 THEN
    UPDATE public.phone_ai_preferences
    SET human_paused_until = NULL,
        updated_at = now()
    WHERE organization_id = v_org_id
      AND normalized_phone = v_phone;
  END IF;
END;
$$;
