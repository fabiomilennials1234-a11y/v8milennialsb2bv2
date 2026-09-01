-- Ensaio TRANSACIONAL do S3 (20270907000010) contra PROD. Termina em ROLLBACK.
BEGIN;

CREATE TEMP TABLE _r(ordem int, medida text, valor text) ON COMMIT DROP;

INSERT INTO _r SELECT 1, 'antes — linhas em meetings', count(*)::text FROM public.meetings;
INSERT INTO _r SELECT 2, 'antes — linhas em meeting_events', count(*)::text FROM public.meeting_events;
INSERT INTO _r SELECT 3, 'antes — CHECK de event_type', pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conname='meeting_events_event_type_check';

\i MIGRATION

INSERT INTO _r SELECT 10, 'depois — linhas em meetings (tem de ser igual)', count(*)::text FROM public.meetings;
INSERT INTO _r SELECT 11, 'depois — linhas em meeting_events (tem de ser igual)', count(*)::text FROM public.meeting_events;
INSERT INTO _r SELECT 12, 'depois — CHECK de event_type', pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conname='meeting_events_event_type_check';
INSERT INTO _r SELECT 13, 'depois — FK meetings.deal_id', pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conname='meetings_deal_id_fkey';
INSERT INTO _r SELECT 14, 'depois — indice de desfecho unico', count(*)::text
  FROM pg_indexes WHERE indexname='uniq_meeting_events_desfecho_por_agendamento';

-- O índice único é criado sobre dados REAIS: se prod tivesse dois desfechos
-- para o mesmo agendamento, o CREATE acima já teria estourado. Chegar aqui é
-- a prova de que o invariante vale na base viva.
INSERT INTO _r SELECT 15, 'guarda — agendamentos com mais de um desfecho', count(*)::text
  FROM (SELECT booked_event_id FROM public.meeting_events
        WHERE event_type IN ('meeting_held','meeting_no_show') AND booked_event_id IS NOT NULL
        GROUP BY 1 HAVING count(*) > 1) x;

-- Nenhuma reunião pode ter ganhado negócio: a coluna nasce toda nula.
INSERT INTO _r SELECT 16, 'guarda — meetings com deal_id preenchido (tem de ser 0)', count(*)::text
  FROM public.meetings WHERE deal_id IS NOT NULL;

SELECT ordem, medida, valor FROM _r ORDER BY ordem;

ROLLBACK;
