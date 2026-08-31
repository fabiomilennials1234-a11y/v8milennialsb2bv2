-- supabase/tests/avisos_varreduras_test.sql
--
-- pgTAP: os quatro alertas derivados viram registro (issue #1887, ADR-0035).
--
-- Follow-up atrasado e reunião de hoje não são eventos: são ESTADOS, verdadeiros
-- continuamente. Enquanto o sino os derivava por consulta a cada 60 segundos,
-- não havia como saber o que era novo — e por isso não havia como tocar som.
--
-- Aqui eles passam a nascer como Aviso, por varredura. A chave de agrupamento
-- carrega o dia, então rodar a varredura de novo não duplica nada: é a
-- propriedade que permite chamar o cron sem medo.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(3);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE _v_fix (org uuid, dono uuid, membro uuid, lead uuid) ON COMMIT DROP;

INSERT INTO _v_fix (org, dono, membro, lead)
VALUES ('c1111111-1111-1111-1111-111111111111'::uuid,
        'c2222222-2222-2222-2222-222222222222'::uuid,
        'c3333333-3333-3333-3333-333333333333'::uuid,
        'c4444444-4444-4444-4444-444444444444'::uuid);

INSERT INTO auth.users (id, email)
SELECT dono, 'varredura-dono@example.test' FROM _v_fix;

INSERT INTO public.organizations (id, name, slug)
SELECT org, 'Varredura Fixture', 'varredura-fixture' FROM _v_fix;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
SELECT membro, org, dono, 'Vendedor', 'member'::app_role, true FROM _v_fix;

INSERT INTO public.leads (id, organization_id, name, sale_responsible_id)
SELECT lead, org, 'Polimex Indústria', membro FROM _v_fix;

INSERT INTO public.pipelines (id, organization_id, name, slug)
SELECT 'ca000000-0000-0000-0000-000000000001'::uuid, org, 'Confirmação', 'confirmacao' FROM _v_fix;

-- Três follow-ups: um atrasado, um para hoje, um já concluído.
INSERT INTO public.follow_ups (id, organization_id, lead_id, assigned_to, title, due_date, completed_at)
SELECT 'c5555555-5555-5555-5555-555555555555'::uuid, org, lead, membro,
       'Mandar proposta revisada', now() - interval '2 days', NULL::timestamptz FROM _v_fix
UNION ALL
SELECT 'c6666666-6666-6666-6666-666666666666'::uuid, org, lead, membro,
       'Confirmar recebimento', date_trunc('day', timezone('America/Sao_Paulo', now())) + interval '23 hours 59 minutes', NULL::timestamptz FROM _v_fix
UNION ALL
SELECT 'c7777777-7777-7777-7777-777777777777'::uuid, org, lead, membro,
       'Ligar para o comprador', now() - interval '1 day', now() FROM _v_fix;

SET LOCAL session_replication_role = DEFAULT;

-- ---------------------------------------------------------------------------
-- A varredura da manhã materializa o dia: atrasado e para-hoje viram Aviso.
-- Concluído não vira nada.
-- ---------------------------------------------------------------------------
SELECT public.fn_varredura_avisos_followups();

SELECT is(
  (SELECT ARRAY[
     (SELECT count(*)::int FROM public.notifications
       WHERE group_key LIKE 'fup:c5555555%' AND type = 'follow_up_overdue'),
     (SELECT count(*)::int FROM public.notifications
       WHERE group_key LIKE 'fup:c6666666%' AND type = 'follow_up_due'),
     (SELECT count(*)::int FROM public.notifications
       WHERE group_key LIKE 'fup:c7777777%')
   ]),
  ARRAY[1, 1, 0],
  'a varredura avisa follow-up atrasado e follow-up de hoje, e ignora o concluído'
);

-- ---------------------------------------------------------------------------
-- Rodar de novo no mesmo dia não duplica — a chave carrega a data.
-- ---------------------------------------------------------------------------
SELECT public.fn_varredura_avisos_followups();

SELECT is(
  (SELECT ARRAY[count(*)::int, max(event_count)]
     FROM public.notifications
    WHERE group_key LIKE 'fup:c5555555%'),
  ARRAY[1, 1],
  'segunda passada da varredura no mesmo dia não duplica nem infla o contador'
);

-- ---------------------------------------------------------------------------
-- A janela curta: só a reunião que começa dentro de uma hora. A de amanhã
-- espera — é o único aviso que perde todo o valor se atrasar.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, metadata)
SELECT 'c8888888-8888-8888-8888-888888888888'::uuid, org,
       'ca000000-0000-0000-0000-000000000001'::uuid,
       lead, 'agendado',
       jsonb_build_object('meeting_date', to_char(now() + interval '30 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'))
FROM _v_fix f
UNION ALL
SELECT 'c9999999-9999-9999-9999-999999999999'::uuid, org,
       'ca000000-0000-0000-0000-000000000001'::uuid,
       lead, 'agendado',
       jsonb_build_object('meeting_date', to_char(now() + interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SSOF'))
FROM _v_fix f;

SET LOCAL session_replication_role = DEFAULT;

SELECT public.fn_varredura_avisos_reuniao_proxima();

SELECT is(
  (SELECT ARRAY[
     (SELECT count(*)::int FROM public.notifications
       WHERE group_key LIKE 'meet_soon:c8888888%'),
     (SELECT count(*)::int FROM public.notifications
       WHERE group_key LIKE 'meet_soon:c9999999%')
   ]),
  ARRAY[1, 0],
  'a janela curta avisa a reunião de daqui a 30 minutos e não a de depois de amanhã'
);

SELECT * FROM finish();

ROLLBACK;
