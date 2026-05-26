-- Human Pause: auto-pause copilot when human agent sends message
-- PRD: #457 | Issue: #458

-- 1. Schema: copilot_agents config fields
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS human_pause_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_pause_duration_minutes INTEGER DEFAULT 60;

-- 2. Schema: conversations pause timestamp
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS human_paused_until TIMESTAMPTZ;

-- 3. Partial index: only rows with active pause (gate query performance)
CREATE INDEX IF NOT EXISTS idx_conversations_human_paused_until
  ON public.conversations (lead_id, organization_id)
  WHERE human_paused_until IS NOT NULL;

-- 4. Trigger function: set/reset pause on manual outgoing message
CREATE OR REPLACE FUNCTION public.fn_human_pause_on_manual_send()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id       uuid;
  v_conversation  record;
  v_agent         record;
  v_normalized    text;
BEGIN
  -- Only outgoing manual (human) messages
  IF NEW.direction != 'outgoing'
     OR COALESCE(NEW.sent_source, 'manual') != 'manual'
     OR COALESCE(NEW.sent_by_ai, false) = true
  THEN
    RETURN NEW;
  END IF;

  -- Resolve lead: prefer explicit lead_id, fallback phone lookup
  IF NEW.lead_id IS NOT NULL THEN
    v_lead_id := NEW.lead_id;
  ELSE
    v_normalized := public.normalize_brazilian_phone(NEW.phone_number);
    IF v_normalized IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE organization_id = NEW.organization_id
      AND normalized_phone = v_normalized
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find active conversation for this lead
  SELECT c.id, c.agent_id
  INTO v_conversation
  FROM public.conversations c
  WHERE c.lead_id = v_lead_id
    AND c.organization_id = NEW.organization_id
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_conversation.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if agent has human_pause_enabled
  SELECT ca.human_pause_enabled, ca.human_pause_duration_minutes
  INTO v_agent
  FROM public.copilot_agents ca
  WHERE ca.id = v_conversation.agent_id
    AND ca.human_pause_enabled = true;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Set/reset human_paused_until
  UPDATE public.conversations
  SET human_paused_until = now() + (v_agent.human_pause_duration_minutes * interval '1 minute'),
      updated_at = now()
  WHERE id = v_conversation.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_human_pause_on_manual_send ON public.whatsapp_messages;
CREATE TRIGGER trg_human_pause_on_manual_send
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_human_pause_on_manual_send();

-- 5. RPC: clear human pause (manual reactivation from chat UI)
CREATE OR REPLACE FUNCTION public.clear_human_pause(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT organization_id INTO v_org_id
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

  UPDATE public.conversations
  SET human_paused_until = NULL,
      updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;
