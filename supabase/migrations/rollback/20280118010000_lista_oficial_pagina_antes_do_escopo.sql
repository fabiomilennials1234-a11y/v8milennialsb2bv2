-- Rollback de 20280118010000_lista_oficial_pagina_antes_do_escopo.sql
--
-- Restaura o corpo VIVO de prod lido em 16/11/2026 com pg_get_functiondef
-- (forma de prod: lê private.channel_messages, private.conversation_read_state
-- e private.leads). md5(prosrc) conferido contra prod: ver o teste
-- tests/integration/inbox-rpcs-restantes-perf.test.mjs.
-- Mesma assinatura e mesmo retorno ⇒ CREATE OR REPLACE preserva a ACL.

CREATE OR REPLACE FUNCTION public.get_official_whatsapp_conversation_list_multi(p_org uuid, p_instances uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_instance uuid DEFAULT NULL::uuid, p_before_contact text DEFAULT NULL::text)
 RETURNS TABLE(instance_id uuid, contact_external_id text, sender_name text, sender_profile_pic text, contact_handle text, last_message text, last_message_time timestamp with time zone, last_message_direction text, unread_count integer, lead_id uuid, lead_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid    := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_boxes uuid[];
BEGIN
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  -- A função de uma Instance tem um gate explícito
  -- `forbidden: instance not in org` para transformar silêncio em erro. Aqui
  -- esse gate está DENTRO de whatsapp_readable_instance_ids, que filtra por
  -- `wi.organization_id = p_org`: uuid de outra org simplesmente não entra no
  -- conjunto. A diferença é deliberada — com N caixas pedidas, uma única
  -- inválida não pode derrubar a lista inteira das válidas.
  v_boxes := public.whatsapp_readable_instance_ids(p_org, p_instances);

  IF cardinality(v_boxes) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH thread AS (
    -- Última mensagem de cada (caixa, interlocutor). Ordem casada com
    -- idx_channel_messages_instance_thread — ver ⚠️ no cabeçalho.
    --
    -- `m.lead_id` NÃO é lido: é CACHE, e cache que nasce nulo em toda linha
    -- nova apagaria o vínculo da tela a cada mensagem recebida. O vínculo sai
    -- do LATERAL contra `leads`, por telefone.
    SELECT DISTINCT ON (m.instance_id, m.contact_external_id)
           m.instance_id         AS inst,
           m.contact_external_id AS cid,
           m.content             AS body,
           m."timestamp"         AS ts,
           m.direction           AS dir
      FROM private.channel_messages m
     WHERE m.organization_id     = p_org
       AND m.instance_id         = ANY(v_boxes)
       AND m.contact_external_id IS NOT NULL
     ORDER BY m.instance_id, m.contact_external_id, m."timestamp" DESC
  ),
  contact_identity AS (
    -- NOME E AVATAR SAEM DA ÚLTIMA MENSAGEM **RECEBIDA**, NÃO DA ÚLTIMA.
    -- `sender_name`/`sender_profile_pic` descrevem QUEM MANDOU aquela linha:
    -- numa mensagem de SAÍDA são a NOSSA conta, e toda conversa já respondida
    -- apareceria com o nome da própria org. O envio pela caixa oficial já
    -- existe (#1640) e grava nesta mesma tabela, então o defeito não é
    -- latente: a primeira resposta do vendedor já o produziria.
    SELECT DISTINCT ON (m.instance_id, m.contact_external_id)
           m.instance_id         AS inst,
           m.contact_external_id AS cid,
           m.sender_name         AS s_name,
           m.sender_profile_pic  AS s_pic,
           m.contact_handle      AS s_handle
      FROM private.channel_messages m
     WHERE m.organization_id     = p_org
       AND m.instance_id         = ANY(v_boxes)
       AND m.contact_external_id IS NOT NULL
       AND m.direction           = 'incoming'
     ORDER BY m.instance_id, m.contact_external_id, m."timestamp" DESC
  ),
  unread AS (
    -- Chave de leitura MONTADA por CAIXA:
    -- `whatsapp_oficial:<instance_id>:<contact_external_id>`. Confirmado em
    -- prod (27 linhas nesse namespace). O namespace é `whatsapp_oficial:` e
    -- NÃO `whatsapp:`, porque aquele é fatiado por `split_part(...,3)` como se
    -- o segmento fosse telefone.
    -- `m.instance_id` na chave, não um escalar: com N caixas, a leitura de uma
    -- não pode zerar o contador de outra.
    SELECT m.instance_id AS inst, m.contact_external_id AS cid,
           count(*)::integer AS cnt
      FROM private.channel_messages m
      LEFT JOIN private.conversation_read_state rs
             ON rs.organization_id  = p_org
            AND rs.user_id          = v_uid
            AND rs.conversation_key = 'whatsapp_oficial:' || m.instance_id::text
                                      || ':' || m.contact_external_id
     WHERE m.organization_id     = p_org
       AND m.instance_id         = ANY(v_boxes)
       AND m.contact_external_id IS NOT NULL
       AND m.direction           = 'incoming'
       AND m."timestamp" > COALESCE(rs.last_read_at, now() - interval '7 days')
     GROUP BY 1, 2
  )
  SELECT t.inst,
         t.cid,
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
    LEFT JOIN contact_identity ci ON ci.inst = t.inst AND ci.cid = t.cid
    LEFT JOIN unread u            ON u.inst  = t.inst AND u.cid  = t.cid
    -- Vínculo por TELEFONE, com a expressão do lado do argumento para usar
    -- idx_leads_org_phone_unique — ver ⚠️ de telefone cru no cabeçalho.
    -- LATERAL com LIMIT 1 porque telefone repetido em dois leads é estado
    -- possível; sem ele a mesma conversa sairia duplicada.
    -- `can_link_or_read_lead`: esta RPC é DEFINER, então sem o predicado o
    -- JOIN entregaria o NOME de um lead que a RLS esconde deste usuário.
    LEFT JOIN LATERAL (
      SELECT l2.id, l2.name
        FROM private.leads l2
       WHERE l2.organization_id  = p_org
         AND l2.deleted_at IS NULL
         AND l2.normalized_phone = public.normalize_brazilian_phone(t.cid)
         AND public.can_link_or_read_lead(l2.id, p_org)
       ORDER BY l2.created_at NULLS LAST, l2.id
       LIMIT 1
    ) l ON true
   -- p_before é cursor sobre a CONVERSA (a última mensagem dela), aplicado
   -- FORA do DISTINCT ON: dentro, mudaria QUAL mensagem é a última de cada
   -- thread em vez de paginar. O limite é GLOBAL sobre o conjunto (D3), e o
   -- cursor é COMPOSTO: `<` estrito sobre `ts` sozinho perde thread em empate
   -- de timestamp na borda da página. Cursor parcial repete em vez de perder.
   WHERE (
       p_before IS NULL
       OR t.ts < p_before
       OR (t.ts = p_before
           AND (p_before_instance IS NULL
                OR p_before_contact IS NULL
                OR (t.inst, t.cid) < (p_before_instance, p_before_contact)))
     )
     -- Isolamento por responsável (#1629), por CONVERSA. Devolve true de saída
     -- quando a política está desligada, que é o caso de todas as orgs com
     -- canal oficial hoje.
     AND public.can_see_chat_scope(p_org, NULL, public.normalize_brazilian_phone(t.cid))
   -- ORDEM TOTAL, mesma ordem e mesma direção da tupla do cursor. É desta
   -- última linha que o cliente tira o cursor da próxima página.
   ORDER BY t.ts DESC, t.inst DESC, t.cid DESC
   LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamp with time zone, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamp with time zone, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
