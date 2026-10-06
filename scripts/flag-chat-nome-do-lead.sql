-- Flag `chat_nome_do_lead` — o `leads.name` é o nome da conversa no chat.
--
-- Org: Café Jurerê (4922638c-4909-494e-ba10-12282ec0b161).
-- Decisão do CTO em 2026-10-06 (Chamados 83b5639e e e261b64b): entrega por org,
-- começando por esta.
--
-- O que a flag muda, e só nesta org:
--   lista, cabeçalho (desktop e mobile) e painel lateral passam a resolver
--   `leads.name → nome salvo → perfil do WhatsApp → telefone`. Grupos e canais
--   que não são WhatsApp ficam como estão. Só `leads.name`, como gravado: nada
--   é montado a partir de campos separados.
--
-- NÃO é a flag `chat_nome_do_whatsapp` (perfil primeiro, só no topo): o sentido
-- é o oposto. A antiga continua existindo e intocada.
--
-- Ordem: depois do DEPLOY do front. Ligar antes não faz nada (o bundle antigo
-- não lê a chave) e depois do deploy o efeito aparece em até 60s (staleTime do
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
                       || '{"chat_nome_do_lead": true}'::jsonb
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 3. Depois: conferir ──────────────────────────────────────────────────────
-- `useFeatureFlag` só aceita `true` booleano — string "true" NÃO liga nada.
SELECT id,
       name,
       feature_flags -> 'chat_nome_do_lead' AS valor,
       feature_flags -> 'chat_nome_do_lead' = 'true'::jsonb AS liga_de_verdade
  FROM organizations
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 4. Ninguém mais deve estar com ela ligada ────────────────────────────────
-- Esperado: exatamente 1 linha, a org acima.
SELECT id, name
  FROM organizations
 WHERE feature_flags -> 'chat_nome_do_lead' = 'true'::jsonb;

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Remove a chave em vez de gravar `false`: a ausência é o estado neutro que o
-- hook já trata.
--
-- UPDATE organizations
--    SET feature_flags = feature_flags - 'chat_nome_do_lead'
--  WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';
--
-- Efeito no navegador aberto: volta à regra antiga em até 60s. Sem F5, sem deploy.
