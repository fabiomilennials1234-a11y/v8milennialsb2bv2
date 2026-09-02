-- Flag `chat_abas_de_grupos` — a aba "Grupos" volta ao chat, só nesta org.
--
-- Org: Café Jurerê (4922638c-4909-494e-ba10-12282ec0b161).
-- Decisão do CTO em 2026-09-02: entrega por org, começando por esta.
--
-- O que a flag muda, e só nesta org:
--   • desktop  — uma TERCEIRA aba no topo da lista, ao lado de Ativas/Arquivadas;
--   • mobile   — um chip "Grupos" na fileira de filtros;
--   • busca    — a lista passa a pedir `p_include_groups := true` à RPC
--                `get_whatsapp_conversation_list`, que desde #1632 recusava
--                grupo antes do LIMIT.
--
-- Org sem a flag não tem aba, não tem chip e não pede grupo à RPC: a lista dela
-- é a de hoje, byte a byte.
--
-- ⚠️ Rodar em PROD é botão do humano. Este arquivo não é aplicado por agente.
--    `apply_migration` do MCP é negado (read_only), e é assim que deve ficar.

-- ═══════════════════════════════════════════════════════════════════════════
-- ORDEM DE ENTREGA — não há atalho
--
--   1. migration `20270909000000_conversation_list_grupos_por_org.sql` em prod
--   2. deploy do front (merge em main já sobe sozinho)
--   3. os passos deste arquivo
--
-- Invertendo 1 e 2, o front pede um parâmetro que não existe e leva `PGRST202`.
-- O hook tem queda para a chamada antiga — a lista sobrevive sem grupo —, mas a
-- aba nasceria vazia e o vendedor concluiria que a feature não funciona.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. A migration já está lá? ───────────────────────────────────────────────
-- Tem que existir UMA função, com 16 argumentos. Duas = overload sobrevivente,
-- e o PostgREST responde PGRST203 para a lista INTEIRA (não só para o grupo).
SELECT p.oid::regprocedure AS assinatura, p.pronargs AS n_args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'get_whatsapp_conversation_list';

-- ── 1. Antes: o que a org tem hoje ───────────────────────────────────────────
SELECT id, name, capture_groups, feature_flags
  FROM organizations
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 2. Tem grupo GRAVADO? ────────────────────────────────────────────────────
-- A aba mostra o que está no banco. Se este número for 0, ligar a flag entrega
-- uma aba vazia — e a causa quase sempre é o passo 3, não "a org não tem grupo".
SELECT count(*)                     AS conversas_de_grupo,
       max(s.last_message_time)     AS grupo_mais_recente
  FROM whatsapp_conversation_summary s
 WHERE s.organization_id = '4922638c-4909-494e-ba10-12282ec0b161'
   AND s.is_group;

-- ── 3. A captura está ligada? ────────────────────────────────────────────────
-- `capture_groups = false` faz o `whatsapp-webhook` DERRUBAR a mensagem de grupo
-- antes de gravar (log `uazapi_group_message_skipped`, motivo
-- `capture_groups_off`). Com ela desligada, a aba mostra só o histórico
-- congelado de antes do desligamento e nunca recebe conversa nova.
--
-- ⚠️ Ligar muda o VOLUME de escrita: grupo é ~40% das mensagens que chegam. Isso
--    pesa em `whatsapp_messages`, no storage de mídia (bucket já em 108 GB) e na
--    RAM de prod. É decisão do CTO, não efeito colateral desta flag — por isso
--    está comentado.
--
-- UPDATE organizations
--    SET capture_groups = true
--  WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 4. Ligar a aba ───────────────────────────────────────────────────────────
-- `||` faz MERGE do jsonb: preserva as outras flags da org. Atribuir o objeto
-- inteiro apagaria flag que alguém ligou antes — e o estrago só apareceria
-- quando a feature daquela outra flag sumisse da tela.
UPDATE organizations
   SET feature_flags = coalesce(feature_flags, '{}'::jsonb)
                       || '{"chat_abas_de_grupos": true}'::jsonb
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 5. Depois: conferir ──────────────────────────────────────────────────────
-- `useFeatureFlag` só aceita `true` booleano — string "true" NÃO liga nada.
SELECT id,
       name,
       feature_flags -> 'chat_abas_de_grupos' AS valor,
       feature_flags -> 'chat_abas_de_grupos' = 'true'::jsonb AS liga_de_verdade
  FROM organizations
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- ── 6. Ninguém mais deve estar com ela ligada ────────────────────────────────
SELECT id, name
  FROM organizations
 WHERE feature_flags -> 'chat_abas_de_grupos' = 'true'::jsonb;

-- ── 7. Quem vai VER a aba cheia ──────────────────────────────────────────────
-- Grupo não tem lead, então não tem responsável. Com `chat_restrict_to_owner`
-- ligado, a RPC trata grupo como conversa não-atribuída: quem tem
-- `leads.view_unassigned` (ou é admin/master) vê; quem não tem, vê a aba vazia.
-- Se a org restringe e ninguém tem a permissão, a aba só serve pra admin.
SELECT o.chat_restrict_to_owner,
       count(*) FILTER (WHERE mfp.enabled) AS membros_com_view_unassigned
  FROM organizations o
  LEFT JOIN team_members tm
         ON tm.organization_id = o.id AND tm.is_active
  LEFT JOIN member_feature_permissions mfp
         ON mfp.team_member_id = tm.id AND mfp.feature_key = 'leads.view_unassigned'
 WHERE o.id = '4922638c-4909-494e-ba10-12282ec0b161'
 GROUP BY o.chat_restrict_to_owner;

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Remove a chave em vez de gravar `false`: a ausência é o estado neutro que o
-- hook já trata, e deixa o jsonb limpo para a próxima leitura humana.
--
-- UPDATE organizations
--    SET feature_flags = feature_flags - 'chat_abas_de_grupos'
--  WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';
--
-- Efeito no navegador aberto: `useFeatureFlag` tem staleTime de 60s, então a aba
-- some em até um minuto (e o shell devolve a lista pra "Ativas" se ela estava
-- aberta). Sem F5, sem deploy. A migration NÃO precisa ser revertida: sem a flag
-- ninguém manda `p_include_groups`, e o default do parâmetro é `false`.
