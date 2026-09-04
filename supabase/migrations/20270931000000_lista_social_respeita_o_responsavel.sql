-- ============================================================================
-- A LISTA SOCIAL PASSA A RESPEITAR O RESPONSÁVEL (SCRUM-653 / W5 do SCRUM-648)
--
-- Medido em produção em 2026-09-04: das CINCO funções de lista de conversa,
-- `get_social_conversation_list` é a ÚNICA que não aplica `can_see_chat_scope`.
--
--   get_whatsapp_conversation_list                 → aplica
--   get_whatsapp_conversation_list_multi           → aplica
--   get_official_whatsapp_conversation_list        → aplica
--   get_official_whatsapp_conversation_list_multi  → aplica
--   get_social_conversation_list                   → NÃO aplica   ← aqui
--
-- Duas organizations têm `chat_restrict_to_owner` ligado, e uma delas
-- (Goletric Pinheiros) recebeu 10.609 mensagens de Instagram em 90 dias.
--
-- ⚠️ HOJE NINGUÉM ESTÁ EXPOSTO, e isso é medição, não otimismo: as duas orgs
--    estão com ZERO membros ativos, e `get_my_organization_ids()` filtra por
--    `is_active`. O furo é LATENTE — acorda no dia em que alguém reativar um
--    membro. Não é hotfix; também não é coisa que espera o Instagram entrar na
--    caixa unificada.
--
-- ─── POR QUE NÃO É COPIAR A CHAMADA DA IRMÃ ─────────────────────────────────
--
-- No WhatsApp o interlocutor é TELEFONE, e `can_see_chat_scope` casa o lead por
-- `normalized_phone` quando o `lead_id` da linha é nulo. No Instagram o
-- interlocutor é IGSID: não há telefone, e `channel_messages.lead_id` é cache
-- derivado que nasce nulo. O vínculo real mora em `lead_social_identities`, que
-- esta função já lê para trazer o nome do lead — o recorte reusa esse JOIN.
--
-- ⚠️ PROD ESTÁ MAIS VELHA QUE O PRÓPRIO LEDGER, e por isso esta migration faz
--    mais do que acrescentar um predicado. As cinco migrations que definem esta
--    função constam como aplicadas em prod, mas o objeto vivo lá tem OITO
--    colunas, enquanto o repo tem DEZ: faltam `contact_handle` e `lead_name`, e
--    falta o `can_link_or_read_lead` que protege o NOME do lead de quem não
--    pode vê-lo. O corpo abaixo é o do REPO — aplicar isto em produção também
--    devolve as duas colunas e aquela proteção. O front já lê `contact_handle`
--    (`toSocialContact`) e hoje recebe `undefined` de lá.
--
-- Fora isso: mesma assinatura de argumentos, mesmos gates de tenancy, mesmas
-- CTEs. A única mudança de lógica é a linha do `WHERE`.
-- ============================================================================

-- ⚠️ DROP + CREATE, e não CREATE OR REPLACE. Em produção esta função ainda tem
--    OITO colunas de retorno; o corpo abaixo tem DEZ, e o Postgres recusa a
--    troca com `42P13 cannot change return type of existing function`. Os
--    ARGUMENTOS são idênticos nas duas formas, então um DROP resolve as duas.
--
-- ⚠️ E DROP RESETA OS GRANTS. Neste repo isso já devolveu `EXECUTE` a `PUBLIC`
--    em silêncio (ver `20260727140438_inbox_filter_grants_tighten`). Por isso os
--    grants são reafirmados logo abaixo, explicitamente, na MESMA forma que
--    produção tem hoje: `authenticated` e `service_role` executam, `anon` não.
--    Nada de conveniência nova — o conjunto medido antes do apply é o conjunto
--    depois dele.
DROP FUNCTION IF EXISTS public.get_social_conversation_list(uuid, uuid, integer, timestamptz);

CREATE OR REPLACE FUNCTION public.get_social_conversation_list(p_org uuid, p_channel uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(contact_external_id text, sender_name text, sender_profile_pic text, contact_handle text, last_message text, last_message_time timestamp with time zone, last_message_direction text, unread_count integer, lead_id uuid, lead_name text)
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
           m.sender_profile_pic   AS s_pic,
           m.contact_handle       AS s_handle
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
         ci.s_handle,
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
   WHERE (p_before IS NULL OR t.ts < p_before)
     -- O RECORTE POR RESPONSÁVEL, que faltava — a razão desta migration.
     --
     -- `si.lead_id`, e não `l.id`: `l` é o JOIN que já existe para o NOME, e
     -- ele sai nulo quando o nome não pode ser visto. Usar `l.id` aqui faria a
     -- visibilidade da CONVERSA depender da visibilidade do NOME, que são duas
     -- perguntas diferentes — e esconderia do responsável a própria conversa
     -- dele sempre que a outra regra apertasse.
     --
     -- Terceiro argumento NULO: no Instagram não há telefone para casar. Sem
     -- vínculo com lead, `can_see_chat_scope` devolve `false` com a política
     -- ligada — "restringir ao dono" sem dono é a resposta vazia, e o admin
     -- continua vendo tudo. Com a política DESLIGADA (60 das 62 organizations)
     -- ela devolve `true` antes de olhar lead nenhum.
     AND public.can_see_chat_scope(p_org, si.lead_id, NULL)
   ORDER BY t.ts DESC
   LIMIT v_limit;
END;
$function$;

COMMENT ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz) IS
  'Lista de conversas de um canal social (Instagram). Aplica can_see_chat_scope '
  'por conversa desde 20270931000000 (SCRUM-653): o lead sai de '
  'lead_social_identities, porque no Instagram não há telefone para casar e '
  'channel_messages.lead_id é cache derivado que nasce nulo.';

REVOKE ALL     ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz) TO service_role;
