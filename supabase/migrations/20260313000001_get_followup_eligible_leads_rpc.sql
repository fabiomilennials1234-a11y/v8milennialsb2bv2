-- RPC: Retorna leads elegíveis para follow-up (última mensagem nossa, tempo sem resposta atingido)
-- Chamado por process-copilot-followups para obter candidatos por regra
-- Date: 2026-03-13

CREATE OR REPLACE FUNCTION public.get_followup_eligible_leads(
  p_organization_id UUID,
  p_trigger_delay_hours INTEGER,
  p_trigger_delay_minutes INTEGER
)
RETURNS TABLE (
  lead_id UUID,
  last_outgoing_at TIMESTAMPTZ,
  phone_number TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH last_msg AS (
    SELECT
      wm.lead_id,
      wm.phone_number,
      wm.direction,
      wm.timestamp,
      ROW_NUMBER() OVER (PARTITION BY wm.lead_id ORDER BY wm.timestamp DESC) AS rn
    FROM whatsapp_messages wm
    WHERE wm.organization_id = p_organization_id
      AND wm.lead_id IS NOT NULL
      AND wm.phone_number IS NOT NULL
      AND wm.phone_number != ''
  )
  SELECT
    lm.lead_id,
    lm.timestamp AS last_outgoing_at,
    lm.phone_number
  FROM last_msg lm
  WHERE lm.rn = 1
    AND lm.direction = 'outgoing'
    AND (NOW() - lm.timestamp) >= (
      (p_trigger_delay_hours || ' hours')::interval +
      (p_trigger_delay_minutes || ' minutes')::interval
    );
$$;

COMMENT ON FUNCTION public.get_followup_eligible_leads IS 'Leads cuja última mensagem é nossa e o delay de follow-up já passou';
