-- Rodar assim (o `\i MIGRATION` e literal, no mesmo estilo dos ensaios S3/S4/S6):
--   psql "$PROD_URL" -v ON_ERROR_STOP=1 -f .specs/agenda-fonte-unica/ensaio-s6-retrovisor.sql
-- trocando `\i MIGRATION` pelo caminho real do arquivo da migration.

-- Ensaio TRANSACIONAL do S6 retrovisor (20270929000000) contra PROD. Termina em ROLLBACK.
-- Cada portão imprime OK/FALHOU numa linha própria — leio todas antes de aplicar.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- get_dashboard_metrics chama assert_org_access, que libera service_role.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

CREATE TEMP TABLE _r(ordem int, medida text, valor text) ON COMMIT DROP;

-- ── FOTOGRAFIA DO ANTES ─────────────────────────────────────────────────────
CREATE TEMP TABLE _me_antes ON COMMIT DROP AS
SELECT id, event_type, meeting_date, occurred_at, booked_event_id FROM public.meeting_events;

-- As entradas que JÁ tinham data: nenhuma pode ser tocada por esta passada.
CREATE TEMP TABLE _com_data_antes ON COMMIT DROP AS
SELECT id, metadata->>'meeting_date' AS data, metadata #>> '{agenda_espelho,rev}' AS rev
FROM public.pipeline_entries
WHERE NULLIF(metadata->>'meeting_date','') IS NOT NULL;

-- O alvo, medido ANTES e pela MESMA regra de desempate que a migration usa.
CREATE TEMP TABLE _alvo_antes ON COMMIT DROP AS
SELECT DISTINCT ON (pe.id) pe.id AS entry_id, m.id AS meeting_id, m.start_at
  FROM backup.meetings_deal_id_s6_20270928 b
  JOIN public.meetings m ON m.id = b.meeting_id
  JOIN public.pipeline_entries pe
    ON pe.deal_id = m.deal_id AND pe.organization_id = m.organization_id
 WHERE m.event_type = 'meeting' AND m.deal_id IS NOT NULL AND m.status <> 'cancelled'
   AND NULLIF(pe.metadata->>'meeting_date','') IS NULL
 ORDER BY pe.id, (m.start_at >= now()) DESC,
          CASE WHEN m.start_at >= now() THEN m.start_at END ASC, m.start_at DESC;

CREATE TEMP TABLE _dm_antes ON COMMIT DROP AS
SELECT to_char(d,'YYYY-MM') AS mes, (m->>'reunioesMarcadas') AS marcadas,
       (m->>'reunioesComparecidas') AS compareceu, (m->>'noShow') AS no_show
FROM (
  SELECT d, (public.get_dashboard_metrics('6030520a-2ca7-477d-be89-55758e2cd808',
             d, (d + interval '1 month' - interval '1 second'), NULL))::jsonb AS m
  FROM generate_series('2026-05-01'::timestamptz,'2026-08-01'::timestamptz, interval '1 month') d
) x;

INSERT INTO _r SELECT 1, 'antes — linhas em meeting_events', count(*)::text FROM _me_antes;
INSERT INTO _r SELECT 2, 'antes — entradas COM data (intocáveis)', count(*)::text FROM _com_data_antes;
INSERT INTO _r SELECT 3, 'antes — alvo do retrovisor (esperado 143)', count(*)::text FROM _alvo_antes;
INSERT INTO _r SELECT 4, 'antes — get_dashboard_metrics ' || mes,
  format('marcadas=%s compareceu=%s noShow=%s', marcadas, compareceu, no_show) FROM _dm_antes;

-- Prova de que o alvo NÃO está vazio antes de aplicar: alvo zero tornaria todo
-- portão adiante verde por ausência.
INSERT INTO _r SELECT 5, 'PORTÃO — alvo não vazio (senão o ensaio não mede nada)',
  CASE WHEN (SELECT count(*) FROM _alvo_antes) > 0 THEN 'OK' ELSE 'FALHOU' END;

-- ── APLICA ──────────────────────────────────────────────────────────────────
\i MIGRATION

-- ── DEPOIS DA MIGRATION ─────────────────────────────────────────────────────

INSERT INTO _r SELECT 10, 'PORTÃO — meeting_events: linhas NOVAS (tem de ser 0)',
  CASE WHEN (SELECT count(*) FROM public.meeting_events me
              WHERE NOT EXISTS (SELECT 1 FROM _me_antes a WHERE a.id = me.id)) = 0
       THEN 'OK' ELSE 'FALHOU: ' || (SELECT count(*) FROM public.meeting_events me
              WHERE NOT EXISTS (SELECT 1 FROM _me_antes a WHERE a.id = me.id))::text END;

INSERT INTO _r SELECT 11, 'PORTÃO — meeting_events: linhas SUMIDAS (tem de ser 0)',
  CASE WHEN (SELECT count(*) FROM _me_antes a
              WHERE NOT EXISTS (SELECT 1 FROM public.meeting_events me WHERE me.id = a.id)) = 0
       THEN 'OK' ELSE 'FALHOU' END;

INSERT INTO _r SELECT 12, 'PORTÃO — meeting_events: meeting_date/occurred_at/booked alterados (tem de ser 0)',
  CASE WHEN (SELECT count(*) FROM _me_antes a JOIN public.meeting_events me ON me.id = a.id
              WHERE me.meeting_date IS DISTINCT FROM a.meeting_date
                 OR me.occurred_at  IS DISTINCT FROM a.occurred_at
                 OR me.booked_event_id IS DISTINCT FROM a.booked_event_id) = 0
       THEN 'OK' ELSE 'FALHOU' END;

INSERT INTO _r SELECT 13, 'PORTÃO — entradas que já tinham data foram PRESERVADAS (tem de ser 0 tocadas)',
  CASE WHEN (SELECT count(*) FROM _com_data_antes c JOIN public.pipeline_entries pe ON pe.id = c.id
              WHERE pe.metadata->>'meeting_date' IS DISTINCT FROM c.data
                 OR pe.metadata #>> '{agenda_espelho,rev}' IS DISTINCT FROM c.rev) = 0
       THEN 'OK' ELSE 'FALHOU: ' || (SELECT count(*) FROM _com_data_antes c JOIN public.pipeline_entries pe ON pe.id = c.id
              WHERE pe.metadata->>'meeting_date' IS DISTINCT FROM c.data
                 OR pe.metadata #>> '{agenda_espelho,rev}' IS DISTINCT FROM c.rev)::text END;

INSERT INTO _r SELECT 14, 'PORTÃO — livro = alvo medido antes (identidade, não só contagem)',
  CASE WHEN (SELECT count(*) FROM backup.entries_projecao_s6_20270929) =
            (SELECT count(*) FROM _alvo_antes)
        AND (SELECT count(*) FROM _alvo_antes a
              WHERE NOT EXISTS (SELECT 1 FROM backup.entries_projecao_s6_20270929 b
                                 WHERE b.entry_id = a.entry_id AND b.meeting_id = a.meeting_id)) = 0
       THEN 'OK' ELSE 'FALHOU' END;

INSERT INTO _r SELECT 15, 'medida — entradas no livro do retrovisor', count(*)::text
  FROM backup.entries_projecao_s6_20270929;

INSERT INTO _r SELECT 16, 'PORTÃO — toda entrada do alvo tem a data da reunião escolhida (tem de ser 0 erradas)',
  CASE WHEN (SELECT count(*) FROM _alvo_antes a JOIN public.pipeline_entries pe ON pe.id = a.entry_id
              WHERE (pe.metadata->>'meeting_date')::timestamptz IS DISTINCT FROM a.start_at) = 0
       THEN 'OK' ELSE 'FALHOU' END;

-- O caso que originou a fatia. Se ele continuar mudo, a migration não serviu.
INSERT INTO _r SELECT 17, 'PORTÃO — o card do print (entry 486974ad) ganhou a data 2026-09-07 14:00Z',
  CASE WHEN (SELECT (pe.metadata->>'meeting_date')::timestamptz
               FROM public.pipeline_entries pe
              WHERE pe.id = '486974ad-0a62-4210-9780-605165734aca') = '2026-09-07 14:00:00+00'::timestamptz
       THEN 'OK' ELSE 'FALHOU: ' || COALESCE((SELECT pe.metadata->>'meeting_date' FROM public.pipeline_entries pe
              WHERE pe.id = '486974ad-0a62-4210-9780-605165734aca'), 'sem data') END;

-- ── INVARIANTE DE MÉTRICA ───────────────────────────────────────────────────
CREATE TEMP TABLE _dm_depois ON COMMIT DROP AS
SELECT to_char(d,'YYYY-MM') AS mes, (m->>'reunioesMarcadas') AS marcadas,
       (m->>'reunioesComparecidas') AS compareceu, (m->>'noShow') AS no_show
FROM (
  SELECT d, (public.get_dashboard_metrics('6030520a-2ca7-477d-be89-55758e2cd808',
             d, (d + interval '1 month' - interval '1 second'), NULL))::jsonb AS m
  FROM generate_series('2026-05-01'::timestamptz,'2026-08-01'::timestamptz, interval '1 month') d
) x;

INSERT INTO _r SELECT 20, 'PORTÃO — meses com divergência em get_dashboard_metrics (tem de ser 0)',
  CASE WHEN (SELECT count(*) FROM _dm_antes a JOIN _dm_depois d USING (mes)
              WHERE a.marcadas IS DISTINCT FROM d.marcadas
                 OR a.compareceu IS DISTINCT FROM d.compareceu
                 OR a.no_show IS DISTINCT FROM d.no_show) = 0
       THEN 'OK' ELSE 'FALHOU' END;

INSERT INTO _r SELECT 21, 'depois — get_dashboard_metrics ' || mes,
  format('marcadas=%s compareceu=%s noShow=%s', marcadas, compareceu, no_show) FROM _dm_depois;

-- ── CONTROLE POSITIVO ───────────────────────────────────────────────────────
-- Sem ele, o portão 10 pode estar verde por `fn_capture_meeting_event` estar
-- inerte por outro motivo. Uma edição HUMANA numa entrada SEM carimbo tem de
-- continuar emitindo evento — é o comportamento que a fatia NÃO pode ter matado.
DO $controle$
DECLARE
  v_entry uuid;
  v_antes int;
  v_depois int;
BEGIN
  SELECT pe.id INTO v_entry
    FROM public.pipeline_entries pe
   WHERE pe.lead_id IS NOT NULL
     AND NOT (pe.metadata ? 'agenda_espelho')
     AND NULLIF(pe.metadata->>'meeting_date','') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.meeting_events me
                  WHERE me.lead_id = pe.lead_id AND me.organization_id = pe.organization_id
                    AND me.event_type = 'meeting_booked'
                    AND NOT EXISTS (SELECT 1 FROM public.meeting_events h
                                     WHERE h.event_type = 'meeting_held' AND h.booked_event_id = me.id))
   LIMIT 1;

  IF v_entry IS NULL THEN
    INSERT INTO _r VALUES (30, 'PORTÃO — controle positivo', 'FALHOU: sem entrada-fixture, o portão 10 seria verde por ausência');
    RETURN;
  END IF;

  SELECT count(*) INTO v_antes FROM public.meeting_events;

  UPDATE public.pipeline_entries
     SET metadata = metadata || jsonb_build_object('meeting_date',
                      ((metadata->>'meeting_date')::timestamptz + interval '400 days'))
   WHERE id = v_entry;

  SELECT count(*) INTO v_depois FROM public.meeting_events;

  INSERT INTO _r VALUES (30, 'PORTÃO — controle positivo: edição humana AINDA mexe em meeting_events',
    CASE WHEN v_depois > v_antes OR EXISTS (
           SELECT 1 FROM _me_antes a JOIN public.meeting_events me ON me.id = a.id
            WHERE me.meeting_date IS DISTINCT FROM a.meeting_date)
         THEN 'OK' ELSE 'FALHOU: o guarda calou escrita humana' END);
END
$controle$;

SELECT ordem, medida, valor FROM _r ORDER BY ordem, medida;

ROLLBACK;
