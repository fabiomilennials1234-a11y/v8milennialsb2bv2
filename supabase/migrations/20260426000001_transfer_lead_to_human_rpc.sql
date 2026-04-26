-- Onda 1 / T1.0.6 — RPC atômica transfer_lead_to_human + backfill
--
-- Telemetria 30d (2026-04-26): 115/115 conversas (100%) com
-- leads.ai_disabled=true mas conversations.state ≠ 'WAITING_HUMAN'.
--
-- Causa: `_shared/ai-action-executor.ts:38-68` executa 2 UPDATEs
-- separados (leads + conversations). Falha entre os dois deixa
-- estado divergente. Operador não vê lead transferido.
--
-- Fix: encapsular em RPC SQL (transação implícita).

CREATE OR REPLACE FUNCTION public.transfer_lead_to_human(
  p_lead_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'p_lead_id cannot be null';
  END IF;

  UPDATE public.leads
  SET ai_disabled = true,
      ai_disabled_at = COALESCE(ai_disabled_at, NOW()),
      updated_at = NOW()
  WHERE id = p_lead_id;

  UPDATE public.conversations
  SET state = 'WAITING_HUMAN',
      updated_at = NOW()
  WHERE lead_id = p_lead_id
    AND state <> 'WAITING_HUMAN';
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_lead_to_human(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_lead_to_human(uuid) TO service_role;

COMMENT ON FUNCTION public.transfer_lead_to_human(uuid) IS
  'Onda 1 T1.0.6: transferência atômica de lead para humano. '
  'Sincroniza leads.ai_disabled e conversations.state em transação única. '
  'Substitui código não-transacional em _shared/ai-action-executor.ts.';

-- Backfill: corrige 115 conversas existentes com drift
-- (leads.ai_disabled=true mas conversations.state divergente)
UPDATE public.conversations c
SET state = 'WAITING_HUMAN',
    updated_at = NOW()
FROM public.leads l
WHERE c.lead_id = l.id
  AND l.ai_disabled = true
  AND c.state <> 'WAITING_HUMAN';
