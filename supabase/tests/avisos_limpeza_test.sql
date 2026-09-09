-- supabase/tests/avisos_limpeza_test.sql
--
-- pgTAP: a tabela para de crescer para sempre, e o ruído vira número
-- (issue #1894, ADR-0035).
--
-- Aviso é efêmero por natureza: quem não leu em seis meses não vai ler. O
-- histórico que importa já vive em lead_history e meeting_events.
--
-- A limpeza roda em LOTES por um motivo mecânico: `notifications` está na
-- publicação de realtime, e um DELETE de milhares de linhas viraria uma
-- enxurrada de eventos para todos os navegadores conectados.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(4);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE _lim_fix (org uuid, dono uuid) ON COMMIT DROP;

INSERT INTO _lim_fix (org, dono)
VALUES ('a9111111-1111-1111-1111-111111111111'::uuid,
        'a9222222-2222-2222-2222-222222222222'::uuid);

INSERT INTO auth.users (id, email) SELECT dono, 'limpeza@example.test' FROM _lim_fix;
INSERT INTO public.organizations (id, name, slug)
SELECT org, 'Limpeza Fixture', 'limpeza-fixture' FROM _lim_fix;

-- Quatro Avisos que cobrem as quatro decisões da regra.
INSERT INTO public.notifications
  (organization_id, user_id, type, title, group_key, created_at, last_event_at, read_at)
SELECT org, dono, 'lead_message', 'Lido e velho',        'g:lido-velho',
       now() - interval '120 days', now() - interval '120 days', now() - interval '119 days' FROM _lim_fix
UNION ALL
SELECT org, dono, 'lead_message', 'Lido e recente',      'g:lido-recente',
       now() - interval '10 days',  now() - interval '10 days',  now() - interval '9 days'   FROM _lim_fix
UNION ALL
SELECT org, dono, 'lead_message', 'Não lido, 100 dias',  'g:nao-lido-100',
       now() - interval '100 days', now() - interval '100 days', NULL                        FROM _lim_fix
UNION ALL
SELECT org, dono, 'lead_message', 'Não lido, 200 dias',  'g:nao-lido-200',
       now() - interval '200 days', now() - interval '200 days', NULL                        FROM _lim_fix;

SET LOCAL session_replication_role = DEFAULT;

-- ---------------------------------------------------------------------------
-- A regra: lido acima de 90 dias sai; não lido só acima de 180. O não lido de
-- 100 dias FICA — quem ainda não viu não perde o registro por prazo de leitura.
-- ---------------------------------------------------------------------------
SELECT is(
  public.fn_limpar_avisos(),
  2,
  'a limpeza remove o lido de 120 dias e o não lido de 200, e mais nada'
);

SELECT is(
  (SELECT array_agg(group_key ORDER BY group_key)
     FROM public.notifications n, _lim_fix f
    WHERE n.user_id = f.dono),
  ARRAY['g:lido-recente', 'g:nao-lido-100'],
  'sobrou exatamente o que a regra manda guardar'
);

-- ---------------------------------------------------------------------------
-- Interrompível: com teto de um lote de uma linha, apaga uma e para. A próxima
-- passada continua de onde parou — é o que torna seguro rodar isto num banco
-- publicado em realtime.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.notifications
  (organization_id, user_id, type, title, group_key, created_at, last_event_at, read_at)
SELECT org, dono, 'lead_message', 'Velho ' || i, 'g:velho-' || i,
       now() - interval '200 days', now() - interval '200 days', now() - interval '199 days'
FROM _lim_fix, generate_series(1, 5) AS i;
SET LOCAL session_replication_role = DEFAULT;

SELECT is(
  public.fn_limpar_avisos(p_lote => 1, p_max_lotes => 1),
  1,
  'com teto de um lote, apaga um e para — a próxima passada continua'
);

-- ---------------------------------------------------------------------------
-- A medição que diz se o recorte de ruído está certo.
-- ---------------------------------------------------------------------------
-- Dois Avisos de hoje, um deles tendo absorvido cinco eventos. A distinção
-- importa: um Aviso com contador 5 custou muito mais atenção do que um com 1, e
-- uma medição que só conta linhas não enxerga isso.
SET LOCAL session_replication_role = replica;
INSERT INTO public.notifications
  (organization_id, user_id, type, title, group_key, event_count, created_at, last_event_at)
SELECT org, dono, 'lead_message', 'De hoje, uma vez',   'g:hoje-1', 1, now(), now() FROM _lim_fix
UNION ALL
SELECT org, dono, 'lead_message', 'De hoje, em rajada', 'g:hoje-2', 5, now(), now() FROM _lim_fix;
SET LOCAL session_replication_role = DEFAULT;

SELECT is(
  (SELECT ARRAY[sum(m.avisos)::int, sum(m.eventos)::int]
     FROM public.fn_medicao_de_ruido(p_dias => 7) m, _lim_fix f
    WHERE m.user_id = f.dono),
  ARRAY[2, 6],
  'a medição conta Avisos e os eventos que cada um absorveu, não só linhas'
);

SELECT * FROM finish();

ROLLBACK;
