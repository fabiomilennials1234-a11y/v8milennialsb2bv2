-- Manual unread is personal; it never retracts provider read receipts.
ALTER TABLE public.conversation_read_state ADD COLUMN IF NOT EXISTS marked_unread boolean NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS reply_context jsonb;

CREATE OR REPLACE FUNCTION public.is_conversation_marked_unread(p_org uuid, p_instance uuid, p_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.conversation_read_state
 WHERE organization_id = p_org AND user_id = auth.uid()
 AND conversation_key = 'whatsapp:' || p_instance::text || ':' || p_phone AND marked_unread);
$$;
REVOKE ALL ON FUNCTION public.is_conversation_marked_unread(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_conversation_marked_unread(uuid,uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_conversation_unread(p_instance_id uuid, p_normalized_phone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid;
BEGIN
 SELECT organization_id INTO v_org FROM public.whatsapp_instances WHERE id = p_instance_id;
 IF auth.uid() IS NULL OR v_org IS NULL OR
   (NOT EXISTS (SELECT 1 FROM public.get_my_organization_ids() AS g(org_id) WHERE g.org_id = v_org) AND NOT coalesce(public.is_master_user(),false)) THEN
   RAISE EXCEPTION 'forbidden: instance not accessible' USING ERRCODE = '42501';
 END IF;
 IF p_normalized_phone IS NULL OR p_normalized_phone !~ '^[0-9]{8,20}$' THEN
   RAISE EXCEPTION 'invalid phone' USING ERRCODE = '22023';
 END IF;
 INSERT INTO public.conversation_read_state (organization_id,user_id,conversation_key,last_read_at,updated_at,marked_unread)
 VALUES (v_org,auth.uid(),'whatsapp:' || p_instance_id::text || ':' || p_normalized_phone,now() - interval '7 days',now(),true)
 ON CONFLICT (organization_id,user_id,conversation_key) DO UPDATE SET marked_unread = true, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.mark_conversation_unread(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_unread(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_instance_id uuid, p_normalized_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_key text := 'whatsapp:' || p_instance_id::text || ':' || p_normalized_phone;
BEGIN
  SELECT organization_id INTO v_org FROM whatsapp_instances WHERE id = p_instance_id;
  -- Acesso: team_member ativo da org OU master ativo (ghost cross-org).
  IF v_org IS NULL OR (NOT (v_org IN (SELECT get_my_organization_ids())) AND NOT is_master_user()) THEN
    RAISE EXCEPTION 'forbidden: instance not accessible' USING ERRCODE = '42501';
  END IF;

  INSERT INTO conversation_read_state
    (organization_id, user_id, conversation_key, last_read_at, updated_at)
  VALUES (v_org, auth.uid(), v_key, now(), now())
  ON CONFLICT (organization_id, user_id, conversation_key)
  DO UPDATE SET last_read_at = now(), updated_at = now(), marked_unread = false;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list(p_org uuid, p_instance uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_funnels uuid[] DEFAULT NULL::uuid[], p_stages text[] DEFAULT NULL::text[], p_tags uuid[] DEFAULT NULL::uuid[], p_tiers text[] DEFAULT NULL::text[], p_vendor_id uuid DEFAULT NULL::uuid, p_unassigned boolean DEFAULT NULL::boolean, p_lead_presence text DEFAULT NULL::text, p_needs_human boolean DEFAULT NULL::boolean, p_unread boolean DEFAULT NULL::boolean, p_waiting boolean DEFAULT NULL::boolean, p_source text DEFAULT NULL::text, p_include_groups boolean DEFAULT false)
 RETURNS TABLE(phone_number text, normalized_phone text, push_name text, last_message text, last_message_time timestamp with time zone, last_message_direction text, last_message_sent_source text, lead_id uuid, is_group boolean, conversation_id uuid, archived_at timestamp with time zone, unread_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  -- Instances do chip: a atual mais as já apagadas do mesmo número.
  v_ids uuid[];
  -- Isolamento por responsavel (#1629). Resolvido UMA vez, nao por linha: o
  -- que varia por conversa e so o EXISTS contra `leads`, indexado por
  -- (organization_id, normalized_phone).
  v_iso_on        boolean;
  v_iso_bypass    boolean;
  v_iso_tm        uuid;
  v_iso_unassign  boolean;
  -- Mesmos ids em texto: a chave de leitura é string, não uuid.
  v_keys text[];
BEGIN
  -- Acesso: team_member ativo da org OU master ativo (ghost cross-org).
  --
  -- O `NOT EXISTS`/`COALESCE` aqui é endurecimento DELIBERADO de um gate que já
  -- existia (esta função é reescrita por esta migration, então o furo passaria a
  -- ser nosso): `NOT (x IN (lista com NULL))` devolve NULL, e `IF NULL THEN` não
  -- dispara — gate aberto em vez de erro. Mesma correção aplicada em
  -- `whatsapp_chip_instance_ids`, onde o risco é maior por guardar uma tabela
  -- RLS deny-all. Comportamento inalterado para qualquer entrada não-NULL.
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
  IF p_lead_presence IS NOT NULL AND p_lead_presence NOT IN ('com', 'sem') THEN
    RAISE EXCEPTION 'invalid lead presence' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('ia', 'humano') THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;

  -- Depois do gate: a resolução do chip só roda para org já autorizada. O gate
  -- interno de whatsapp_chip_instance_ids reavalia o mesmo `p_org` no mesmo
  -- contexto de sessão (auth.uid()/auth.role() não mudam ao entrar numa função
  -- SECURITY DEFINER), então quem passou aqui passa lá — a checagem dobrada é
  -- redundância deliberada, não risco de falso negativo.
  v_ids  := whatsapp_chip_instance_ids(p_org, p_instance);
  v_keys := ARRAY(SELECT t.id::text FROM unnest(v_ids) AS t(id));

  -- ── Isolamento por responsavel ─────────────────────────────────────────
  -- Esta funcao e SECURITY DEFINER, entao o RLS de whatsapp_messages NAO se
  -- aplica aqui. Sem este bloco a politica fica decorativa: a tabela fica
  -- fechada e a LISTA -- que e o que o usuario ve -- continua mostrando tudo.
  SELECT COALESCE(o.chat_restrict_to_owner, false) INTO v_iso_on
  FROM public.organizations o WHERE o.id = p_org;

  IF v_iso_on THEN
    SELECT tm.id INTO v_iso_tm
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
      AND tm.organization_id = p_org
      AND tm.is_active = true
    LIMIT 1;

    v_iso_bypass :=
      public.is_master_user()
      OR public.is_user_admin()
      OR (v_iso_tm IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.member_feature_permissions mfp
            WHERE mfp.team_member_id = v_iso_tm
              AND mfp.feature_key = 'leads.view_all'
              AND mfp.enabled));

    v_iso_unassign := v_iso_tm IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.member_feature_permissions mfp
      WHERE mfp.team_member_id = v_iso_tm
        AND mfp.feature_key = 'leads.view_unassigned'
        AND mfp.enabled);
  ELSE
    v_iso_bypass := true;
  END IF;

  RETURN QUERY
  WITH read_state AS (
    SELECT split_part(rs.conversation_key, ':', 3) AS np,
           max(rs.last_read_at) AS last_read_at
    FROM conversation_read_state rs
    WHERE rs.organization_id = p_org AND rs.user_id = v_uid
      AND rs.conversation_key LIKE 'whatsapp:%'
      AND split_part(rs.conversation_key, ':', 2) = ANY(v_keys)
    GROUP BY 1
  ),
  unread AS (
    SELECT m.normalized_phone AS np, count(*)::integer AS cnt
    FROM whatsapp_messages m
    LEFT JOIN read_state r ON r.np = m.normalized_phone
    WHERE m.organization_id = p_org AND m.instance_id = ANY(v_ids)
      -- [grupos] mesma porta do `chip`: sem o parametro, o conjunto de mensagens
      -- contadas e identico ao de hoje. Com ele, a aba de grupos mostra badge de
      -- nao-lida em vez de uma lista muda.
      AND m.direction = 'incoming' AND m.deleted_at IS NULL
      AND (p_include_groups OR m.is_group = false)
      AND m."timestamp" > now() - interval '30 days'
      AND m."timestamp" > COALESCE(r.last_read_at, now() - interval '7 days')
    GROUP BY m.normalized_phone
  ),
  conv AS (
    SELECT c.normalized_phone AS np, c.id, c.archived_at, c.deleted_at,
           c.instance_id, c.created_at
    FROM whatsapp_conversations c
    WHERE c.organization_id = p_org AND c.instance_id = ANY(v_ids)
      AND c.normalized_phone IS NOT NULL
  ),
  -- Uma linha por telefone. Prioriza a Instance viva: arquivar/apagar a thread
  -- é ato do usuário no chip de hoje, e é essa decisão que deve valer.
  conv_pick AS (
    SELECT DISTINCT ON (c2.np) c2.np, c2.id, c2.archived_at, c2.deleted_at
    FROM conv c2
    ORDER BY c2.np, (c2.instance_id = p_instance) DESC,
             c2.created_at DESC NULLS LAST, c2.id
  ),
  -- O chip inteiro, colapsado por telefone antes de qualquer filtro.
  chip AS (
    SELECT DISTINCT ON (s.normalized_phone)
           s.phone_number, s.normalized_phone, s.last_push_name, s.last_message,
           s.last_message_time, s.last_message_direction, s.last_message_sent_source,
           s.lead_id, s.is_group
    FROM whatsapp_conversation_summary s
    WHERE s.organization_id = p_org AND s.instance_id = ANY(v_ids)
      -- [grupos] O recorte continua AQUI, antes do LIMIT e antes de trafegar:
      -- grupo e 978.756 de 2.472.395 mensagens (40%), e baixar tudo para
      -- descartar no navegador foi o custo que #1632 matou. A diferenca e que
      -- agora quem paga esses 40% e so a org que pediu a aba.
      AND (p_include_groups OR s.is_group = false)
      -- Mesma regra do predicado can_see_chat_scope, escrita aqui para caber
      -- num unico EXISTS por conversa em vez de tres lookups por linha.
      AND (
        v_iso_bypass
        -- [grupos] GRUPO NAO TEM DONO. O EXISTS abaixo casa a conversa com um
        -- `leads.normalized_phone`, e o jid de grupo nunca e telefone de lead —
        -- entao, com o isolamento ligado, TODO grupo cairia fora e a aba nasceria
        -- vazia para o vendedor. Uma conversa sem responsavel e exatamente o que
        -- `leads.view_unassigned` governa, e e essa a chave usada aqui: quem ve
        -- nao-atribuido ve grupo; quem nao ve, nao ve. Nao inventa excecao nova.
        OR (s.is_group AND COALESCE(v_iso_unassign, false))
        OR EXISTS (
          SELECT 1 FROM public.leads l
          WHERE l.organization_id  = p_org
            AND l.normalized_phone = s.normalized_phone
            AND l.deleted_at IS NULL
            AND (
              COALESCE(v_iso_tm IN (
                l.pre_sale_responsible_id, l.sale_responsible_id,
                l.sdr_id, l.closer_id
              ), false)
              OR (
                COALESCE(
                  l.pre_sale_responsible_id, l.sale_responsible_id,
                  l.sdr_id, l.closer_id
                ) IS NULL
                AND v_iso_unassign
              )
            )
        )
      )
    ORDER BY s.normalized_phone, s.last_message_time DESC
  ),
  -- Pré-filtro ANTES do LIMIT: é isto que faz o filtro enxergar a base inteira.
  page AS (
    SELECT s.phone_number, s.normalized_phone, s.last_push_name, s.last_message, s.last_message_time,
           s.last_message_direction, s.last_message_sent_source, s.lead_id, s.is_group
    FROM chip s
    WHERE (p_before IS NULL OR s.last_message_time < p_before)

      AND (p_waiting IS NOT TRUE OR s.last_message_direction = 'incoming')
      AND (
        p_source IS NULL
        OR (p_source = 'humano' AND s.last_message_sent_source = 'manual')
        OR (p_source = 'ia' AND s.last_message_sent_source IN ('copilot', 'workflow'))
      )
      AND (
        p_lead_presence IS NULL
        OR (p_lead_presence = 'com' AND s.lead_id IS NOT NULL)
        OR (p_lead_presence = 'sem' AND s.lead_id IS NULL)
      )

      AND (
        p_unread IS NOT TRUE
        OR public.is_conversation_marked_unread(p_org, p_instance, s.normalized_phone)
        OR EXISTS (SELECT 1 FROM unread u WHERE u.np = s.normalized_phone AND u.cnt > 0)
      )

      AND (
        p_needs_human IS NOT TRUE
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM conversations cv
              WHERE cv.organization_id = p_org AND cv.lead_id = s.lead_id
                AND cv.state = 'WAITING_HUMAN'))
      )

      -- `qualification_tier` é ENUM: o cast pro texto permite comparar com o
      -- array de strings da UI — valor desconhecido vira "não casa", não erro.
      AND (
        p_tiers IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.qualification_tier::text = ANY(p_tiers)))
      )

      AND (
        p_unassigned IS NOT TRUE
        OR s.lead_id IS NULL
        OR EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.responsible_id IS NULL)
      )
      AND (
        p_vendor_id IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.responsible_id = p_vendor_id))
      )

      AND (
        p_funnels IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lead_id
                AND pe.pipeline_id = ANY(p_funnels)))
      )

      AND (
        p_stages IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lead_id
                AND pe.stage_key = ANY(p_stages)
                AND (p_funnels IS NULL OR pe.pipeline_id = ANY(p_funnels))))
      )

      AND (
        p_tags IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM lead_tags lt
              WHERE lt.lead_id = s.lead_id AND lt.tag_id = ANY(p_tags)))
        OR EXISTS (
              SELECT 1 FROM conv c3
              JOIN whatsapp_conversation_tags ct ON ct.conversation_id = c3.id
              WHERE c3.np = s.normalized_phone AND ct.tag_id = ANY(p_tags))
      )
    ORDER BY s.last_message_time DESC
    LIMIT v_limit
  )
  SELECT p.phone_number, p.normalized_phone, p.last_push_name, p.last_message, p.last_message_time,
         p.last_message_direction, p.last_message_sent_source, p.lead_id, p.is_group,
         conv.id, conv.archived_at, GREATEST(coalesce(u.cnt, 0), CASE WHEN public.is_conversation_marked_unread(p_org, p_instance, p.normalized_phone) THEN 1 ELSE 0 END)
  FROM page p
  LEFT JOIN conv_pick conv ON conv.np = p.normalized_phone
  LEFT JOIN unread u ON u.np  = p.normalized_phone
  WHERE conv.deleted_at IS NULL
  ORDER BY p.last_message_time DESC;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list_multi(p_org uuid, p_instances uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_funnels uuid[] DEFAULT NULL::uuid[], p_stages text[] DEFAULT NULL::text[], p_tags uuid[] DEFAULT NULL::uuid[], p_tiers text[] DEFAULT NULL::text[], p_vendor_id uuid DEFAULT NULL::uuid, p_unassigned boolean DEFAULT NULL::boolean, p_lead_presence text DEFAULT NULL::text, p_needs_human boolean DEFAULT NULL::boolean, p_unread boolean DEFAULT NULL::boolean, p_waiting boolean DEFAULT NULL::boolean, p_source text DEFAULT NULL::text, p_include_groups boolean DEFAULT false, p_before_box uuid DEFAULT NULL::uuid, p_before_phone text DEFAULT NULL::text)
 RETURNS TABLE(instance_id uuid, phone_number text, normalized_phone text, push_name text, last_message text, last_message_time timestamp with time zone, last_message_direction text, last_message_sent_source text, lead_id uuid, is_group boolean, conversation_id uuid, archived_at timestamp with time zone, unread_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid    := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  -- As caixas que o usuário pode de fato ler, já cruzadas com o pedido.
  v_boxes   uuid[];
  -- O mapa uuid-do-chip → CAIXA, materializado como DOIS arrays paralelos.
  -- Existe para que `whatsapp_chip_instance_ids` seja chamada UMA vez por
  -- requisição, e não duas: antes ela rodava aqui e DE NOVO dentro da CTE
  -- `boxes` do RETURN QUERY, com os mesmos argumentos e em statements
  -- separados — sem reuso de plano, portanto trabalho jogado fora.
  -- MEDIDO com EXPLAIN ANALYZE em prod, como membro ativo da Alamaster:
  -- expandir as 57 caixas custa 49,1 ms (59,5 ms como master), porque cada
  -- chamada é uma plpgsql DEFINER que reavalia `get_my_organization_ids()` e
  -- `is_master_user()` antes de olhar a reap_queue. Duas rodadas eram ~98 ms
  -- por lista, com ~49 ms de desperdício — a mesma ordem de grandeza da
  -- consulta de dados inteira (30-112 ms). No caso comum (1 a 2 caixas, 60 das
  -- 62 orgs) a diferença é ~2 ms e nenhuma das duas formas importa.
  v_box_of    uuid[];
  v_member_of uuid[];
  -- Todos os uuids de todos os chips das caixas acima, achatados. Serve só
  -- para pré-filtrar leitura; o mapeamento uuid → caixa é o par acima.
  v_members uuid[];
  v_keys    text[];
  -- Isolamento por responsável (#1629). Resolvido UMA vez, não por linha.
  v_iso_on       boolean;
  v_iso_bypass   boolean;
  v_iso_tm       uuid;
  v_iso_unassign boolean;
BEGIN
  -- Gate de org, forma canônica. Ver comentário em
  -- whatsapp_readable_instance_ids sobre `NOT EXISTS` e `COALESCE`.
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  -- NÃO existe gate `instance required` aqui: aceitar o conjunto vazio como
  -- "tudo que eu posso ler" é o ponto desta função.
  IF p_lead_presence IS NOT NULL AND p_lead_presence NOT IN ('com', 'sem') THEN
    RAISE EXCEPTION 'invalid lead presence' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('ia', 'humano') THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;

  -- ── Interseção de acesso (D4) ──────────────────────────────────────────
  v_boxes := public.whatsapp_readable_instance_ids(p_org, p_instances);

  -- Conjunto vazio devolve lista vazia, NÃO exceção. Aqui vazio é resposta de
  -- verdade e não sintoma: o gate de org já barrou quem não é da org, e a
  -- interseção só pode esvaziar quando a pessoa pediu caixas que perdeu o
  -- direito de ler. Levantar erro faria uma seleção salva ficar venenosa
  -- depois de uma mudança de permissão, quebrando a tela em vez de mostrá-la
  -- vazia. Instance de outra org também cai aqui — e isso é deliberado: quem
  -- decide o que é acessível é a função, não o argumento.
  IF cardinality(v_boxes) = 0 THEN
    RETURN;
  END IF;

  -- Expansão dos chips, UMA vez. `whatsapp_chip_instance_ids` é o mapa
  -- Instance → uuids históricos do MESMO NÚMERO, e degrada em silêncio por
  -- desenho (número desconhecido devolve o singleton) — a tolerância é
  -- mantida aqui de propósito, porque o front sobe antes da migration.
  --
  -- O `DISTINCT ON (member)` garante PARTIÇÃO: cada uuid pertence a exatamente
  -- uma caixa, então nenhuma conversa é contada duas vezes se dois chips se
  -- sobrepuserem. Medido: hoje isso não acontece — as 36 linhas de
  -- `whatsapp_instance_reap_queue` nunca são Instances vivas, e o único par de
  -- Instances vivas que divide número (Basic4u, "Bruna Basic4u" e "bruna 2",
  -- 554797890485) tem chips singleton e disjuntos. A guarda é para o dia em
  -- que isso mudar, e custa uma ordenação sobre no máximo 57 linhas.
  -- O desempate prefere a caixa que É o próprio uuid, depois a menor.
  SELECT array_agg(x.box ORDER BY x.member), array_agg(x.member ORDER BY x.member)
    INTO v_box_of, v_member_of
    FROM (
      SELECT DISTINCT ON (mm.member) b.box, mm.member
        FROM unnest(v_boxes) AS b(box)
        CROSS JOIN LATERAL unnest(public.whatsapp_chip_instance_ids(p_org, b.box)) AS mm(member)
       ORDER BY mm.member, (mm.member = b.box) DESC, b.box
    ) x;

  -- `array_agg` de zero linhas devolve NULL. Aqui isso só aconteceria se a
  -- função de chip devolvesse vazio para TODAS as caixas — impossível pelo
  -- corpo dela, que devolve ao menos o singleton, mas NULL viraria mapa vazio e
  -- lista vazia, e vazio pareceria resposta. A identidade é o fallback correto.
  IF v_member_of IS NULL THEN
    v_box_of    := v_boxes;
    v_member_of := v_boxes;
  END IF;

  v_members := v_member_of;
  v_keys    := ARRAY(SELECT t.m::text FROM unnest(v_members) AS t(m));

  -- ── Isolamento por responsável ─────────────────────────────────────────
  -- Bloco copiado da função viva, com a mesma semântica — com UMA divergência
  -- deliberada, documentada no lugar dela, algumas linhas abaixo. Esta função é
  -- SECURITY DEFINER, então o RLS de whatsapp_messages NÃO se aplica aqui: sem
  -- este bloco a política fica decorativa — a tabela fecha e a LISTA, que é o
  -- que o usuário vê, continua mostrando tudo.
  --
  -- Nota de cobertura: medido em produção, as DUAS únicas orgs com
  -- `chat_restrict_to_owner = true` (Goletric Perdizes e Goletric Pinheiros)
  -- têm ZERO whatsapp_instances. Nenhuma org exercita este bloco hoje, o que
  -- significa que ele não tem cobertura viva — mais uma razão para copiá-lo
  -- literalmente em vez de "melhorá-lo" aqui.
  SELECT COALESCE(o.chat_restrict_to_owner, false) INTO v_iso_on
  FROM public.organizations o WHERE o.id = p_org;

  IF v_iso_on THEN
    SELECT tm.id INTO v_iso_tm
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
      AND tm.organization_id = p_org
      AND tm.is_active = true
    LIMIT 1;

    -- DIVERGÊNCIA DELIBERADA da função viva, e é a única do bloco: ela usa
    -- `is_user_admin()`, que é ORG-AGNÓSTICA (corpo vivo:
    -- `EXISTS(user_roles WHERE user_id=auth.uid() AND role='admin')` OR
    -- `EXISTS(team_members WHERE user_id=auth.uid() AND role='admin' AND
    -- is_active)` — sem `organization_id` em nenhum dos dois ramos). Com ela,
    -- quem é admin em QUALQUER org derrubaria o recorte por responsável de uma
    -- org onde é membro raso. O cabeçalho desta migration argumenta contra isso
    -- 280 linhas acima, e usá-la aqui deixaria o arquivo incoerente consigo.
    -- Exposição hoje é ZERO, medida nas duas pontas: das 147 linhas
    -- `user_roles.role='admin'`, nenhuma é de alguém que seja membro não-admin
    -- de alguma org; e das 2 orgs com `chat_restrict_to_owner`, nenhuma tem
    -- whatsapp_instance. É latente, não vivo — e a irmã nasce sem ele.
    -- `is_org_admin(p_org)` já embute o master e já exige `is_active`.
    v_iso_bypass :=
      public.is_org_admin(p_org)
      OR (v_iso_tm IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.member_feature_permissions mfp
            WHERE mfp.team_member_id = v_iso_tm
              AND mfp.feature_key = 'leads.view_all'
              AND mfp.enabled));

    v_iso_unassign := v_iso_tm IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.member_feature_permissions mfp
      WHERE mfp.team_member_id = v_iso_tm
        AND mfp.feature_key = 'leads.view_unassigned'
        AND mfp.enabled);
  ELSE
    v_iso_bypass := true;
  END IF;

  RETURN QUERY
  -- Mapa uuid-do-chip → CAIXA. É este `box` que sai no retorno: a caixa que a
  -- pessoa marcou na tela, NUNCA um uuid histórico do chip — a linha tem que
  -- dizer por qual número ela vai responder, e um uuid de instância já
  -- excluída não é resposta.
  --
  -- A partição já foi calculada acima, com UMA passada por
  -- `whatsapp_chip_instance_ids`. Aqui ela só é desempacotada.
  WITH boxes AS (
    SELECT u.box, u.member
    FROM unnest(v_box_of, v_member_of) AS u(box, member)
  ),
  -- Leitura por (caixa, telefone). A chave é `whatsapp:<instance>:<telefone>`
  -- — confirmado em prod: 19.038 linhas nesse namespace, segmento 2 sempre um
  -- uuid de 36 chars, sobre 188 Instances distintas.
  -- `max(last_read_at)` colapsa o CHIP (ter lido no número antigo conta), mas
  -- NUNCA colapsa caixas diferentes: agrupa por `box`. A função atual agrupa
  -- só por telefone, o que com uma caixa só dá no mesmo e com várias faria a
  -- leitura de uma caixa zerar o contador de outra.
  read_state AS (
    SELECT bx.box AS box,
           split_part(rs.conversation_key, ':', 3) AS np,
           max(rs.last_read_at) AS last_read_at
    FROM public.conversation_read_state rs
    JOIN boxes bx ON bx.member::text = split_part(rs.conversation_key, ':', 2)
    WHERE rs.organization_id = p_org AND rs.user_id = v_uid
      AND rs.conversation_key LIKE 'whatsapp:%'
      AND split_part(rs.conversation_key, ':', 2) = ANY(v_keys)
    GROUP BY 1, 2
  ),
  -- Uma linha de `whatsapp_conversations` por (caixa, telefone), para o
  -- `conversation_id` / `archived_at` / `deleted_at`. O desempate prefere a
  -- Instance viva da própria caixa: arquivar ou apagar a thread é ato do
  -- usuário no chip de hoje, e é essa decisão que deve valer.
  conv AS (
    SELECT bx.box AS box, c.normalized_phone AS np, c.id, c.archived_at,
           c.deleted_at, c.instance_id AS inst, c.created_at
    FROM public.whatsapp_conversations c
    JOIN boxes bx ON bx.member = c.instance_id
    WHERE c.organization_id = p_org
      AND c.instance_id = ANY(v_members)
      AND c.normalized_phone IS NOT NULL
  ),
  conv_pick AS (
    SELECT DISTINCT ON (c2.box, c2.np)
           c2.box, c2.np, c2.id, c2.archived_at, c2.deleted_at
    FROM conv c2
    ORDER BY c2.box, c2.np, (c2.inst = c2.box) DESC,
             c2.created_at DESC NULLS LAST, c2.id
  ),
  -- O conjunto inteiro, colapsado por (CAIXA, telefone) antes de qualquer
  -- filtro. `whatsapp_conversation_summary` já tem PK
  -- (organization_id, instance_id, normalized_phone), então dentro de uma
  -- Instance a linha é única; o que este DISTINCT ON colapsa são os uuids
  -- HISTÓRICOS do chip, ficando com a mensagem mais recente do número.
  chip AS (
    SELECT DISTINCT ON (bx.box, s.normalized_phone)
           bx.box AS box,
           s.phone_number, s.normalized_phone, s.last_push_name, s.last_message,
           s.last_message_time, s.last_message_direction, s.last_message_sent_source,
           s.lead_id AS lid, s.is_group AS grp
    FROM public.whatsapp_conversation_summary s
    JOIN boxes bx ON bx.member = s.instance_id
    WHERE s.organization_id = p_org
      AND s.instance_id = ANY(v_members)
      -- Grupo é 978.756 de 2.472.395 mensagens (40%): o recorte fica AQUI,
      -- antes do LIMIT e antes de trafegar.
      AND (p_include_groups OR s.is_group = false)
      -- Mesma regra do predicado can_see_chat_scope, escrita aqui para caber
      -- num único EXISTS por conversa em vez de três lookups por linha.
      AND (
        v_iso_bypass
        -- GRUPO NÃO TEM DONO: o EXISTS abaixo casa por
        -- `leads.normalized_phone`, e jid de grupo nunca é telefone de lead.
        -- Quem vê não-atribuído vê grupo; quem não vê, não vê.
        OR (s.is_group AND COALESCE(v_iso_unassign, false))
        OR EXISTS (
          SELECT 1 FROM public.leads l
          WHERE l.organization_id  = p_org
            AND l.normalized_phone = s.normalized_phone
            AND l.deleted_at IS NULL
            AND (
              COALESCE(v_iso_tm IN (
                l.pre_sale_responsible_id, l.sale_responsible_id,
                l.sdr_id, l.closer_id
              ), false)
              OR (
                COALESCE(
                  l.pre_sale_responsible_id, l.sale_responsible_id,
                  l.sdr_id, l.closer_id
                ) IS NULL
                AND v_iso_unassign
              )
            )
        )
      )
    ORDER BY bx.box, s.normalized_phone, s.last_message_time DESC
  ),
  -- Pré-filtro ANTES do LIMIT: é isto que faz o filtro enxergar a base inteira.
  -- O LIMIT é GLOBAL sobre o conjunto (D3) — a ordenação por recência é sobre
  -- a união das caixas, não por caixa.
  page AS (
    SELECT s.box, s.phone_number, s.normalized_phone, s.last_push_name,
           s.last_message, s.last_message_time, s.last_message_direction,
           s.last_message_sent_source, s.lid, s.grp
    FROM chip s
      -- CURSOR COMPOSTO — ver bloco (B) do cabeçalho. `<` estrito sobre
      -- `last_message_time` sozinho apaga conversa real na borda da página
      -- quando há empate, e sobre o CONJUNTO empate é regime, não cauda:
      -- medido, 22 conversas somem para sempre na rolagem da Alamaster.
      -- A tupla é comparada NA MESMA ORDEM e na MESMA DIREÇÃO do ORDER BY.
      -- Cursor PARCIAL (só `p_before`, o contrato antigo) devolve o empate
      -- inteiro de novo em vez de perdê-lo: repetir é visível, sumir não.
    WHERE (
        p_before IS NULL
        OR s.last_message_time < p_before
        OR (s.last_message_time = p_before
            AND (p_before_box IS NULL
                 OR p_before_phone IS NULL
                 OR (s.box, s.normalized_phone) < (p_before_box, p_before_phone)))
      )

      AND (p_waiting IS NOT TRUE OR s.last_message_direction = 'incoming')
      AND (
        p_source IS NULL
        OR (p_source = 'humano' AND s.last_message_sent_source = 'manual')
        OR (p_source = 'ia' AND s.last_message_sent_source IN ('copilot', 'workflow'))
      )
      AND (
        p_lead_presence IS NULL
        OR (p_lead_presence = 'com' AND s.lid IS NOT NULL)
        OR (p_lead_presence = 'sem' AND s.lid IS NULL)
      )

      -- FILTRO de não-lida: `EXISTS`, não contagem. Ver bloco (C) no cabeçalho
      -- — 22 ms contra 5,8 s do agregado, porque curto-circuita na primeira
      -- mensagem e deixa o planner parar no LIMIT.
      AND (
        p_unread IS NOT TRUE
        OR public.is_conversation_marked_unread(p_org, s.box, s.normalized_phone)
        OR EXISTS (
             SELECT 1
             FROM public.whatsapp_messages m
             LEFT JOIN read_state r ON r.box = s.box AND r.np = s.normalized_phone
             WHERE m.organization_id  = p_org
               -- SÓ o chip DESTA caixa, nunca `= ANY(v_members)`: v_members é o
               -- achatado de TODOS os chips, e um telefone que fala com duas
               -- caixas passaria no filtro por causa da mensagem da OUTRA.
               AND m.instance_id IN (SELECT bb.member FROM boxes bb WHERE bb.box = s.box)
               AND m.normalized_phone = s.normalized_phone
               AND m.direction        = 'incoming'
               AND m.deleted_at IS NULL
               AND (p_include_groups OR m.is_group = false)
               AND m."timestamp" > now() - interval '30 days'
               AND m."timestamp" > COALESCE(r.last_read_at, now() - interval '7 days')
           )
      )

      AND (
        p_needs_human IS NOT TRUE
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.conversations cv
              WHERE cv.organization_id = p_org AND cv.lead_id = s.lid
                AND cv.state = 'WAITING_HUMAN'))
      )

      -- `qualification_tier` é ENUM: o cast pro texto permite comparar com o
      -- array de strings da UI — valor desconhecido vira "não casa", não erro.
      AND (
        p_tiers IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.leads l
              WHERE l.id = s.lid AND l.organization_id = p_org
                AND l.qualification_tier::text = ANY(p_tiers)))
      )

      AND (
        p_unassigned IS NOT TRUE
        OR s.lid IS NULL
        OR EXISTS (
              SELECT 1 FROM public.leads l
              WHERE l.id = s.lid AND l.organization_id = p_org
                AND l.responsible_id IS NULL)
      )
      AND (
        p_vendor_id IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.leads l
              WHERE l.id = s.lid AND l.organization_id = p_org
                AND l.responsible_id = p_vendor_id))
      )

      AND (
        p_funnels IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lid
                AND pe.pipeline_id = ANY(p_funnels)))
      )

      AND (
        p_stages IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lid
                AND pe.stage_key = ANY(p_stages)
                AND (p_funnels IS NULL OR pe.pipeline_id = ANY(p_funnels))))
      )

      -- A tag da CONVERSA é procurada dentro da MESMA caixa (`c3.box = s.box`).
      -- Sem isso, a etiqueta posta numa caixa faria a conversa homônima de
      -- outra caixa aparecer no filtro.
      AND (
        p_tags IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.lead_tags lt
              WHERE lt.lead_id = s.lid AND lt.tag_id = ANY(p_tags)))
        OR EXISTS (
              SELECT 1 FROM conv c3
              JOIN public.whatsapp_conversation_tags ct ON ct.conversation_id = c3.id
              WHERE c3.box = s.box AND c3.np = s.normalized_phone
                AND ct.tag_id = ANY(p_tags))
      )
    -- ORDEM TOTAL. `(box, normalized_phone)` é a chave do DISTINCT ON de `chip`,
    -- logo é única, logo esta ordenação não tem empate — e é ela que torna o
    -- cursor composto acima uma posição, e não um grupo. As três colunas DESC.
    ORDER BY s.last_message_time DESC, s.box DESC, s.normalized_phone DESC
    LIMIT v_limit
  )
  SELECT p.box, p.phone_number, p.normalized_phone, p.last_push_name, p.last_message,
         p.last_message_time, p.last_message_direction, p.last_message_sent_source,
         p.lid, p.grp, cp.id, cp.archived_at, GREATEST(COALESCE(u.cnt, 0)::integer, CASE WHEN public.is_conversation_marked_unread(p_org, p.box, p.normalized_phone) THEN 1 ELSE 0 END)
  FROM page p
  LEFT JOIN conv_pick cp ON cp.box = p.box AND cp.np = p.normalized_phone
  -- CONTAGEM de não-lida: só para as linhas da página, depois do LIMIT.
  -- Ver bloco (C) no cabeçalho — 112 ms a quente para 50 conversas nas 57
  -- caixas da Alamaster, contra 5,8 s do agregado sobre o conjunto inteiro.
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.whatsapp_messages m
    LEFT JOIN read_state r ON r.box = p.box AND r.np = p.normalized_phone
    WHERE m.organization_id  = p_org
      -- SÓ o chip DESTA caixa. `= ANY(v_members)` somaria as não-lidas de
      -- TODAS as caixas na linha de cada uma: o contato que fala com duas
      -- caixas mostraria o mesmo total inflado nas duas linhas.
      AND m.instance_id IN (SELECT bb.member FROM boxes bb WHERE bb.box = p.box)
      AND m.normalized_phone = p.normalized_phone
      AND m.direction        = 'incoming'
      AND m.deleted_at IS NULL
      AND (p_include_groups OR m.is_group = false)
      AND m."timestamp" > now() - interval '30 days'
      AND m."timestamp" > COALESCE(r.last_read_at, now() - interval '7 days')
  ) u ON true
  WHERE cp.deleted_at IS NULL
  -- Mesma ordem TOTAL do CTE `page`: é desta última linha que o cliente tira o
  -- cursor da página seguinte, então as duas ordenações têm que coincidir.
  ORDER BY p.last_message_time DESC, p.box DESC, p.normalized_phone DESC;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_unread_counts(p_instance_ids uuid[])
RETURNS TABLE(instance_id uuid, normalized_phone text, unread integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 WITH natural_unread AS (SELECT m.instance_id, m.normalized_phone, count(*)::int AS unread
  FROM public.whatsapp_messages m
  LEFT JOIN public.conversation_read_state rs
    ON  rs.organization_id = m.organization_id
    AND rs.user_id         = auth.uid()
    AND rs.conversation_key = 'whatsapp:' || m.instance_id::text || ':' || m.normalized_phone
  WHERE m.organization_id IN (SELECT public.get_my_organization_ids())
    AND m.instance_id = ANY (p_instance_ids)
    AND m.direction = 'incoming' AND m.deleted_at IS NULL AND m.is_group = false
    AND m."timestamp" > now() - interval '30 days'
    AND m."timestamp" > COALESCE(rs.last_read_at, now() - interval '7 days')
  GROUP BY m.instance_id, m.normalized_phone), combined AS (
 SELECT * FROM natural_unread
 UNION ALL
 SELECT i.id, split_part(rs.conversation_key, ':', 3), 1
 FROM public.conversation_read_state rs
 JOIN public.whatsapp_instances i ON rs.conversation_key LIKE 'whatsapp:' || i.id::text || ':%'
 AND i.organization_id = rs.organization_id
 WHERE rs.user_id = auth.uid() AND rs.marked_unread
 AND rs.organization_id IN (SELECT public.get_my_organization_ids())
 AND i.id = ANY(p_instance_ids)
 ) SELECT instance_id, normalized_phone, max(unread)::integer FROM combined GROUP BY instance_id,normalized_phone;
$$;
CREATE OR REPLACE FUNCTION public.get_unread_total(p_instance_ids uuid[])
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT coalesce(sum(unread),0)::integer FROM public.get_unread_counts(p_instance_ids);
$$;
