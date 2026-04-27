-- Remove todos os leads da organização indicada.
-- Os registros nos funis (pipe_whatsapp, pipe_confirmacao, pipe_propostas),
-- lead_tags, lead_history, lead_custom_field_values, conversations, follow_ups, etc.
-- são apagados em cascata (ON DELETE CASCADE).
--
-- Se os cards ainda aparecem após rodar este script:
-- 1. Rode antes: supabase/scripts/list_leads_by_organization.sql
--    para ver qual organização tem quantos leads (ex.: 30).
-- 2. Troque o UUID abaixo pelo organization_id que tem os leads que você quer apagar.
--
-- Como executar: Supabase Dashboard → SQL Editor → colar e executar.

-- ========== ORGANIZAÇÃO ALVO ==========
-- Se os 30 cards são de OUTRA organização, rode antes list_leads_by_organization.sql,
-- identifique o organization_id (e o nome da org) que tem 30 leads e troque o UUID abaixo nos dois lugares.

-- Conferir quantos leads serão apagados (rode primeiro para conferir)
SELECT COUNT(*) AS leads_a_remover
FROM public.leads
WHERE organization_id = '6030520a-2ca7-477d-be89-55758e2cd808';

-- Remover todos os leads da organização (cascata remove funis e dependências)
DELETE FROM public.leads
WHERE organization_id = '6030520a-2ca7-477d-be89-55758e2cd808';

-- ========== OPCIONAL: apagar leads SEM organização (organization_id NULL) ==========
-- Descomente as linhas abaixo se existirem leads antigos sem org e você quiser removê-los.
-- SELECT COUNT(*) FROM public.leads WHERE organization_id IS NULL;
-- DELETE FROM public.leads WHERE organization_id IS NULL;
