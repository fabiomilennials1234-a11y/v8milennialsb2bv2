-- Limpeza pontual — Chique Distribuidora, funil Oportunidades (pipe whatsapp).
--
-- NÃO é migration. Não entra no ledger, não roda em CI, não roda sozinha.
-- Operação de dado, executada pelo humano contra prod, uma vez.
--
-- ─── Contexto ────────────────────────────────────────────────────────────────
-- A importação em funil custom duplicava o lead em Oportunidades: a edge
-- function `import-leads` inseria o lead antes da entry custom, e o trigger
-- `trg_auto_assign_lead_default_pipe` semeava whatsapp/novo no meio do caminho.
-- A causa foi corrigida na migration 20270729000000; este script limpa o
-- passivo que o bug já deixou nesta org.
--
-- ─── Escopo (medido em prod 2026-07-29) ──────────────────────────────────────
--   3.919  entries em Oportunidades hoje (= 100% dos leads ativos da org)
--   3.912  em stage 'novo' cujo lead TAMBÉM está em funil custom  ← alvo
--       3  em stage 'perdido' (têm trabalho humano)               ← preservadas
--       4  leads que só existem em Oportunidades (entrada legítima) ← preservadas
--   3.968  entries nos 5 funis custom                             ← INTOCADAS
--
-- Os funis custom vivem em `custom_pipe_entries`, tabela diferente da que este
-- script apaga. Não há caminho por onde este DELETE os alcance.
--
-- Verificado antes de escrever: nenhuma das 3.912 entries é referenciada por
-- pipe_proposta_items, tinyerp_order_mappings, commissions, upsell_orders ou
-- acoes_do_dia (essas FKs apontam para entries de propostas/confirmação).
--
-- Efeito colateral esperado e desejado: `trg_sync_whatsapp_stage_to_lead` zera
-- `leads.pipe_whatsapp` dos leads afetados — é exatamente o que significa sair
-- do funil de Oportunidades. Nenhum lead é apagado.
--
-- ─── Como rodar ──────────────────────────────────────────────────────────────
--   1. Rodar o bloco de CONFERÊNCIA e comparar com os números acima.
--      Divergiu? PARE — o passivo mudou desde a medição, remeça a análise.
--   2. Rodar o backup. Conferir que a tabela tem 3.912 linhas.
--   3. Só então rodar a transação de DELETE.
--   4. Guardar a tabela de backup por pelo menos 30 dias.

\set org_id '38f3bea4-44c6-4732-bb20-065f547a7ed8'

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 1 — CONFERÊNCIA (somente leitura)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  pe.stage_key,
  count(*) AS total,
  count(*) FILTER (
    WHERE EXISTS (SELECT 1 FROM public.custom_pipe_entries c WHERE c.lead_id = pe.lead_id)
  ) AS tambem_em_custom
FROM public.pipeline_entries pe
JOIN public.pipelines p
  ON p.id = pe.pipeline_id AND p.slug = 'whatsapp' AND p.type = 'system'
WHERE pe.organization_id = :'org_id'
GROUP BY 1
ORDER BY 2 DESC;
-- Esperado: novo=3916 (3912 em custom) | perdido=3 (3 em custom)

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2 — BACKUP (rollback)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backup_chique_oportunidades_20260729 AS
SELECT pe.*
FROM public.pipeline_entries pe
JOIN public.pipelines p
  ON p.id = pe.pipeline_id AND p.slug = 'whatsapp' AND p.type = 'system'
WHERE pe.organization_id = :'org_id'
  AND pe.stage_key = 'novo'
  AND EXISTS (SELECT 1 FROM public.custom_pipe_entries c WHERE c.lead_id = pe.lead_id);

SELECT count(*) AS linhas_no_backup FROM public.backup_chique_oportunidades_20260729;
-- Esperado: 3912. Diferente disso, NÃO siga para o passo 3.

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 3 — DELETE (transacional)
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

DELETE FROM public.pipeline_entries pe
USING public.pipelines p
WHERE p.id = pe.pipeline_id
  AND p.slug = 'whatsapp'
  AND p.type = 'system'
  AND pe.organization_id = :'org_id'
  AND pe.stage_key = 'novo'
  AND EXISTS (SELECT 1 FROM public.custom_pipe_entries c WHERE c.lead_id = pe.lead_id)
  -- Só apaga o que foi para o backup. Se uma entry nova entrou entre o passo 2
  -- e agora, ela fica de fora — sem linha apagada sem cópia guardada.
  AND pe.id IN (SELECT id FROM public.backup_chique_oportunidades_20260729);

-- Confira o "DELETE 3912" antes de confirmar.
-- Saiu diferente? ROLLBACK;
COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 4 — VERIFICAÇÃO PÓS-DELETE
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.pipeline_entries pe
     JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.slug = 'whatsapp' AND p.type = 'system'
   WHERE pe.organization_id = :'org_id')                                    AS oportunidades_restantes,  -- esperado 7
  (SELECT count(*) FROM public.custom_pipe_entries WHERE organization_id = :'org_id') AS funis_custom,     -- esperado 3968, inalterado
  (SELECT count(*) FROM public.leads WHERE organization_id = :'org_id' AND deleted_at IS NULL) AS leads;   -- esperado 3919, inalterado

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK, se preciso
-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT INTO public.pipeline_entries
-- SELECT * FROM public.backup_chique_oportunidades_20260729
-- ON CONFLICT (id) DO NOTHING;
--
-- Restaura as entries. O trigger de sync repõe `leads.pipe_whatsapp='novo'`.
