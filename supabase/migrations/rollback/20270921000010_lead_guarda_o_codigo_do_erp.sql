-- ROLLBACK de 20270921000010_lead_guarda_o_codigo_do_erp.sql
--
-- Derruba `leads.erp_code`.
--
-- 🔴 DESTRUTIVO E IRREVERSÍVEL SEM RE-BACKFILL. O dado da coluna vem de
-- `upsell_clients.external_id`, que continua lá — então recuperar é rodar
-- `scripts/backfill-lead-erp-code.sql` de novo depois de recriar a coluna.
-- Nenhum dado nasce aqui; a coluna é espelho. Ainda assim, com PITR OFF em prod,
-- DROP COLUMN exige aprovação explícita do CTO.
--
-- ⚠ ORDEM: o frontend tem que sair de prod ANTES. `lead-list-filters.ts` manda
-- `erp_code.ilike.…` no `.or()` do PostgREST, e coluna inexistente devolve 400 —
-- que não degrada, apaga a busca de leads inteira. Derrubar a coluna com o
-- frontend novo no ar quebra a lista para todas as orgs.

ALTER TABLE public.leads
  DROP COLUMN IF EXISTS erp_code;
