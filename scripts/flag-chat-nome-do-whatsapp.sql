-- Flag `chat_nome_do_whatsapp` — o nome do perfil do WhatsApp manda no chat.
--
-- Org: Café Jurerê (4922638c-4909-494e-ba10-12282ec0b161).
-- Decisão do CTO em 2026-09-02: entrega por org, começando por esta.
--
-- O que a flag muda, e só nesta org:
--   o CABEÇALHO da conversa passa a resolver `push_name → nome do lead →
--   telefone`, que é a ordem que a LISTA já usa para todas as orgs.
--
-- Ou seja: a lista NÃO muda em org nenhuma. O que estava divergindo era o topo,
-- que preferia o nome curado no CRM enquanto a linha mostrava o do WhatsApp —
-- dois nomes para a mesma conversa. A flag alinha as duas telas nesta org.
--
-- `push_name` é o nome que a PESSOA escreveu no aparelho dela. Chega em toda
-- mensagem recebida, e o trigger de `whatsapp_conversation_summary` grava
-- `COALESCE(EXCLUDED.last_push_name, s.last_push_name)` — o novo na frente —
-- então ele acompanha a pessoa trocar o nome. Não é um valor congelado.
--
-- ⚠️ Rodar em PROD é botão do humano. Este arquivo não é aplicado por agente.
--    `apply_migration` do MCP é negado (read_only), e é assim que deve ficar.

-- ── 1. Antes: o que a org tem hoje ───────────────────────────────────────────
SELECT id, name, feature_flags
  FROM organizations
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 2. Ligar ─────────────────────────────────────────────────────────────────
-- `||` faz MERGE do jsonb: preserva as outras flags da org. Atribuir o objeto
-- inteiro apagaria flag que alguém ligou antes — e o estrago só apareceria
-- quando a feature daquela outra flag sumisse da tela.
UPDATE organizations
   SET feature_flags = coalesce(feature_flags, '{}'::jsonb)
                       || '{"chat_nome_do_whatsapp": true}'::jsonb
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 3. Depois: conferir ──────────────────────────────────────────────────────
-- `useFeatureFlag` só aceita `true` booleano — string "true" NÃO liga nada.
SELECT id,
       name,
       feature_flags -> 'chat_nome_do_whatsapp' AS valor,
       feature_flags -> 'chat_nome_do_whatsapp' = 'true'::jsonb AS liga_de_verdade
  FROM organizations
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 4. Ninguém mais deve estar com ela ligada ────────────────────────────────
SELECT id, name
  FROM organizations
 WHERE feature_flags -> 'chat_nome_do_whatsapp' = 'true'::jsonb;

-- ── 5. O que a org vai ver mudar no topo (amostra) ──────────────────────────
-- Onde as duas fontes divergem, a linha de cima é o que o cabeçalho mostra hoje
-- e a de baixo é o que passará a mostrar. Rodar ANTES de ligar.
SELECT l.name        AS topo_mostra_hoje,
       s.last_push_name AS topo_passa_a_mostrar,
       s.phone_number
  FROM whatsapp_conversation_summary s
  JOIN leads l ON l.id = s.lead_id
 WHERE s.organization_id = '4922638c-4909-494e-ba10-12282ec0b161'
   AND s.last_push_name IS NOT NULL
   AND s.last_push_name IS DISTINCT FROM l.name
 ORDER BY s.last_message_time DESC
 LIMIT 20;

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Remove a chave em vez de gravar `false`: a ausência é o estado neutro que o
-- hook já trata, e deixa o jsonb limpo para a próxima leitura humana.
--
-- UPDATE organizations
--    SET feature_flags = feature_flags - 'chat_nome_do_whatsapp'
--  WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';
--
-- Efeito no navegador aberto: `useFeatureFlag` tem staleTime de 60s, então o
-- topo volta ao nome do CRM em até um minuto. Sem F5, sem deploy.
