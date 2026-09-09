-- ============================================================================
-- LID no inbox — SANEAMENTO (DML; NÃO é migration, não entra no `db push`)
--
-- Pré-requisito, sem atalho: o deploy de `history-sync-worker` com o fix de
-- `_shared/whatsapp-jid.ts` PRIMEIRO. Sanear antes do deploy é enxugar gelo —
-- o próximo "sincronizar histórico" recria tudo.
--
-- O QUE ESTE SCRIPT FAZ: remove do inbox as conversas cuja chave é um LID.
-- O QUE ELE NÃO FAZ: apagar mensagem. Nenhuma linha de `whatsapp_messages` é
-- tocada.
--
-- Por que não apagar (medido em prod 2026-09-03, Café Jurerê):
--   • 5.937 mensagens, 498 conversas, 100% via `received_via='history_sync'`;
--   • de 500 amostradas, ZERO têm gêmea pelo número real (`message_id` igual
--     em linha não-LID). O conteúdo é único: apagar seria perder histórico,
--     não remover duplicata;
--   • o payload não carrega o telefone do contato em campo nenhum
--     (`sender` é o próprio LID no recebido, e o NOSSO número no enviado),
--     então não há como reescrever a identidade a partir do que está no banco.
--
-- Logo: o dado fica, a linha de inbox sai. É reversível — a última consulta
-- deste arquivo reconstrói o resumo a partir das mensagens.
--
-- Impacto medido: 514 das 988 linhas do inbox da Café Jurerê (52%).
--
-- ORG: troque <ORG_ID> pelo uuid da organização antes de rodar.
--      Café Jurerê = 4922638c-4909-494e-ba10-12282ec0b161
--
-- COMO RODAR: uma consulta por vez, conferindo o retorno. Comece pelo bloco 1
-- (contagem), rode o 2 (backup), só então o 3 (delete).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) O que será removido. Rode ANTES e guarde o número.
-- ---------------------------------------------------------------------------
WITH lid AS (
  SELECT DISTINCT organization_id, instance_id, normalized_phone
  FROM public.whatsapp_messages
  WHERE (remote_jid LIKE '%@lid' OR remote_jid LIKE '%@newsletter' OR remote_jid LIKE '%@broadcast')
    AND organization_id = '<ORG_ID>'::uuid
)
SELECT s.organization_id, count(*) AS linhas_a_remover
FROM public.whatsapp_conversation_summary s
JOIN lid ON lid.organization_id = s.organization_id
        AND lid.instance_id     = s.instance_id
        AND lid.normalized_phone = s.normalized_phone
GROUP BY 1;

-- ---------------------------------------------------------------------------
-- 2) Backup das linhas em tabela própria. Sem isto, reconstruir depende de
--    recalcular; com isto, é um INSERT de volta.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._backup_lid_conversation_summary
  (LIKE public.whatsapp_conversation_summary INCLUDING ALL);

-- ⚠️ Tabela nova em `public` nasce ABERTA neste projeto, por dois caminhos que
--    se escondem um atrás do outro: o grant implícito de `PUBLIC` e o
--    `ALTER DEFAULT PRIVILEGES` que concede a `anon`/`authenticated`
--    nominalmente. E `LIKE ... INCLUDING ALL` copia índices e defaults, mas
--    NÃO copia RLS nem policies. Sem as três linhas abaixo, este backup
--    publicaria `phone_number` e `last_message` de todas as orgs.
ALTER TABLE public._backup_lid_conversation_summary ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._backup_lid_conversation_summary FROM PUBLIC;
REVOKE ALL ON TABLE public._backup_lid_conversation_summary FROM anon;
REVOKE ALL ON TABLE public._backup_lid_conversation_summary FROM authenticated;

-- A conferência é o que fecha o item — o grant é dado pelo banco no CREATE,
-- não pelo seu SQL. Espera-se `false, false` nas duas primeiras colunas.
SELECT has_table_privilege('anon',          'public._backup_lid_conversation_summary', 'SELECT') AS anon,
       has_table_privilege('authenticated', 'public._backup_lid_conversation_summary', 'SELECT') AS authenticated,
       relrowsecurity AS rls_ligada
FROM pg_class WHERE oid = 'public._backup_lid_conversation_summary'::regclass;

INSERT INTO public._backup_lid_conversation_summary
SELECT s.*
FROM public.whatsapp_conversation_summary s
WHERE s.organization_id = '<ORG_ID>'::uuid
  AND EXISTS (
    SELECT 1 FROM public.whatsapp_messages m
     WHERE m.organization_id  = s.organization_id
       AND m.instance_id      = s.instance_id
       AND m.normalized_phone = s.normalized_phone
       AND m.(remote_jid LIKE '%@lid' OR remote_jid LIKE '%@newsletter' OR remote_jid LIKE '%@broadcast')
  )
ON CONFLICT DO NOTHING;

SELECT count(*) AS linhas_no_backup FROM public._backup_lid_conversation_summary;

-- ---------------------------------------------------------------------------
-- 3) Remoção. O número devolvido tem de bater com o do passo 1.
-- ---------------------------------------------------------------------------
DELETE FROM public.whatsapp_conversation_summary s
WHERE s.organization_id = '<ORG_ID>'::uuid
  AND EXISTS (
    SELECT 1 FROM public.whatsapp_messages m
     WHERE m.organization_id  = s.organization_id
       AND m.instance_id      = s.instance_id
       AND m.normalized_phone = s.normalized_phone
       AND m.(remote_jid LIKE '%@lid' OR remote_jid LIKE '%@newsletter' OR remote_jid LIKE '%@broadcast')
  );

-- ---------------------------------------------------------------------------
-- 4) Conferência: o inbox encolheu, as mensagens continuam lá.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.whatsapp_conversation_summary
    WHERE organization_id = '<ORG_ID>'::uuid)                          AS inbox_agora,
  (SELECT count(*) FROM public.whatsapp_messages
    WHERE organization_id = '<ORG_ID>'::uuid AND (remote_jid LIKE '%@lid' OR remote_jid LIKE '%@newsletter' OR remote_jid LIKE '%@broadcast')) AS mensagens_preservadas;

-- ---------------------------------------------------------------------------
-- 5) DESFAZER (se for preciso): devolve as linhas do backup.
-- ---------------------------------------------------------------------------
-- INSERT INTO public.whatsapp_conversation_summary
-- SELECT * FROM public._backup_lid_conversation_summary
-- WHERE organization_id = '<ORG_ID>'::uuid
-- ON CONFLICT (organization_id, instance_id, normalized_phone) DO NOTHING;
