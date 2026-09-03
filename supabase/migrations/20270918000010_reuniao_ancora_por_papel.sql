-- 20270918000010_reuniao_ancora_por_papel.sql — SCRUM-641 (W6 · Funil é Funil)
--
-- Premissa da Agenda ABSORVIDA (decisão CTO 2026-09-03): reunião ancora por
-- PAPEL de etapa (`stage_role = 'meeting_booked'/'meeting_held'`) em QUALQUER
-- funil — nunca por slug 'confirmacao' nem por stage_key literal.
--
-- ── O FURO, MEDIDO EM PROD (2026-09-03) ─────────────────────────────────────
--
--   `fn_capture_meeting_event` (trigger trg_meeting_events_capture em
--   pipeline_entries) é a ÚNICA porta de captura para `meeting_events` — e a
--   Agenda (get_agenda_events, Source 5) lê meeting_events. Os predicados de
--   prod eram exclusivamente literais:
--     BOOKED: slug='confirmacao' no INSERT, OU stage_key='agendado';
--     HELD:   stage_key='compareceu'.
--   Org nova pós-funil-único (20270918000000) marca reunião no funil PADRÃO
--   (etapa com papel meeting_booked, ex.: 'reuniao_marcada' do Funil de
--   Vendas) — que NÃO casa com predicado nenhum: a reunião nunca chegaria à
--   Agenda. O mesmo furo vale hoje para funil custom com etapa de reunião
--   (729 etapas ativas meeting_booked / 114 meeting_held em prod).
--
-- ── O QUE MUDA ──────────────────────────────────────────────────────────────
--
--   Os predicados literais ficam NA ÍNTEGRA (as 108 orgs atuais seguem no
--   caminho de sempre) e ganham o irmão por papel:
--     BOOKED: + (papel da etapa de destino = 'meeting_booked' e o card entrou
--               nela — INSERT ou mudança de stage_key);
--     HELD:   + (papel = 'meeting_held').
--   Efeito novo e INTENCIONAL (a premissa absorvida): funil custom/novo com
--   etapa de reunião passa a alimentar meeting_events → Agenda → desfecho.
--   O dedup existente (booked aberto ±30 dias vira UPDATE, nunca segundo
--   INSERT) continua governando duplicação.
--
-- Corpo baixado de prod em 2026-09-03 (idêntico ao topo do ledger) e alterado
-- SÓ nos três pontos acima. Rollback pareado em
-- supabase/migrations/rollback/20270918000010_reuniao_ancora_por_papel.sql
-- (restaura o corpo de prod pré-migration).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.fn_capture_meeting_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug text;
  v_meeting_date timestamptz;
  v_presale uuid;
  v_prev public.meeting_events%ROWTYPE;
  v_prev_open boolean;
  v_entering_booked boolean := false;
  v_booked_id uuid;
  v_role_new public.stage_role;
BEGIN
  SELECT p.slug INTO v_slug FROM public.pipelines p WHERE p.id = NEW.pipeline_id;

  -- SCRUM-641: PAPEL da etapa de destino — a âncora que vale em QUALQUER
  -- funil (premissa da Agenda absorvida). Resolvido por (pipeline_id,
  -- stage_key); etapa sem linha (legado) fica NULL e só os predicados
  -- literais de sempre decidem.
  SELECT ps.stage_role INTO v_role_new
  FROM public.pipeline_stages ps
  WHERE ps.pipeline_id = NEW.pipeline_id
    AND ps.stage_key = NEW.stage_key
  LIMIT 1;

  v_meeting_date := NULLIF(NEW.metadata->>'meeting_date', '')::timestamptz;

  SELECT COALESCE(
    NULLIF(NEW.metadata->>'pre_sale_responsible_id', '')::uuid,
    l.pre_sale_responsible_id,
    NULLIF(NEW.metadata->>'sdr_id', '')::uuid,
    l.sdr_id
  ) INTO v_presale
  FROM public.leads l WHERE l.id = NEW.lead_id;

  SELECT * INTO v_prev FROM public.meeting_events me
  WHERE me.lead_id = NEW.lead_id
    AND me.organization_id = NEW.organization_id
    AND me.event_type = 'meeting_booked'
  ORDER BY me.occurred_at DESC
  LIMIT 1;

  v_prev_open := v_prev.id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.meeting_events h
    WHERE h.event_type = 'meeting_held' AND h.booked_event_id = v_prev.id
  );

  -- BOOKED ──────────────────────────────────────────────────────────────────
  -- Predicados LITERAIS preservados na íntegra (108 orgs atuais) + o predicado
  -- por PAPEL (SCRUM-641): entrar numa etapa com stage_role='meeting_booked'
  -- de QUALQUER funil marca reunião — org nova sem o trio inclusa. O dedup de
  -- 30 dias logo abaixo continua sendo quem decide UPDATE vs INSERT.
  IF (v_slug = 'confirmacao' AND TG_OP = 'INSERT')
     OR (NEW.stage_key = 'agendado' AND (TG_OP = 'INSERT' OR OLD.stage_key IS DISTINCT FROM NEW.stage_key))
     OR (v_role_new = 'meeting_booked' AND (TG_OP = 'INSERT' OR OLD.stage_key IS DISTINCT FROM NEW.stage_key)) THEN
    v_entering_booked := true;
  END IF;

  IF v_entering_booked THEN
    IF v_prev_open AND (
         v_meeting_date IS NULL OR v_prev.meeting_date IS NULL
         OR abs(EXTRACT(EPOCH FROM (v_meeting_date - v_prev.meeting_date))) <= 30 * 86400
       ) THEN
      UPDATE public.meeting_events
      SET meeting_date = COALESCE(v_meeting_date, meeting_date),
          metadata = metadata || jsonb_build_object('last_reschedule_at', now(), 'last_source_entry_id', NEW.id)
      WHERE id = v_prev.id;
    ELSE
      INSERT INTO public.meeting_events
        (organization_id, lead_id, event_type, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
      VALUES
        (NEW.organization_id, NEW.lead_id, 'meeting_booked', v_presale, v_meeting_date, now(),
         'pipeline:' || COALESCE(v_slug, '?'), NEW.id);
    END IF;
  END IF;

  -- RESCHEDULE without stage change (meeting_date edited in place) ──────────
  IF TG_OP = 'UPDATE'
     AND NEW.stage_key = OLD.stage_key
     AND (OLD.metadata->>'meeting_date') IS DISTINCT FROM (NEW.metadata->>'meeting_date')
     AND v_meeting_date IS NOT NULL
     AND v_prev_open THEN
    IF v_prev.meeting_date IS NOT NULL
       AND abs(EXTRACT(EPOCH FROM (v_meeting_date - v_prev.meeting_date))) > 30 * 86400 THEN
      INSERT INTO public.meeting_events
        (organization_id, lead_id, event_type, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
      VALUES
        (NEW.organization_id, NEW.lead_id, 'meeting_booked', v_presale, v_meeting_date, now(),
         'pipeline:' || COALESCE(v_slug, '?') || ':reschedule', NEW.id);
    ELSE
      UPDATE public.meeting_events
      SET meeting_date = v_meeting_date,
          metadata = metadata || jsonb_build_object('last_reschedule_at', now())
      WHERE id = v_prev.id;
    END IF;
  END IF;

  -- HELD ────────────────────────────────────────────────────────────────────
  IF (NEW.stage_key = 'compareceu' OR v_role_new = 'meeting_held')
     AND (TG_OP = 'INSERT' OR OLD.stage_key IS DISTINCT FROM NEW.stage_key) THEN
    v_booked_id := v_prev.id;
    IF v_booked_id IS NULL THEN
      INSERT INTO public.meeting_events
        (organization_id, lead_id, event_type, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
      VALUES
        (NEW.organization_id, NEW.lead_id, 'meeting_booked', v_presale, v_meeting_date, now(),
         'pipeline:' || COALESCE(v_slug, '?') || ':implicit', NEW.id)
      RETURNING id INTO v_booked_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.meeting_events h
      WHERE h.event_type = 'meeting_held' AND h.booked_event_id = v_booked_id
    ) THEN
      INSERT INTO public.meeting_events
        (organization_id, lead_id, event_type, booked_event_id, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
      VALUES
        (NEW.organization_id, NEW.lead_id, 'meeting_held', v_booked_id,
         COALESCE(v_prev.pre_sale_responsible_id, v_presale),
         COALESCE(v_meeting_date, v_prev.meeting_date), now(),
         'pipeline:' || COALESCE(v_slug, '?'), NEW.id)
      -- A linha nova: fecha a janela entre o NOT EXISTS acima e este INSERT.
      ON CONFLICT (booked_event_id) WHERE event_type IN ('meeting_held', 'meeting_no_show') DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

-- ── Verificação — falha alto no próprio apply ───────────────────────────────
DO $$
DECLARE v_body text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_capture_meeting_event';

  -- (a) O papel entrou nos dois ramos.
  IF v_body NOT LIKE '%meeting_booked'' AND (TG_OP%' OR v_body NOT LIKE '%v_role_new = ''meeting_held''%' THEN
    RAISE EXCEPTION 'SCRUM641: captura não generalizada por stage_role.';
  END IF;

  -- (b) Os predicados literais SOBREVIVERAM (preservação das 108 orgs).
  IF v_body NOT LIKE '%v_slug = ''confirmacao'' AND TG_OP = ''INSERT''%'
     OR v_body NOT LIKE '%NEW.stage_key = ''agendado''%'
     OR v_body NOT LIKE '%NEW.stage_key = ''compareceu''%' THEN
    RAISE EXCEPTION 'SCRUM641: predicado literal legado sumiu — as 108 orgs mudariam de comportamento.';
  END IF;

  -- (c) O trigger continua pendurado onde sempre esteve.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_meeting_events_capture'
      AND tgrelid = 'public.pipeline_entries'::regclass
  ) THEN
    RAISE EXCEPTION 'SCRUM641: trg_meeting_events_capture sumiu de pipeline_entries.';
  END IF;

  RAISE NOTICE 'SCRUM641 OK: reunião ancora por papel em qualquer funil; literais legados preservados.';
END $$;
