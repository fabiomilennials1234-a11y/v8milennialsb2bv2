-- ============================================================================
-- Migration: o @usuário do interlocutor vira COLUNA e ATRIBUTO DA IDENTIDADE
-- Data: 2026-08-17
--
-- ─── POR QUE ─────────────────────────────────────────────────────────────────
--
--   A primeira mensagem real de Instagram (2026-08-17 17:25 UTC) provou que o
--   fornecedor MANDA o @ do interlocutor, em `message.visitor.name` — contra o
--   que o handoff desta fatia afirmava. Ele chegava e morria dentro do
--   `raw_payload`.
--
--   Preso em jsonb, o @ não serve para nada do que ele existe para servir: o
--   detector de duplicatas precisa COMPARAR o @ do Instagram com o que o
--   vendedor anotou no lead, e ninguém faz isso varrendo jsonb linha a linha.
--   Em coluna, ele é pesquisável, indexável e citável na tela.
--
--   É o SEGUNDO sinal de identidade da fatia, ao lado do telefone digitado no
--   texto da conversa. E é o único que chega de graça, em toda mensagem.
--
-- ─── O QUE MUDA ──────────────────────────────────────────────────────────────
--   1. `channel_messages.contact_handle` — o @ de QUEM ESTÁ DO OUTRO LADO;
--   2. índice por (org, @) para o detector — parcial, porque WhatsApp não tem @;
--   3. backfill do que já chegou, a partir do `raw_payload` guardado;
--   4. `get_social_conversation_list` devolve o @ (DROP+CREATE: muda RETURNS);
--   5. as duas RPCs de vínculo passam a gravar o @ em `lead_social_identities`.
--
-- ⚠️ `handle` é ATRIBUTO, nunca chave: o @ muda, o IGSID não. É por isso que ele
--    entra com COALESCE no UPDATE de reafirmação e fica FORA de todo índice
--    único — a mesma regra que o COMMENT da coluna já declarava.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A coluna.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS contact_handle TEXT;

COMMENT ON COLUMN public.channel_messages.contact_handle IS
  'O @usuário do INTERLOCUTOR (nunca o da nossa conta, que mora em '
  'messaging_channels.handle). Vem de `message.visitor.name` no corpo do '
  'NotificaMe — que é o @, e NÃO o nome humano: esse último está em '
  '`visitor.firstName` e vai para sender_name. A inversão é do fornecedor e foi '
  'medida no primeiro payload real. NULL para WhatsApp, que não tem @.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O índice do detector.
--
--    PARCIAL e por ORG: a busca é sempre "este @ existe nesta organização?", e
--    a esmagadora maioria das linhas é WhatsApp, que não tem @ nenhum. Índice
--    total pagaria escrita em 10.982 linhas para indexar NULL.
--
--    `lower()` porque @ do Instagram é case-insensitive na prática e o vendedor
--    digita como quiser ao anotar no lead.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_channel_messages_org_contact_handle
  ON public.channel_messages (organization_id, lower(contact_handle))
  WHERE contact_handle IS NOT NULL;

COMMENT ON INDEX public.idx_channel_messages_org_contact_handle IS
  'Casamento por @usuário no detector de leads duplicados: dado um @, quais '
  'conversas desta org pertencem a ele. Parcial porque WhatsApp não tem @.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill do que já chegou.
--
--    O `raw_payload` guarda o corpo INTEGRAL desde sempre — é exatamente para
--    isto que ele existe. As mensagens que entraram antes desta coluna não
--    precisam ser reenviadas pelo fornecedor.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.channel_messages
   SET contact_handle = raw_payload -> 'message' -> 'visitor' ->> 'name'
 WHERE contact_handle IS NULL
   AND direction = 'incoming'
   AND raw_payload -> 'message' -> 'visitor' ->> 'name' IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. A lista devolve o @. DROP+CREATE porque o RETURNS TABLE muda (42P13).
--    ⚠️ O DROP LEVA OS GRANTS — refeitos no bloco 6.
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
  contact_handle text,
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
   WHERE p_before IS NULL OR t.ts < p_before
   ORDER BY t.ts DESC
   LIMIT v_limit;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. As RPCs de vínculo gravam o @ na identidade social.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_handle       text;
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
  SELECT m.sender_name, m.sender_profile_pic, m.contact_handle, m."timestamp"
    INTO v_name, v_pic, v_handle, v_seen
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
    display_name, avatar_url, handle, messaging_channel_id, linked_by, last_seen_at
  ) VALUES (
    p_org, p_lead_id, COALESCE(v_provider, 'notificame'), v_channel_type,
    btrim(p_external_user_id), v_name, v_pic, v_handle, p_channel, v_actor, v_seen
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
           -- O @ MUDA (o IGSID não). Reafirmar a cada vínculo mantém o rótulo
           -- vivo sem tocar em chave nenhuma — é para isso que ele é atributo.
           handle               = COALESCE(v_handle, si.handle),
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
      'handle', v_handle,
      'messages_backfilled', v_backfilled,
      -- Trilha do ator quando ele é master sem team_member na org: `linked_by`
      -- fica NULL e este campo é a única resposta para "quem fez isso?".
      'master_user_id', CASE WHEN v_actor IS NULL THEN v_uid ELSE NULL END
    )
  );

  RETURN v_identity_id;
END;
$function$;

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
  v_handle       text;
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
  SELECT m.sender_name, m.sender_profile_pic, m.contact_handle, m."timestamp"
    INTO v_disp_name, v_pic, v_handle, v_seen
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
    display_name, avatar_url, handle, messaging_channel_id, linked_by, last_seen_at
  ) VALUES (
    p_org, v_lead_id, COALESCE(v_provider, 'notificame'), v_channel_type, v_ext,
    v_disp_name, v_pic, v_handle, p_channel, v_actor, v_seen
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Grants — refeitos, porque CREATE [OR REPLACE] os devolve ao default.
--
--    `CREATE OR REPLACE FUNCTION` reconcede EXECUTE a PUBLIC e a `anon` (default
--    privilege do Supabase no schema public), e o DROP do bloco 4 apagou os da
--    lista. Esquecer aqui é silencioso das duas maneiras: continua funcionando
--    para `authenticated` e ganha superfície para `anon` sem ninguém notar.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.link_social_conversation_to_lead(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.link_social_conversation_to_lead(uuid, uuid, text, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.create_lead_from_social_conversation(uuid, uuid, text, text, text, text, text, text, uuid, uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_lead_from_social_conversation(uuid, uuid, text, text, text, text, text, text, uuid, uuid, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz)
  TO service_role;
