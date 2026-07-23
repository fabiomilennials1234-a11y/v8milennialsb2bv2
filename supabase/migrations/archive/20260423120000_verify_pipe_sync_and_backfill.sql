-- =============================================================================
-- Fix + verificação: pipe sync de closer_id/sdr_id/responsible_id (incidente
-- funis-access-multi-org-rls / 2026-04-23).
-- =============================================================================
--
-- MOTIVAÇÃO
-- --------
-- A migration 20260417110000_fix_pipe_closer_sdr_sync foi validada em dev
-- (`bcfadphgsibjzivtbjvc`) mas NÃO foi aplicada em produção
-- (`jsjsmuncfkbsbzqzqhfq`) na data do incidente. Sem ela, o trigger
-- `trg_sync_responsible_from_lead_to_pipes` só sincroniza `responsible_id`
-- e deixa `closer_id`/`sdr_id` divergentes entre `leads` e `pipe_*`, fazendo
-- com que a RLS de pipe (que lê colunas do próprio pipe) esconda cards do
-- responsável atual e continue mostrando ao antigo.
--
-- Esta migration é IDEMPOTENTE: roda sobre qualquer estado (pós 20260417110000
-- ou sem ela) e termina com drift zero e trigger canônico. Use como gate de
-- produção — aplicada sozinha já corrige o invariante se a 20260417110000
-- tiver falhado ou sido pulada.
--
-- INVARIANTE FINAL
-- ----------------
--   pipe_whatsapp.{responsible_id, sdr_id}                     ≡ leads.{responsible_id, sdr_id}
--   pipe_confirmacao.{responsible_id, sdr_id, closer_id}       ≡ leads.{responsible_id, sdr_id, closer_id}
--   pipe_propostas.{responsible_id, closer_id}                 ≡ leads.{responsible_id, closer_id}
--   campanha_leads.responsible_id                              ≡ leads.responsible_id
-- =============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. FUNÇÃO canônica — re-declara a versão completa (superset de 20260417110000).
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_responsible_from_lead_to_pipes()
RETURNS TRIGGER AS $$
BEGIN
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

  IF NEW.closer_id IS DISTINCT FROM OLD.closer_id THEN
    UPDATE public.pipe_confirmacao
       SET closer_id = NEW.closer_id
     WHERE lead_id = NEW.id AND closer_id IS DISTINCT FROM NEW.closer_id;

    UPDATE public.pipe_propostas
       SET closer_id = NEW.closer_id
     WHERE lead_id = NEW.id AND closer_id IS DISTINCT FROM NEW.closer_id;
  END IF;

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
  'Reverse sync: leads.{responsible_id,closer_id,sdr_id} → pipe_*. Corrige bug de visibilidade em que o closer/sdr antigo continuava vendo o card após transferência (incidente 2026-04-23).';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. TRIGGER canônico — recria dispara em OF (responsible_id, closer_id, sdr_id).
-- ────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_sync_responsible_from_lead_to_pipes ON public.leads;
CREATE TRIGGER trg_sync_responsible_from_lead_to_pipes
  AFTER UPDATE OF responsible_id, closer_id, sdr_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_responsible_from_lead_to_pipes();


-- ────────────────────────────────────────────────────────────────────────────
-- 3. BACKFILL — corrige drift histórico em todas as tabelas afetadas.
--    `IS DISTINCT FROM` garante idempotência (no-op em rows já sincronizadas).
-- ────────────────────────────────────────────────────────────────────────────

UPDATE public.pipe_propostas pp
   SET closer_id = l.closer_id
  FROM public.leads l
 WHERE pp.lead_id = l.id
   AND pp.closer_id IS DISTINCT FROM l.closer_id;

UPDATE public.pipe_propostas pp
   SET responsible_id = l.responsible_id
  FROM public.leads l
 WHERE pp.lead_id = l.id
   AND pp.responsible_id IS DISTINCT FROM l.responsible_id;

UPDATE public.pipe_confirmacao pc
   SET closer_id = l.closer_id
  FROM public.leads l
 WHERE pc.lead_id = l.id
   AND pc.closer_id IS DISTINCT FROM l.closer_id;

UPDATE public.pipe_confirmacao pc
   SET sdr_id = l.sdr_id
  FROM public.leads l
 WHERE pc.lead_id = l.id
   AND pc.sdr_id IS DISTINCT FROM l.sdr_id;

UPDATE public.pipe_confirmacao pc
   SET responsible_id = l.responsible_id
  FROM public.leads l
 WHERE pc.lead_id = l.id
   AND pc.responsible_id IS DISTINCT FROM l.responsible_id;

UPDATE public.pipe_whatsapp pw
   SET sdr_id = l.sdr_id
  FROM public.leads l
 WHERE pw.lead_id = l.id
   AND pw.sdr_id IS DISTINCT FROM l.sdr_id;

UPDATE public.pipe_whatsapp pw
   SET responsible_id = l.responsible_id
  FROM public.leads l
 WHERE pw.lead_id = l.id
   AND pw.responsible_id IS DISTINCT FROM l.responsible_id;

UPDATE public.campanha_leads cl
   SET responsible_id = l.responsible_id
  FROM public.leads l
 WHERE cl.lead_id = l.id
   AND cl.responsible_id IS DISTINCT FROM l.responsible_id;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. DIAGNÓSTICO runtime — view auxiliar para monitoramento pós-deploy.
--    Se alguma linha aparecer aqui após o deploy, o trigger não está cobrindo
--    um caminho de escrita (ex: INSERT direto em pipe ignorando leads).
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_pipe_responsibility_drift AS
  SELECT 'pipe_propostas' AS source, 'closer_id' AS field, pp.id AS pipe_id, pp.lead_id, pp.organization_id,
         pp.closer_id AS pipe_value, l.closer_id AS lead_value
    FROM public.pipe_propostas pp JOIN public.leads l ON l.id = pp.lead_id
   WHERE pp.closer_id IS DISTINCT FROM l.closer_id
  UNION ALL
  SELECT 'pipe_propostas', 'responsible_id', pp.id, pp.lead_id, pp.organization_id,
         pp.responsible_id, l.responsible_id
    FROM public.pipe_propostas pp JOIN public.leads l ON l.id = pp.lead_id
   WHERE pp.responsible_id IS DISTINCT FROM l.responsible_id
  UNION ALL
  SELECT 'pipe_confirmacao', 'closer_id', pc.id, pc.lead_id, pc.organization_id,
         pc.closer_id, l.closer_id
    FROM public.pipe_confirmacao pc JOIN public.leads l ON l.id = pc.lead_id
   WHERE pc.closer_id IS DISTINCT FROM l.closer_id
  UNION ALL
  SELECT 'pipe_confirmacao', 'sdr_id', pc.id, pc.lead_id, pc.organization_id,
         pc.sdr_id, l.sdr_id
    FROM public.pipe_confirmacao pc JOIN public.leads l ON l.id = pc.lead_id
   WHERE pc.sdr_id IS DISTINCT FROM l.sdr_id
  UNION ALL
  SELECT 'pipe_confirmacao', 'responsible_id', pc.id, pc.lead_id, pc.organization_id,
         pc.responsible_id, l.responsible_id
    FROM public.pipe_confirmacao pc JOIN public.leads l ON l.id = pc.lead_id
   WHERE pc.responsible_id IS DISTINCT FROM l.responsible_id
  UNION ALL
  SELECT 'pipe_whatsapp', 'sdr_id', pw.id, pw.lead_id, pw.organization_id,
         pw.sdr_id, l.sdr_id
    FROM public.pipe_whatsapp pw JOIN public.leads l ON l.id = pw.lead_id
   WHERE pw.sdr_id IS DISTINCT FROM l.sdr_id
  UNION ALL
  SELECT 'pipe_whatsapp', 'responsible_id', pw.id, pw.lead_id, pw.organization_id,
         pw.responsible_id, l.responsible_id
    FROM public.pipe_whatsapp pw JOIN public.leads l ON l.id = pw.lead_id
   WHERE pw.responsible_id IS DISTINCT FROM l.responsible_id;

COMMENT ON VIEW public.v_pipe_responsibility_drift IS
  'Diagnóstico: linhas de pipe_* cujo responsável divirja de leads. Em regime, espera-se 0 linhas. Uso: SELECT source, field, COUNT(*) FROM v_pipe_responsibility_drift GROUP BY 1,2;';


-- ────────────────────────────────────────────────────────────────────────────
-- 5. VALIDAÇÃO — aborta a migration se drift persistir após backfill.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_total INT;
  v_trigger_events TEXT[];
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.v_pipe_responsibility_drift;

  RAISE NOTICE 'Pipe responsibility drift total após backfill = %', v_total;

  IF v_total > 0 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: drift persistente (% linhas) — investigar via v_pipe_responsibility_drift', v_total;
  END IF;

  -- Checa que o trigger existe e monitora os 3 campos.
  SELECT array_agg(a.attname ORDER BY a.attname) INTO v_trigger_events
    FROM pg_trigger t
    JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY(t.tgattr)
   WHERE t.tgname = 'trg_sync_responsible_from_lead_to_pipes';

  IF v_trigger_events IS NULL OR NOT (
       'closer_id'      = ANY(v_trigger_events)
   AND 'responsible_id' = ANY(v_trigger_events)
   AND 'sdr_id'         = ANY(v_trigger_events)
  ) THEN
    RAISE EXCEPTION 'VALIDATION FAILED: trigger não cobre (responsible_id, closer_id, sdr_id). Eventos = %', v_trigger_events;
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: drift zerado + trigger canônico ativo.';
END;
$$;
