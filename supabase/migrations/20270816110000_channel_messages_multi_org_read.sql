-- ============================================================================
-- Migration: `channel_messages` — a LEITURA passa a enxergar TODAS as orgs do
--            usuário, e não só a primeira delas.
-- Data: 2027-08-16
-- Branch: feat/notificame-seamless
--
-- ⛔ ORDEM: DEPOIS de `20270815104500_notificame_instagram_inbound.sql`.
--    Aquele arquivo é quem revoga a escrita de `authenticated` nesta tabela
--    (bloco 7); este aqui conta com isso — ver "POR QUE `FOR SELECT`".
--
-- ─── O DEFEITO ──────────────────────────────────────────────────────────────
--
--   O inbox social tem DOIS gates para o MESMO dado, e eles não são o mesmo gate:
--
--     LISTA   → RPC `get_social_conversation_list`: `get_my_organization_ids()`
--               (TODAS as orgs ativas do usuário + orgs de gestor) OR
--               `is_master_user()`;
--     THREAD  → `SELECT` direto em `channel_messages`, sob a policy
--               `channel_messages_org_access`, que usa
--               `get_user_organization_id()` — SINGULAR, legado:
--
--                 SELECT organization_id FROM team_members
--                  WHERE user_id = auth.uid() AND is_active
--                  ORDER BY created_at ASC, id ASC
--                  LIMIT 1
--
--   `LIMIT 1` sobre a org MAIS ANTIGA. Para quem é membro de uma org só as duas
--   leituras coincidem — e é por isso que isto nunca apareceu. Para um usuário
--   MULTI-ORG operando em qualquer org que não seja a mais antiga dele, a lista
--   devolve as conversas e a thread devolve ZERO LINHAS: a conversa aparece na
--   lista e ABRE EM BRANCO. Sem erro, sem toast — a query é um sucesso com zero
--   linhas, que é indistinguível de "conversa vazia".
--
--   E não é só a thread. A MESMA policy é o gate de `apply_rls()` no Realtime,
--   então o mesmo usuário também não recebe:
--     - `useSocialRealtime` — a mensagem nova não aparece sem F5;
--     - `useIncomingMessageToast` — o aviso de mensagem recebida não toca.
--   Três sintomas, um gate. Consertar só a thread deixaria os outros dois.
--
-- ─── POR QUE ALINHAR NA POLICY, E NÃO TRANSFORMAR A THREAD EM RPC ───────────
--
--   Uma RPC nova para a thread consertaria a tela e deixaria o Realtime cego do
--   mesmo jeito — o transporte lê a TABELA, não a RPC. Além disso duplicaria o
--   gate: dois lugares descrevendo quem pode ver a mesma conversa, livres para
--   divergir de novo no próximo ajuste. Aqui há UM gate.
--
--   Não é ampliação de acesso decidida agora: quem PODE ver estas conversas já
--   foi decidido pela lista (`get_my_organization_ids()` + `is_master_user()`,
--   20270815104500 bloco 5). Esta migration faz a thread obedecer à MESMA
--   decisão. Master continua vindo da policy que já existe
--   (`master_all_channel_messages`, permissiva, avaliada em OR) — por isso
--   `is_master_user()` NÃO se repete aqui.
--
--   `get_my_organization_ids()` = orgs onde o usuário é team_member ATIVO, mais
--   as orgs de gestor de portfólio (`get_my_gestor_organization_ids()`). É o
--   recorte padrão deste repo (CLAUDE.md, "Gotchas": nunca `SELECT FROM
--   team_members` inline em policy — sempre a função SECURITY DEFINER, senão o
--   Realtime entra em recursão ao avaliar `apply_rls()`).
--
-- ─── POR QUE `FOR SELECT` (a policy antiga era `FOR ALL`) ───────────────────
--
--   A policy substituída é `FOR ALL` SEM `WITH CHECK` explícito — e policy
--   permissiva sem WITH CHECK reusa o USING como WITH CHECK. Combinada com o
--   `GRANT ALL ... TO authenticated` do baseline (L44513), ela deixava um MEMBRO
--   comum INSERIR linha em `channel_messages` pelo PostgREST. Manter `FOR ALL`
--   aqui e trocar só a função ampliaria esse caminho de escrita de "a minha org
--   mais antiga" para "qualquer org minha" — ampliar um furo em vez de fechá-lo.
--
--   Os grants de escrita já foram revogados em 20270815104500 (bloco 7), que
--   enumerou os escritores um a um: TODOS usam `service_role`, e `service_role`
--   não é afetado nem por aquele REVOKE nem por esta policy (BYPASSRLS). Em
--   `src/` não há um único escritor desta tabela — `useMetaMessages`,
--   `useSocialMessages`, `useMetaRealtime`, `useSocialRealtime` e
--   `useIncomingMessageToast` só leem/escutam. Ou seja: o privilégio ALCANÇÁVEL
--   depois desta migration é idêntico ao de antes dela (SELECT), e o caminho de
--   escrita fica fechado nas DUAS camadas — grant e policy — em vez de uma.
--
--   `mcp_readonly` e `anon` não mudam: sem `auth.uid()`, as duas funções
--   devolvem conjunto vazio, ontem e hoje.
--
-- ─── QUEM MAIS LÊ ESTA TABELA (blast radius, conferido) ─────────────────────
--
--   `useMetaMessages` / `useMetaRealtime` (rota Meta/Graph, `chat-meta`) leem
--   `channel_messages` sob esta policy e passam a enxergar as conversas de
--   TODAS as orgs do usuário — que é a correção do mesmo defeito naquela tela,
--   não um efeito colateral: hoje um usuário multi-org também vê a caixa Meta
--   vazia na org errada. Nenhuma das duas monta INSERT/UPDATE/DELETE.
--
-- ⚠️ APPLY — SEMPRE com `--db-url` EXPLÍCITO. `supabase/config.toml` aponta para
--   PROD; `db push --linked` sem alvo explícito já escreveu em prod sem
--   autorização neste repo. Apply em prod exige autorização do CTO na sessão.
--
-- ⚠️ TIMESTAMP — …110000 é posterior a 20270815104500 e não colide com nenhum
--   arquivo deste checkout nem de `origin/main` (conferido em 2026-08-13).
--   RECONFERIR contra as branches em voo NO MOMENTO DO APPLY: colisão faz o CLI
--   PULAR a migration em silêncio e o ledger dar falso verde.
--
-- ROLLBACK: `supabase/migrations/rollback/20270816110000_channel_messages_multi_org_read.sql`
-- ============================================================================

DROP POLICY IF EXISTS "channel_messages_org_access" ON public.channel_messages;

CREATE POLICY "channel_messages_org_access"
  ON public.channel_messages
  FOR SELECT
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
  );

COMMENT ON POLICY "channel_messages_org_access" ON public.channel_messages IS
  'Leitura por org do usuário. Usa get_my_organization_ids() (TODAS as orgs '
  'ativas + orgs de gestor) e não get_user_organization_id() (LIMIT 1 na org '
  'mais antiga): o gate tem de ser o MESMO de get_social_conversation_list, que '
  'serve a LISTA do inbox social. Enquanto foram dois, a conversa aparecia na '
  'lista e a thread abria em branco para usuário multi-org — e o Realtime, que '
  'avalia esta policy em apply_rls(), ficava mudo junto (useSocialRealtime e '
  'useIncomingMessageToast). FOR SELECT e não FOR ALL: a versão anterior era '
  'FOR ALL sem WITH CHECK, o que deixava membro comum INSERIR linha forjada '
  'nesta tabela pelo PostgREST. Todo escritor legítimo usa service_role. '
  'Master vem da policy irmã master_all_channel_messages (permissiva, OR).';
