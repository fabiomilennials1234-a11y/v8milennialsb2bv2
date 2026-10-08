-- Flag `chat_nome_cod_contato_lead` — a conversa se chama "Cód - Contato - Lead".
--
-- Org: Café Jurerê (4922638c-4909-494e-ba10-12282ec0b161).
-- Decisão do CTO em 2026-10-08 (Chamado 82c50502, ADR-0039): entrega por org,
-- começando por esta.
--
-- O que a flag muda, e só nesta org:
--   lista, cabeçalho (desktop e mobile) e painel lateral passam a mostrar
--   `<Cód> - <Nome do contato> - <Lead>` em toda conversa de cliente
--   (WhatsApp, não grupo). Sem nome de contato no telefone da conversa:
--   `<Cód> - <Lead>`. Sem código: `<Contato> - <Lead>`. O painel ganha o bloco
--   "Falando com" (nomear o contato, abrir conversa com outro contato).
--   Grupos e canais que não são WhatsApp ficam como estão. NADA é gravado em
--   `leads.name`: disparo, Copilot e `{{nome}}` seguem com o nome puro.
--
-- Vence `chat_nome_do_lead` (que está ligada nesta org e pode continuar: sem a
-- flag nova, a regra dela volta a valer).
--
-- Ordem: depois do APPLY da migration 20271112000000 (RPC
-- `contatos_das_conversas`) e do DEPLOY do front. Ligar antes não faz nada (o
-- bundle antigo não lê a chave). Rode o `toth-sync-clientes` uma vez depois,
-- para os contatos do ERP chegarem com o nome; antes disso a lista mostra
-- "Cód - Lead". Efeito no navegador em até 60s (staleTime do
-- `useFeatureFlag`), sem F5.
--
-- ⚠️ Rodar em PROD é botão do humano. Este arquivo não é aplicado por agente.

-- ── 1. Antes: o que a org tem hoje ───────────────────────────────────────────
SELECT id, name, feature_flags
  FROM organizations
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 2. Ligar ─────────────────────────────────────────────────────────────────
-- `||` faz MERGE do jsonb: preserva as outras flags da org. Atribuir o objeto
-- inteiro apagaria flag que alguém ligou antes.
UPDATE organizations
   SET feature_flags = coalesce(feature_flags, '{}'::jsonb)
                       || '{"chat_nome_cod_contato_lead": true}'::jsonb
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 3. Depois: conferir ──────────────────────────────────────────────────────
-- `useFeatureFlag` só aceita `true` booleano — string "true" NÃO liga nada.
SELECT id,
       name,
       feature_flags -> 'chat_nome_cod_contato_lead' AS valor,
       feature_flags -> 'chat_nome_cod_contato_lead' = 'true'::jsonb AS liga_de_verdade
  FROM organizations
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 4. Ninguém mais deve estar com ela ligada ────────────────────────────────
-- Esperado: exatamente 1 linha, a org acima.
SELECT id, name
  FROM organizations
 WHERE feature_flags -> 'chat_nome_cod_contato_lead' = 'true'::jsonb;

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Remove a chave em vez de gravar `false`: a ausência é o estado neutro que o
-- hook já trata.
--
-- UPDATE organizations
--    SET feature_flags = feature_flags - 'chat_nome_cod_contato_lead'
--  WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';
--
-- Efeito no navegador aberto: volta à regra anterior (`chat_nome_do_lead`) em
-- até 60s. Sem F5, sem deploy.
