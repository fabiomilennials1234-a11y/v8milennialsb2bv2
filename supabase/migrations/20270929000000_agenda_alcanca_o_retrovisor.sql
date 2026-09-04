-- 20270929000000_agenda_alcanca_o_retrovisor.sql — S6, complemento
--
-- ── POR QUE ESTA MIGRATION EXISTE ────────────────────────────────────────
-- A 20270928000000 ligou o espelho e resolveu a reunião NOVA: o trigger dispara
-- no INSERT e o app passou a escrever `meetings.deal_id`. O HISTÓRICO ficou de
-- fora, e não por descuido — o comentário do passo 4 daquela migration é
-- explícito: o backfill de `deal_id` roda DEPOIS da projeção justamente para
-- não "projetar data em 143 entradas a mais (medido) — muito além das 17 que
-- esta fatia autoriza".
--
-- O recorte era de ESCOPO, não de segurança. Medido em prod logo após o apply:
--   · 642 pares que já tinham `deal_id` → 17 carimbados, 0 sem data no card
--   · 151 pares que GANHARAM `deal_id` naquele apply → 0 carimbados, 143 sem
--     data nenhuma no card
-- Entre os 143 está o caso que originou a fatia (meeting 80ebb72c, deal
-- 24702b39, entry 486974ad): ganhou o ponteiro e seguiu com o card mudo.
--
-- O CTO autorizou ampliar o escopo em 2026-09-04. Esta migration faz a MESMA
-- operação do backfill da projeção da 20270928000000, com o mesmo predicado de
-- preservação, apontada para os pares do livro.
--
-- ── POR QUE CONTINUA METRIC-NEUTRA ───────────────────────────────────────
-- A escrita leva o carimbo `agenda_espelho` junto, e é ele que faz
-- `fn_capture_meeting_event` sair calada — mesmo mecanismo que manteve as 17
-- escritas anteriores sem tocar em `meeting_events`. Nenhum escritor de
-- métrica muda aqui, e nenhuma linha de `meeting_events` é criada, alterada ou
-- removida. O ensaio (.specs/agenda-fonte-unica/ensaio-s6-retrovisor.sql) prova
-- isso contra o schema real antes do apply.
--
-- ── A DIFERENÇA EM RELAÇÃO À ORIGINAL: MULTIPLICIDADE ────────────────────
-- A original escrevia com `UPDATE ... FROM meetings` sem desempate, e sua
-- guarda comparava PARES do join com o ROW_COUNT do UPDATE, que conta ENTRADAS.
-- Isso só era verdade porque nenhum negócio tinha duas reuniões vivas. No
-- conjunto do livro isso NÃO vale: medido agora, 151 pares para 148 entradas —
-- 2 negócios têm mais de uma reunião viva. Sem desempate, o Postgres escolhe
-- uma linha arbitrária entre as candidatas e o resultado deixa de ser
-- reproduzível. Aqui a escolha é explícita e determinística:
--   1. a próxima reunião FUTURA (a mais próxima de hoje);
--   2. não havendo futura, a passada mais RECENTE.
-- É a reunião que o vendedor procura quando abre o card.
--
-- ── REAPLICAR É NO-OP ────────────────────────────────────────────────────
-- O predicado exige entrada SEM `meeting_date`. Na segunda passada o alvo é
-- vazio, `v_escritas` é 0 e a asserção de igualdade passa por 0 = 0.
--
-- Idempotente. Nenhuma linha de `meeting_events` é tocada.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. O LIVRO DA PROCEDÊNCIA DESTA PASSADA
-- ═══════════════════════════════════════════════════════════════════════════
-- O carimbo `agenda_espelho` sozinho NÃO serve ao rollback: as 17 entradas da
-- 20270928000000 também o carregam, e depois de escrito o carimbo desta passada
-- é indistinguível do dela. O livro guarda quais entradas ESTA migration tocou,
-- com o `rev` que ela gravou — o rollback só desfaz o que ainda tem o mesmo
-- `rev`, preservando o que alguém tenha reescrito depois.
CREATE SCHEMA IF NOT EXISTS backup;

CREATE TABLE IF NOT EXISTS backup.entries_projecao_s6_20270929 (
  entry_id    uuid PRIMARY KEY,
  meeting_id  uuid NOT NULL,
  rev         text NOT NULL,
  escrito_em  timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE backup.entries_projecao_s6_20270929 FROM PUBLIC;
REVOKE ALL ON TABLE backup.entries_projecao_s6_20270929 FROM anon;
REVOKE ALL ON TABLE backup.entries_projecao_s6_20270929 FROM authenticated;

COMMENT ON TABLE backup.entries_projecao_s6_20270929 IS
  'S6 retrovisor — as entradas que receberam projeção de reunião pela 20270929000000, com o rev gravado. Consumida pelo rollback pareado.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. A PROJEÇÃO DO HISTÓRICO
-- ═══════════════════════════════════════════════════════════════════════════
-- `DISABLE TRIGGER` pega SHARE ROW EXCLUSIVE em `pipeline_entries` (assim desde
-- o PG 13; prod é 17.6). Conflita com ROW EXCLUSIVE, então escritor concorrente
-- espera e leitor passa. Com `lock_timeout = 5s` a migration falha rápido em vez
-- de segurar a tabela. A desabilitação vive só dentro desta transação.
ALTER TABLE public.pipeline_entries DISABLE TRIGGER update_pipeline_entries_updated_at;
ALTER TABLE public.pipeline_entries DISABLE TRIGGER trg_sync_whatsapp_stage_to_lead;

DO $retrovisor$
DECLARE
  v_previstas int;
  v_escritas  int;
BEGIN
  -- Alvo: um par (entrada, reunião) por ENTRADA, já desempatado. Contar sobre
  -- a mesma CTE que escreve é o que torna a guarda honesta — a original
  -- comparava pares com entradas e só passava por acidente da distribuição.
  WITH escolhida AS (
    SELECT DISTINCT ON (pe.id)
           pe.id AS entry_id, m.id AS meeting_id, m.start_at, m.meet_link
      FROM backup.meetings_deal_id_s6_20270928 b
      JOIN public.meetings m ON m.id = b.meeting_id
      JOIN public.pipeline_entries pe
        ON pe.deal_id = m.deal_id AND pe.organization_id = m.organization_id
     WHERE m.event_type = 'meeting'
       AND m.deal_id IS NOT NULL
       AND m.status <> 'cancelled'
       AND NULLIF(pe.metadata->>'meeting_date','') IS NULL
     ORDER BY pe.id,
              (m.start_at >= now()) DESC,
              CASE WHEN m.start_at >= now() THEN m.start_at END ASC,
              m.start_at DESC
  )
  SELECT count(*) INTO v_previstas FROM escolhida;

  WITH escolhida AS (
    SELECT DISTINCT ON (pe.id)
           pe.id AS entry_id, m.id AS meeting_id, m.start_at, m.meet_link
      FROM backup.meetings_deal_id_s6_20270928 b
      JOIN public.meetings m ON m.id = b.meeting_id
      JOIN public.pipeline_entries pe
        ON pe.deal_id = m.deal_id AND pe.organization_id = m.organization_id
     WHERE m.event_type = 'meeting'
       AND m.deal_id IS NOT NULL
       AND m.status <> 'cancelled'
       AND NULLIF(pe.metadata->>'meeting_date','') IS NULL
     ORDER BY pe.id,
              (m.start_at >= now()) DESC,
              CASE WHEN m.start_at >= now() THEN m.start_at END ASC,
              m.start_at DESC
  ),
  com_rev AS (
    SELECT e.*, gen_random_uuid()::text AS rev FROM escolhida e
  ),
  gravadas AS (
    UPDATE public.pipeline_entries pe
       SET metadata = COALESCE(pe.metadata, '{}'::jsonb)
                      || jsonb_build_object('meeting_date', c.start_at)
                      || CASE
                           WHEN c.meet_link IS NOT NULL
                             THEN jsonb_build_object('meet_link', c.meet_link)
                           ELSE '{}'::jsonb
                         END
                      || jsonb_build_object(
                           'agenda_espelho',
                           jsonb_build_object(
                             'meeting_id', c.meeting_id,
                             'rev',        c.rev,
                             'start_at',   c.start_at))
      FROM com_rev c
     WHERE pe.id = c.entry_id
    RETURNING pe.id AS entry_id, c.meeting_id, c.rev
  )
  -- O livro é alimentado no MESMO statement da escrita. Contar depois, por
  -- predicado, devolveria o conjunto de amanhã e não o desta passada.
  INSERT INTO backup.entries_projecao_s6_20270929 (entry_id, meeting_id, rev)
  SELECT entry_id, meeting_id, rev FROM gravadas
  ON CONFLICT (entry_id) DO NOTHING;

  GET DIAGNOSTICS v_escritas = ROW_COUNT;

  IF v_escritas IS DISTINCT FROM v_previstas THEN
    RAISE EXCEPTION 'S6 retrovisor: livro recebeu % linhas, alvo tinha % — o conjunto mudou entre a contagem e a escrita. Abortando.',
      v_escritas, v_previstas;
  END IF;

  RAISE NOTICE 'S6 retrovisor: % entradas ganharam meeting_date (medido em 2026-09-04: 143).', v_escritas;
END;
$retrovisor$;

ALTER TABLE public.pipeline_entries ENABLE TRIGGER trg_sync_whatsapp_stage_to_lead;
ALTER TABLE public.pipeline_entries ENABLE TRIGGER update_pipeline_entries_updated_at;
