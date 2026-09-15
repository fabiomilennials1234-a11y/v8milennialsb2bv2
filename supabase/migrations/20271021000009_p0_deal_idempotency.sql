-- P0: replay atômico, payload conflitante recusado e materialização serializada.
-- Chave opcional preserva negócios distintos intencionais. Sem limpeza de dados.
ALTER TABLE public.api_idempotency_keys ADD COLUMN IF NOT EXISTS request_hash text;
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
