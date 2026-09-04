-- Rollback: restaura os quatro corpos capturados de PROD antes da SCRUM-674 passo 3.
-- Aplicar como migration nova; nunca editar/apagar a migration já aplicada.

CREATE OR REPLACE FUNCTION public.abrir_negocio(p_lead_id uuid, p_pipe text, p_stage text, p_owner_id uuid DEFAULT NULL::uuid, p_value numeric DEFAULT NULL::numeric, p_meeting_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_source text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_org        uuid;
  v_tz         text;
  v_deal_id    uuid;
  v_entry_id   uuid := gen_random_uuid();
  v_title      text;
  v_pip        public.pipelines%ROWTYPE;
  v_stage_txt  text := NULLIF(btrim(COALESCE(p_stage, '')), '');
  v_stage_id   uuid;
  v_notes      text := NULLIF(btrim(COALESCE(p_notes, '')), '');
BEGIN
  -- A org vem do LEAD, nunca de parâmetro. Com RLS de invoker, um lead de outra
  -- organização simplesmente não é visível e a função aborta aqui — o chamador
  -- não consegue escolher em qual org escreve.
  SELECT l.organization_id INTO v_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Lead % não encontrado (ou está na lixeira).', p_lead_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- O CHECK da coluna também recusa, mas a mensagem dele fala de constraint.
  -- Esta diz o que fazer, e é a que o integrador lê.
  IF p_source IS NOT NULL
     AND p_source NOT IN ('human','workflow','api','import','backfill') THEN
    RAISE EXCEPTION 'Procedência inválida: %. Válidas: human, workflow, api, import, backfill.', p_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Qualquer funil, por id/slug/alias — erra alto antes de escrever qualquer
  -- coisa. 'upsell' segue sem porta aqui: não existe linha em `pipelines` com
  -- esse slug (carteira entra por regra própria, ADR-0023 decisão 8), então o
  -- resolvedor recusa com "não existe" — mesmo destino do ELSE antigo.
  v_pip := public.fn_resolver_funil(v_org, p_pipe);

  SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = v_org;

  -- Dono de outra org é recusado aqui, e não só pela trava do M6: a mensagem
  -- daqui diz o que aconteceu, a do gatilho diz que uma constraint falhou.
  IF p_owner_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.team_members m
                      WHERE m.id = p_owner_id AND m.organization_id = v_org) THEN
    RAISE EXCEPTION 'Responsável % não pertence à organização deste lead.', p_owner_id
      USING ERRCODE = 'check_violation';
  END IF;

  v_title := COALESCE(
    NULLIF(btrim(COALESCE(p_title, '')), ''),
    public.fn_negocio_titulo_padrao(now(), v_tz)
  );

  INSERT INTO public.deals (organization_id, title, source_lead_id, owner_id, value, notes, created_by, source)
  VALUES (v_org, v_title, p_lead_id, p_owner_id, p_value, v_notes, auth.uid(), p_source)
  RETURNING id INTO v_deal_id;

  IF v_pip.type = 'custom' THEN
    -- Etapa por stage_key OU uuid. O catálogo (`api_list_pipelines`) publica os
    -- dois; antes só o uuid era aceito e stage_key quebrava com "invalid input
    -- syntax for type uuid" — erro de encanamento no lugar de erro de domínio.
    IF v_stage_txt IS NULL THEN
      RAISE EXCEPTION 'Etapa é obrigatória para abrir Negócio em funil personalizado.'
        USING ERRCODE = 'invalid_parameter_value';
    ELSIF v_stage_txt ~ v_uuid_re THEN
      v_stage_id := v_stage_txt::uuid;  -- pertencimento ao funil é validado pela view
    ELSE
      SELECT ps.id INTO v_stage_id
        FROM public.pipeline_stages ps
       WHERE ps.organization_id = v_org
         AND ps.pipeline_id = v_pip.id
         AND ps.stage_key = v_stage_txt;
      IF v_stage_id IS NULL THEN
        RAISE EXCEPTION 'Etapa "%" não existe no funil %.', v_stage_txt, v_pip.id
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END IF;

    -- Caminho único pós-621: a view escreve em pipeline_entries e valida
    -- funil/etapa/tenancy no INSTEAD OF. Já nasce ligada ao negócio.
    INSERT INTO public.custom_pipe_entries
      (id, pipeline_id, lead_id, organization_id, stage_id, assigned_to, notes, deal_id)
    VALUES (v_entry_id, v_pip.id, p_lead_id, v_org, v_stage_id, p_owner_id, v_notes, v_deal_id);

  ELSIF v_pip.slug = 'whatsapp' THEN
    INSERT INTO public.pipe_whatsapp
      (id, lead_id, organization_id, status, responsible_id, sdr_id, notes)
    VALUES (v_entry_id, p_lead_id, v_org, v_stage_txt, p_owner_id, p_owner_id, v_notes);

  ELSIF v_pip.slug = 'confirmacao' THEN
    INSERT INTO public.pipe_confirmacao
      (id, lead_id, organization_id, status, responsible_id, sdr_id, meeting_date, notes)
    VALUES (v_entry_id, p_lead_id, v_org, v_stage_txt, p_owner_id, p_owner_id, p_meeting_date, v_notes);

  ELSIF v_pip.slug = 'propostas' THEN
    INSERT INTO public.pipe_propostas
      (id, lead_id, organization_id, status, responsible_id, closer_id, sale_value, notes)
    VALUES (v_entry_id, p_lead_id, v_org, v_stage_txt, p_owner_id, p_owner_id, p_value, v_notes);

  ELSE
    -- Funil de sistema com slug sem porta própria (não existe em prod hoje —
    -- medido 2026-09-02: só whatsapp/confirmacao/propostas). Erra alto em vez
    -- de inventar um caminho.
    RAISE EXCEPTION 'Funil % não abre negócio por esta porta.', v_pip.slug
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Liga a posição à identidade. Nos funis de sistema a linha nasceu pelo
  -- `INSTEAD OF` da view, que não conhece `deal_id`; no custom já nasceu ligada.
  IF v_pip.type <> 'custom' THEN
    UPDATE public.pipeline_entries SET deal_id = v_deal_id WHERE id = v_entry_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Card criado mas não encontrado para ligar ao negócio (entry %). Transação desfeita para não deixar negócio sem posição.', v_entry_id
        USING ERRCODE = 'internal_error';
    END IF;
  END IF;

  RETURN v_deal_id;
END;
$function$;


-- ============================================================

CREATE OR REPLACE FUNCTION public.create_lead_from_social_conversation(p_org uuid, p_channel uuid, p_external_user_id text, p_name text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_company text DEFAULT NULL::text, p_destination text DEFAULT 'qualificacao'::text, p_campanha_id uuid DEFAULT NULL::uuid, p_custom_pipeline_id uuid DEFAULT NULL::uuid, p_custom_stage_id uuid DEFAULT NULL::uuid)
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
      SELECT 1 FROM public.pipelines cp
       WHERE cp.type = 'custom'
         AND cp.id = p_custom_pipeline_id
         AND cp.organization_id = p_org
         AND cp.is_active = true
    ) THEN
      RAISE EXCEPTION 'forbidden: custom pipeline not in org' USING ERRCODE = '42501';
    END IF;
    -- Guard de integridade: a etapa tem de ser DESTE funil.
    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_stages cps
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


-- ============================================================

CREATE OR REPLACE FUNCTION public.create_lead_with_pipe(p_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_normalized_phone text DEFAULT NULL::text, p_company text DEFAULT NULL::text, p_origin text DEFAULT 'outro'::text, p_organization_id uuid DEFAULT NULL::uuid, p_sdr_id uuid DEFAULT NULL::uuid, p_closer_id uuid DEFAULT NULL::uuid, p_rating integer DEFAULT 0, p_notes text DEFAULT NULL::text, p_segment text DEFAULT NULL::text, p_faturamento text DEFAULT NULL::text, p_urgency text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_meeting_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_compromisso_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_utm_source text DEFAULT NULL::text, p_utm_medium text DEFAULT NULL::text, p_utm_campaign text DEFAULT NULL::text, p_utm_term text DEFAULT NULL::text, p_utm_content text DEFAULT NULL::text, p_pipe_type text DEFAULT NULL::text, p_pipe_status text DEFAULT NULL::text, p_pipe_meeting_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_meet_link text DEFAULT NULL::text, p_pipe_responsible_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_id UUID;
  v_pipe_id UUID;
  v_result JSONB;
BEGIN
  PERFORM public.assert_org_access(p_organization_id);
  -- Insert lead
  INSERT INTO public.leads (
    name, email, phone, normalized_phone, company, origin,
    organization_id, sdr_id, closer_id, rating, notes,
    segment, faturamento, urgency, responsible_id,
    meeting_date, compromisso_date,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content
  ) VALUES (
    p_name, p_email, p_phone, p_normalized_phone, p_company, p_origin,
    p_organization_id, p_sdr_id, p_closer_id, p_rating, p_notes,
    p_segment, p_faturamento, p_urgency, p_responsible_id,
    p_meeting_date, p_compromisso_date,
    p_utm_source, p_utm_medium, p_utm_campaign, p_utm_term, p_utm_content
  )
  RETURNING id INTO v_lead_id;

  v_result := jsonb_build_object('lead_id', v_lead_id, 'pipe_id', NULL, 'pipe_type', p_pipe_type);

  -- Insert pipe entry if requested
  IF p_pipe_type = 'whatsapp' THEN
    INSERT INTO public.pipe_whatsapp (
      lead_id, organization_id, status, responsible_id, sdr_id
    ) VALUES (
      v_lead_id, p_organization_id,
      COALESCE(p_pipe_status, 'novo'),
      p_pipe_responsible_id,
      p_sdr_id
    )
    RETURNING id INTO v_pipe_id;
    v_result := v_result || jsonb_build_object('pipe_id', v_pipe_id);

  ELSIF p_pipe_type = 'confirmacao' THEN
    INSERT INTO public.pipe_confirmacao (
      lead_id, organization_id, status, meeting_date,
      meet_link, sdr_id, closer_id, responsible_id
    ) VALUES (
      v_lead_id, p_organization_id,
      COALESCE(p_pipe_status, 'reuniao_marcada'),
      p_pipe_meeting_date, p_meet_link,
      p_sdr_id, p_closer_id,
      COALESCE(p_pipe_responsible_id, p_sdr_id, p_closer_id)
    )
    RETURNING id INTO v_pipe_id;
    v_result := v_result || jsonb_build_object('pipe_id', v_pipe_id);
  END IF;

  RETURN v_result;
END;
$function$;


-- ============================================================

CREATE OR REPLACE FUNCTION public.import_lead_into_custom_pipeline(p_organization_id uuid, p_lead jsonb, p_pipeline_id uuid, p_stage_id uuid, p_assigned_to uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead_id uuid;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id é obrigatório';
  END IF;

  -- Guard de tenant: o funil tem que ser da org que está importando. Sem isto,
  -- um organization_id de uma org e um pipeline_id de outra criariam o card no
  -- funil do vizinho.
  IF NOT EXISTS (
    SELECT 1 FROM public.pipelines
    WHERE type = 'custom'
      AND id = p_pipeline_id
      AND organization_id = p_organization_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Pipeline custom % não pertence à organização % ou está inativo',
      p_pipeline_id, p_organization_id;
  END IF;

  -- Guard de integridade: a etapa tem que ser DESTE funil.
  IF NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE id = p_stage_id
      AND pipeline_id = p_pipeline_id
  ) THEN
    RAISE EXCEPTION 'Etapa % não pertence ao pipeline %', p_stage_id, p_pipeline_id;
  END IF;

  -- Guard de tenant no responsável: impede carimbar um membro de outra org.
  IF p_assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE id = p_assigned_to
      AND organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Responsável % não pertence à organização %',
      p_assigned_to, p_organization_id;
  END IF;

  -- Escopo `true` = LOCAL: vale só até o fim desta transação. Não vaza pra
  -- próxima query da mesma conexão (pooler reusa conexão entre requests).
  PERFORM set_config('app.skip_default_pipe', '1', true);

  INSERT INTO public.leads (
    organization_id, name, company, phone, email,
    faturamento, segment, notes, origin, rating,
    utm_campaign, utm_source, utm_medium, utm_content, utm_term,
    responsible_id, sdr_id
  ) VALUES (
    p_organization_id,
    p_lead->>'name',
    p_lead->>'company',
    p_lead->>'phone',
    p_lead->>'email',
    p_lead->>'faturamento',
    p_lead->>'segment',
    p_lead->>'notes',
    coalesce((p_lead->>'origin')::public.lead_origin, 'outro'::public.lead_origin),
    coalesce((p_lead->>'rating')::int, 0),
    p_lead->>'utm_campaign',
    p_lead->>'utm_source',
    p_lead->>'utm_medium',
    p_lead->>'utm_content',
    p_lead->>'utm_term',
    p_assigned_to,
    p_assigned_to
  )
  RETURNING id INTO v_lead_id;

  INSERT INTO public.custom_pipe_entries (
    organization_id, pipeline_id, lead_id, stage_id, assigned_to,
    entered_at, stage_changed_at
  ) VALUES (
    p_organization_id, p_pipeline_id, v_lead_id, p_stage_id, p_assigned_to,
    NOW(), NOW()
  );

  RETURN v_lead_id;
END;
$function$;
