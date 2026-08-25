-- Passo 3 de 3 do apply da Source 5 da Agenda.
--
-- Rodar DEPOIS de:
--   node scripts/prod-sql-win.mjs --file supabase/migrations/20270829000000_agenda_meeting_events_source.sql
--   node scripts/prod-sql-win.mjs --file supabase/migrations/20270829000010_comando_revoga_anon.sql
--
-- Este arquivo faz duas coisas:
--   1. carimba as duas versões no ledger — foi exatamente a FALTA disso em
--      30/07 que produziu o drift que este trabalho veio consertar;
--   2. devolve o gabarito, que é o último statement (a Management API só
--      devolve o resultado do último).
--
-- Reaplicar é no-op: o INSERT é guardado por NOT EXISTS.

BEGIN;

INSERT INTO supabase_migrations.schema_migrations (version, name)
SELECT '20270829000000', 'agenda_meeting_events_source'
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270829000000'
);

INSERT INTO supabase_migrations.schema_migrations (version, name)
SELECT '20270829000010', 'comando_revoga_anon'
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270829000010'
);

COMMIT;

-- ── GABARITO ──────────────────────────────────────────────────────────────
-- Esperado, linha a linha:
--   fantasmas_jun_milennials .. 0   (era 30)
--   fantasmas_jun_london ..... 0    (era 15)
--   fontes ................... 5
--   anon_agenda .............. false
--   anon_comando ............. false
--   anon_is_org_admin ........ false
--   ledger_829000 ............ 1
--   ledger_829010 ............ 1
SELECT
  (SELECT count(*) - count(DISTINCT e.id)
     FROM public.organizations o
     CROSS JOIN LATERAL public.get_agenda_events(o.id, '2026-06-01', '2026-07-01') e
    WHERE o.name = 'Milennials' AND e.source = 'meeting')                       AS fantasmas_jun_milennials,
  (SELECT count(*) - count(DISTINCT e.id)
     FROM public.organizations o
     CROSS JOIN LATERAL public.get_agenda_events(o.id, '2026-06-01', '2026-07-01') e
    WHERE o.name = 'London Cosmeticos' AND e.source = 'meeting')                AS fantasmas_jun_london,
  (SELECT count(DISTINCT e.source)
     FROM public.organizations o
     CROSS JOIN LATERAL public.get_agenda_events(o.id, '2020-01-01', '2030-01-01') e) AS fontes_distintas_vistas,
  has_function_privilege('anon', 'public.get_agenda_events(uuid,timestamptz,timestamptz)',        'EXECUTE') AS anon_agenda,
  has_function_privilege('anon', 'public.get_comando_agenda_events(uuid,timestamptz,timestamptz)','EXECUTE') AS anon_comando,
  has_function_privilege('anon', 'public.is_org_admin(uuid)',                                     'EXECUTE') AS anon_is_org_admin,
  has_function_privilege('anon', 'public.my_team_member_id(uuid)',                                'EXECUTE') AS anon_my_tm,
  has_function_privilege('anon', 'public.get_conversations_awaiting_human_reply(uuid,uuid,integer,integer)', 'EXECUTE') AS anon_conversas,
  (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20270829000000') AS ledger_829000,
  (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20270829000010') AS ledger_829010;
