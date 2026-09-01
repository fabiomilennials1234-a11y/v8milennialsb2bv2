-- Ensaio TRANSACIONAL do S4 (20270907000020) contra PROD. Termina em ROLLBACK.
BEGIN;

CREATE TEMP TABLE _r(ordem int, medida text, valor text) ON COMMIT DROP;

INSERT INTO _r SELECT 1, 'antes — linhas em meetings', count(*)::text FROM public.meetings;
INSERT INTO _r SELECT 2, 'antes — agenda Milennials set/2026 por fonte: ' || source, count(*)::text
  FROM public.get_agenda_events('6030520a-2ca7-477d-be89-55758e2cd808','2026-08-30','2026-10-01') GROUP BY source;
INSERT INTO _r SELECT 3, 'antes — agenda Milennials set/2026 TOTAL', count(*)::text
  FROM public.get_agenda_events('6030520a-2ca7-477d-be89-55758e2cd808','2026-08-30','2026-10-01');

\i MIGRATION

INSERT INTO _r SELECT 10, 'depois — linhas em meetings', count(*)::text FROM public.meetings;
INSERT INTO _r SELECT 11, 'depois — linhas criadas pelo backfill', count(*)::text
  FROM public.meetings WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%';
INSERT INTO _r SELECT 12, 'depois — por status: ' || status, count(*)::text
  FROM public.meetings WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%' GROUP BY status;
INSERT INTO _r SELECT 13, 'depois — agenda Milennials set/2026 por fonte: ' || source, count(*)::text
  FROM public.get_agenda_events('6030520a-2ca7-477d-be89-55758e2cd808','2026-08-30','2026-10-01') GROUP BY source;
INSERT INTO _r SELECT 14, 'depois — agenda Milennials set/2026 TOTAL (tem de ser igual ao 3)', count(*)::text
  FROM public.get_agenda_events('6030520a-2ca7-477d-be89-55758e2cd808','2026-08-30','2026-10-01');

-- Enriquecimento
INSERT INTO _r SELECT 20, 'enriq — com deal_id', count(*) FILTER (WHERE deal_id IS NOT NULL)::text || ' de ' || count(*)::text
  FROM public.meetings WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%';
INSERT INTO _r SELECT 21, 'enriq — com created_by', count(*) FILTER (WHERE created_by IS NOT NULL)::text || ' de ' || count(*)::text
  FROM public.meetings WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%';
INSERT INTO _r SELECT 22, 'enriq — com pipeline_id', count(*) FILTER (WHERE pipeline_id IS NOT NULL)::text || ' de ' || count(*)::text
  FROM public.meetings WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%';

-- Guardas
INSERT INTO _r SELECT 30, 'guarda — pares (lead,data) duplicados em meetings', count(*)::text FROM (
  SELECT lead_id, start_at FROM public.meetings WHERE lead_id IS NOT NULL GROUP BY 1,2 HAVING count(*)>1) x;
INSERT INTO _r SELECT 31, 'guarda — linhas pre-existentes tocadas (tem de ser 0)', count(*)::text
  FROM public.meetings WHERE external_ref IS NULL AND updated_at > now() - interval '1 minute';
INSERT INTO _r SELECT 32, 'guarda — meeting_events intacta', count(*)::text FROM public.meeting_events;
INSERT INTO _r SELECT 33, 'guarda — pipe_confirmacao intacta', count(*)::text FROM public.pipe_confirmacao;
INSERT INTO _r SELECT 34, 'guarda — backfill sem lead', count(*)::text
  FROM public.meetings WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%' AND lead_id IS NULL;

-- Rollback é executável? (mede sem executar)
INSERT INTO _r SELECT 40, 'rollback — linhas que o DELETE alcanca', count(*)::text
  FROM public.meetings WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%';

SELECT ordem, medida, valor FROM _r ORDER BY ordem, medida;

ROLLBACK;
