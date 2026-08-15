-- ============================================================================
-- Migration: identidade SOCIAL do lead — "a conversa de Instagram passa a ter dono"
-- Data: 2027-08-17
-- Branch: feat/notificame-seamless
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⛔ ORDEM DE APPLY — MIGRATION PRIMEIRO, FUNÇÃO DEPOIS, FRONT POR ÚLTIMO. ║
-- ║                                                                          ║
-- ║      1º  `20270815104500_notificame_instagram_inbound.sql` (já é         ║
-- ║          pré-requisito: este arquivo RECRIA a RPC que nasce lá);         ║
-- ║      2º  ESTE ARQUIVO, com `--db-url` EXPLÍCITO;                         ║
-- ║      3º  `supabase functions deploy notificame-webhook`;                 ║
-- ║      4º  o front (SocialLeadLinkPanel + useSocialLeadLink).              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ─── POR QUE 2º ANTES DE 3º ─────────────────────────────────────────────────
--
--   O `notificame-webhook` passa a RESOLVER a identidade (SELECT, nunca INSERT)
--   antes de montar a linha. A leitura é BEST-EFFORT e está embrulhada em
--   try/catch: com a tabela ausente ela devolve `null` e a mensagem entra igual,
--   com `lead_id` nulo — exatamente o comportamento de hoje. Inverter 2º↔3º NÃO
--   perde evento; só adia o preenchimento do vínculo. É a única ordem deste
--   conjunto que tolera inversão, e ela é tolerada de propósito (o inbound é o
--   caminho que não pode cair).
--
-- ─── POR QUE 2º ANTES DE 4º (aqui inverter QUEBRA A TELA) ───────────────────
--
--   O bloco 7 muda o `RETURNS TABLE` de `get_social_conversation_list`
--   (acrescenta `lead_name`). Front novo sobre banco velho recebe erro de
--   PostgREST na lista inteira — a caixa de Instagram fica VAZIA, não degradada.
--   Banco novo sobre front velho é inofensivo: a coluna a mais é ignorada pelo
--   cliente.
--
-- ─── O BURACO QUE ESTE ARQUIVO FECHA ────────────────────────────────────────
--
--   Hoje o painel lateral da conversa de Instagram diz, textualmente: "Conversas
--   do Instagram ainda não são vinculadas a um lead". A conversa entra, aparece
--   na lista, abre a thread — e morre ali: não vira lead, não entra em funil, não
--   tem ficha. `channel_messages.lead_id` fica NULL em toda linha de IG.
--
--   A razão de ter ficado assim está no COMMENT de `contact_external_id` e no
--   cabeçalho de 20270815104500: `leads` NÃO TEM NENHUMA COLUNA DE IDENTIDADE
--   SOCIAL. As únicas identidades da tabela são `email`, `phone`,
--   `normalized_phone` e `phone_digits` — todas telefônicas ou de e-mail. Um
--   IGSID não cabe em nenhuma delas, e enfiá-lo em `phone` seria o desastre já
--   descrito no ⚠️ de `buildInboundChannelMessageRow`.
--
-- ─── POR QUE TABELA PRÓPRIA, E NÃO UMA COLUNA EM `leads` ────────────────────
--
--   Quatro razões, e "menos SQL" não é uma delas:
--
--   (a) CARDINALIDADE. Lead 1:N identidades — Instagram hoje, Messenger amanhã,
--       duas contas de IG da mesma pessoa depois. Coluna obrigaria UMA COLUNA POR
--       REDE numa tabela de 40.485 linhas e ~90 colunas, com ALTER TABLE a cada
--       rede nova. E não é hipótese distante: o IGSID é PAGE-SCOPED — a mesma
--       pessoa falando com DOIS canais de IG da MESMA org já produz dois ids
--       distintos, hoje, sem nenhuma rede nova entrar.
--
--   (b) MUTABILIDADE. O @handle MUDA; o IGSID NÃO. Em tabela separada,
--       `external_user_id` é CHAVE e `handle`/`display_name`/`avatar_url` são
--       atributos mutáveis, atualizáveis sem tocar índice nenhum. Numa coluna de
--       `leads` os dois viveriam no mesmo nível, e a próxima pessoa indexaria o
--       handle — que é o campo que troca.
--
--   (c) PROVENIÊNCIA. `linked_by`, `linked_at`, `messaging_channel_id`,
--       `last_seen_at` são fatos sobre o VÍNCULO, não sobre o lead. Sem lugar para
--       eles, a pergunta "quem vinculou esta conversa a este lead, e quando?"
--       nasce sem resposta — e é a primeira pergunta de qualquer disputa.
--
--   (d) SEGURANÇA DE ESCRITA. `leads` é INSERT/UPDATE-ável por QUALQUER membro
--       autenticado pelo PostgREST (a policy `leads_insert_organization` só checa
--       org, não papel). Identidade em coluna de `leads` seria ROUBÁVEL com um
--       UPDATE direto: um membro apontaria a conversa de qualquer pessoa para
--       qualquer lead da org dele, sem passar por gate nenhum. Aqui a tabela
--       replica o molde de `messaging_channels`: `REVOKE ALL FROM authenticated`
--       + `GRANT SELECT`, e escrita SÓ por RPC SECURITY DEFINER.
--
--   A tabela morta `contacts` (0 referências em `src/` e em
--   `supabase/functions/`, chaveada por `normalized_phone`) NÃO é atalho:
--   adotá-la é projeto, e ela é chaveada justamente pelo eixo que não existe
--   aqui.
--
-- ─── QUEM CRIA O LEAD: HUMANO AUTENTICADO. NUNCA O WEBHOOK. ─────────────────
--
--   O fornecedor CONFIRMOU POR ESCRITO que não assina o corpo do webhook. Quem
--   descobrir o secret do path e o uuid da subconta consegue POSTAR mensagem
--   forjada numa org. Se esse endpoint criasse lead, ele viraria um BOTÃO DE
--   INFLAR A BASE de qualquer org — uma requisição, um lead, sem limite.
--
--   Isto não é conservadorismo inventado agora: é o molde do WhatsApp. O
--   `whatsapp-webhook` não tem UMA chamada a `getOrCreateLead`; quem cria é
--   `useCreateLeadFromWhatsApp`, no clique de uma pessoa. E o guard
--   `if (!phone && !email) return null` de `_shared/lead-service.ts:130` NÃO É
--   AFROUXADO por este arquivo — ele protege 8 call sites, inclusive o caminho
--   quente do `agent-message`. O caminho novo é RPC própria, não relaxamento do
--   criador canônico.
--
--   TRADE-OFF DECLARADO: manual não captura sozinho. Conversa sem toque humano
--   nunca vira lead. É o preço de um endpoint sem autenticidade de conteúdo.
--   Automático só seria aceitável atrás de (a) HMAC real do fornecedor — que ele
--   não oferece — ou, na falta dela, do conjunto (b) opt-in por canal +
--   `is_shadow` + rate limit + teto diário. Sem (a), (b) só REDUZ o alcance do
--   vetor; não o fecha. Fica documentado e NÃO implementado.
--
-- ─── POR QUE O VÍNCULO NÃO PODE MORAR EM `channel_messages.lead_id` ─────────
--
--   Porque ele SUMIRIA na próxima mensagem. A lista lê `lead_id` da ÚLTIMA
--   mensagem da thread (bloco 5 de 20270815104500, `t.lid`) e o writer do inbound
--   grava `lead_id` NULO. Vincular só as linhas existentes duraria até o próximo
--   evento entrar. Por isso a identidade é a FONTE DA VERDADE e
--   `channel_messages.lead_id` vira CACHE DERIVADO, escrito em três tempos:
--     PASSADO  — backfill da thread inteira, dentro da RPC de vínculo;
--     FUTURO   — `notificame-webhook` resolve a identidade e já grava preenchido;
--     PRESENTE — a lista (bloco 7) passa a fazer LEFT JOIN na identidade.
--   A FK `channel_messages.lead_id → leads(id)` já é ON DELETE SET NULL, então
--   lead apagado não deixa ponteiro pendurado no cache.
--
-- ─── O QUE FAZ ──────────────────────────────────────────────────────────────
--   1. `public.lead_social_identities` — a identidade social como ENTIDADE;
--   2. índices (a unicidade POR ORG é o único guarda desta fatia);
--   3. RLS + grants (leitura por membro da org; escrita só service_role/DEFINER);
--   4. `link_social_conversation_to_lead` — vincular a lead EXISTENTE;
--   5. `create_lead_from_social_conversation` — criar E vincular, UM ato só;
--   6. `unlink_social_conversation_from_lead` — desfazer erro;
--   7. `get_social_conversation_list` recriada: `lead_id` sai da IDENTIDADE e
--      `lead_name` entra no retorno;
--   8. grants das QUATRO funções — inclusive a recriada (o DROP apagou os dela).
--
-- ─── O QUE ESTA MIGRATION NÃO TOCA, DE PROPÓSITO ────────────────────────────
--   - `leads`: nenhuma coluna nova, nenhuma constraint alterada. A tabela de
--     40.485 linhas não é reescrita nem re-validada;
--   - `_shared/lead-service.ts` e o guard `!phone && !email`: intocados;
--   - `fn_auto_assign_lead_default_pipe` / `trg_auto_assign_lead_default_pipe`:
--     intocados. A RPC do bloco 5 usa o escape hatch que JÁ EXISTE
--     (`app.skip_default_pipe`), criado por 20270729000000 — não inventa um
--     segundo mecanismo para o mesmo problema;
--   - `contacts` (tabela morta): não é adotada, não é populada;
--   - publicação `supabase_realtime`: `lead_social_identities` não entra. Não há
--     consumidor de realtime dela; quem invalida a tela é o `onSuccess` da
--     mutation. Tabela em publicação sem leitor é custo sem benefício;
--   - `agent-message` e o Copilot: conversa de Instagram continua NÃO acordando
--     agente. Aquele caminho é phone-keyed do primeiro ao último passo (lock por
--     telefone, audience gate por `normalized_phone`, kill-switch em
--     `phone_ai_preferences`), e o guard de `from` lá é só `length >= 8` — um
--     IGSID PASSARIA e poderia colidir com o `normalized_phone` de um lead real.
--     Fatia própria, com desmontagem daquele acoplamento antes.
--
-- ⚠️ APPLY — SEMPRE com `--db-url` EXPLÍCITO. `supabase/config.toml` aponta para
--   PROD; `db push --linked` sem alvo explícito já escreveu em prod sem
--   autorização neste repo. Apply em prod exige autorização do CTO na sessão.
--
-- ⚠️ TIMESTAMP — …090000 é posterior a 20270816120000, a maior deste checkout.
--   CONFERIDO em 2026-08-14 contra `origin/main`, TODAS as branches remotas e os
--   arquivos NÃO-COMMITADOS dos worktrees desta máquina: nenhum `20270817*` em
--   lugar nenhum. Isso vale para o momento da ESCRITA, não para o do APPLY —
--   colisão de timestamp faz o CLI PULAR a migration em silêncio e o ledger dar
--   falso verde, e `scripts/check-migration-versions.sh` só olha o próprio
--   checkout + a base. RECONFERIR contra as branches em voo NO MOMENTO DO APPLY.
--
-- ROLLBACK: `supabase/migrations/rollback/20270817090000_lead_social_identities.sql`
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A identidade social como ENTIDADE.
--
--    NA CHAVE ENTRA `channel_type`, NÃO `provider`. O IGSID é escopado pela
--    PLATAFORMA (Instagram/Meta), não pelo BSP: se amanhã o MESMO id chegar pela
--    Meta direto em vez do NotificaMe, incluir `provider` na chave criaria um
--    SEGUNDO vínculo para a MESMA pessoa — e, pelo caminho da criação, um segundo
--    LEAD. O inverso é correto em `messaging_channels`, e é por isso que lá a
--    chave é `(provider, external_channel_id)`: `external_channel_id` é id DO
--    FORNECEDOR. A regra é: A CHAVE CARREGA O NAMESPACE DO ID. `provider` fica
--    como coluna DESCRITIVA (quem observou), fora de qualquer índice único.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_social_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- CASCADE: sem lead, o vínculo não descreve nada. E a linha órfã seria pior que
  -- ausência — ela ocuparia a chave única e IMPEDIRIA um vínculo novo para a
  -- mesma pessoa, sem nada na tela explicando por quê.
  lead_id UUID NOT NULL
    REFERENCES public.leads(id) ON DELETE CASCADE,

  -- Descritivo, NUNCA parte de chave. Ver o bloco de comentário acima.
  provider TEXT NOT NULL DEFAULT 'notificame',

  -- Mesmo vocabulário de `messaging_channels.channel_type`, e 'whatsapp' é
  -- RECUSADO pela mesma razão: WhatsApp tem identidade própria e canônica em
  -- `leads.normalized_phone`. Uma segunda identidade telefônica aqui seria uma
  -- segunda verdade sobre a MESMA pessoa, livre para divergir.
  channel_type TEXT NOT NULL
    CHECK (channel_type IN ('instagram', 'facebook')),

  -- O IGSID. Id ESTÁVEL do usuário no app — NUNCA o @handle.
  external_user_id TEXT NOT NULL,

  -- Rótulos MUTÁVEIS. Derivados no servidor, a partir da última mensagem
  -- RECEBIDA da thread; nunca vêm do corpo de uma requisição do cliente.
  handle TEXT,
  display_name TEXT,
  avatar_url TEXT,

  -- ONDE foi observado. SET NULL e não CASCADE: desconectar um canal NÃO pode
  -- apagar a identidade da PESSOA. Mesma lógica de
  -- `channel_messages.messaging_channel_id` — histórico órfão é estado degradado
  -- e HONESTO; vínculo apagado é dado perdido em silêncio.
  messaging_channel_id UUID
    REFERENCES public.messaging_channels(id) ON DELETE SET NULL,

  -- QUEM vinculou. NULL quando o ator é master sem team_member na org — ver o
  -- ⚠️ do COMMENT desta coluna.
  linked_by UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL,

  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Última vez que esta identidade foi VISTA falando. Alimentado a partir do
  -- timestamp da última mensagem da thread no momento do vínculo.
  last_seen_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lead_social_identities IS
  'Identidade de rede social (hoje Instagram) vinculada a um lead. FONTE DA '
  'VERDADE do vínculo — `channel_messages.lead_id` é cache derivado dela. Existe '
  'como tabela, e não como coluna em `leads`, por quatro razões: cardinalidade '
  '(lead 1:N identidades, e o IGSID é page-scoped, então a mesma pessoa em dois '
  'canais da MESMA org já são dois ids), mutabilidade (o @handle muda, o IGSID '
  'não — aqui um é atributo e o outro é chave), proveniência (linked_by/linked_at '
  'são fatos sobre o VÍNCULO) e segurança de escrita (`leads` é UPDATE-ável por '
  'qualquer membro pelo PostgREST; esta tabela não é escrevível pelo browser). '
  'ESCRITA EXCLUSIVA pelas três RPCs SECURITY DEFINER desta migration, chamadas '
  'por humano autenticado no chat. O webhook do NotificaMe NUNCA escreve aqui: '
  'ele não tem autenticidade de conteúdo (o fornecedor não assina o corpo), e '
  'criar lead a partir dele seria um botão de inflar a base de qualquer org.';

COMMENT ON COLUMN public.lead_social_identities.external_user_id IS
  'O id ESTÁVEL do usuário na plataforma (IGSID no Instagram). NUNCA o @handle: '
  'handle muda, id não. É o mesmo valor que `channel_messages.contact_external_id` '
  'guarda, e é por ele que o inbound RESOLVE (nunca cria) o lead da mensagem nova. '
  '⚠️ PAGE-SCOPED no Instagram: a mesma pessoa falando com dois canais de IG da '
  'mesma org tem DOIS ids, e portanto duas linhas aqui — suportado por construção '
  '(1:N), e motivo adicional para a chave ser por ORG e não por canal.';

COMMENT ON COLUMN public.lead_social_identities.channel_type IS
  'instagram | facebook. ''whatsapp'' é RECUSADO pelo CHECK de propósito: WhatsApp '
  'tem identidade canônica em leads.normalized_phone, e duplicá-la aqui criaria '
  'uma segunda verdade sobre a mesma pessoa. Entra na chave única no lugar de '
  '`provider` porque o id é escopado pela PLATAFORMA, não pelo BSP.';

COMMENT ON COLUMN public.lead_social_identities.provider IS
  'Quem OBSERVOU a identidade (notificame, meta, ...). Descritivo. FORA de índice '
  'único de propósito: se o mesmo IGSID chegar por outro provider, é a MESMA '
  'pessoa — com provider na chave, viraria um segundo lead.';

COMMENT ON COLUMN public.lead_social_identities.handle IS
  'O @usuário — MUTÁVEL, rótulo, jamais chave. Nasce NULL na maioria dos casos: o '
  'payload de entrada hoje não traz o handle do INTERLOCUTOR (só o da nossa '
  'conta). Trazê-lo é fatia própria.';

COMMENT ON COLUMN public.lead_social_identities.linked_by IS
  'team_member que clicou. ⚠️ NULL quando o ator é MASTER sem team_member na org '
  '— o ator mais poderoso é justo o que pode deixar buraco na trilha. Nesse caso '
  'as RPCs gravam `master_user_id` no metadata do lead_history, que é o padrão já '
  'documentado no COMMENT de lead_history.metadata.';

COMMENT ON COLUMN public.lead_social_identities.messaging_channel_id IS
  'Canal onde a identidade foi observada. ON DELETE SET NULL: desconectar canal '
  'não pode apagar a identidade da PESSOA — o vínculo dela com o lead sobrevive '
  'ao canal, como o histórico de channel_messages sobrevive.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Índices.
--
--    ⚠️ A UNICIDADE É POR ORG, E ISSO É DELIBERADO — o raciocínio de
--    `uq_messaging_channels_external` (unicidade GLOBAL, sem organization_id) NÃO
--    se aplica aqui, e a diferença é O TIPO DO OBJETO IDENTIFICADO:
--
--      lá o id identifica um RECURSO NOSSO (um canal do fornecedor), que tem
--      exatamente UM dono — duas orgs reivindicando o mesmo canal significa
--      mensagens de um tenant entregues a outro;
--
--      aqui o id identifica uma PESSOA. A mesma pessoa falar com DUAS orgs é o
--      caso NORMAL do B2B (a mesma fábrica é cliente de dois clientes nossos),
--      não fraude.
--
--    Unicidade global produziria DOIS danos: recusa legítima (a segunda org
--    simplesmente não conseguiria vincular, sem explicação possível na tela) e
--    ORÁCULO CROSS-TENANT — o 23505 contaria à org B que a org A já tem aquela
--    pessoa. Índice único é canal de informação.
--
--    E NÃO existe unique em `(lead_id, channel_type)`: uma pessoa pode ter duas
--    contas de Instagram, e o IGSID page-scoped já garante duas linhas para o
--    mesmo par pessoa↔org quando há dois canais.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_social_identities_org_identity
  ON public.lead_social_identities (organization_id, channel_type, external_user_id);

COMMENT ON INDEX public.uq_lead_social_identities_org_identity IS
  'O ÚNICO guarda de unicidade desta fatia. `idx_leads_org_phone_unique` NÃO '
  'cobre nada aqui: ele é PARCIAL em normalized_phone e um lead de Instagram '
  'nasce sem telefone. É por causa deste índice que criar-e-vincular tem de ser '
  'UMA transação: fora dela, dois cliques na mesma conversa produziriam dois '
  'leads e um órfão, sem nada no banco para impedir.';

-- "Quais identidades sociais este lead tem?" — ficha do lead e desvínculo.
CREATE INDEX IF NOT EXISTS idx_lead_social_identities_lead
  ON public.lead_social_identities (lead_id);

-- "Quais identidades vieram deste canal?" — parcial: a coluna é nullable e linha
-- com canal apagado não interessa a esta leitura.
CREATE INDEX IF NOT EXISTS idx_lead_social_identities_channel
  ON public.lead_social_identities (messaging_channel_id)
  WHERE messaging_channel_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_lead_social_identities_updated_at
  ON public.lead_social_identities;
CREATE TRIGGER trg_lead_social_identities_updated_at
  BEFORE UPDATE ON public.lead_social_identities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS + grants.
--
--    LEITURA por membro da org (o front precisa saber que a conversa tem lead) e
--    ESCRITA por ninguém a não ser service_role e as DEFINER deste arquivo.
--
--    GRANT de TABELA domina a policy: sem os REVOKEs, o default privilege do
--    schema public deixa a tabela alcançável ANTES de a RLS opinar. Foi assim que
--    uma tabela de backup nasceu legível por `anon` neste repo.
--
--    Funções SECURITY DEFINER na policy, NUNCA `SELECT ... FROM team_members`
--    inline: subquery inline em policy causa recursão infinita quando o Realtime
--    avalia `apply_rls()` (CLAUDE.md, "Gotchas").
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.lead_social_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read lead_social_identities"
  ON public.lead_social_identities;
CREATE POLICY "Org members read lead_social_identities"
  ON public.lead_social_identities
  FOR SELECT
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR public.is_master_user()
  );

DROP POLICY IF EXISTS "Service role full access lead_social_identities"
  ON public.lead_social_identities;
CREATE POLICY "Service role full access lead_social_identities"
  ON public.lead_social_identities
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.lead_social_identities FROM PUBLIC;
REVOKE ALL ON public.lead_social_identities FROM anon;
REVOKE ALL ON public.lead_social_identities FROM authenticated;
GRANT SELECT ON public.lead_social_identities TO authenticated;
GRANT ALL ON public.lead_social_identities TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. VINCULAR a um lead EXISTENTE.
--
--    QUATRO GATES, não dois:
--      (1) org acessível a quem chama — `get_my_organization_ids()` OR
--          `is_master_user()`, forma idêntica à de `get_social_conversation_list`;
--      (2) o CANAL pertence à org — sem ele, um membro legítimo da org A escreve
--          na caixa da org B só passando o uuid do canal dela. É o vetor já
--          catalogado neste repo: RPC DEFINER que recorta por parâmetro do
--          cliente sem CONFERIR o parâmetro;
--      (3) o LEAD pertence à org E não está na lixeira — sem ele, um membro
--          aponta a conversa dela para um lead de OUTRA org. `deleted_at IS NULL`
--          não é detalhe: a lixeira NÃO apaga a linha, e sem o filtro a conversa
--          exibiria para sempre um lead que o usuário mandou para o lixo;
--      (4) — só na de CRIAR (bloco 5). Vincular exige apenas membro ativo da org.
--          ASSIMETRIA CONSCIENTE: não existe chave 'leads.edit' semeada, e
--          inventar chave de permissão nova é outra fatia.
--
--    A autorização NUNCA vem do corpo: `p_org` é CONFERIDO contra o auth context,
--    não confiado.
--
--    display_name/avatar/last_seen_at são DERIVADOS NO SERVIDOR, da última
--    mensagem RECEBIDA da thread. Nenhum rótulo entra por parâmetro — o que o
--    cliente não escreve, o cliente não forja.
-- ─────────────────────────────────────────────────────────────────────────────
-- ─────────────────────────────────────────────────────────────────────────────
-- can_link_or_read_lead — ESPELHO da policy `leads_select_by_responsibility_and_permissions`.
--
-- POR QUE ELE EXISTE: as duas RPCs desta migration são SECURITY DEFINER, e DEFINER
-- BYPASSA A RLS de `leads`. Sem este predicado, o gate de org (a única checagem que
-- havia) deixaria um vendedor SEM `leads.view_all` e SEM responsabilidade sobre o
-- lead (a) vincular uma conversa a esse lead e (b) LER O NOME dele na lista social
-- — nome que a policy de `leads` esconde dele. O `lead_id` para montar o ataque é
-- público o bastante: `get_whatsapp_conversation_list` já o entrega.
--
-- ESPELHO, e não predicado novo: se a regra de visibilidade de lead mudar, ela tem
-- de mudar num lugar só. Qualquer divergência aqui vira furo silencioso, porque a
-- RLS não opina dentro de DEFINER.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_link_or_read_lead(p_lead_id uuid, p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.leads l
     WHERE l.id = p_lead_id
       AND l.organization_id = p_org
       AND l.deleted_at IS NULL
       AND (
         COALESCE(public.is_master_user(), false)
         OR COALESCE(public.is_user_admin(), false)
         OR public.has_feature_permission('leads.view_all', l.organization_id)
         OR public.is_user_responsible(l.pre_sale_responsible_id, l.sale_responsible_id)
         OR public.can_see_lead_by_permissions(l.sdr_id, l.closer_id)
         OR public.is_user_responsible_in_any_pipe(l.id)
       )
  );
$fn$;

COMMENT ON FUNCTION public.can_link_or_read_lead(uuid, uuid) IS
  'Espelha a policy leads_select_by_responsibility_and_permissions para uso DENTRO '
  'de funções SECURITY DEFINER, que bypassam RLS. Sem ela, gate de org sozinho '
  'deixaria um vendedor vincular e LER o nome de um lead que a RLS esconde dele.';

CREATE OR REPLACE FUNCTION public.link_social_conversation_to_lead(
  p_org uuid,
  p_channel uuid,
  p_external_user_id text,
  p_lead_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_channel_type text;
  v_provider     text;
  v_actor        uuid;
  v_is_master    boolean := COALESCE(public.is_master_user(), false);
  v_identity_id  uuid;
  v_existing_id  uuid;
  v_existing_lead uuid;
  v_name         text;
  v_pic          text;
  v_seen         timestamptz;
  v_backfilled   integer;
BEGIN
  -- Gate 1 — org acessível.
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT v_is_master) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_channel IS NULL OR p_lead_id IS NULL
     OR COALESCE(btrim(p_external_user_id), '') = '' THEN
    RAISE EXCEPTION 'channel, external_user_id and lead are required'
      USING ERRCODE = '22023';
  END IF;

  -- Gate 2 — o canal é DESTA org. `messaging_channels` é lida aqui sob DEFINER
  -- (bypassa a RLS dela), então a verificação tem de ser EXPLÍCITA.
  SELECT mc.channel_type, mc.provider
    INTO v_channel_type, v_provider
    FROM public.messaging_channels mc
   WHERE mc.id = p_channel AND mc.organization_id = p_org;

  IF v_channel_type IS NULL THEN
    RAISE EXCEPTION 'forbidden: channel not in org' USING ERRCODE = '42501';
  END IF;

  -- Gate 3 — o lead é DESTA org, não está na lixeira, E QUEM CHAMA PODE VÊ-LO.
  --
  -- A visibilidade é parte do gate, não refinamento: esta função é DEFINER e
  -- bypassa a RLS de `leads`. Só conferir a org deixaria um vendedor vincular uma
  -- conversa a um lead que ele não enxerga — e, com o LEFT JOIN da lista, LER o
  -- nome dele depois. O `lead_id` para montar isso já sai de
  -- `get_whatsapp_conversation_list`.
  IF NOT public.can_link_or_read_lead(p_lead_id, p_org) THEN
    RAISE EXCEPTION 'forbidden: lead not in org' USING ERRCODE = '42501';
  END IF;

  -- O ator. NULL quando master sem team_member na org — ver o COMMENT de
  -- `linked_by`. O metadata do lead_history guarda o user_id nesse caso, para a
  -- trilha não ficar cega justo no ator mais poderoso.
  SELECT tm.id INTO v_actor
    FROM public.team_members tm
   WHERE tm.user_id = v_uid
     AND tm.organization_id = p_org
     AND tm.is_active = true
   LIMIT 1;

  -- Rótulos DERIVADOS: última mensagem RECEBIDA desta thread. `incoming` e não
  -- "última mensagem": numa linha de SAÍDA, sender_name/sender_profile_pic são a
  -- NOSSA conta — o mesmo cuidado do CTE `contact_identity` da lista.
  SELECT m.sender_name, m.sender_profile_pic, m."timestamp"
    INTO v_name, v_pic, v_seen
    FROM public.channel_messages m
   WHERE m.organization_id      = p_org
     AND m.messaging_channel_id = p_channel
     AND m.contact_external_id  = p_external_user_id
     AND m.direction            = 'incoming'
   ORDER BY m."timestamp" DESC
   LIMIT 1;

  -- Escrita da identidade. ON CONFLICT DO NOTHING + releitura, e não um SELECT
  -- antes do INSERT: entre o SELECT e o INSERT cabe outra transação, e o índice
  -- único é o único guarda desta fatia. Aqui a corrida termina no índice.
  INSERT INTO public.lead_social_identities (
    organization_id, lead_id, provider, channel_type, external_user_id,
    display_name, avatar_url, messaging_channel_id, linked_by, last_seen_at
  ) VALUES (
    p_org, p_lead_id, COALESCE(v_provider, 'notificame'), v_channel_type,
    btrim(p_external_user_id), v_name, v_pic, p_channel, v_actor, v_seen
  )
  ON CONFLICT (organization_id, channel_type, external_user_id) DO NOTHING
  RETURNING id INTO v_identity_id;

  IF v_identity_id IS NULL THEN
    SELECT si.id, si.lead_id INTO v_existing_id, v_existing_lead
      FROM public.lead_social_identities si
     WHERE si.organization_id  = p_org
       AND si.channel_type     = v_channel_type
       AND si.external_user_id = btrim(p_external_user_id);

    -- Já apontava para OUTRO lead. Não sobrescreve em silêncio: o front oferece
    -- abrir o lead atual ou desvincular. Sobrescrever seria roubo de conversa
    -- entre dois vendedores da mesma org, sem trilha.
    IF v_existing_lead IS DISTINCT FROM p_lead_id THEN
      RAISE EXCEPTION 'identity_already_linked:%', v_existing_lead
        USING ERRCODE = 'P0001';
    END IF;

    -- Já apontava para ESTE lead: idempotente. Reafirma canal e rótulos (o canal
    -- pode ter sido observado noutro lugar) e segue para o backfill, que é o que
    -- pode ter faltado.
    UPDATE public.lead_social_identities si
       SET messaging_channel_id = COALESCE(p_channel, si.messaging_channel_id),
           display_name         = COALESCE(v_name, si.display_name),
           avatar_url           = COALESCE(v_pic, si.avatar_url),
           last_seen_at         = GREATEST(COALESCE(v_seen, si.last_seen_at),
                                           COALESCE(si.last_seen_at, v_seen))
     WHERE si.id = v_existing_id;

    v_identity_id := v_existing_id;
  END IF;

  -- BACKFILL do cache. Só a DEFINER consegue: `authenticated` ficou com
  -- SELECT-only em `channel_messages` desde 20270815104500 bloco 7 — não existe
  -- versão front-only desta fatia.
  --
  -- O recorte é por CANAIS DA ORG do MESMO TIPO, não pelo canal único: o IGSID é
  -- page-scoped, mas quando o mesmo id aparece em dois canais da org é a mesma
  -- pessoa, e a identidade é chaveada por (org, tipo, id) — o cache tem de
  -- obedecer à mesma chave, senão ele diverge da fonte da verdade.
  UPDATE public.channel_messages m
     SET lead_id = p_lead_id
   WHERE m.organization_id     = p_org
     AND m.contact_external_id = btrim(p_external_user_id)
     AND m.messaging_channel_id IN (
       SELECT mc.id FROM public.messaging_channels mc
        WHERE mc.organization_id = p_org
          AND mc.channel_type    = v_channel_type
     )
     AND m.lead_id IS DISTINCT FROM p_lead_id;

  GET DIAGNOSTICS v_backfilled = ROW_COUNT;

  INSERT INTO public.lead_history (
    lead_id, organization_id, action, description, created_by, source, metadata
  ) VALUES (
    p_lead_id, p_org, 'social_identity_linked',
    'Conversa de ' || v_channel_type || ' vinculada a este lead',
    v_uid, 'manual',
    jsonb_build_object(
      'channel_type', v_channel_type,
      'external_user_id', btrim(p_external_user_id),
      'messaging_channel_id', p_channel,
      'identity_id', v_identity_id,
      'handle', NULL,
      'messages_backfilled', v_backfilled,
      -- Trilha do ator quando ele é master sem team_member na org: `linked_by`
      -- fica NULL e este campo é a única resposta para "quem fez isso?".
      'master_user_id', CASE WHEN v_actor IS NULL THEN v_uid ELSE NULL END
    )
  );

  RETURN v_identity_id;
END;
$function$;

COMMENT ON FUNCTION public.link_social_conversation_to_lead(uuid, uuid, text, uuid) IS
  'Vincula uma conversa social a um lead JÁ EXISTENTE. Ato de HUMANO autenticado '
  '— a org vem do auth context e p_org é conferido contra ele, nunca confiado. '
  'TRÊS gates (org acessível, canal na org, lead na org e fora da lixeira), todos '
  '42501. Não exige feature permission: não existe chave ''leads.edit'' semeada, '
  'e inventar chave nova é outra fatia. Faz o BACKFILL de channel_messages.lead_id '
  'na thread inteira — só a DEFINER consegue, porque authenticated é SELECT-only '
  'naquela tabela desde 20270815104500. Idempotente para o MESMO lead; para OUTRO '
  'lead levanta identity_already_linked:<lead_id> (P0001) em vez de sobrescrever, '
  'que seria roubo de conversa sem trilha.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CRIAR e VINCULAR — UM ATO SÓ, NO SERVIDOR.
--
--    POR QUE NÃO `useCreateLead` no front seguido de um link: dois vendedores na
--    mesma conversa (ou dois cliques) produziriam DOIS leads e um órfão, e NÃO
--    EXISTE unique em `leads` que pegue isso — `idx_leads_org_phone_unique` é
--    PARCIAL em `normalized_phone`, e um lead de Instagram não tem telefone. O
--    ÚNICO guarda de unicidade desta fatia é `uq_lead_social_identities_org_identity`;
--    portanto o INSERT do lead TEM de estar na MESMA transação do INSERT da
--    identidade, senão o guarda não guarda nada.
--
--    O LEAD ENTRA EM FUNIL, E QUEM DECIDE É ESTA RPC — NÃO O TRIGGER. Lead
--    invisível é pior que lead sem telefone: é a patologia "feature construída e
--    nunca ligada". `SET LOCAL app.skip_default_pipe='1'` + INSERT explícito da
--    entry, na MESMA transação — o padrão de `import_lead_into_custom_pipeline`.
--    Sem o GUC, `trg_auto_assign_lead_default_pipe` (CONSTRAINT TRIGGER AFTER
--    INSERT DEFERRABLE INITIALLY DEFERRED) semeia whatsapp/novo NO COMMIT, e
--    qualquer insert em statement separado perde a corrida.
--
--    O LEAD NASCE COM:
--      name  — obrigatório e não-vazio. O front pré-preenche com display_name >
--              @handle > 'Instagram <últimos 6>' e deixa EDITÁVEL; o IGSID cru
--              nunca vira nome;
--      phone — NULL, e NUNCA `''`. `normalizePhone('')` devolve `''`, e `''` casa
--              com `''`: todos os contatos de IG colapsariam num só. Mesmo ⚠️ já
--              escrito em `buildInboundChannelMessageRow`;
--      origin — 'instagram', valor que JÁ existe no enum lead_origin desde o
--              baseline (L368). Não é vocabulário novo, e é ele que permite
--              segmentar/excluir esses leads dos disparos por origem;
--      is_shadow — false. `shadow` é vocabulário do Copilot (criação automática
--              invisível); aqui houve um humano.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_lead_from_social_conversation(
  p_org uuid,
  p_channel uuid,
  p_external_user_id text,
  p_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_company text DEFAULT NULL,
  p_destination text DEFAULT 'qualificacao',
  p_campanha_id uuid DEFAULT NULL,
  p_custom_pipeline_id uuid DEFAULT NULL,
  p_custom_stage_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_channel_type text;
  v_provider     text;
  v_actor        uuid;
  v_is_master    boolean := COALESCE(public.is_master_user(), false);
  v_ext          text := btrim(COALESCE(p_external_user_id, ''));
  v_name         text := btrim(COALESCE(p_name, ''));
  v_dest         text := COALESCE(NULLIF(btrim(COALESCE(p_destination, '')), ''), 'qualificacao');
  v_slug         text;
  v_pipeline_id  uuid;
  v_stage_key    text;
  v_stage_id     uuid;
  v_lead_id      uuid;
  v_identity_id  uuid;
  v_existing_lead uuid;
  v_disp_name    text;
  v_pic          text;
  v_seen         timestamptz;
  v_backfilled   integer;
BEGIN
  -- Gate 1 — org acessível.
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT v_is_master) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_channel IS NULL OR v_ext = '' THEN
    RAISE EXCEPTION 'channel and external_user_id are required' USING ERRCODE = '22023';
  END IF;

  -- Nome obrigatório NO SERVIDOR. O front pré-preenche, mas um cliente que mande
  -- '' ou '   ' produziria um lead sem rótulo — irreconhecível em qualquer lista.
  IF v_name = '' THEN
    RAISE EXCEPTION 'name is required' USING ERRCODE = '22023';
  END IF;

  IF v_dest NOT IN ('qualificacao', 'confirmacao', 'propostas', 'campanha', 'custom', 'none') THEN
    RAISE EXCEPTION 'unknown destination: %', v_dest USING ERRCODE = '22023';
  END IF;

  -- Gate 2 — o canal é DESTA org.
  SELECT mc.channel_type, mc.provider
    INTO v_channel_type, v_provider
    FROM public.messaging_channels mc
   WHERE mc.id = p_channel AND mc.organization_id = p_org;

  IF v_channel_type IS NULL THEN
    RAISE EXCEPTION 'forbidden: channel not in org' USING ERRCODE = '42501';
  END IF;

  -- Gate 4 — CRIAR exige a chave real de permissão, semeada em
  -- supabase/seed.sql:268, que hoje só é checada NO CLIENTE (useCanDo). Vincular
  -- não exige (não há chave equivalente). ⚠️ Isto é MAIS restritivo que o mundo
  -- de hoje: a policy `leads_insert_organization` não checa papel nenhum, então
  -- uma org que desligou "Criar lead" para um membro vai ver o botão falhar AQUI
  -- e continuar funcionando no LeadModal. É inconsistência REAL do produto que
  -- esta fatia EXPÕE — o lado certo de expô-la é o servidor, não o cliente.
  IF NOT COALESCE(public.has_feature_permission('leads.create', p_org), false) THEN
    RAISE EXCEPTION 'forbidden: leads.create' USING ERRCODE = '42501';
  END IF;

  -- A identidade já existe? Então esta conversa JÁ TEM lead, e criar um segundo
  -- seria a duplicata que a chave única existe para impedir.
  SELECT si.lead_id INTO v_existing_lead
    FROM public.lead_social_identities si
   WHERE si.organization_id  = p_org
     AND si.channel_type     = v_channel_type
     AND si.external_user_id = v_ext;

  IF v_existing_lead IS NOT NULL THEN
    RAISE EXCEPTION 'identity_already_linked:%', v_existing_lead USING ERRCODE = 'P0001';
  END IF;

  SELECT tm.id INTO v_actor
    FROM public.team_members tm
   WHERE tm.user_id = v_uid
     AND tm.organization_id = p_org
     AND tm.is_active = true
   LIMIT 1;

  -- Rótulos derivados da última mensagem RECEBIDA (ver o bloco 4).
  SELECT m.sender_name, m.sender_profile_pic, m."timestamp"
    INTO v_disp_name, v_pic, v_seen
    FROM public.channel_messages m
   WHERE m.organization_id      = p_org
     AND m.messaging_channel_id = p_channel
     AND m.contact_external_id  = v_ext
     AND m.direction            = 'incoming'
   ORDER BY m."timestamp" DESC
   LIMIT 1;

  -- ── Destino: RESOLVIDO ANTES de o lead nascer ───────────────────────────────
  -- Resolver depois deixaria o lead criado e o funil não — o lead invisível que
  -- esta RPC existe para não produzir. Falhar aqui aborta a transação inteira e
  -- não deixa nada meio-feito.
  IF v_dest IN ('qualificacao', 'confirmacao', 'propostas') THEN
    v_slug := CASE v_dest
                WHEN 'qualificacao' THEN 'whatsapp'
                WHEN 'confirmacao'  THEN 'confirmacao'
                ELSE 'propostas'
              END;

    SELECT p.id INTO v_pipeline_id
      FROM public.pipelines p
     WHERE p.organization_id = p_org
       AND p.type = 'system'  -- metric-lint-allow: seed de funil, não métrica
       AND p.slug = v_slug
       AND p.is_active = true
     LIMIT 1;

    IF v_pipeline_id IS NULL THEN
      RAISE EXCEPTION 'destination_unavailable:%', v_dest USING ERRCODE = 'P0001';
    END IF;

    -- Primeira etapa ATIVA do funil, dinâmica (pipeline_stages) — mesma leitura
    -- de `getFirstStageKey` no front. Sem fallback chumbado: se a org não tem
    -- etapa ativa, o card nasceria numa etapa que a tela não desenha.
    SELECT ps.stage_key INTO v_stage_key
      FROM public.pipeline_stages ps
     WHERE ps.organization_id = p_org
       AND ps.pipeline_type   = v_slug
       AND ps.is_active       = true
     ORDER BY ps."position" ASC
     LIMIT 1;

    IF v_stage_key IS NULL THEN
      RAISE EXCEPTION 'destination_unavailable:%', v_dest USING ERRCODE = 'P0001';
    END IF;

  ELSIF v_dest = 'campanha' THEN
    IF p_campanha_id IS NULL THEN
      RAISE EXCEPTION 'campanha_id required for destination campanha' USING ERRCODE = '22023';
    END IF;
    -- Guard de tenant no PARÂMETRO: sem ele, um uuid de campanha de outra org
    -- colocaria o lead no funil do vizinho.
    IF NOT EXISTS (
      SELECT 1 FROM public.campanhas c
       WHERE c.id = p_campanha_id AND c.organization_id = p_org
    ) THEN
      RAISE EXCEPTION 'forbidden: campanha not in org' USING ERRCODE = '42501';
    END IF;

    SELECT cs.id INTO v_stage_id
      FROM public.campanha_stages cs
     WHERE cs.campanha_id = p_campanha_id
     ORDER BY cs."position" ASC
     LIMIT 1;

    IF v_stage_id IS NULL THEN
      RAISE EXCEPTION 'destination_unavailable:campanha' USING ERRCODE = 'P0001';
    END IF;

  ELSIF v_dest = 'custom' THEN
    IF p_custom_pipeline_id IS NULL OR p_custom_stage_id IS NULL THEN
      RAISE EXCEPTION 'custom pipeline and stage required' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.custom_pipelines cp
       WHERE cp.id = p_custom_pipeline_id
         AND cp.organization_id = p_org
         AND cp.is_active = true
    ) THEN
      RAISE EXCEPTION 'forbidden: custom pipeline not in org' USING ERRCODE = '42501';
    END IF;
    -- Guard de integridade: a etapa tem de ser DESTE funil.
    IF NOT EXISTS (
      SELECT 1 FROM public.custom_pipeline_stages cps
       WHERE cps.id = p_custom_stage_id
         AND cps.pipeline_id = p_custom_pipeline_id
    ) THEN
      RAISE EXCEPTION 'stage does not belong to pipeline' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Escopo `true` = LOCAL: vale até o fim DESTA transação e não vaza para a
  -- próxima query da mesma conexão (o pooler reusa conexão entre requests).
  -- Vale também para v_dest='none': quem escolheu "nenhum funil" não pode ser
  -- desmentido pelo trigger no COMMIT.
  -- ── DEDUP POR TELEFONE, ANTES DE TENTAR CRIAR ──────────────────────────────
  --
  -- `idx_leads_org_phone_unique (organization_id, normalized_phone) WHERE
  -- deleted_at IS NULL` dispara 23505 e ABORTA A TRANSAÇÃO INTEIRA — nem lead nem
  -- identidade nascem. E o lead que bloqueia pode ser `is_shadow`, que o picker
  -- NUNCA mostra (`useLeads` filtra shadow): o vendedor ficaria num beco, sem
  -- conseguir criar e sem enxergar o que impede.
  --
  -- Em vez de deixar o índice falar por erro cru do Postgres, ADOTAMOS o lead que
  -- já existe: é o mesmo ser humano, e o gêmeo de WhatsApp
  -- (`useWhatsAppLeadIntegration`) faz exatamente isso. A identidade social é então
  -- vinculada a ele, e o shadow é promovido — que é o efeito desejado de alguém
  -- ter finalmente conversado com aquele contato.
  IF NULLIF(btrim(COALESCE(p_phone, '')), '') IS NOT NULL THEN
    SELECT l.id INTO v_lead_id
      FROM public.leads l
     WHERE l.organization_id  = p_org
       AND l.deleted_at IS NULL
       -- ⚠️ `normalize_brazilian_phone` e não normalização própria: é EXATAMENTE a
       -- função que o trigger `trigger_normalize_lead_phone` usa para gravar
       -- `normalized_phone`. Normalizar diferente aqui faria a busca NÃO achar o
       -- lead que o índice único barra segundos depois — dedup falhando em
       -- silêncio e 23505 cru na cara do vendedor.
       AND l.normalized_phone = public.normalize_brazilian_phone(btrim(p_phone))
     LIMIT 1;

    IF v_lead_id IS NOT NULL THEN
      -- Promove shadow: o contato deixou de ser hipótese quando alguém falou com ele.
      UPDATE public.leads
         SET is_shadow = false,
             updated_at = now()
       WHERE id = v_lead_id
         AND is_shadow IS TRUE;

      -- Reusa o caminho de vínculo, que já carrega gate de visibilidade, backfill
      -- do histórico e trilha. Duas escritas do mesmo vínculo em lugares
      -- diferentes divergiriam.
      RETURN public.link_social_conversation_to_lead(
        p_org, p_channel, p_external_user_id, v_lead_id
      );
    END IF;
  END IF;

  PERFORM set_config('app.skip_default_pipe', '1', true);

  INSERT INTO public.leads (
    organization_id, name, company, email, phone, origin,
    responsible_id, sdr_id, is_shadow, notes
  ) VALUES (
    p_org,
    v_name,
    NULLIF(btrim(COALESCE(p_company, '')), ''),
    NULLIF(btrim(COALESCE(p_email, '')), ''),
    -- ⚠️ NULLIF, e não COALESCE(...,''): string vazia aqui colapsaria todos os
    -- contatos de Instagram da org num único lead por normalized_phone.
    NULLIF(btrim(COALESCE(p_phone, '')), ''),
    'instagram',
    v_actor,
    v_actor,
    false,
    'Lead criado a partir de conversa do ' || initcap(v_channel_type)
  )
  RETURNING id INTO v_lead_id;

  -- ── A entry, na MESMA transação ─────────────────────────────────────────────
  IF v_dest IN ('qualificacao', 'confirmacao', 'propostas') THEN
    -- `pipeline_entries` direto, e não a view `pipe_*`: a view é uma projeção que
    -- lê responsável de dentro do metadata. Escrever na tabela com o metadata
    -- montado é o mesmo dado, sem depender do INSTEAD OF.
    INSERT INTO public.pipeline_entries (
      organization_id, pipeline_id, lead_id, stage_key, assigned_to,
      metadata, entered_at, stage_changed_at
    ) VALUES (
      p_org, v_pipeline_id, v_lead_id, v_stage_key, v_actor,
      jsonb_strip_nulls(jsonb_build_object(
        'responsible_id', v_actor,
        'sdr_id',         CASE WHEN v_dest <> 'propostas' THEN v_actor END,
        'closer_id',      CASE WHEN v_dest =  'propostas' THEN v_actor END,
        -- ⚠️ EXPLÍCITO, e não deixado para o trigger. `pipeline_entries_snapshot_responsibles`
        -- faz RETURN NEW assim que QUALQUER uma das quatro chaves de responsável já
        -- está no metadata — e `responsible_id` acima já está. Logo ele nunca
        -- preenche `sale_responsible_id`, e a view `pipe_propostas` lê justamente
        -- essa coluna. Sem isto, o card nasce com o slot de responsável de venda
        -- VAZIO e o negócio some das métricas e comissões por vendedor, que leem
        -- `sale_responsible_id`. O caminho de WhatsApp e o CreateOpportunityModal
        -- setam explicitamente pelo mesmo motivo.
        'sale_responsible_id', CASE WHEN v_dest = 'propostas' THEN v_actor END,
        'created_from',   'social_conversation'
      )),
      now(), now()
    );

  ELSIF v_dest = 'campanha' THEN
    INSERT INTO public.campanha_leads (
      campanha_id, lead_id, stage_id, sdr_id, responsible_id
    ) VALUES (
      p_campanha_id, v_lead_id, v_stage_id, v_actor, v_actor
    );

  ELSIF v_dest = 'custom' THEN
    INSERT INTO public.custom_pipe_entries (
      organization_id, pipeline_id, lead_id, stage_id, assigned_to,
      entered_at, stage_changed_at
    ) VALUES (
      p_org, p_custom_pipeline_id, v_lead_id, p_custom_stage_id, v_actor,
      now(), now()
    );
  END IF;

  -- ── A identidade, na MESMA transação ────────────────────────────────────────
  -- Sem ON CONFLICT: aqui um 23505 é a CORRIDA sendo vencida pelo índice (dois
  -- cliques simultâneos), e o desfecho certo é abortar a transação inteira —
  -- inclusive o lead que ela acabou de criar. Engolir o conflito deixaria um lead
  -- órfão, que é exatamente o dano que a transação única existe para impedir.
  INSERT INTO public.lead_social_identities (
    organization_id, lead_id, provider, channel_type, external_user_id,
    display_name, avatar_url, messaging_channel_id, linked_by, last_seen_at
  ) VALUES (
    p_org, v_lead_id, COALESCE(v_provider, 'notificame'), v_channel_type, v_ext,
    v_disp_name, v_pic, p_channel, v_actor, v_seen
  )
  RETURNING id INTO v_identity_id;

  UPDATE public.channel_messages m
     SET lead_id = v_lead_id
   WHERE m.organization_id     = p_org
     AND m.contact_external_id = v_ext
     AND m.messaging_channel_id IN (
       SELECT mc.id FROM public.messaging_channels mc
        WHERE mc.organization_id = p_org
          AND mc.channel_type    = v_channel_type
     )
     AND m.lead_id IS DISTINCT FROM v_lead_id;

  GET DIAGNOSTICS v_backfilled = ROW_COUNT;

  INSERT INTO public.lead_history (
    lead_id, organization_id, action, description, created_by, source, metadata
  ) VALUES (
    v_lead_id, p_org, 'lead_created',
    'Lead criado a partir de conversa do ' || initcap(v_channel_type),
    v_uid, 'manual',
    jsonb_build_object(
      'channel_type', v_channel_type,
      'external_user_id', v_ext,
      'messaging_channel_id', p_channel,
      'destination', v_dest,
      'has_phone', (NULLIF(btrim(COALESCE(p_phone, '')), '') IS NOT NULL),
      'master_user_id', CASE WHEN v_actor IS NULL THEN v_uid ELSE NULL END
    )
  ), (
    v_lead_id, p_org, 'social_identity_linked',
    'Conversa de ' || v_channel_type || ' vinculada a este lead',
    v_uid, 'manual',
    jsonb_build_object(
      'channel_type', v_channel_type,
      'external_user_id', v_ext,
      'messaging_channel_id', p_channel,
      'identity_id', v_identity_id,
      'messages_backfilled', v_backfilled,
      'master_user_id', CASE WHEN v_actor IS NULL THEN v_uid ELSE NULL END
    )
  );

  RETURN v_lead_id;
END;
$function$;

COMMENT ON FUNCTION public.create_lead_from_social_conversation(uuid, uuid, text, text, text, text, text, text, uuid, uuid, uuid) IS
  'Cria o lead E a identidade social E a entry de funil numa ÚNICA transação, a '
  'partir de uma conversa social. Transação única não é elegância: o único guarda '
  'de unicidade desta fatia é uq_lead_social_identities_org_identity (um lead de '
  'Instagram não tem telefone, então idx_leads_org_phone_unique não cobre nada), e '
  'fora da transação dois cliques produziriam dois leads e um órfão. Usa o GUC '
  'app.skip_default_pipe (criado por 20270729000000) para que o CONSTRAINT TRIGGER '
  'DEFERRABLE não semeie whatsapp/novo no COMMIT por cima do destino escolhido. '
  'QUATRO gates: org acessível, canal na org, campanha/funil custom na org, e '
  'has_feature_permission(''leads.create'') — o único ponto do produto onde essa '
  'chave é conferida no SERVIDOR. phone NULL e nunca '''' (string vazia colapsa '
  'todos os contatos de IG num lead só via normalized_phone). origin=''instagram'', '
  'valor que já existe no enum lead_origin desde o baseline.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. DESVINCULAR — correção de erro.
--
--    Existe porque vincular a conversa errada é o erro humano MAIS provável desta
--    tela, e sem saída pela UI a correção viraria ticket de suporte com UPDATE
--    manual em produção. O lead NÃO é apagado: desvincular é desfazer o vínculo,
--    não a criação.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unlink_social_conversation_from_lead(
  p_org uuid,
  p_channel uuid,
  p_external_user_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_channel_type text;
  v_is_master    boolean := COALESCE(public.is_master_user(), false);
  v_actor        uuid;
  v_ext          text := btrim(COALESCE(p_external_user_id, ''));
  v_lead_id      uuid;
  v_identity_id  uuid;
BEGIN
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT v_is_master) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_channel IS NULL OR v_ext = '' THEN
    RAISE EXCEPTION 'channel and external_user_id are required' USING ERRCODE = '22023';
  END IF;

  SELECT mc.channel_type INTO v_channel_type
    FROM public.messaging_channels mc
   WHERE mc.id = p_channel AND mc.organization_id = p_org;

  IF v_channel_type IS NULL THEN
    RAISE EXCEPTION 'forbidden: channel not in org' USING ERRCODE = '42501';
  END IF;

  SELECT tm.id INTO v_actor
    FROM public.team_members tm
   WHERE tm.user_id = v_uid
     AND tm.organization_id = p_org
     AND tm.is_active = true
   LIMIT 1;

  DELETE FROM public.lead_social_identities si
   WHERE si.organization_id  = p_org
     AND si.channel_type     = v_channel_type
     AND si.external_user_id = v_ext
  RETURNING si.id, si.lead_id INTO v_identity_id, v_lead_id;

  -- Nada vinculado: SUCESSO SILENCIOSO, e de propósito. Desvincular é a operação
  -- cujo desfecho desejado é "não está mais vinculado" — levantar erro faria o
  -- duplo clique virar toast vermelho num estado que já é o pedido.
  IF v_identity_id IS NULL THEN
    RETURN;
  END IF;

  -- O cache volta a NULL. `lead_id = v_lead_id` no predicado para não zerar uma
  -- linha que outro vínculo (outro lead, mesmo canal) tenha preenchido.
  UPDATE public.channel_messages m
     SET lead_id = NULL
   WHERE m.organization_id     = p_org
     AND m.contact_external_id = v_ext
     AND m.lead_id             = v_lead_id
     AND m.messaging_channel_id IN (
       SELECT mc.id FROM public.messaging_channels mc
        WHERE mc.organization_id = p_org
          AND mc.channel_type    = v_channel_type
     );

  INSERT INTO public.lead_history (
    lead_id, organization_id, action, description, created_by, source, metadata
  ) VALUES (
    v_lead_id, p_org, 'social_identity_unlinked',
    'Conversa de ' || v_channel_type || ' desvinculada deste lead',
    v_uid, 'manual',
    jsonb_build_object(
      'channel_type', v_channel_type,
      'external_user_id', v_ext,
      'messaging_channel_id', p_channel,
      'identity_id', v_identity_id,
      'master_user_id', CASE WHEN v_actor IS NULL THEN v_uid ELSE NULL END
    )
  );
END;
$function$;

COMMENT ON FUNCTION public.unlink_social_conversation_from_lead(uuid, uuid, text) IS
  'Desfaz o vínculo entre conversa social e lead. NÃO apaga o lead — desvincular '
  'corrige o vínculo, não a criação. Mesmos gates de org e canal das irmãs. '
  'Sucesso SILENCIOSO quando não há nada vinculado: o desfecho pedido já é o '
  'estado atual, e erro ali transformaria duplo clique em toast vermelho. Devolve '
  'channel_messages.lead_id a NULL só nas linhas que apontavam para ESTE lead.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. A lista de conversas passa a ler o vínculo da IDENTIDADE.
--
--    ⚠️ POR QUE ISTO É OBRIGATÓRIO, E NÃO ENFEITE: hoje a lista devolve `t.lid` —
--    o `lead_id` da ÚLTIMA MENSAGEM. O writer do inbound grava `lead_id` NULO.
--    Sem esta troca, o vínculo APARECERIA na tela e SUMIRIA na próxima mensagem
--    recebida, porque a "última mensagem" passaria a ser uma linha nova com o
--    cache ainda não preenchido. A identidade é a fonte da verdade; a coluna é
--    cache.
--
--    `lead_name` entra no RETURNS TABLE, e não vira uma segunda query no front,
--    porque o dado já está no JOIN — uma query a mais por conversa seria fanout
--    para servir um badge.
--
--    `l.deleted_at IS NULL` no JOIN: a lixeira NÃO apaga a linha de `leads`. Sem
--    o filtro, a conversa continuaria exibindo um lead que o usuário mandou para
--    o lixo — e o `lead_id` devolvido abriria uma ficha fantasma.
--
--    DROP + CREATE, e não CREATE OR REPLACE: mudar o RETURNS TABLE de uma função
--    existente é 42P13. ⚠️ E o DROP LEVA OS GRANTS JUNTO — ver o bloco 8.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_social_conversation_list(uuid, uuid, integer, timestamptz);

CREATE OR REPLACE FUNCTION public.get_social_conversation_list(
  p_org uuid,
  p_channel uuid,
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE(
  contact_external_id text,
  sender_name text,
  sender_profile_pic text,
  last_message text,
  last_message_time timestamptz,
  last_message_direction text,
  unread_count integer,
  lead_id uuid,
  lead_name text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_channel_type text;
BEGIN
  -- Gate 1 — acesso: team_member ativo da org OU master ativo (ghost cross-org).
  -- Forma idêntica à de get_whatsapp_conversation_list (20270811000011).
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_channel IS NULL THEN
    RAISE EXCEPTION 'channel required' USING ERRCODE = '22023';
  END IF;

  -- Gate 2 — tenancy DO ARGUMENTO: o canal tem que ser DA org pedida. Sem este
  -- gate, um membro legítimo da org A leria a caixa de Instagram da org B só
  -- passando o uuid do canal dela. `messaging_channels` é lida aqui sob DEFINER
  -- (bypassa a RLS dela), então a verificação tem que ser explícita.
  --
  -- O tipo do canal sai DESTE mesmo SELECT e alimenta o JOIN da identidade —
  -- 'instagram' não é chumbado no join para que o dia do Messenger não exija
  -- reescrever esta função.
  SELECT mc.channel_type INTO v_channel_type
    FROM public.messaging_channels mc
   WHERE mc.id = p_channel AND mc.organization_id = p_org;

  IF v_channel_type IS NULL THEN
    RAISE EXCEPTION 'forbidden: channel not in org' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH thread AS (
    -- A última mensagem de cada interlocutor. Casa exatamente com
    -- idx_channel_messages_social_thread.
    --
    -- ⚠️ `m.lead_id` NÃO é lido aqui de propósito (era o `t.lid` da versão
    -- anterior): é CACHE, e cache que nasce nulo em toda linha nova apagaria o
    -- vínculo da tela a cada mensagem recebida.
    SELECT DISTINCT ON (m.contact_external_id)
           m.contact_external_id  AS cid,
           m.content              AS body,
           m."timestamp"          AS ts,
           m.direction            AS dir
      FROM public.channel_messages m
     WHERE m.organization_id      = p_org
       AND m.messaging_channel_id = p_channel
       AND m.contact_external_id IS NOT NULL
     ORDER BY m.contact_external_id, m."timestamp" DESC
  ),
  contact_identity AS (
    -- ⚠️ NOME E AVATAR SAEM DA ÚLTIMA MENSAGEM **RECEBIDA**, NÃO DA ÚLTIMA
    -- MENSAGEM. `sender_name`/`sender_profile_pic` descrevem QUEM MANDOU aquela
    -- linha: numa mensagem de SAÍDA eles são a NOSSA conta. Tirar a identidade do
    -- contato da última mensagem faria toda conversa JÁ RESPONDIDA aparecer na
    -- lista com o nome e o avatar da própria org — a mesma classe de defeito que
    -- `contact_external_id` existe para evitar no agrupamento (ver o COMMENT da
    -- coluna e o defeito vivo de useMetaMessages).
    --
    -- Hoje isso é LATENTE: esta fatia é inbound-only, então a última mensagem é
    -- sempre `incoming` e as duas leituras coincidem. Ele acorda no dia em que o
    -- outbound da fatia 3 gravar a primeira linha — e aí seria retrofit em dado de
    -- conversa. Custa um CTE agora.
    --
    -- Thread só-outbound (fatia 3, quando NÓS iniciamos): devolve NULL, e NULL é a
    -- resposta honesta. O front já cai para o handle do canal e, na falta dele,
    -- para 'Instagram <últimos 6 do id>' — nunca para o nome da org.
    SELECT DISTINCT ON (m.contact_external_id)
           m.contact_external_id  AS cid,
           m.sender_name          AS s_name,
           m.sender_profile_pic   AS s_pic
      FROM public.channel_messages m
     WHERE m.organization_id      = p_org
       AND m.messaging_channel_id = p_channel
       AND m.contact_external_id IS NOT NULL
       AND m.direction            = 'incoming'
     ORDER BY m.contact_external_id, m."timestamp" DESC
  ),
  unread AS (
    -- Chave de leitura MONTADA, não fatiada. get_whatsapp_conversation_list usa
    -- `split_part(conversation_key, ':', 3)`, que só é seguro lá porque telefone
    -- não contém ':'. Um id de usuário de rede social é opaco: montar a chave e
    -- comparar inteira é correto mesmo se o id tiver ':' no meio.
    SELECT m.contact_external_id AS cid, count(*)::integer AS cnt
      FROM public.channel_messages m
      LEFT JOIN public.conversation_read_state rs
             ON rs.organization_id  = p_org
            AND rs.user_id          = v_uid
            AND rs.conversation_key = 'instagram:' || p_channel::text || ':'
                                      || m.contact_external_id
     WHERE m.organization_id      = p_org
       AND m.messaging_channel_id = p_channel
       AND m.contact_external_id IS NOT NULL
       AND m.direction            = 'incoming'
       AND m."timestamp" > COALESCE(rs.last_read_at, now() - interval '7 days')
     GROUP BY m.contact_external_id
  )
  SELECT t.cid,
         ci.s_name,
         ci.s_pic,
         t.body,
         t.ts,
         t.dir,
         COALESCE(u.cnt, 0)::integer,
         -- `l.id`, e NÃO `si.lead_id`: se o lead foi para a lixeira, o JOIN de
         -- `leads` não casa e as DUAS colunas saem nulas juntas. Devolver
         -- `si.lead_id` aqui daria um id sem nome — e um clique numa ficha
         -- fantasma.
         l.id,
         l.name
    FROM thread t
    LEFT JOIN contact_identity ci ON ci.cid = t.cid
    LEFT JOIN unread u ON u.cid = t.cid
    -- A FONTE DA VERDADE do vínculo. Por org + tipo, não por canal: o IGSID é
    -- page-scoped, e a identidade é chaveada exatamente assim.
    LEFT JOIN public.lead_social_identities si
           ON si.organization_id  = p_org
          AND si.channel_type     = v_channel_type
          AND si.external_user_id = t.cid
    -- O nome do lead só aparece para quem PODE VÊ-LO. Esta RPC é DEFINER: sem o
    -- predicado, o JOIN entregaria nome de lead que a RLS de `leads` esconde
    -- deste usuário. `lead_id` continua saindo (a UI precisa saber que existe
    -- vínculo); o que o predicado protege é o NOME.
    LEFT JOIN public.leads l
           ON l.id = si.lead_id
          AND l.deleted_at IS NULL
          AND public.can_link_or_read_lead(l.id, p_org)
   -- p_before é cursor sobre a CONVERSA (a última mensagem dela), não filtro sobre
   -- as mensagens: aplicado dentro do DISTINCT ON, ele mudaria QUAL mensagem é a
   -- última de cada thread em vez de paginar a lista.
   WHERE p_before IS NULL OR t.ts < p_before
   ORDER BY t.ts DESC
   LIMIT v_limit;
END;
$function$;

COMMENT ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz) IS
  'Lista de conversas de um canal social (Instagram) para o inbox. Caminho '
  'PARALELO ao de WhatsApp: get_whatsapp_conversation_list, '
  'whatsapp_conversation_summary e o trigger que a alimenta ficam byte-a-byte '
  'intactos. DOIS gates: org acessível (42501) e p_channel pertencente a p_org '
  '(42501) — o segundo é o que fecha o vetor de RPC DEFINER com recorte por '
  'parâmetro do cliente. Sem os 14 filtros do irmão de WhatsApp de propósito: o '
  'front oculta esses controles na caixa de IG em vez de mostrá-los inertes. '
  'sender_name/sender_profile_pic saem da última mensagem RECEBIDA, não da última '
  'mensagem: numa linha de saída esses campos são a nossa conta, e a lista '
  'mostraria o nome da própria org em toda conversa já respondida. ⚠️ lead_id sai '
  'de lead_social_identities (LEFT JOIN), NUNCA mais de channel_messages.lead_id: '
  'aquela coluna é cache derivado e nasce NULA em toda linha nova, então ler o '
  'vínculo dela fazia o lead sumir da lista na próxima mensagem recebida.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Grants — das QUATRO funções.
--
--    `CREATE [OR REPLACE] FUNCTION` reconcede EXECUTE a PUBLIC (default do
--    Postgres) e a `anon` (default privilege do Supabase no schema public). Já
--    aconteceu neste repo — 20260727140438 existe exatamente por isso.
--
--    ⚠️ `get_social_conversation_list` PRECISA aparecer aqui mesmo já tendo grants
--    antes: o DROP do bloco 7 os APAGOU. Esquecer é silencioso das duas maneiras —
--    a lista continua funcionando para `authenticated` (o REVOKE/GRANT do CREATE
--    já lhe dá acesso via PUBLIC) e ganha superfície para `anon` sem ninguém notar.
--
--    ⚠️ AS TRÊS FUNÇÕES NOVAS TAMBÉM REVOGAM `service_role`, E O REVOKE É
--    NECESSÁRIO — não é decoração. MEDIDO em banco local: revogar só de
--    `PUBLIC, anon` deixa `service_role` COM EXECUTE, porque o Supabase mantém
--    `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO ... service_role`
--    no schema public — o grant nasce junto com a função e nenhum REVOKE de
--    PUBLIC o alcança. (Mesma família do incidente da tabela de backup que nasceu
--    legível por `anon` neste repo: default privilege não é revogado por tabela.)
--
--    E por que revogar: nenhum caminho de SERVIDOR deve criar ou vincular lead
--    social. Com `auth.uid()` nulo elas já levariam 42501 no gate 1 — o grant
--    ausente é a SEGUNDA camada, para que uma edge function não passe a chamá-las
--    por descuido e reabra pela porta de trás o caminho que a decisão de "quem
--    cria é o humano" fechou pela frente. A lista continua com `service_role`
--    (leitura, e ela já tinha).
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ `can_link_or_read_lead` É A QUINTA FUNÇÃO, e ela NÃO tem grant nenhum de
--    propósito. Quem a chama são as DEFINER deste arquivo, que rodam como owner —
--    nenhum papel do PostgREST precisa executá-la. Sem este REVOKE ela nasceria
--    executável por PUBLIC, `anon` e `service_role` (o mesmo default privilege
--    descrito acima) e viraria um ORÁCULO: `can_link_or_read_lead(<lead>, <org>)`
--    responde, com um booleano, se aquele lead existe naquela org e está fora da
--    lixeira — fora de qualquer gate, e para um id que outras RPCs já entregam.
--    É a família de furo já catalogada neste repo em RPC DEFINER que recorta por
--    parâmetro do cliente.
REVOKE ALL ON FUNCTION public.can_link_or_read_lead(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.link_social_conversation_to_lead(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.link_social_conversation_to_lead(uuid, uuid, text, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.create_lead_from_social_conversation(uuid, uuid, text, text, text, text, text, text, uuid, uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_lead_from_social_conversation(uuid, uuid, text, text, text, text, text, text, uuid, uuid, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.unlink_social_conversation_from_lead(uuid, uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.unlink_social_conversation_from_lead(uuid, uuid, text)
  TO authenticated;

-- A recriada. Mesmos grants de antes do DROP (20270815104500 bloco 6).
REVOKE ALL ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz)
  TO service_role;
