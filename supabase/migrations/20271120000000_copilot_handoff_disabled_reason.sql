-- Copilot: transferência para humano passa a ser PEGAJOSA (H2 do diagnóstico
-- de 2026-10-13).
--
-- Problema
--   A transferência para humano desliga a IA sem usuário: RPC
--   transfer_lead_to_human (V1), transfer-human.ts (fila V2/SZ),
--   webhook-orchestrator e qualify-lead gravam leads.ai_disabled sem
--   ai_disabled_by, e o trigger sync_lead_ai_to_preferences espelha na
--   preferência com set_by NULL. A religação automática no inbound (#839, feita
--   para o desligamento em massa REALSC de 28/05/2026) usa set_by IS NULL como
--   assinatura de "bulk do sistema" e religa a IA na próxima mensagem do lead.
--   Além disso, quando leads.ai_disabled já era true (lead "travado"), o RPC não
--   vira a flag, o trigger (IS DISTINCT) não roda, e a preferência — fonte de
--   verdade do gate — continua ligada: humano e IA falando juntos, e o loop
--   transfere/notifica de novo a cada turno (144 leads em 12 orgs em prod).
--
-- Mecanismo (decisões fechadas no CP-v2)
--   1. phone_ai_preferences.disabled_reason: 'handoff' marca o desligamento por
--      transferência; NULL = qualquer outro (manual com set_by, bulk do sistema).
--      Só tem significado com ai_disabled = true. set_by NÃO serve de prova
--      (COALESCE no trigger; FK para auth.users impede sentinela).
--   2. sync_lead_ai_to_preferences: na virada da flag, desligar sem
--      ai_disabled_by grava 'handoff'; com usuário ou religando grava NULL.
--   3. transfer_lead_to_human: além de leads/conversations, garante a
--      preferência desligada para (org, leads.normalized_phone). Se a
--      preferência já estava desligada (manual, bulk ou o próprio trigger desta
--      transação), nada muda: set_by, set_at e disabled_reason preservados —
--      implementado como `DO UPDATE ... WHERE NOT ai_disabled` (equivale ao
--      CASE da decisão, sem escrita no-op que dispararia
--      trg_sync_ai_state_from_preferences e o realtime à toa).
--   A religação (cancellation.ts) passa a exigir disabled_reason IS NULL.
--
-- Contrato preservado
--   - transfer_lead_to_human: mesma assinatura (uuid) → void, SEM DROP,
--     SECURITY DEFINER, search_path=public, ACL só postgres + service_role
--     (CREATE OR REPLACE mantém a ACL; o REVOKE/GRANT abaixo é reafirmação
--     idempotente).
--   - sync_lead_ai_to_preferences: mesma assinatura, INVOKER, search_path
--     public, extensions; ACL de prod preservada pelo CREATE OR REPLACE.
--
-- Aditiva e idempotente. Backfill do estado existente NÃO é migration (F4):
-- scripts/copilot-handoff-backfill-20271120.sql, aplicado só depois desta
-- migration E do deploy das edges (ordem no cabeçalho do script).
-- Rollback: supabase/migrations/rollback/20271120000000_copilot_handoff_disabled_reason.sql

ALTER TABLE public.phone_ai_preferences
  ADD COLUMN IF NOT EXISTS disabled_reason text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_ai_preferences_disabled_reason_check'
      AND conrelid = 'public.phone_ai_preferences'::regclass
  ) THEN
    ALTER TABLE public.phone_ai_preferences
      ADD CONSTRAINT phone_ai_preferences_disabled_reason_check
      CHECK (disabled_reason IN ('handoff'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.phone_ai_preferences.disabled_reason IS
  'Motivo do desligamento vigente. ''handoff'' = transferência para humano (pegajosa: '
  'a religação automática no inbound não a desfaz). NULL = manual (set_by) ou bulk do '
  'sistema. Só tem significado com ai_disabled = true.';


CREATE OR REPLACE FUNCTION public.sync_lead_ai_to_preferences()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Apenas quando a flag realmente muda
  IF NEW.ai_disabled IS DISTINCT FROM OLD.ai_disabled THEN
    -- Exige normalized_phone para ter chave canônica
    IF NEW.normalized_phone IS NOT NULL AND length(NEW.normalized_phone) > 0 THEN
      INSERT INTO public.phone_ai_preferences (
        organization_id, normalized_phone, ai_disabled, set_by, set_at, disabled_reason
      ) VALUES (
        NEW.organization_id,
        NEW.normalized_phone,
        NEW.ai_disabled,
        NEW.ai_disabled_by,  -- Pode ser NULL se o caller não preencheu
        COALESCE(NEW.ai_disabled_at, now()),
        -- Desligar sem usuário = transferência para humano (pegajosa).
        -- Com usuário (toggle/master) ou religando = sem motivo.
        CASE WHEN NEW.ai_disabled AND NEW.ai_disabled_by IS NULL THEN 'handoff' ELSE NULL END
      )
      ON CONFLICT (organization_id, normalized_phone) DO UPDATE
      SET ai_disabled = EXCLUDED.ai_disabled,
          set_by = COALESCE(EXCLUDED.set_by, public.phone_ai_preferences.set_by),
          set_at = EXCLUDED.set_at,
          disabled_reason = EXCLUDED.disabled_reason;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.sync_lead_ai_to_preferences() IS
  'Rede de segurança: sincroniza phone_ai_preferences quando leads.ai_disabled muda por '
  'qualquer caminho. Mantém a invariante "fonte única = preferences" mesmo se alguém '
  'bypassar as RPCs canônicas. Desligar sem ai_disabled_by grava disabled_reason=''handoff'' '
  '(20271120000000).';
-- ACL do trigger fn: CREATE OR REPLACE preserva a de prod; nada a reafirmar.


CREATE OR REPLACE FUNCTION public.transfer_lead_to_human(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_phone  text;
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'p_lead_id cannot be null';
  END IF;

  UPDATE public.leads
  SET ai_disabled = true,
      ai_disabled_at = COALESCE(ai_disabled_at, NOW()),
      updated_at = NOW()
  WHERE id = p_lead_id
  RETURNING organization_id, normalized_phone INTO v_org_id, v_phone;

  -- A preferência é a fonte de verdade do gate. Com o lead já desligado o
  -- UPDATE acima não vira a flag e o trigger (IS DISTINCT) não roda — sem isto
  -- a IA seguia ligada para o telefone (lead "travado"). Preferência já
  -- desligada (manual, bulk ou o trigger acima) → intocada.
  IF v_org_id IS NOT NULL AND v_phone IS NOT NULL AND length(v_phone) > 0 THEN
    INSERT INTO public.phone_ai_preferences (
      organization_id, normalized_phone, ai_disabled, set_at, disabled_reason
    ) VALUES (
      v_org_id, v_phone, true, now(), 'handoff'
    )
    ON CONFLICT (organization_id, normalized_phone) DO UPDATE
    SET ai_disabled = true,
        set_at = now(),
        disabled_reason = 'handoff'
    WHERE NOT public.phone_ai_preferences.ai_disabled;
  END IF;

  UPDATE public.conversations
  SET state = 'WAITING_HUMAN',
      updated_at = NOW()
  WHERE lead_id = p_lead_id
    AND state <> 'WAITING_HUMAN';
END;
$function$;

COMMENT ON FUNCTION public.transfer_lead_to_human(uuid) IS
  'Onda 1 T1.0.6: transferência atômica de lead para humano. Sincroniza leads.ai_disabled, '
  'conversations.state e phone_ai_preferences (ai_disabled + disabled_reason=''handoff'', '
  'preservando um desligamento anterior) em transação única. 20271120000000.';

REVOKE ALL ON FUNCTION public.transfer_lead_to_human(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_lead_to_human(uuid) TO service_role;
