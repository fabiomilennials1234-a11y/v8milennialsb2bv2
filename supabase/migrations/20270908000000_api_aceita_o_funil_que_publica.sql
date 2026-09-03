-- `POST /deals` aceita o funil e a etapa exatamente como o catálogo os publica.
--
-- O catálogo (`GET /pipelines`) devolve funil por `slug` (sistema) ou `id`
-- (personalizado) e etapa por `stage_key`. `abrir_negocio` só aceita funil
-- personalizado na forma `custom:<uuid>` e etapa como o **uuid** da etapa —
-- forma que o catálogo nunca devolve. Resultado medido em prod (org TorqueCRM,
-- funil "Leads"): o integrador monta o seletor com o que a API publica e recebe
-- 422 "Funil não abre negócio por esta porta". Contrato quebrado dos dois lados:
-- o que se lê não serve para escrever.
--
-- A tradução fica aqui, na borda pública, e não em `abrir_negocio`: a porta
-- única continua estrita para o produto: só a API pública é permissiva na
-- entrada. Nada do que já funciona muda — `whatsapp`/`novo` e
-- `custom:<uuid>`/<uuid> seguem passando pelo mesmo caminho de antes.
--
-- De quebra, o aviso de "lead já tem negócio aberto neste funil" comparava
-- `pipelines.slug = p_pipe`, o que nunca casava para funil personalizado
-- (slug 'leads' vs 'custom:<uuid>'): quem integra com funil personalizado nunca
-- recebia o aviso. Passa a comparar pelo funil resolvido.
CREATE OR REPLACE FUNCTION public.api_create_deal(
  p_org uuid,
  p_lead_id uuid,
  p_pipe text,
  p_stage text,
  p_owner_id uuid DEFAULT NULL::uuid,
  p_value numeric DEFAULT NULL::numeric,
  p_title text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_source text DEFAULT 'api'::text,
  p_idempotency_key text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_endpoint constant text := 'POST /deals';
  v_uuid_re  constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_lead_org uuid;
  v_existente uuid;
  v_deal_id  uuid;
  v_aberto   record;
  v_row      public.deals%ROWTYPE;
  v_aviso    jsonb := NULL;
  v_pipe     text := NULLIF(btrim(COALESCE(p_pipe, '')), '');
  v_stage    text := NULLIF(btrim(COALESCE(p_stage, '')), '');
  v_pip      record;
  v_pipe_id  uuid;
  v_stage_id uuid;
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

  -- ── Tradução do endereço do funil ────────────────────────────────────────
  -- Entra slug, uuid ou 'custom:<uuid>'; sai o que `abrir_negocio` entende.
  IF v_pipe IS NOT NULL THEN
    IF v_pipe LIKE 'custom:%' THEN
      v_pipe_id := NULLIF(substring(v_pipe FROM 8), '')::uuid;
      SELECT p.id, p.slug, p.type INTO v_pip
        FROM public.pipelines p
       WHERE p.organization_id = p_org AND p.id = v_pipe_id;
    ELSE
      SELECT p.id, p.slug, p.type INTO v_pip
        FROM public.pipelines p
       WHERE p.organization_id = p_org
         AND (p.slug = v_pipe OR (v_pipe ~ v_uuid_re AND p.id = v_pipe::uuid));

      IF FOUND THEN
        v_pipe_id := v_pip.id;
        v_pipe := CASE WHEN v_pip.type = 'system' THEN v_pip.slug
                       ELSE 'custom:' || v_pip.id::text END;
      END IF;
    END IF;
  END IF;

  -- ── Tradução da etapa do funil personalizado ─────────────────────────────
  -- `abrir_negocio` grava `stage_id`; o catálogo publica `stage_key`. Aceita as
  -- duas formas e recusa com mensagem própria quando a etapa não é do funil —
  -- sem isto, chave inexistente viraria `invalid input syntax for type uuid`.
  IF v_pipe LIKE 'custom:%' AND v_stage IS NOT NULL AND v_stage !~ v_uuid_re THEN
    SELECT ps.id INTO v_stage_id
      FROM public.pipeline_stages ps
     WHERE ps.organization_id = p_org
       AND ps.pipeline_id = v_pipe_id
       AND ps.stage_key = v_stage;

    IF v_stage_id IS NULL THEN
      RAISE EXCEPTION 'Etapa % não existe no funil %.', v_stage, v_pipe_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_stage := v_stage_id::text;
  END IF;

  -- ── Replay ────────────────────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT k.resource_id INTO v_existente
      FROM public.api_idempotency_keys k
     WHERE k.organization_id = p_org
       AND k.endpoint = v_endpoint
       AND k.idempotency_key = p_idempotency_key;

    IF v_existente IS NOT NULL THEN
      SELECT * INTO v_row FROM public.deals WHERE id = v_existente AND deleted_at IS NULL;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'status', 'replayed',
          'deal', jsonb_build_object('id', v_row.id, 'title', v_row.title,
                                     'value', v_row.value, 'source', v_row.source));
      END IF;
    END IF;
  END IF;

  -- ── O aviso, medido ANTES de abrir ────────────────────────────────────────
  -- Depois de abrir, o Negócio novo já estaria na contagem e o aviso viria
  -- sempre. A pergunta é "ele JÁ tinha um aberto aqui?".
  SELECT d.id, pe.stage_key INTO v_aberto
    FROM public.deals d
    JOIN public.pipeline_entries pe ON pe.deal_id = d.id
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id
   WHERE d.source_lead_id = p_lead_id
     AND d.organization_id = p_org
     AND d.closed_at IS NULL
     AND d.deleted_at IS NULL
     AND (pip.id = v_pipe_id OR (v_pipe_id IS NULL AND pip.slug = v_pipe))
   LIMIT 1;

  IF FOUND THEN
    v_aviso := jsonb_build_object(
      'code', 'lead_has_open_deal_in_pipeline',
      'open_deal_id', v_aberto.id,
      'stage', v_aberto.stage_key);
  END IF;

  -- ── Delega para a porta única ─────────────────────────────────────────────
  v_deal_id := public.abrir_negocio(
    p_lead_id, v_pipe, v_stage, p_owner_id, p_value, NULL, p_notes, p_title, p_source);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.api_idempotency_keys (organization_id, endpoint, idempotency_key, resource_id)
    VALUES (p_org, v_endpoint, p_idempotency_key, v_deal_id)
    ON CONFLICT (organization_id, endpoint, idempotency_key) DO NOTHING;
  END IF;

  SELECT * INTO v_row FROM public.deals WHERE id = v_deal_id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'status', 'created',
    'deal', jsonb_build_object('id', v_row.id, 'title', v_row.title,
                               'value', v_row.value, 'source', v_row.source),
    'warning', v_aviso));
END;
$function$;

-- A etapa também precisa ser endereçável: o catálogo publicava `stage_key` sem
-- o `id`, e quem monta seletor de etapa para abrir Negócio precisa do uuid.
-- Aditivo — nenhum campo existente sai.
CREATE OR REPLACE FUNCTION public.api_list_pipelines(p_org uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pip.id, 'name', pip.name, 'slug', pip.slug,
    'type', pip.type, 'color', pip.color, 'icon', pip.icon, 'display_order', pip.display_order,
    'is_active', pip.is_active,
    'stages', CASE
      WHEN pip.type = 'system' THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', ps.id, 'stage_key', ps.stage_key, 'name', ps.name,
          'color', ps.color, 'position', ps.position, 'is_active', ps.is_active,
          'is_final_positive', ps.is_final_positive, 'is_final_negative', ps.is_final_negative)
          ORDER BY ps.position)
        FROM pipeline_stages ps
        WHERE ps.organization_id = p_org
          AND (ps.pipeline_id = pip.id OR (ps.pipeline_id IS NULL AND ps.pipeline_type = pip.slug))), '[]'::jsonb)
      ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', cs.id, 'stage_key', cs.stage_key, 'name', cs.name,
          'color', cs.color, 'position', cs.position, 'is_active', cs.is_active,
          'is_final_positive', cs.is_final_positive, 'is_final_negative', cs.is_final_negative)
          ORDER BY cs.position)
        FROM custom_pipeline_stages cs
        WHERE cs.organization_id = p_org AND cs.pipeline_id = pip.id), '[]'::jsonb)
    END
  ) ORDER BY pip.display_order), '[]'::jsonb)
  FROM pipelines pip WHERE pip.organization_id = p_org AND pip.is_active = true;
$function$;
