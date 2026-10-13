-- Rollback of 20271118000000_abrir_negocio_adota_card_sem_negocio.sql.
-- Restores abrir_negocio to 20271112000000 (identical to prod before this fix):
-- every call creates a new card again, even with a deal-less card of the same
-- lead in the same pipeline. Deals already linked to adopted cards stay linked.
BEGIN;

CREATE OR REPLACE FUNCTION public.abrir_negocio(p_lead_id uuid, p_pipe text, p_stage text, p_owner_id uuid DEFAULT NULL::uuid, p_value numeric DEFAULT NULL::numeric, p_meeting_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_lead_phone_id uuid DEFAULT NULL::uuid)
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
  v_phone_id   uuid := p_lead_phone_id;
  v_phones     integer;
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

  -- Com quem é o negócio (Chamado 82c50502). Informado → tem de ser telefone
  -- ativo DESTE lead. Omitido por um humano num lead com 2+ telefones → recusa:
  -- chutar o principal é como o vendedor acaba falando com a pessoa errada.
  -- Com 1 telefone, é esse. Workflow/API/import seguem sem exigir.
  IF v_phone_id IS NOT NULL THEN
    IF NOT public.fn_telefone_do_lead_valido(p_lead_id, v_phone_id) THEN
      RAISE EXCEPTION 'lead_phone_invalid' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT count(*) INTO v_phones FROM public.lead_phones lp
     WHERE lp.lead_id = p_lead_id AND lp.deleted_at IS NULL;
    IF v_phones >= 2 AND p_source = 'human' THEN
      RAISE EXCEPTION 'lead_phone_required' USING ERRCODE = 'check_violation';
    ELSIF v_phones = 1 THEN
      SELECT lp.id INTO v_phone_id FROM public.lead_phones lp
       WHERE lp.lead_id = p_lead_id AND lp.deleted_at IS NULL;
    END IF;
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

  INSERT INTO public.deals (organization_id, title, source_lead_id, owner_id, value, notes, created_by, source, lead_phone_id)
  VALUES (v_org, v_title, p_lead_id, p_owner_id, p_value, v_notes, auth.uid(), p_source, v_phone_id)
  RETURNING id INTO v_deal_id;

  IF v_pip.type = 'custom' THEN
    -- Etapa por stage_key OU uuid. O catálogo (`api_list_pipelines`) publica os
    -- dois; antes só o uuid era aceito e stage_key quebrava com "invalid input
    -- syntax for type uuid" — erro de encanamento no lugar de erro de domínio.
    IF v_stage_txt IS NULL THEN
      RAISE EXCEPTION 'Etapa é obrigatória para abrir Negócio em funil personalizado.'
        USING ERRCODE = 'invalid_parameter_value';
    ELSIF v_stage_txt ~ v_uuid_re THEN
      v_stage_id := v_stage_txt::uuid;  -- pertencimento ao funil é validado pela função compartilhada
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

    -- Caminho único pós-674: a função compartilhada escreve em pipeline_entries,
    -- valida funil/etapa/tenancy e já liga o card ao negócio.
    PERFORM public.fn_entrada_custom_criar(
      p_organization_id => v_org,
      p_pipeline_id     => v_pip.id,
      p_lead_id         => p_lead_id,
      p_stage_id        => v_stage_id,
      p_assigned_to     => p_owner_id,
      p_deal_id         => v_deal_id,
      p_notes           => v_notes,
      p_id              => v_entry_id);

  ELSIF v_pip.slug = 'whatsapp' THEN
    PERFORM public.fn_entrada_sistema_criar(
      p_organization_id => v_org,
      p_slug            => 'whatsapp',
      p_lead_id         => p_lead_id,
      p_stage_key       => COALESCE(v_stage_txt, 'novo_lead'),
      p_assigned_to     => p_owner_id,
      p_metadata        => jsonb_build_object(
        'responsible_id', p_owner_id,
        'sdr_id',         p_owner_id,
        'scheduled_date', NULL::timestamptz),
      p_notes           => v_notes,
      p_id              => v_entry_id);

  ELSIF v_pip.slug = 'confirmacao' THEN
    PERFORM public.fn_entrada_sistema_criar(
      p_organization_id => v_org,
      p_slug            => 'confirmacao',
      p_lead_id         => p_lead_id,
      p_stage_key       => COALESCE(v_stage_txt, 'marcada'),
      p_assigned_to     => p_owner_id,
      p_metadata        => jsonb_build_object(
        'meeting_date',      p_meeting_date,
        'is_confirmed',      false,
        'closer_id',         NULL::uuid,
        'responsible_id',    p_owner_id,
        'sdr_id',            p_owner_id,
        'meet_link',         NULL::text,
        'metrics_period_at', NULL::timestamptz),
      p_notes           => v_notes,
      p_id              => v_entry_id);

  ELSIF v_pip.slug = 'propostas' THEN
    PERFORM public.fn_entrada_sistema_criar(
      p_organization_id => v_org,
      p_slug            => 'propostas',
      p_lead_id         => p_lead_id,
      p_stage_key       => COALESCE(v_stage_txt, 'enviada'),
      p_assigned_to     => p_owner_id,
      p_metadata        => jsonb_build_object(
        'sale_value',        p_value,
        'closer_id',         p_owner_id,
        'responsible_id',    p_owner_id,
        'product_id',        NULL::uuid,
        'product_type',      NULL::text,
        'calor',             NULL::integer,
        'loss_reason',       NULL::text,
        'loss_reason_id',    NULL::uuid,
        'commitment_date',   NULL::date,
        'contract_duration', NULL::integer,
        'metrics_period_at', NULL::timestamptz),
      p_notes           => v_notes,
      p_id              => v_entry_id);

  ELSE
    -- Funil de sistema com slug sem porta própria (não existe em prod hoje —
    -- medido 2026-09-02: só whatsapp/confirmacao/propostas). Erra alto em vez
    -- de inventar um caminho.
    RAISE EXCEPTION 'Funil % não abre negócio por esta porta.', v_pip.slug
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Liga a posição à identidade. A função de sistema não recebe `deal_id`;
  -- a função custom já criou o card ligado.
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

REVOKE ALL ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamp with time zone, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamp with time zone, text, text, text, uuid) TO authenticated, service_role;

COMMIT;
