-- ════════════════════════════════════════════════════════════════════════════
-- Lista do canal oficial: gates constantes por chamador fora do laço
-- ════════════════════════════════════════════════════════════════════════════
--
-- SINTOMA (prod, 21/11/2026, org 38f3, admin, 200 conversas): 426 ms quente.
--   * LATERAL do lead: `can_link_or_read_lead(l.id, org)` por linha =
--     200 × 1,37 ms = 275 ms (37 buffers cada). O gate refaz, a cada lead,
--     jrtex_lead_scope_for_user, riofix_balcao_scope_for_user, is_master_user,
--     is_user_admin, has_feature_permission — todos CONSTANTES por chamador.
--   * Laço: `can_see_chat_scope` por conversa = 200 × ~0,5 ms ≈ 100 ms numa
--     org sem strict nem chat_restrict_to_owner, onde ele é true constante.
--
-- CORREÇÃO (4), mesma saída:
--   * `v_lead_livre` = sem escopo JR Tex/Riofix E (master OU is_user_admin OU
--     leads.view_all na org). Com ele, `can_link_or_read_lead` se reduz a
--     "lead existe na org e não apagado" — o WHERE do próprio LATERAL —, e
--     não roda por linha.
--   * `v_escopo_livre` = org sem strict_lead_owner_access E
--     chat_scope_for_recipient no ramo que devolve true sem olhar o telefone.
--     Com ele, `can_see_chat_scope` não roda por conversa.
--   * Os dois só ligam se os corpos de can_link_or_read_lead (b8d3d019…),
--     can_see_chat_scope (1bb1bb81…) e private.chat_scope_for_recipient
--     (48030489…) forem os revisados — md5 conferido a cada chamada, mesmo
--     padrão do pré-filtro strict de 20280119040000. Corpo mudou ⇒ gate por
--     linha, como antes.
--
-- BASE: o MESMO texto de 20280119010000 (aplicada; produz em prod o corpo de
-- md5 915a15bf544ab1745f828801f5a04a89, 5× `private.`) + (4). Mesmo mecanismo
-- de forma de prod (public.* → private.* nas 3 relações quando o recorte
-- strict está instalado). Contagem esperada de `private.` depois da troca:
-- 5 + 7 (as do (4), todas em chamadas de função, nenhuma relação nova).
-- Pré-voo: corpo vivo = prod-form 915a15bf… onde o recorte está instalado,
-- repo-form onde não está; outro corpo ⇒ RAISE.
-- Mesma assinatura e retorno ⇒ CREATE OR REPLACE preserva a ACL
-- ({postgres, authenticated}); REVOKE/GRANT explícitos.
--
-- Rollback: supabase/migrations/rollback/20280123000700_lista_oficial_gates_fora_do_laco.sql

DO $preflight$
DECLARE
  v_md5 text;
  v_esperado text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.get_official_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid,text)');
  v_esperado := CASE WHEN to_regprocedure('private.strict_lead_member_orgs()') IS NOT NULL
                     THEN '915a15bf544ab1745f828801f5a04a89'
                     ELSE 'c16c87b3fa09df324f6fe99b82de59bd' END;
  IF v_md5 IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION 'pré-voo: get_official_whatsapp_conversation_list_multi diverge da base revisada (md5 %, esperado %), abortado', v_md5, v_esperado;
  END IF;
END
$preflight$;

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
  -- A página, na ordem total da lista: (caixa, contato, corpo, ts, direção).
  v_inst  uuid[] := '{}';
  v_cid   text[] := '{}';
  v_body  text[] := '{}';
  v_ts    timestamptz[] := '{}';
  v_dir   text[] := '{}';
  r       record;
  -- (4) Gates constantes por chamador, calculados UMA vez (ver cabeçalho de
  -- 20280123000700). false = o gate roda por linha, como antes.
  v_lead_livre   boolean := false;
  v_escopo_livre boolean := false;
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

  -- (4) Só com os corpos REVISADOS (md5 de prod, 21/11/2026) dos gates que
  -- este atalho reproduz, e com as funções de escopo de prod presentes.
  -- Corpo mudou ou função ausente: os dois ficam false e o gate roda por linha
  -- (correto e lento), nunca um atalho desatualizado abrindo conversa ou nome.
  IF to_regprocedure('private.jrtex_lead_scope_for_user(uuid,uuid)') IS NOT NULL
     AND to_regprocedure('private.riofix_balcao_scope_for_user(uuid,uuid)') IS NOT NULL THEN
    -- can_link_or_read_lead(lead, org): sem escopo JR Tex nem balcão Riofix, e
    -- com master/admin/leads.view_all, o gate se reduz a "o lead existe na
    -- org e não foi apagado" — exatamente o WHERE do LATERAL que o chama.
    IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
         WHERE p.oid = to_regprocedure('public.can_link_or_read_lead(uuid,uuid)'))
       = 'b8d3d01935b9c1897281cc0198397888' THEN
      v_lead_livre := COALESCE(public.is_master_user(), false)
        OR COALESCE(public.is_user_admin(), false)
        OR COALESCE(public.has_feature_permission('leads.view_all', p_org), false);
      IF v_lead_livre THEN
        EXECUTE 'SELECT private.jrtex_lead_scope_for_user($1, $2) IS NULL
                    AND private.riofix_balcao_scope_for_user($1, $2) IS NULL'
          INTO v_lead_livre USING v_uid, p_org;
        v_lead_livre := COALESCE(v_lead_livre, false);
      END IF;
    END IF;
    -- can_see_chat_scope(org, NULL, tel): org sem strict_lead_owner_access e
    -- chat_scope_for_recipient no ramo que devolve true sem olhar o telefone
    -- (sem escopo JR Tex/Riofix; master, ou membro ativo que é admin, ou org
    -- sem chat_restrict_to_owner, ou override leads.view_all do membro). Os
    -- ramos da Karine/Izadora só ACRESCENTAM true — com o resto true, não mudam.
    IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
         WHERE p.oid = to_regprocedure('public.can_see_chat_scope(uuid,uuid,text)'))
       = '1bb1bb8111c50c2999e0a2165b864cc7'
       AND (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
         WHERE p.oid = to_regprocedure('private.chat_scope_for_recipient(uuid,uuid,uuid,text)'))
       = '480304899e31cc83ea4aed7fe3c77a26' THEN
      EXECUTE $escopo$
        SELECT NOT EXISTS (
                 SELECT 1 FROM public.organizations o
                  WHERE o.id = $2
                    AND o.feature_flags @> '{"strict_lead_owner_access":true}'::jsonb)
           AND private.jrtex_lead_scope_for_user($1, $2) IS NULL
           AND private.riofix_balcao_scope_for_user($1, $2) IS NULL
           AND (COALESCE(public.is_master_user($1), false)
                OR (SELECT CASE WHEN m.tm IS NULL THEN false ELSE
                          EXISTS (SELECT 1 FROM public.user_roles ur
                                   WHERE ur.user_id = $1 AND ur.role = 'admin')
                       OR EXISTS (SELECT 1 FROM public.team_members t2
                                   WHERE t2.user_id = $1 AND t2.role = 'admin' AND t2.is_active)
                       OR NOT COALESCE((SELECT o.chat_restrict_to_owner FROM public.organizations o
                                         WHERE o.id = $2), false)
                       OR EXISTS (SELECT 1 FROM public.member_feature_permissions mfp
                                   WHERE mfp.team_member_id = m.tm
                                     AND mfp.feature_key = 'leads.view_all' AND mfp.enabled)
                       END
                      FROM (SELECT (SELECT tm.id FROM public.team_members tm
                                     WHERE tm.user_id = $1 AND tm.organization_id = $2
                                       AND tm.is_active = true
                                     LIMIT 1) AS tm) m))
      $escopo$ INTO v_escopo_livre USING v_uid, p_org;
      v_escopo_livre := COALESCE(v_escopo_livre, false);
    END IF;
  END IF;

  -- (1)+(2) Página preguiçosa. A consulta do FOR é lida sob demanda (cursor):
  -- `can_see_chat_scope` roda uma vez por CONVERSA, na ordem total da lista,
  -- e o laço para quando a página enche — nunca uma vez por mensagem, nunca
  -- para as conversas que ficariam depois do LIMIT.
  FOR r IN
    WITH thread AS (
      -- Última mensagem de cada (caixa, interlocutor). Ordem casada com
      -- idx_channel_messages_instance_thread.
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
        FROM public.channel_messages m
       WHERE m.organization_id     = p_org
         AND m.instance_id         = ANY(v_boxes)
         AND m.contact_external_id IS NOT NULL
       ORDER BY m.instance_id, m.contact_external_id, m."timestamp" DESC
    )
    SELECT t.inst, t.cid, t.body, t.ts, t.dir
      FROM thread t
     -- p_before é cursor sobre a CONVERSA (a última mensagem dela), aplicado
     -- FORA do DISTINCT ON: dentro, mudaria QUAL mensagem é a última de cada
     -- thread em vez de paginar. O cursor é COMPOSTO: `<` estrito sobre `ts`
     -- sozinho perde thread em empate de timestamp na borda da página.
     -- Cursor parcial repete em vez de perder.
     WHERE (
         p_before IS NULL
         OR t.ts < p_before
         OR (t.ts = p_before
             AND (p_before_instance IS NULL
                  OR p_before_contact IS NULL
                  OR (t.inst, t.cid) < (p_before_instance, p_before_contact)))
       )
     -- ORDEM TOTAL, mesma ordem e mesma direção da tupla do cursor.
     ORDER BY t.ts DESC, t.inst DESC, t.cid DESC
  LOOP
    -- Isolamento por responsável (#1629), por CONVERSA. Devolve true de saída
    -- quando a política está desligada.
    IF NOT v_escopo_livre THEN
      CONTINUE WHEN NOT COALESCE(
        public.can_see_chat_scope(p_org, NULL, public.normalize_brazilian_phone(r.cid)), false);
    END IF;
    v_inst := v_inst || r.inst;
    v_cid  := v_cid  || r.cid;
    v_body := v_body || r.body;
    v_ts   := v_ts   || r.ts;
    v_dir  := v_dir  || r.dir;
    EXIT WHEN cardinality(v_inst) >= v_limit;
  END LOOP;

  IF cardinality(v_inst) = 0 THEN
    RETURN;
  END IF;

  -- (3) Só a página paga identidade, não-lidas e vínculo com o lead.
  RETURN QUERY
  SELECT p.inst,
         p.cid,
         ci.s_name,
         ci.s_pic,
         ci.s_handle,
         p.body,
         p.ts,
         p.dir,
         COALESCE(u.cnt, 0)::integer,
         l.id,
         l.name
    FROM unnest(v_inst, v_cid, v_body, v_ts, v_dir) WITH ORDINALITY
           AS p(inst, cid, body, ts, dir, ord)
    -- NOME E AVATAR SAEM DA ÚLTIMA MENSAGEM **RECEBIDA**, NÃO DA ÚLTIMA.
    -- `sender_name`/`sender_profile_pic` descrevem QUEM MANDOU aquela linha:
    -- numa mensagem de SAÍDA são a NOSSA conta, e toda conversa já respondida
    -- apareceria com o nome da própria org.
    LEFT JOIN LATERAL (
      SELECT m.sender_name        AS s_name,
             m.sender_profile_pic AS s_pic,
             m.contact_handle     AS s_handle
        FROM public.channel_messages m
       WHERE m.organization_id     = p_org
         AND m.instance_id         = p.inst
         AND m.contact_external_id = p.cid
         AND m.direction           = 'incoming'
       ORDER BY m."timestamp" DESC
       LIMIT 1
    ) ci ON true
    -- Chave de leitura MONTADA por CAIXA:
    -- `whatsapp_oficial:<instance_id>:<contact_external_id>`. O namespace é
    -- `whatsapp_oficial:` e NÃO `whatsapp:`, porque aquele é fatiado por
    -- `split_part(...,3)` como se o segmento fosse telefone. Com N caixas, a
    -- leitura de uma não zera o contador de outra.
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS cnt
        FROM public.channel_messages m
        LEFT JOIN public.conversation_read_state rs
               ON rs.organization_id  = p_org
              AND rs.user_id          = v_uid
              AND rs.conversation_key = 'whatsapp_oficial:' || p.inst::text
                                        || ':' || p.cid
       WHERE m.organization_id     = p_org
         AND m.instance_id         = p.inst
         AND m.contact_external_id = p.cid
         AND m.direction           = 'incoming'
         AND m."timestamp" > COALESCE(rs.last_read_at, now() - interval '7 days')
    ) u ON true
    -- Vínculo por TELEFONE, com a expressão do lado do argumento para usar
    -- idx_leads_org_phone_unique. LATERAL com LIMIT 1 porque telefone repetido
    -- em dois leads é estado possível; sem ele a mesma conversa sairia
    -- duplicada. `can_link_or_read_lead`: esta RPC é DEFINER, então sem o
    -- predicado o JOIN entregaria o NOME de um lead que a RLS esconde.
    LEFT JOIN LATERAL (
      SELECT l2.id, l2.name
        FROM public.leads l2
       WHERE l2.organization_id  = p_org
         AND l2.deleted_at IS NULL
         AND l2.normalized_phone = public.normalize_brazilian_phone(p.cid)
         AND (v_lead_livre OR public.can_link_or_read_lead(l2.id, p_org))
       ORDER BY l2.created_at NULLS LAST, l2.id
       LIMIT 1
    ) l ON true
   ORDER BY p.ord;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamp with time zone, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamp with time zone, uuid, text) TO authenticated;

DO $troca$
DECLARE
  v_sig regprocedure := 'public.get_official_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid,text)'::regprocedure;
  v_rels text[] := ARRAY['channel_messages', 'conversation_read_state', 'leads'];
  v_esperado constant integer := 12;
  v_def text;
  v_rel text;
  v_faltando text[];
  v_sobra integer;
  v_private integer;
BEGIN
  IF to_regprocedure('private.strict_lead_member_orgs()') IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(r ORDER BY r) INTO v_faltando
    FROM unnest(v_rels) AS r
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'private' AND c.relname = r AND c.relkind = 'v');
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'forma de prod incompleta: strict instalado, mas faltam as views private.% — abortado para não ler sem o recorte',
      array_to_string(v_faltando, ', private.');
  END IF;

  v_def := pg_get_functiondef(v_sig);
  FOREACH v_rel IN ARRAY v_rels LOOP
    v_def := regexp_replace(v_def, 'public\.' || v_rel || '\M', 'private.' || v_rel, 'g');
  END LOOP;
  EXECUTE v_def;

  v_def := pg_get_functiondef(v_sig);
  SELECT count(*) INTO v_sobra
    FROM regexp_matches(v_def, 'public\.(' || array_to_string(v_rels, '|') || ')\M', 'g');
  SELECT count(*) INTO v_private FROM regexp_matches(v_def, 'private\.', 'g');
  IF v_sobra <> 0 OR v_private <> v_esperado THEN
    RAISE EXCEPTION 'forma de prod divergente: % referência(s) public.* às 3 relações e % private.* (esperado 0 e %)',
      v_sobra, v_private, v_esperado;
  END IF;
END
$troca$;

NOTIFY pgrst, 'reload schema';
