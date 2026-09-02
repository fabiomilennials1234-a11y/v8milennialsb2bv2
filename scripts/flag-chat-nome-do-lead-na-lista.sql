-- Flag `chat_nome_do_lead_na_lista` — liga o nome do CRM na lista do inbox.
--
-- Org: Café Jurerê (4922638c-4909-494e-ba10-12282ec0b161).
-- Decisão do CTO em 2026-09-02: entrega por org, começando por esta.
--
-- O que a flag muda, e só nesta org:
--   1. a LINHA da lista passa a mostrar `leads.name` na frente de `push_name`
--      (o nome do perfil do WhatsApp, que o CRM não controla);
--   2. conversa cujo resumo não vinculou lead passa a achá-lo por telefone
--      (`leads.normalized_phone`) — a mesma queda que o CABEÇALHO já fazia.
--
-- Org sem a flag continua byte-a-byte como está hoje.
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
                       || '{"chat_nome_do_lead_na_lista": true}'::jsonb
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 3. Depois: conferir ──────────────────────────────────────────────────────
-- `useFeatureFlag` só aceita `true` booleano — string "true" NÃO liga nada.
SELECT id,
       name,
       feature_flags -> 'chat_nome_do_lead_na_lista' AS valor,
       feature_flags -> 'chat_nome_do_lead_na_lista' = 'true'::jsonb AS liga_de_verdade
  FROM organizations
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 4. Ninguém mais deve estar com ela ligada ────────────────────────────────
SELECT id, name
  FROM organizations
 WHERE feature_flags -> 'chat_nome_do_lead_na_lista' = 'true'::jsonb;

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Remove a chave em vez de gravar `false`: a ausência é o estado neutro que o
-- hook já trata, e deixa o jsonb limpo para a próxima leitura humana.
--
-- UPDATE organizations
--    SET feature_flags = feature_flags - 'chat_nome_do_lead_na_lista'
--  WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';
--
-- Efeito em ≤20s no navegador aberto: a lista refaz o fetch nesse intervalo e o
-- hook da flag tem staleTime de 60s. Sem F5, sem deploy.
