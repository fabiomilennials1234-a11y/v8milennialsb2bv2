-- =============================================================================
-- Fix: sincronizar closer_id e sdr_id de leads para pipes (bug de visibilidade)
-- =============================================================================
--
-- PROBLEMA REPORTADO:
-- Closer A transfere o lead para Closer B alterando leads.closer_id e
-- leads.responsible_id. O trigger atual (20260826100000) sincroniza APENAS
-- responsible_id nos pipes; pipe_propostas.closer_id e pipe_confirmacao.closer_id
-- permanecem apontando para Closer A.
--
-- Como a RLS SELECT de pipe_propostas/confirmacao usa o closer_id DO PIPE
-- (não de leads), Closer A continua vendo o card → dois closers veem o mesmo
-- lead → métricas duplicadas e atendimento duplicado.
--
-- Evidência no dev (bcfadphgsibjzivtbjvc) antes do fix:
--   SELECT COUNT(*) FROM pipe_confirmacao pc JOIN leads l ON l.id=pc.lead_id
--     WHERE pc.closer_id IS DISTINCT FROM l.closer_id AND l.closer_id IS NOT NULL;
--   → 1 registro já desincronizado
--
-- FIX:
-- 1. Estende sync_responsible_from_lead_to_pipes para também propagar sdr_id
--    e closer_id quando esses campos mudam em leads.
-- 2. Atualiza o trigger para disparar também em UPDATE OF closer_id, sdr_id.
-- 3. Backfill histórico: corrige pipes desincronizados (closer_id E sdr_id).
-- 4. Bloco de validação garante drift zerado ao final.
--
-- NÃO altera as policies RLS — a correção do trigger + backfill é suficiente
-- para o bug descrito e evita subquery extra por linha (mais seguro em
-- performance). Se RLS precisar passar a ler de leads direto, será uma
-- decisão de arquitetura separada (ver STATE.md / ADR).
-- =============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. FUNÇÃO — estendida para sincronizar responsible_id, closer_id e sdr_id
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_responsible_from_lead_to_pipes()
RETURNS TRIGGER AS $$
BEGIN
  -- ── responsible_id ──────────────────────────────────────────────
  IF NEW.responsible_id IS DISTINCT FROM OLD.responsible_id THEN
    UPDATE public.pipe_whatsapp
      SET responsible_id = NEW.responsible_id
      WHERE lead_id = NEW.id AND responsible_id IS DISTINCT FROM NEW.responsible_id;

    UPDATE public.pipe_confirmacao
      SET responsible_id = NEW.responsible_id
      WHERE lead_id = NEW.id AND responsible_id IS DISTINCT FROM NEW.responsible_id;

    UPDATE public.pipe_propostas
      SET responsible_id = NEW.responsible_id
      WHERE lead_id = NEW.id AND responsible_id IS DISTINCT FROM NEW.responsible_id;

    UPDATE public.campanha_leads
      SET responsible_id = NEW.responsible_id
      WHERE lead_id = NEW.id AND responsible_id IS DISTINCT FROM NEW.responsible_id;
  END IF;

  -- ── closer_id — só em pipe_confirmacao e pipe_propostas ────────
  -- (pipe_whatsapp e campanha_leads não têm closer_id)
  IF NEW.closer_id IS DISTINCT FROM OLD.closer_id THEN
    UPDATE public.pipe_confirmacao
      SET closer_id = NEW.closer_id
      WHERE lead_id = NEW.id AND closer_id IS DISTINCT FROM NEW.closer_id;

    UPDATE public.pipe_propostas
      SET closer_id = NEW.closer_id
      WHERE lead_id = NEW.id AND closer_id IS DISTINCT FROM NEW.closer_id;
  END IF;

  -- ── sdr_id — em pipe_whatsapp e pipe_confirmacao ───────────────
  -- (pipe_propostas não tem sdr_id; campanha_leads também não)
  IF NEW.sdr_id IS DISTINCT FROM OLD.sdr_id THEN
    UPDATE public.pipe_whatsapp
      SET sdr_id = NEW.sdr_id
      WHERE lead_id = NEW.id AND sdr_id IS DISTINCT FROM NEW.sdr_id;

    UPDATE public.pipe_confirmacao
      SET sdr_id = NEW.sdr_id
      WHERE lead_id = NEW.id AND sdr_id IS DISTINCT FROM NEW.sdr_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.sync_responsible_from_lead_to_pipes() IS
  'Reverse sync: quando leads.responsible_id, closer_id ou sdr_id mudam, propaga para todos os pipes associados + campanha_leads. Corrige bug de visibilidade em que o closer antigo continuava vendo o card após transferência porque pipe_propostas.closer_id não era atualizado.';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. TRIGGER — monitora também closer_id e sdr_id
-- ────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_sync_responsible_from_lead_to_pipes ON public.leads;
CREATE TRIGGER trg_sync_responsible_from_lead_to_pipes
  AFTER UPDATE OF responsible_id, closer_id, sdr_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_responsible_from_lead_to_pipes();


-- ────────────────────────────────────────────────────────────────────────────
-- 3. BACKFILL histórico — corrige pipes desincronizados de fonte de verdade
-- ────────────────────────────────────────────────────────────────────────────

-- pipe_propostas.closer_id ← leads.closer_id
UPDATE public.pipe_propostas pp
SET closer_id = l.closer_id
FROM public.leads l
WHERE pp.lead_id = l.id
  AND pp.closer_id IS DISTINCT FROM l.closer_id;

-- pipe_confirmacao.closer_id ← leads.closer_id
UPDATE public.pipe_confirmacao pc
SET closer_id = l.closer_id
FROM public.leads l
WHERE pc.lead_id = l.id
  AND pc.closer_id IS DISTINCT FROM l.closer_id;

-- pipe_confirmacao.sdr_id ← leads.sdr_id
UPDATE public.pipe_confirmacao pc
SET sdr_id = l.sdr_id
FROM public.leads l
WHERE pc.lead_id = l.id
  AND pc.sdr_id IS DISTINCT FROM l.sdr_id;

-- pipe_whatsapp.sdr_id ← leads.sdr_id
UPDATE public.pipe_whatsapp pw
SET sdr_id = l.sdr_id
FROM public.leads l
WHERE pw.lead_id = l.id
  AND pw.sdr_id IS DISTINCT FROM l.sdr_id;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. VALIDAÇÃO — drift deve ser zero para closer_id e sdr_id
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_drift_pp_closer INT;
  v_drift_pc_closer INT;
  v_drift_pc_sdr INT;
  v_drift_pw_sdr INT;
BEGIN
  SELECT COUNT(*) INTO v_drift_pp_closer
  FROM public.pipe_propostas pp
  JOIN public.leads l ON l.id = pp.lead_id
  WHERE pp.closer_id IS DISTINCT FROM l.closer_id;

  SELECT COUNT(*) INTO v_drift_pc_closer
  FROM public.pipe_confirmacao pc
  JOIN public.leads l ON l.id = pc.lead_id
  WHERE pc.closer_id IS DISTINCT FROM l.closer_id;

  SELECT COUNT(*) INTO v_drift_pc_sdr
  FROM public.pipe_confirmacao pc
  JOIN public.leads l ON l.id = pc.lead_id
  WHERE pc.sdr_id IS DISTINCT FROM l.sdr_id;

  SELECT COUNT(*) INTO v_drift_pw_sdr
  FROM public.pipe_whatsapp pw
  JOIN public.leads l ON l.id = pw.lead_id
  WHERE pw.sdr_id IS DISTINCT FROM l.sdr_id;

  RAISE NOTICE 'Drift remanescente após backfill:';
  RAISE NOTICE '  pipe_propostas.closer_id      = %', v_drift_pp_closer;
  RAISE NOTICE '  pipe_confirmacao.closer_id    = %', v_drift_pc_closer;
  RAISE NOTICE '  pipe_confirmacao.sdr_id       = %', v_drift_pc_sdr;
  RAISE NOTICE '  pipe_whatsapp.sdr_id          = %', v_drift_pw_sdr;

  IF v_drift_pp_closer + v_drift_pc_closer + v_drift_pc_sdr + v_drift_pw_sdr > 0 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: drift remanescente após backfill';
  END IF;

  -- Checa trigger
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_responsible_from_lead_to_pipes'
  ) THEN
    RAISE EXCEPTION 'VALIDATION FAILED: trigger não foi recriado';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: drift zerado e trigger ativo para (responsible_id, closer_id, sdr_id).';
END;
$$;
