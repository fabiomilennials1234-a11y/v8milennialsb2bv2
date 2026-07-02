-- apply_22 — DNA de Almas: reconcilia backlog residual (2026-07-02)
-- Org: d67ae17a-815d-476d-b3a9-287c7b267997 (prod jsjsmuncfkbsbzqzqhfq)
--
-- Dois detritos residuais achados no diagnóstico da integração Zuvic:
--   (1) 7 entries presos em whatsapp/`novo` (etapa INATIVA pos 90) = invisíveis no Kanban.
--       Backlog criado na janela ANTES do guard ghost-stage (lead-webhook resolveActiveStageKey)
--       ir a prod (~30/06 12:57). Fix já vivo; estes 7 são resíduo, mesma classe dos 50 de 29/06.
--   (2) 3 entries-lixo no pipe `confirmacao` (funil de reunião ERRADO): ganho×2 + upgrade×1.
--       Pagos que a Zuvic roteou p/ confirmacao/ganho antes do L1b. Todos velhos (27/05..25/06),
--       zero vazamento novo. Cada lead JÁ tem entry no pipe whatsapp (verificado) → só removemos
--       o entry parasita do funil de reunião.
--
-- Idempotente: WHERE pinam org + stage_key atual; re-run = no-op.
-- Seguro: DNA sem dispatch_rules; whatsapp_instances=0; nenhum drip é keyed em novo_lead como
--   to_stage. O move novo→novo_lead dispara stage_changed (no-op de envio). Delete de confirmacao
--   não dispara workflow. Mesma classe de operação já executada em 29/06 sem efeito colateral.

BEGIN;

-- (1) Backfill 7 leads: whatsapp/novo (inativa) → novo_lead (1ª etapa ativa)
UPDATE pipeline_entries pe
SET stage_key = 'novo_lead',
    stage_changed_at = now()
FROM pipelines p
WHERE pe.pipeline_id = p.id
  AND p.organization_id = 'd67ae17a-815d-476d-b3a9-287c7b267997'
  AND p.slug = 'whatsapp'
  AND pe.stage_key = 'novo'
  AND pe.id IN (
    '04629abf-61b9-4eb7-948d-3ae1c4e83fa3', -- Alexsander dos Santos Comin
    '591c8b67-3ed2-47ab-8542-5db902919578', -- Benedita Lourdes dos Santos
    '45e325c5-1ec3-4a75-acf7-115824ac7603', -- Pedro Henrique Carminatti Pei
    'e2f23db4-9aaa-44d9-918e-5cc63f264322', -- Veiveane
    'b092d41b-7e55-4767-94aa-591762792aef', -- Veiveane
    '86e0b18c-dfc9-48cd-a725-492fb8925fe5', -- Deise Caminha
    '718a9b85-0c85-4d53-95aa-359763862320'  -- Lucas da Silva Rodrigues
  );

-- (2) Remove os 3 entries parasitas do pipe confirmacao (leads mantêm o entry whatsapp)
DELETE FROM pipeline_entries pe
USING pipelines p
WHERE pe.pipeline_id = p.id
  AND p.organization_id = 'd67ae17a-815d-476d-b3a9-287c7b267997'
  AND p.slug = 'confirmacao'
  AND pe.id IN (
    '2f91bf16-cb0f-413e-9d19-5bd938a9ccba', -- Clara Ferraz  (confirmacao/ganho)  → whatsapp/pago fica
    '711c724f-fb95-41c4-86cf-7bef6a5d8b2d', -- Fabio         (confirmacao/upgrade)→ whatsapp/novo_lead fica
    '329bbe08-9ef3-42d5-b34f-bbd90f08f36b'  -- Teste Gsilva  (confirmacao/ganho)  → whatsapp/novo_lead fica
  );

COMMIT;

-- Verificação: pós-estado dos dois pipes da DNA
SELECT p.slug, pe.stage_key, COUNT(*) AS leads
FROM pipeline_entries pe
JOIN pipelines p ON p.id = pe.pipeline_id
WHERE p.organization_id = 'd67ae17a-815d-476d-b3a9-287c7b267997'
  AND (
    (p.slug = 'whatsapp' AND pe.stage_key IN ('novo','novo_lead'))
    OR p.slug = 'confirmacao'
  )
GROUP BY p.slug, pe.stage_key
ORDER BY p.slug, pe.stage_key;
