-- Rollback de 20271111000000_lead_phones_contatos_nomeados.sql (Chamado 82c50502)
--
-- ANTES de rodar: volte o frontend e as edge functions (`api`,
-- `toth-sync-clientes` e as que importam `_shared/lead-service.ts`) para uma
-- versão que não lê `lead_phones`, não chama as RPCs novas e não manda
-- `p_lead_phone_id` — senão o PostgREST devolve 404/PGRST202.
--
-- PERDE DADO: todo contato nomeado e telefone secundário (lead_phones) e a
-- escolha de telefone dos negócios (deals.lead_phone_id). Exporte antes.
-- `leads.phone` (o principal) não é tocado pela migration nem por este rollback.
--
-- Mensagens adotadas por telefone secundário continuam com o lead_id que
-- receberam (vínculo de dado, como faz a adoção de leads).

BEGIN;

SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.aplicar_telefones_do_erp(uuid, jsonb);
DROP FUNCTION IF EXISTS public.contatos_das_conversas(jsonb);
DROP FUNCTION IF EXISTS public.nomear_contato_do_telefone(uuid, text, text);
DROP FUNCTION IF EXISTS public.salvar_telefones_do_lead(uuid, jsonb);
DROP FUNCTION IF EXISTS public.definir_telefone_do_negocio(uuid, uuid);

-- resolve_message_lead_id: as 3 passadas de antes (pg_get_functiondef de prod, 08/10).
CREATE OR REPLACE FUNCTION public.resolve_message_lead_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  resolved_id uuid;
  digits text;
  normalized text;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  digits := regexp_replace(COALESCE(NEW.phone_number, ''), '[^0-9]', '', 'g');
  IF digits = '' THEN
    RETURN NEW;
  END IF;

  -- Exact match on full digits
  SELECT l.id INTO resolved_id
  FROM leads l
  WHERE l.organization_id = NEW.organization_id
    AND l.phone_digits = digits
    AND l.phone_digits != ''
  LIMIT 1;

  -- BR mobile normalization match (handles 9th digit differences)
  IF resolved_id IS NULL AND length(digits) >= 10 THEN
    normalized := normalize_br_mobile(digits);
    SELECT l.id INTO resolved_id
    FROM leads l
    WHERE l.organization_id = NEW.organization_id
      AND l.phone_digits != ''
      AND length(l.phone_digits) >= 10
      AND normalize_br_mobile(l.phone_digits) = normalized
    LIMIT 1;
  END IF;

  -- Suffix match: last 11 digits (fallback for international numbers)
  IF resolved_id IS NULL AND length(digits) >= 10 THEN
    SELECT l.id INTO resolved_id
    FROM leads l
    WHERE l.organization_id = NEW.organization_id
      AND l.phone_digits != ''
      AND length(l.phone_digits) >= 10
      AND right(l.phone_digits, 11) = right(digits, 11)
    LIMIT 1;
  END IF;

  IF resolved_id IS NOT NULL THEN
    NEW.lead_id := resolved_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- api_create_deal e abrir_negocio: assinaturas de antes, sem sobrecarga.
DROP FUNCTION IF EXISTS public.api_create_deal(uuid,uuid,text,text,uuid,numeric,text,text,text,text,uuid);
DROP FUNCTION IF EXISTS public.abrir_negocio(uuid, text, text, uuid, numeric, timestamp with time zone, text, text, text, uuid);

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

REVOKE ALL ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamp with time zone, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamp with time zone, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.api_create_deal(
  p_org             uuid,
  p_lead_id         uuid,
  p_pipe            text,
  p_stage           text,
  p_owner_id        uuid    DEFAULT NULL,
  p_value           numeric DEFAULT NULL,
  p_title           text    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_source          text    DEFAULT 'api',
  p_idempotency_key text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_endpoint constant text := 'POST /deals';
  v_lead_org uuid;
  v_existente uuid;
  v_hash text; v_saved_hash text;
  v_deal_id  uuid;
  v_aberto   record;
  v_row      public.deals%ROWTYPE;
  v_aviso    jsonb := NULL;
  v_pip      public.pipelines%ROWTYPE;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'organization_id é obrigatório';
  END IF;

  -- ── Recorte por inquilino, ANTES de qualquer coisa ────────────────────────
  -- A função roda como DEFINER e é chamada por service_role: RLS não protege
  -- este caminho. Se o Lead não é desta organização, a chave não pode alcançá-lo.
  SELECT l.organization_id INTO v_lead_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;

  IF v_lead_org IS NULL OR v_lead_org <> p_org THEN
    RAISE EXCEPTION 'Lead % não encontrado nesta organização.', p_lead_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    IF length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'invalid_idempotency_key' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(jsonb_build_array(p_lead_id,p_pipe,p_stage,p_owner_id,
      trim_scale(p_value),p_title,p_notes,p_source)::text,'UTF8')),'hex');
    -- Serializa a transação inteira antes da leitura, inclusive quando a chave ainda não existe.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || v_endpoint || ':' || p_idempotency_key, 0));
  END IF;

  -- ── Replay ────────────────────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT k.resource_id, k.request_hash INTO v_existente, v_saved_hash
      FROM public.api_idempotency_keys k
     WHERE k.organization_id = p_org
       AND k.endpoint = v_endpoint
       AND k.idempotency_key = p_idempotency_key;

    IF v_saved_hash IS NOT NULL AND v_saved_hash <> v_hash THEN
      RAISE EXCEPTION 'idempotency_key_conflict' USING ERRCODE = '23505';
    END IF;
    IF v_existente IS NOT NULL THEN
      SELECT * INTO v_row FROM public.deals WHERE id = v_existente AND organization_id = p_org AND source_lead_id = p_lead_id AND deleted_at IS NULL;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'status', 'replayed',
          'deal', jsonb_build_object('id', v_row.id, 'title', v_row.title,
                                     'value', v_row.value, 'source', v_row.source));
      END IF;
      RAISE EXCEPTION 'idempotent_resource_unavailable' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Erra alto DEPOIS do replay (retry idempotente devolve o Negócio mesmo se o
  -- funil sumiu no meio-tempo — comportamento herdado) e ANTES do aviso e da
  -- abertura: funil inexistente não abre nada nem conta aviso.
  v_pip := public.fn_resolver_funil(p_org, p_pipe);

  -- ── O aviso, medido ANTES de abrir ────────────────────────────────────────
  -- Depois de abrir, o Negócio novo já estaria na contagem e o aviso viria
  -- sempre. A pergunta é "ele JÁ tinha um aberto aqui?". Ancorado por
  -- pipeline_id: funciona igual para funil de sistema e personalizado.
  SELECT d.id, pe.stage_key INTO v_aberto
    FROM public.deals d
    JOIN public.pipeline_entries pe ON pe.deal_id = d.id
   WHERE d.source_lead_id = p_lead_id
     AND d.organization_id = p_org
     AND d.closed_at IS NULL
     AND d.deleted_at IS NULL
     AND pe.pipeline_id = v_pip.id
   LIMIT 1;

  IF FOUND THEN
    v_aviso := jsonb_build_object(
      'code', 'lead_has_open_deal_in_pipeline',
      'open_deal_id', v_aberto.id,
      'stage', v_aberto.stage_key);
  END IF;

  -- ── Delega para a porta única ─────────────────────────────────────────────
  -- p_pipe cru: abrir_negocio resolve com o MESMO resolvedor (inclusive a
  -- tradução stage_key→stage_id de funil custom, que morava aqui na fantasma).
  v_deal_id := public.abrir_negocio(
    p_lead_id, p_pipe, p_stage, p_owner_id, p_value, NULL, p_notes, p_title, p_source);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.api_idempotency_keys (organization_id, endpoint, idempotency_key, resource_id, request_hash)
    VALUES (p_org, v_endpoint, p_idempotency_key, v_deal_id, v_hash)
    ;
  END IF;

  SELECT * INTO v_row FROM public.deals WHERE id = v_deal_id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'status', 'created',
    'deal', jsonb_build_object('id', v_row.id, 'title', v_row.title,
                               'value', v_row.value, 'source', v_row.source),
    'warning', v_aviso));
END;
$$;

REVOKE ALL ON FUNCTION public.api_create_deal(uuid,uuid,text,text,uuid,numeric,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_deal(uuid,uuid,text,text,uuid,numeric,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.garantir_negocio_da_entrada(p_entry_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entry public.pipeline_entries%ROWTYPE;
  v_deal_id uuid; v_titulo text; v_valor numeric;
BEGIN
  SELECT * INTO v_entry FROM public.pipeline_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entrada % não existe', p_entry_id USING ERRCODE = '22023';
  END IF;

  -- A checagem que faltava. Vem DEPOIS do SELECT porque a org é da entrada, e
  -- ANTES de qualquer escrita. `assert_org_access` libera service_role e
  -- master, que é como os chamadores de servidor continuam passando.
  PERFORM public.assert_org_access(v_entry.organization_id);

  IF v_entry.deal_id IS NOT NULL THEN
    RETURN v_entry.deal_id;
  END IF;

  SELECT COALESCE(NULLIF(l.name, ''), 'Negócio sem título') INTO v_titulo
    FROM public.leads l WHERE l.id = v_entry.lead_id;

  BEGIN
    v_valor := NULLIF(v_entry.metadata->>'sale_value', '')::numeric;
  EXCEPTION WHEN OTHERS THEN v_valor := NULL;
  END;

  INSERT INTO public.deals (organization_id, title, value, source_lead_id, owner_id, source)
  VALUES (v_entry.organization_id, COALESCE(v_titulo, 'Negócio'), v_valor,
          v_entry.lead_id, v_entry.assigned_to, 'entrada_materializada')
  RETURNING id INTO v_deal_id;

  UPDATE public.pipeline_entries SET deal_id = v_deal_id WHERE id = p_entry_id;
  RETURN v_deal_id;
END;
$function$;

-- O grant é reafirmado de propósito: o painel chama como `authenticated`, e a
-- checagem no corpo é o que torna isso seguro. `anon` continua de fora.
REVOKE EXECUTE ON FUNCTION public.garantir_negocio_da_entrada(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.garantir_negocio_da_entrada(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fn_telefone_do_lead_valido(uuid, uuid);

DROP TRIGGER IF EXISTS trg_leads_espelha_telefone_principal ON public.leads;
DROP FUNCTION IF EXISTS public.tg_leads_espelha_telefone_principal();

DROP INDEX IF EXISTS public.deals_lead_phone_id_idx;
ALTER TABLE public.deals DROP COLUMN IF EXISTS lead_phone_id;

DROP TABLE IF EXISTS public.lead_phones;
DROP FUNCTION IF EXISTS public.tg_lead_phones_adopt_orphan_messages();
DROP FUNCTION IF EXISTS public.tg_lead_phones_org_guard();
DROP FUNCTION IF EXISTS public.tg_lead_phones_normalize();

COMMIT;
