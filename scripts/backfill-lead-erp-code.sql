-- backfill-lead-erp-code.sql
--
-- Preenche `leads.erp_code` a partir de `upsell_clients.external_id` para os
-- leads que já existiam quando a coluna nasceu (migration 20270921000010).
--
-- Passo SEPARADO da migration de propósito: migration é só schema (guarda F4 do
-- CLAUDE.md), para que um apply com URL errada vire erro de schema recuperável e
-- não escrita em dado de cliente.
--
-- Idempotente: rodar de novo não escreve nada (o WHERE exige que o valor seja
-- diferente do que já está lá). Escopo: um ERP por lead — `upsell_clients` é
-- UNIQUE em (organization_id, lead_id), então não há ambiguidade de qual código
-- adotar.
--
-- Medido em 2026-09-03: 12.664 clientes com `external_id`, todos da Café Jurerê
-- (`4922638c-4909-494e-ba10-12282ec0b161`), source `toth`.
--
-- Conferência ANTES (deve casar com o total afetado):
--   SELECT count(*) FROM upsell_clients c JOIN leads l ON l.id = c.lead_id
--   WHERE c.external_id IS NOT NULL AND l.erp_code IS DISTINCT FROM c.external_id;

UPDATE public.leads AS l
SET    erp_code = c.external_id
FROM   public.upsell_clients AS c
WHERE  c.lead_id = l.id
  AND  c.organization_id = l.organization_id
  AND  c.external_id IS NOT NULL
  AND  l.erp_code IS DISTINCT FROM c.external_id;

-- Conferência DEPOIS — tem que devolver 0:
--   SELECT count(*) FROM upsell_clients c JOIN leads l ON l.id = c.lead_id
--   WHERE c.external_id IS NOT NULL AND l.erp_code IS DISTINCT FROM c.external_id;
