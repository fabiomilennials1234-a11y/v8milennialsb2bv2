-- ROLLBACK de 20270914000000_agenda_de_todos_por_permissao.sql
--
-- Desfaz a fronteira nova. NÃO devolve a Agenda ao recorte antigo: aquele
-- recorte vivia no front (`seesEveryone = isAdmin`), e reverter o banco sem
-- reverter o front deixa a tela org-wide para todo mundo — que é o padrão
-- pedido. Reverter de verdade é reverter os dois lados.

DROP FUNCTION IF EXISTS public.get_agenda_events_scoped(uuid, timestamptz, timestamptz);

-- A chave sai do catálogo. `organization_feature_defaults.feature_key` tem
-- ON DELETE CASCADE, mas `member_feature_permissions.feature_key` NÃO tem
-- (conferido no baseline, linha 35099) — apagar o catálogo primeiro estouraria
-- a FK. Por isso o override do membro sai antes, à mão.
DELETE FROM public.member_feature_permissions WHERE feature_key = 'agenda.view_all';
DELETE FROM public.organization_feature_defaults WHERE feature_key = 'agenda.view_all';
DELETE FROM public.feature_permissions WHERE key = 'agenda.view_all';
