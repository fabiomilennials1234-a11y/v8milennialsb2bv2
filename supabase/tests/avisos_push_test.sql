-- supabase/tests/avisos_push_test.sql
--
-- pgTAP: o Aviso alcança quem está longe do CRM (issue #1893, ADR-0035).
--
-- Push é o canal mais intrusivo do produto: chega no bolso, fora do horário,
-- sem contexto. Por isso ele não repete o que a pessoa já está vendo — quem
-- tem aba viva NÃO recebe — e não vai atrás de tudo: só os três tipos quentes.
--
-- A fila vive no banco e não na edge function porque quem decide quem recebe é
-- a mesma regra que decide o que nasce, e ela já mora aqui.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE _push_fix (org uuid, longe uuid, presente uuid, sem_push uuid) ON COMMIT DROP;

INSERT INTO _push_fix (org, longe, presente, sem_push)
VALUES ('f1111111-1111-1111-1111-111111111111'::uuid,
        'f2222222-2222-2222-2222-222222222222'::uuid,
        'f3333333-3333-3333-3333-333333333333'::uuid,
        'f4444444-4444-4444-4444-444444444444'::uuid);

INSERT INTO auth.users (id, email)
SELECT longe, 'longe@example.test' FROM _push_fix
UNION ALL SELECT presente, 'presente@example.test' FROM _push_fix
UNION ALL SELECT sem_push, 'sem-push@example.test' FROM _push_fix;

INSERT INTO public.organizations (id, name, slug)
SELECT org, 'Push Fixture', 'push-fixture' FROM _push_fix;

INSERT INTO public.team_members (organization_id, user_id, name, role, is_active)
SELECT org, longe,    'Longe',    'member'::app_role, true FROM _push_fix
UNION ALL SELECT org, presente, 'Presente', 'member'::app_role, true FROM _push_fix
UNION ALL SELECT org, sem_push, 'Sem push', 'member'::app_role, true FROM _push_fix;

-- Os três querem push; um deles vai desligar.
INSERT INTO public.notification_preferences (organization_id, user_id, push_enabled)
SELECT org, longe,    true  FROM _push_fix
UNION ALL SELECT org, presente, true  FROM _push_fix
UNION ALL SELECT org, sem_push, false FROM _push_fix;

-- Os três têm aparelho registrado: assim, quem for excluído da fila é excluído
-- pela regra sob teste, e não por não ter para onde receber.
INSERT INTO public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth)
SELECT org, longe,    'https://push.example.test/longe',    'p256dh-longe',    'auth-longe'    FROM _push_fix
UNION ALL
SELECT org, presente, 'https://push.example.test/presente', 'p256dh-presente', 'auth-presente' FROM _push_fix
UNION ALL
SELECT org, sem_push, 'https://push.example.test/sem-push',  'p256dh-sem-push', 'auth-sem-push' FROM _push_fix;

-- Quem está com o CRM aberto carimba presença; quem está longe, não.
INSERT INTO public.user_presence (user_id, organization_id, last_seen_at)
SELECT presente, org, now() - interval '20 seconds' FROM _push_fix;

SET LOCAL session_replication_role = DEFAULT;

-- Um Aviso quente para cada um dos três.
SELECT public.fn_emit_aviso(
         p_organization_id => org, p_user_id => longe,
         p_type => 'lead_message', p_group_key => 'msg:longe',
         p_title => 'Marcos Andrade', p_description => 'Consigo fechar hoje')
FROM _push_fix;

SELECT public.fn_emit_aviso(
         p_organization_id => org, p_user_id => presente,
         p_type => 'lead_message', p_group_key => 'msg:presente',
         p_title => 'Renata Bittencourt')
FROM _push_fix;

SELECT public.fn_emit_aviso(
         p_organization_id => org, p_user_id => sem_push,
         p_type => 'lead_message', p_group_key => 'msg:sem-push',
         p_title => 'Carlos Dias')
FROM _push_fix;

-- E um Aviso frio para quem está longe: agenda não persegue ninguém no bolso.
SELECT public.fn_emit_aviso(
         p_organization_id => org, p_user_id => longe,
         p_type => 'meeting_booked', p_group_key => 'meet:longe',
         p_title => 'Reunião marcada')
FROM _push_fix;

-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.fn_avisos_pendentes_de_push() f, _push_fix x
    WHERE f.user_id = x.longe AND f.group_key = 'msg:longe'),
  1,
  'quem está longe do CRM e quer push entra na fila'
);

SELECT is(
  (SELECT count(*)::int FROM public.fn_avisos_pendentes_de_push() f, _push_fix x
    WHERE f.user_id = x.presente),
  0,
  'quem tem aba viva não recebe no bolso o que já está na tela'
);

SELECT is(
  (SELECT count(*)::int FROM public.fn_avisos_pendentes_de_push() f, _push_fix x
    WHERE f.user_id = x.sem_push),
  0,
  'quem desligou push nas preferências não entra na fila'
);

SELECT is(
  (SELECT count(*)::int FROM public.fn_avisos_pendentes_de_push()
    WHERE group_key = 'meet:longe'),
  0,
  'tipo frio não persegue ninguém no bolso — reunião fica no sino'
);

-- ---------------------------------------------------------------------------
-- Marcado como enviado, não volta. Um push repetido é pior que nenhum.
-- ---------------------------------------------------------------------------
SELECT public.fn_marcar_push_enviado(
  ARRAY(SELECT aviso_id FROM public.fn_avisos_pendentes_de_push())
);

SELECT is(
  (SELECT count(*)::int FROM public.fn_avisos_pendentes_de_push()),
  0,
  'Aviso já enviado não volta para a fila'
);

SELECT * FROM finish();

ROLLBACK;
