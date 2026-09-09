-- ROLLBACK pareado da 20270928000000 (S6 — espelho do Negócio).
--
-- Ordem INVERSA da migration, e a ordem é o que torna o rollback seguro:
--   1. derruba o TRIGGER primeiro (para nada projetar durante a reversão);
--   2. desfaz a projeção das entradas que ainda carregam o carimbo;
--   3. desfaz o ponteiro `meetings.deal_id` das 151 do backfill, PELO LIVRO
--      `backup.meetings_deal_id_s6_20270928` (ver o passo 3 — nenhuma coluna
--      de `meetings` separa esses ponteiros dos que o app escreve);
--   4. só ENTÃO restaura `fn_capture_meeting_event` sem o guarda.
--
-- O passo 4 vem por último pelo mesmo motivo que na ida ele vinha primeiro: o
-- passo 2 é um UPDATE de `metadata` e `trg_meeting_events_capture` é
-- `AFTER INSERT OR UPDATE OF stage_key, metadata`. Restaurando a função antes,
-- as remoções de projeção passariam pelo ramo RESCHEDULE e inflariam
-- `meeting_events` — e essa inflação é IRREVERSÍVEL: `fn_meeting_delete_cleans_events`
-- só apaga linhas com source='agenda:meeting'.
--
-- LIMITE HONESTO DESTE ROLLBACK: ele reverte o que a MIGRATION escreveu, não o
-- que o app escreveu depois — e essa fronteira é lida em LIVRO e em CARIMBO,
-- nunca em heurística de coluna. `meetings.deal_id` escrito pelo picker ou
-- pelo `meeting-webhook` depois do apply sobrevive ao rollback de propósito: é
-- trabalho de gente, e a fatia que o rollback desfaz é a projeção, não o
-- vínculo que alguém escolheu à mão. Entradas cuja `meeting_date` foi projetada pelo
-- espelho em produção (carimbo presente) voltam a NÃO ter data — o que é o
-- estado de antes. Entradas cuja data veio do funil (sem carimbo, ou com
-- carimbo de outra reunião) ficam INTOCADAS, pela mesma condição que governa a
-- limpeza na ida.
--
-- As 3 chaves são removidas juntas: `meeting_date`, `agenda_espelho` e
-- `meet_link` (este só quando idêntico ao da reunião carimbada).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- 1 ─────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_meeting_espelha_no_funil ON public.meetings;

-- 2 ─────────────────────────────────────────────────────────────────────────
-- Mesmos dois triggers desabilitados da ida, e pelo mesmo motivo: não sujar
-- `pipeline_entries.updated_at` (âncora viva de get_analytics_pipeline_metrics
-- e do fallback de período de get_pipeline_page) nem `leads.updated_at`.
ALTER TABLE public.pipeline_entries DISABLE TRIGGER update_pipeline_entries_updated_at;
ALTER TABLE public.pipeline_entries DISABLE TRIGGER trg_sync_whatsapp_stage_to_lead;

DO $desfaz_projecao$
DECLARE
  v_limpas int;
BEGIN
  UPDATE public.pipeline_entries pe
     SET metadata = CASE
           WHEN m.meet_link IS NOT NULL AND pe.metadata->>'meet_link' = m.meet_link
             THEN pe.metadata - 'meeting_date' - 'agenda_espelho' - 'meet_link'
           ELSE pe.metadata - 'meeting_date' - 'agenda_espelho'
         END
    FROM public.meetings m
   WHERE m.id::text = pe.metadata->'agenda_espelho'->>'meeting_id';

  GET DIAGNOSTICS v_limpas = ROW_COUNT;
  RAISE NOTICE 'S6 rollback: % entradas tiveram a projeção removida.', v_limpas;

  -- Cinto e suspensório: carimbo cuja reunião já não existe (DELETE que o
  -- espelho não alcançou) também sai — senão fica lixo apontando para o nada.
  UPDATE public.pipeline_entries pe
     SET metadata = pe.metadata - 'meeting_date' - 'agenda_espelho'
   WHERE pe.metadata ? 'agenda_espelho'
     AND NOT EXISTS (
       SELECT 1 FROM public.meetings m
        WHERE m.id::text = pe.metadata->'agenda_espelho'->>'meeting_id');

  GET DIAGNOSTICS v_limpas = ROW_COUNT;
  RAISE NOTICE 'S6 rollback: % entradas com carimbo órfão limpas.', v_limpas;
END;
$desfaz_projecao$;

ALTER TABLE public.pipeline_entries ENABLE TRIGGER trg_sync_whatsapp_stage_to_lead;
ALTER TABLE public.pipeline_entries ENABLE TRIGGER update_pipeline_entries_updated_at;

-- 3 ─────────────────────────────────────────────────────────────────────────
-- Desfaz os ponteiros pelo LIVRO, nunca por heurística de coluna.
--
-- POR QUE NÃO `created_at`: a versão anterior deste passo recortava por
-- `created_at <> '2026-09-01 19:55:09.193388+00'` achando que isso separava
-- "as 151 do backfill" das "642 do S3/S4". Medido em prod (2026-09-03), erra
-- nos DOIS sentidos:
--   • 145 das 151 alvo TÊM `created_at` exatamente naquele instante — porque
--     foi o backfill do S3/S4 que INSERIU essas linhas; o instante é o de
--     criação da LINHA, não o da escrita do `deal_id`. O recorte reverteria 6
--     de 151 e deixaria 145 ponteiros de pé afirmando tê-los removido;
--   • toda reunião criada pelo app DEPOIS do apply tem `created_at` fora do
--     instante — o recorte apagaria o `deal_id` que o picker e o
--     `meeting-webhook` escreveram, destruindo vínculo feito por gente e
--     deixando o banco num terceiro estado, nem o de antes nem o de depois.
--
-- O livro `backup.meetings_deal_id_s6_20270928` guarda (meeting_id, deal_id
-- escrito) do passo 4 da ida. Aqui só se reverte a linha cujo `deal_id` AINDA
-- é o que a migration escreveu: se alguém religou aquela reunião a outro
-- negócio depois, o valor difere e a linha fica INTOCADA. Reunião que nunca
-- esteve no livro nunca é tocada.
DO $desfaz_ponteiros$
DECLARE
  v_revertidas int := 0;
  v_no_livro   int := 0;
BEGIN
  IF to_regclass('backup.meetings_deal_id_s6_20270928') IS NULL THEN
    -- Rollback rodado duas vezes, ou migration aplicada por um caminho que não
    -- criou o livro. Avisar é melhor do que estourar: os passos 1, 2 e 4 já
    -- devolveram o comportamento, e adivinhar ponteiro é o defeito que este
    -- bloco existe para não repetir.
    RAISE WARNING 'S6 rollback: livro backup.meetings_deal_id_s6_20270928 ausente — NENHUM meetings.deal_id foi revertido. Se a migration foi aplicada, reverter à mão só com a lista do livro; NÃO existe recorte por coluna que separe estes ponteiros dos escritos pelo app.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_no_livro FROM backup.meetings_deal_id_s6_20270928;

  UPDATE public.meetings m
     SET deal_id = NULL
    FROM backup.meetings_deal_id_s6_20270928 b
   WHERE m.id = b.meeting_id
     AND m.deal_id = b.deal_id_escrito;

  GET DIAGNOSTICS v_revertidas = ROW_COUNT;

  RAISE NOTICE 'S6 rollback: % de % ponteiros do livro revertidos; % preservados porque o vínculo foi refeito depois do apply.',
    v_revertidas, v_no_livro, v_no_livro - v_revertidas;

  -- O livro cumpriu a função. Some para que uma reaplicação da migration
  -- comece com o livro que ELA escrever, e não com o desta rodada.
  DROP TABLE backup.meetings_deal_id_s6_20270928;
END;
$desfaz_ponteiros$;

-- 4 ─────────────────────────────────────────────────────────────────────────
-- Corpo de prod pré-S6 (idêntico à 20270918000010), SEM o guarda do carimbo.
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
      ON CONFLICT (booked_event_id) WHERE event_type IN ('meeting_held', 'meeting_no_show') DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- As duas funções do espelho ficam órfãs, sem trigger que as chame. Derrubá-las
-- é opcional e vem por último — se algum objeto futuro passar a depender delas,
-- o DROP falha e o rollback avisa em vez de quebrar em silêncio.
DROP FUNCTION IF EXISTS public.fn_espelha_reuniao_no_funil();
DROP FUNCTION IF EXISTS public.fn_espelho_limpa_projecao(uuid, uuid, uuid, text);
