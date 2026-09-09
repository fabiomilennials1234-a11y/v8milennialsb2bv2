-- supabase/tests/avisos_automacao_test.sql
--
-- pgTAP: automação parada avisa quem pode consertar (issue #1886, ADR-0035).
--
-- O alerta de hoje exige três falhas na mesma hora, suprime por organização
-- inteira — dois workflows quebrados na mesma hora e o segundo nunca notifica —
-- e escolhe os dez primeiros membros ativos, sem olhar papel: o vendedor recebe
-- alerta de infraestrutura que ele não pode resolver.
--
-- Aqui o Aviso nasce na primeira falha, agrupado por workflow, e vai para os
-- administradores. O contador faz o trabalho que o limiar fazia.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(2);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE _a_fix (org uuid, admin_ativo uuid, admin_sem_conta uuid, vendedor uuid, wf uuid)
  ON COMMIT DROP;

INSERT INTO _a_fix (org, admin_ativo, admin_sem_conta, vendedor, wf)
VALUES ('b1111111-1111-1111-1111-111111111111'::uuid,
        'b2222222-2222-2222-2222-222222222222'::uuid,
        'b3333333-3333-3333-3333-333333333333'::uuid,
        'b4444444-4444-4444-4444-444444444444'::uuid,
        'b5555555-5555-5555-5555-555555555555'::uuid);

INSERT INTO auth.users (id, email)
SELECT admin_ativo, 'admin-ativo@example.test' FROM _a_fix
UNION ALL
SELECT vendedor, 'vendedor@example.test' FROM _a_fix;

INSERT INTO public.organizations (id, name, slug)
SELECT org, 'Automação Fixture', 'automacao-fixture' FROM _a_fix;

INSERT INTO public.team_members (organization_id, user_id, name, role, is_active)
SELECT org, admin_ativo,     'Admin Ativo',   'admin'::app_role,  true  FROM _a_fix
UNION ALL
SELECT org, NULL,            'Admin sem conta','admin'::app_role,  true  FROM _a_fix
UNION ALL
SELECT org, vendedor,        'Vendedor',      'member'::app_role, true  FROM _a_fix;

SET LOCAL session_replication_role = DEFAULT;

-- ---------------------------------------------------------------------------
-- Quem recebe: administrador com conta ativa. Vendedor não. Admin sem conta
-- de usuário não tem para onde receber.
-- ---------------------------------------------------------------------------
SELECT public.fn_emit_aviso_admins(
         p_organization_id => org,
         p_type            => 'workflow_alert',
         p_group_key       => 'wf:' || wf::text,
         p_title           => 'Automação parou: Nutrição D+3',
         p_description     => '1 falha · instância desconectada',
         p_link            => '/automacoes'
       )
FROM _a_fix;

SELECT is(
  (SELECT ARRAY[count(*)::int, count(*) FILTER (WHERE n.user_id = f.admin_ativo)::int]
     FROM public.notifications n, _a_fix f
    WHERE n.group_key = 'wf:' || f.wf::text),
  ARRAY[1, 1],
  'automação parada avisa só o administrador com conta ativa'
);

-- ---------------------------------------------------------------------------
-- A segunda falha do mesmo workflow engorda o Aviso; um workflow diferente na
-- mesma hora produz Aviso próprio — hoje ele seria silenciado.
-- ---------------------------------------------------------------------------
SELECT public.fn_emit_aviso_admins(
         p_organization_id => org,
         p_type            => 'workflow_alert',
         p_group_key       => 'wf:' || wf::text,
         p_title           => 'Automação parou: Nutrição D+3',
         p_description     => '2 falhas · instância desconectada',
         p_link            => '/automacoes'
       )
FROM _a_fix;

SELECT public.fn_emit_aviso_admins(
         p_organization_id => org,
         p_type            => 'workflow_alert',
         p_group_key       => 'wf:b6666666-6666-6666-6666-666666666666',
         p_title           => 'Automação parou: Reengajamento 30d',
         p_description     => '1 falha',
         p_link            => '/automacoes'
       )
FROM _a_fix;

SELECT is(
  (SELECT ARRAY[
     (SELECT max(n.event_count) FROM public.notifications n, _a_fix f
       WHERE n.group_key = 'wf:' || f.wf::text),
     (SELECT count(*)::int FROM public.notifications
       WHERE group_key = 'wf:b6666666-6666-6666-6666-666666666666')
   ]),
  ARRAY[2, 1],
  'falha repetida engorda o mesmo Aviso e outro workflow na mesma hora não é silenciado'
);

SELECT * FROM finish();

ROLLBACK;
