-- supabase/tests/avisos_preferencias_test.sql
--
-- pgTAP: cada pessoa manda no próprio barulho (issue #1890, ADR-0035).
--
-- A regra que atravessa tudo: preferência corta ENTREGA, nunca REGISTRO. O
-- Aviso é sempre gravado; o que muda é se ele toca, aparece ou viaja para o
-- celular. Histórico com buraco torna "não recebi" indebugável.
--
-- Preferência é por usuário E organização: a mesma pessoa é administradora numa
-- e vendedora na outra, e não quer o mesmo alarme nas duas.
--
-- As asserções de isolamento rodam como `authenticated`, não como superusuário —
-- postgres bypassa RLS e devolveria verde para uma política inexistente.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(3);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE _pref_fix (org_a uuid, org_b uuid, ana uuid, bruno uuid) ON COMMIT DROP;
-- A asserção de isolamento roda como `authenticated`; sem este grant, o teste
-- falharia por não enxergar a própria fixture e não pela política sob teste.
GRANT SELECT ON _pref_fix TO authenticated;

INSERT INTO _pref_fix (org_a, org_b, ana, bruno)
VALUES ('d1111111-1111-1111-1111-111111111111'::uuid,
        'd2222222-2222-2222-2222-222222222222'::uuid,
        'd3333333-3333-3333-3333-333333333333'::uuid,
        'd4444444-4444-4444-4444-444444444444'::uuid);

INSERT INTO auth.users (id, email)
SELECT ana, 'ana@example.test' FROM _pref_fix
UNION ALL
SELECT bruno, 'bruno@example.test' FROM _pref_fix;

INSERT INTO public.organizations (id, name, slug)
SELECT org_a, 'Org A', 'org-a-pref' FROM _pref_fix
UNION ALL
SELECT org_b, 'Org B', 'org-b-pref' FROM _pref_fix;

INSERT INTO public.team_members (organization_id, user_id, name, role, is_active)
SELECT org_a, ana,   'Ana',   'admin'::app_role,  true FROM _pref_fix
UNION ALL
SELECT org_b, ana,   'Ana',   'member'::app_role, true FROM _pref_fix
UNION ALL
SELECT org_a, bruno, 'Bruno', 'member'::app_role, true FROM _pref_fix;

INSERT INTO public.notification_preferences (organization_id, user_id, sound_enabled, volume)
SELECT org_a, ana,   true,  80 FROM _pref_fix
UNION ALL
SELECT org_b, ana,   false, 20 FROM _pref_fix
UNION ALL
SELECT org_a, bruno, true,  55 FROM _pref_fix;

SET LOCAL session_replication_role = DEFAULT;

-- ---------------------------------------------------------------------------
-- A mesma pessoa configura diferente em cada organização.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT ARRAY[
     (SELECT volume::int FROM public.notification_preferences p, _pref_fix f
       WHERE p.user_id = f.ana AND p.organization_id = f.org_a),
     (SELECT volume::int FROM public.notification_preferences p, _pref_fix f
       WHERE p.user_id = f.ana AND p.organization_id = f.org_b)
   ]),
  ARRAY[80, 20],
  'a preferência é por usuário E organização, não uma só para as duas'
);

-- ---------------------------------------------------------------------------
-- Isolamento como `authenticated`: Ana não enxerga a preferência do Bruno,
-- mesmo estando na mesma organização.
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', ana::text, 'role', 'authenticated')::text,
                  true)
FROM _pref_fix;

SELECT is(
  (SELECT ARRAY[
     count(*)::int,
     count(*) FILTER (WHERE p.user_id = (SELECT ana FROM _pref_fix))::int
   ]
     FROM public.notification_preferences p),
  ARRAY[2, 2],
  'como authenticated, cada pessoa só enxerga as próprias preferências'
);

SET LOCAL role postgres;
SELECT set_config('request.jwt.claims', NULL, true);

-- ---------------------------------------------------------------------------
-- Quem nunca configurou nada recebe os padrões, sem linha no banco. É o que o
-- envio de push lê do servidor, onde não existe localStorage nem contexto de
-- navegador.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT ARRAY[
     (public.fn_preferencias_de_aviso(bruno, org_b) ->> 'sound_enabled'),
     (public.fn_preferencias_de_aviso(bruno, org_b) ->> 'volume'),
     (public.fn_preferencias_de_aviso(ana, org_b) ->> 'volume')
   ] FROM _pref_fix),
  ARRAY['true', '55', '20'],
  'sem linha, valem os padrões; com linha, vale o que a pessoa escolheu'
);

SELECT * FROM finish();

ROLLBACK;
