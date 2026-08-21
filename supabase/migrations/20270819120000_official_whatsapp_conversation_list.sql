-- ============================================================================
-- A LISTA da caixa de WhatsApp oficial (NotificaMe) — issue #1650
--
-- O recebimento funciona até o banco e a mensagem é INVISÍVEL na tela. Medido
-- em produção em 2026-08-18:
--
--   channel_messages: channel='whatsapp', instance_id=7312692e-…,
--                     messaging_channel_id=NULL, contact_external_id='554884334050'
--
-- `get_social_conversation_list` não a alcança por DUAS razões independentes,
-- e é por isso que "passar o instance_id na posição do canal" (decisão Q10 do
-- spec) não fecha:
--
--   1. gate de tenancy: `SELECT ... FROM messaging_channels WHERE id = p_channel`
--      — a instância de WhatsApp não está nessa tabela, então a chamada morre em
--      42501 antes de ler qualquer mensagem;
--   2. a CTE filtra `messaging_channel_id = p_channel`, e essa coluna é NULL em
--      TODAS as 10.983 linhas de `channel='whatsapp'` da tabela.
--
-- A saída é esta função: mesma FORMA de retorno da social (o front reusa o
-- mapper inteiro), eixo de leitura trocado de `messaging_channel_id` para
-- `instance_id`.
--
-- A ROTA DESCARTADA foi criar linha em `messaging_channels` para o canal
-- oficial e passar a preencher `messaging_channel_id` no webhook: leitura sairia
-- de graça, mas o mesmo canal passaria a ter DUAS identidades no banco — a
-- segunda verdade que as decisões Q5 e Q9 do spec existem para não criar.
--
-- ⚠️ ISOLAMENTO POR RESPONSÁVEL. Esta função nasce chamando
-- `can_see_chat_scope` (PRD #1629). Não é zelo: `get_social_conversation_list`
-- NÃO o aplica, e duas organizações têm `chat_restrict_to_owner = true` hoje
-- (Goletric Perdizes e Goletric Pinheiros) — a segunda com Instagram conectado e
-- recebendo. Copiar a forma social traria o furo junto. A política está
-- DESLIGADA na Chique, então aqui ela é inerte hoje e correta no dia em que
-- alguém a ligar.
--
-- Custo: um `can_see_chat_scope` por CONVERSA (não por mensagem), depois do
-- DISTINCT ON. `get_whatsapp_conversation_list` optou por inlinar o EXISTS para
-- caber numa varredura só; ali são milhares de conversas por org. Aqui é uma, e
-- duplicar a regra de autorização em dois lugares custa mais do que a varredura.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Índice — a mesma FORMA do índice social, no eixo da instância
--
-- Sem ele o plano medido em prod é `Index Scan` por `idx_channel_messages_instance`
-- (btree de coluna única) + nó `Sort`, porque o DISTINCT ON exige
-- (contact_external_id, timestamp DESC) e aquele índice não entrega ordem
-- nenhuma. Na instância fóssil mais pesada isso é BitmapAnd + 339 blocos de heap
-- + 833 linhas descartadas por filtro para devolver ZERO linha. O controle
-- positivo é o lado do Instagram, que com o índice certo não tem nó `Sort`.
--
-- PARCIAL pela mesma razão que o social é parcial: 10.982 das 10.983 linhas de
-- `channel='whatsapp'` têm `contact_external_id` NULL (fósseis de março/2026, da
-- era Evolution). Um índice total cobraria escrita e espaço delas para servir
-- zero leitura.
--
-- Os dois predicados são prováveis pelo planner: a query filtra
-- `contact_external_id IS NOT NULL` literalmente, e `instance_id = $2` é
-- operador estrito, que implica `instance_id IS NOT NULL`.
--
-- Sem CONCURRENTLY: o índice nasce com 1 linha hoje.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_channel_messages_instance_thread
  ON public.channel_messages (
    organization_id,
    instance_id,
    contact_external_id,
    "timestamp" DESC
  )
  WHERE contact_external_id IS NOT NULL
    AND instance_id IS NOT NULL;

COMMENT ON INDEX public.idx_channel_messages_instance_thread IS
  'Thread da caixa de WhatsApp oficial (NotificaMe): o par (org, instance) como prefixo de igualdade e (contact_external_id, timestamp DESC) na ordem exata do DISTINCT ON de get_official_whatsapp_conversation_list — é o que elimina o nó Sort. Parcial porque só ~1 em 11 mil linhas de channel=whatsapp tem contact_external_id.';

CREATE OR REPLACE FUNCTION public.get_official_whatsapp_conversation_list(
  p_org      uuid,
  p_instance uuid,
  p_limit    integer     DEFAULT 50,
  p_before   timestamptz DEFAULT NULL
)
RETURNS TABLE(
  contact_external_id    text,
  sender_name            text,
  sender_profile_pic     text,
  contact_handle         text,
  last_message           text,
  last_message_time      timestamptz,
  last_message_direction text,
  unread_count           integer,
  lead_id                uuid,
  lead_name              text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid    := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
BEGIN
  -- Gate 1 — acesso: team_member ativo da org OU master ativo (ghost cross-org).
  -- Forma idêntica à das duas irmãs, incluindo as defesas contra NULL:
  -- `NOT EXISTS` em vez de `NOT (x IN (...))` (IN com NULL na lista devolve
  -- NULL, e `IF NULL THEN` não dispara — gate ABERTO em vez de erro) e
  -- COALESCE em is_master_user().
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_instance IS NULL THEN
    RAISE EXCEPTION 'instance required' USING ERRCODE = '22023';
  END IF;

  -- Gate 2 — tenancy DO ARGUMENTO: a instância tem que ser DA org pedida.
  -- Explícito e fail-closed, e não herdado do filtro da query: um membro
  -- legítimo da org A que passe o uuid da instância da org B tem que receber
  -- 42501, não uma lista vazia que ele leria como "não há conversa".
  --
  -- `whatsapp_chip_instance_ids` resolve o mesmo problema devolvendo
  -- ARRAY[p_instance] quando a instância não é da org — funciona lá porque toda
  -- a query seguinte filtra por organization_id. Aqui a checagem é explícita:
  -- custa um índice único (pkey) e transforma silêncio em erro.
  --
  -- Sem recorte por `provider`: o eixo desta função é a INSTÂNCIA que gravou em
  -- channel_messages. Amarrá-la a 'notificame' faria o próximo provider que
  -- escreva nessa tabela precisar de uma terceira função idêntica.
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_instances wi
     WHERE wi.id = p_instance AND wi.organization_id = p_org
  ) THEN
    RAISE EXCEPTION 'forbidden: instance not in org' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH thread AS (
    -- A última mensagem de cada interlocutor. Casa exatamente com
    -- idx_channel_messages_instance_thread.
    --
    -- ⚠️ `m.lead_id` NÃO é lido aqui: é CACHE, e cache que nasce nulo em toda
    -- linha nova apagaria o vínculo da tela a cada mensagem recebida. O vínculo
    -- sai do LATERAL contra `leads`, por telefone (decisão Q8 do spec).
    SELECT DISTINCT ON (m.contact_external_id)
           m.contact_external_id  AS cid,
           m.content              AS body,
           m."timestamp"          AS ts,
           m.direction            AS dir
      FROM public.channel_messages m
     WHERE m.organization_id     = p_org
       AND m.instance_id         = p_instance
       AND m.contact_external_id IS NOT NULL
     ORDER BY m.contact_external_id, m."timestamp" DESC
  ),
  contact_identity AS (
    -- ⚠️ NOME E AVATAR SAEM DA ÚLTIMA MENSAGEM **RECEBIDA**, NÃO DA ÚLTIMA
    -- MENSAGEM. `sender_name`/`sender_profile_pic` descrevem QUEM MANDOU aquela
    -- linha: numa mensagem de SAÍDA eles são a NOSSA conta, e toda conversa já
    -- respondida apareceria na lista com o nome da própria org.
    --
    -- Aqui isso NÃO é latente como no lado social: o envio pela caixa oficial já
    -- existe (#1640) e `NotificameProvider.persist()` grava a saída nesta mesma
    -- tabela. A primeira resposta do vendedor já produziria o defeito.
    SELECT DISTINCT ON (m.contact_external_id)
           m.contact_external_id  AS cid,
           m.sender_name          AS s_name,
           m.sender_profile_pic   AS s_pic,
           m.contact_handle       AS s_handle
      FROM public.channel_messages m
     WHERE m.organization_id     = p_org
       AND m.instance_id         = p_instance
       AND m.contact_external_id IS NOT NULL
       AND m.direction           = 'incoming'
     ORDER BY m.contact_external_id, m."timestamp" DESC
  ),
  unread AS (
    -- Chave de leitura MONTADA, não fatiada — mesma escolha da social. O
    -- namespace é `whatsapp_oficial:` e NÃO `whatsapp:`: o do WhatsApp por QR é
    -- fatiado por `split_part(conversation_key, ':', 3)` em
    -- get_whatsapp_conversation_list, e uma chave nossa naquele namespace seria
    -- lida por aquela função como se fosse telefone.
    SELECT m.contact_external_id AS cid, count(*)::integer AS cnt
      FROM public.channel_messages m
      LEFT JOIN public.conversation_read_state rs
             ON rs.organization_id  = p_org
            AND rs.user_id          = v_uid
            AND rs.conversation_key = 'whatsapp_oficial:' || p_instance::text
                                      || ':' || m.contact_external_id
     WHERE m.organization_id     = p_org
       AND m.instance_id         = p_instance
       AND m.contact_external_id IS NOT NULL
       AND m.direction           = 'incoming'
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
         l.id,
         l.name
    FROM thread t
    LEFT JOIN contact_identity ci ON ci.cid = t.cid
    LEFT JOIN unread u            ON u.cid  = t.cid
    -- O VÍNCULO É POR TELEFONE (Q8), e não por `lead_social_identities`: o
    -- interlocutor do WhatsApp É um telefone, que é o identificador forte do
    -- lead neste produto. `normalize_brazilian_phone` porque `leads.normalized_phone`
    -- é produzida por ela — reimplementar a normalização aqui criaria duas que
    -- divergem no primeiro DDD de 8 dígitos. Medido: o contato real
    -- '554884334050' normaliza para '48984334050', com o nono dígito que o
    -- fornecedor não manda.
    --
    -- LATERAL com LIMIT 1 porque telefone repetido em dois leads é estado
    -- possível; sem ele a mesma conversa sairia duplicada na lista.
    --
    -- `can_link_or_read_lead`: esta RPC é DEFINER, então sem o predicado o JOIN
    -- entregaria o NOME de um lead que a RLS esconde deste usuário.
    LEFT JOIN LATERAL (
      SELECT l2.id, l2.name
        FROM public.leads l2
       WHERE l2.organization_id  = p_org
         AND l2.deleted_at IS NULL
         AND l2.normalized_phone = public.normalize_brazilian_phone(t.cid)
         AND public.can_link_or_read_lead(l2.id, p_org)
       ORDER BY l2.created_at NULLS LAST, l2.id
       LIMIT 1
    ) l ON true
   -- p_before é cursor sobre a CONVERSA (a última mensagem dela), não filtro
   -- sobre as mensagens: aplicado dentro do DISTINCT ON, mudaria QUAL mensagem é
   -- a última de cada thread em vez de paginar a lista.
   WHERE (p_before IS NULL OR t.ts < p_before)
     -- Isolamento por responsável (#1629), avaliado por CONVERSA. Devolve true
     -- de saída quando a política está desligada, que é o caso de todas as orgs
     -- com canal oficial hoje.
     AND public.can_see_chat_scope(p_org, NULL, public.normalize_brazilian_phone(t.cid))
   ORDER BY t.ts DESC
   LIMIT v_limit;
END;
$function$;

COMMENT ON FUNCTION public.get_official_whatsapp_conversation_list(uuid, uuid, integer, timestamptz) IS
  'Lista de conversas da caixa de WhatsApp oficial (NotificaMe) — issue #1650. Mesma forma de retorno de get_social_conversation_list, com o eixo de leitura em channel_messages.instance_id em vez de messaging_channel_id, porque o inbound do canal oficial grava a instância e deixa o canal social nulo. Vínculo de lead por telefone normalizado; isolamento por responsável via can_see_chat_scope.';

-- Grants explícitos: CREATE OR REPLACE preserva os de uma função já existente,
-- mas esta nasce agora — e função nova nasce com EXECUTE para PUBLIC.
REVOKE ALL ON FUNCTION public.get_official_whatsapp_conversation_list(uuid, uuid, integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_official_whatsapp_conversation_list(uuid, uuid, integer, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- ANALYZE — sem isto o índice acima pode não ser escolhido
--
-- Medido em prod: `last_autoanalyze` de channel_messages é de 2026-05-11, e
-- `pg_stats` NÃO TEM LINHA para `contact_external_id` nem para
-- `messaging_channel_id` — as colunas nasceram depois. O planner está cego
-- quanto à seletividade delas e chuta o IS NOT NULL; num dos planos medidos ele
-- já preferiu `idx_channel_messages_timestamp` a filtrar por instância.
-- ---------------------------------------------------------------------------
ANALYZE public.channel_messages;
