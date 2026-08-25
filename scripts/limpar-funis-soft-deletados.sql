-- limpar-funis-soft-deletados.sql
--
-- ✅ EXECUTADO EM PROD EM 25/08/2026. Os 21 funis que sobraram do soft delete
--    foram apagados: Milennials (17), JC Atacado (2), REALSC (1), The Good
--    Balloon (1). Gabarito final: 0 funis mortos, 0 espelhos mortos, 0 órfãos
--    em `custom_pipeline_stages` / `custom_pipe_entries` / `pipeline_entries` /
--    `pipeline_stage_events`; 73 funis ativos e 73 espelhos (batendo), 16.260
--    cards e 55.754 leads intactos, 131 automações ativas (nenhuma desligada).
--
--    Este arquivo fica como RUNBOOK para a próxima vez que sobrar funil morto.
--
-- CONTEXTO: até 25/08/2026 excluir funil era soft delete (`is_active = false`).
-- A linha ficava no banco e as `custom_pipe_entries` continuavam vivas — e o
-- público "Todos os funis" do Disparo lê essa tabela DIRETO, então um lead que
-- só existia num funil "excluído" ainda podia receber mensagem.
--
-- ── COMO RODAR ──────────────────────────────────────────────────────────────
--
-- `SET LOCAL ROLE service_role` é o pulo do gato: a autorização da RPC sai do
-- JWT, e numa conexão direta pela Management API `auth.uid()` é NULL. Sem o
-- SET LOCAL a RPC recusa com 42501. Com ele, `current_setting('role')` casa
-- com a cláusula de escape e a chamada passa — usando o MESMO código que o
-- botão da tela usa, guardas incluídas.
--
-- `SET LOCAL` vale porque a Management API já roda o corpo dentro de uma
-- transação (provado: um ROLLBACK aqui desfaz até `CREATE TEMP TABLE`).
--
--   1. ENSAIE primeiro. Com o ROLLBACK no fim, a RPC roda de verdade em todos
--      os alvos e desfaz — é assim que se descobre se algum funil vai recusar,
--      sem gravar nada:
--
--        BEGIN;
--        SET LOCAL ROLE service_role;
--        SELECT public.delete_custom_pipeline(cp.id)
--          FROM public.custom_pipelines cp
--         WHERE cp.organization_id = '<ORG_ID>'::uuid AND cp.is_active = false;
--        ROLLBACK;
--        SELECT count(*) AS deve_continuar_igual FROM public.custom_pipelines
--         WHERE organization_id = '<ORG_ID>'::uuid AND is_active = false;
--
--   2. Depois rode PRA VALER: o bloco abaixo, sem BEGIN/ROLLBACK. A API
--      commita sozinha, e o SELECT (último statement) devolve o impacto de
--      cada funil.
--
-- ⚠️ A ORDEM PODE IMPORTAR. Se um card de um funil-alvo estiver pousado numa
--    etapa de OUTRO funil-alvo, a RPC recusa o segundo enquanto o primeiro
--    existir. Aconteceu em 25/08: "Funil A PADRÃO" tinha um card na etapa de
--    "Funil A | Modelo". Solução: apague primeiro o DONO do card. A mensagem de
--    erro da RPC nomeia funil e lead, então ela mesma diz por onde começar.
--
-- ⚠️ REMEÇA ANTES. Em 25/08 nenhum dos 21 tinha venda (`sale_events`), e é isso
--    que tornou a limpeza barata: nenhuma receita virou "Sem valor" no recorte
--    por funil. Um funil morto mais novo pode ter — confira com o inventário.

SET LOCAL ROLE service_role;

SELECT
  cp.name                              AS funil,
  public.delete_custom_pipeline(cp.id) AS impacto
  FROM public.custom_pipelines cp
 WHERE cp.organization_id = '<ORG_ID>'::uuid
   AND cp.is_active = false
 ORDER BY cp.name;

-- ── INVENTÁRIO (read-only) — rode antes, sozinho ────────────────────────────
-- SELECT o.name AS org, cp.name AS funil, cp.updated_at::date AS excluido_em,
--        (SELECT count(*) FROM custom_pipe_entries e    WHERE e.pipeline_id = cp.id) AS cards,
--        (SELECT count(*) FROM custom_pipeline_stages s WHERE s.pipeline_id = cp.id) AS etapas,
--        (SELECT count(*) FROM pipeline_stage_events s  WHERE s.pipeline_id = cp.id) AS eventos_etapa,
--        (SELECT count(*) FROM sale_events se           WHERE se.pipeline_id = cp.id) AS vendas
--   FROM custom_pipelines cp JOIN organizations o ON o.id = cp.organization_id
--  WHERE cp.is_active = false
--  ORDER BY o.name, eventos_etapa DESC;
--
-- ── CARDS INVASORES (read-only) — quem vai fazer a RPC recusar ──────────────
-- SELECT pe.name AS funil_do_card, ps.name AS funil_da_etapa, s.name AS etapa,
--        l.name AS lead
--   FROM custom_pipe_entries e
--   JOIN custom_pipeline_stages s ON s.id = e.stage_id
--   JOIN custom_pipelines pe ON pe.id = e.pipeline_id
--   JOIN custom_pipelines ps ON ps.id = s.pipeline_id
--   LEFT JOIN leads l ON l.id = e.lead_id
--  WHERE s.pipeline_id <> e.pipeline_id;
--
-- 🔴 Em 25/08 sobraram 2 desses, os dois entre funis ATIVOS
--    ("Prospecção CNAE" × "Prospecção Ativa Presencial" e "Reativação Mercos" ×
--    "Prospecção Mercos"). São cards INVISÍVEIS hoje — o kanban do funil deles
--    não tem aquela coluna. Não foram tocados: consertar exige mover o card, e
--    mover dispara automação. Fica como dívida conhecida.
