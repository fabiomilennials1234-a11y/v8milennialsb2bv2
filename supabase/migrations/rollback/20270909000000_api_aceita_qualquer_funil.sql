-- ============================================================================
-- ROLLBACK de 20270909000000_api_aceita_qualquer_funil (SCRUM-625).
--
-- Restaura as definições EXATAS de prod capturadas via pg_get_functiondef em
-- 2026-09-02 (pós-fantasma 20270908000000_api_aceita_o_funil_que_publica) e
-- remove o resolvedor. Grants não mudam: CREATE OR REPLACE preserva ACL.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.abrir_negocio(p_lead_id uuid, p_pipe text, p_stage text, p_owner_id uuid DEFAULT NULL::uuid, p_value numeric DEFAULT NULL::numeric, p_meeting_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_source text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org        uuid;
  v_tz         text;
  v_deal_id    uuid;
  v_entry_id   uuid := gen_random_uuid();
  v_title      text;
  v_custom_id  uuid;
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

  IF p_pipe LIKE 'custom:%' THEN
    v_custom_id := substring(p_pipe FROM 8)::uuid;

    INSERT INTO public.custom_pipe_entries
      (id, pipeline_id, lead_id, organization_id, stage_id, assigned_to, notes, deal_id)
    VALUES (v_entry_id, v_custom_id, p_lead_id, v_org, p_stage::uuid, p_owner_id, v_notes, v_deal_id);

  ELSIF p_pipe = 'whatsapp' THEN
    INSERT INTO public.pipe_whatsapp
      (id, lead_id, organization_id, status, responsible_id, sdr_id, notes)
    VALUES (v_entry_id, p_lead_id, v_org, p_stage, p_owner_id, p_owner_id, v_notes);

  ELSIF p_pipe = 'confirmacao' THEN
    INSERT INTO public.pipe_confirmacao
      (id, lead_id, organization_id, status, responsible_id, sdr_id, meeting_date, notes)
    VALUES (v_entry_id, p_lead_id, v_org, p_stage, p_owner_id, p_owner_id, p_meeting_date, v_notes);

  ELSIF p_pipe = 'propostas' THEN
    INSERT INTO public.pipe_propostas
      (id, lead_id, organization_id, status, responsible_id, closer_id, sale_value, notes)
    VALUES (v_entry_id, p_lead_id, v_org, p_stage, p_owner_id, p_owner_id, p_value, v_notes);

  ELSE
    -- `upsell` cai aqui de propósito: carteira entra por regra própria
    -- (ADR-0023 decisão 8), não por esta porta.
    RAISE EXCEPTION 'Funil % não abre negócio por esta porta.', p_pipe
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Liga a posição à identidade. Nos funis de sistema a linha nasceu pelo
  -- `INSTEAD OF` da view, que não conhece `deal_id`; no custom já nasceu ligada.
  IF p_pipe NOT LIKE 'custom:%' THEN
    UPDATE public.pipeline_entries SET deal_id = v_deal_id WHERE id = v_entry_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Card criado mas não encontrado para ligar ao negócio (entry %). Transação desfeita para não deixar negócio sem posição.', v_entry_id
        USING ERRCODE = 'internal_error';
    END IF;
  END IF;

  RETURN v_deal_id;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.mover_negocio(p_entry_id uuid, p_target_pipeline_id uuid, p_target_stage_key text, p_stage_origem text DEFAULT NULL::text, p_assigned_to uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org        uuid;
  v_lead       uuid;
  v_pipe_atual uuid;
  v_stage_atual text;
  v_tipo_alvo  text;
  v_org_alvo   uuid;
BEGIN
  SELECT pe.organization_id, pe.lead_id, pe.pipeline_id, pe.stage_key
    INTO v_org, v_lead, v_pipe_atual, v_stage_atual
    FROM public.pipeline_entries pe
   WHERE pe.id = p_entry_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Negócio % não encontrado.', p_entry_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT p.type, p.organization_id INTO v_tipo_alvo, v_org_alvo
    FROM public.pipelines p WHERE p.id = p_target_pipeline_id;

  IF v_tipo_alvo IS NULL THEN
    RAISE EXCEPTION 'Funil de destino % não existe.', p_target_pipeline_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Cross-org pelo destino seria mover o negócio para fora da própria empresa. A
  -- RLS já esconderia o funil de outra org, mas mensagem própria vale mais que
  -- "não encontrado".
  IF v_org_alvo <> v_org THEN
    RAISE EXCEPTION 'Funil de destino pertence a outra organização.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_tipo_alvo <> 'system' THEN
    RAISE EXCEPTION
      'Destino não é funil de sistema. Mover para funil customizado atravessa de `pipeline_entries` para `custom_pipe_entries`, que são espelho por primary key e não trocam de `pipeline_id` — é o passo 5c, e ainda não tem decisão.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  IF p_target_stage_key IS NULL OR btrim(p_target_stage_key) = '' THEN
    RAISE EXCEPTION 'Etapa de destino é obrigatória.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── Passo 1: passar pela etapa de sucesso da origem ─────────────────────
  -- É o UPDATE que já acontece hoje, e é dele que saem `meeting_booked` e
  -- `meeting_held`. Pular quando o card já está lá evita evento duplicado — os
  -- gatilhos exigem `OLD.stage_key IS DISTINCT FROM NEW.stage_key`, então
  -- reescrever o mesmo valor seria inerte de qualquer forma; a guarda aqui é
  -- para não gastar um UPDATE e um round de gatilhos à toa.
  IF p_stage_origem IS NOT NULL
     AND btrim(p_stage_origem) <> ''
     AND p_stage_origem IS DISTINCT FROM v_stage_atual THEN
    UPDATE public.pipeline_entries
       SET stage_key = p_stage_origem
     WHERE id = p_entry_id;
  END IF;

  -- ── Passo 2: a troca de funil ───────────────────────────────────────────
  -- `assigned_to` só é tocado quando veio explícito: `COALESCE` cegamente
  -- apagaria o responsável do card quando o chamador não informa nada.
  UPDATE public.pipeline_entries
     SET pipeline_id = p_target_pipeline_id,
         stage_key   = p_target_stage_key,
         assigned_to = COALESCE(p_assigned_to, assigned_to)
   WHERE id = p_entry_id;

  RETURN p_entry_id;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.api_move_deal(p_org uuid, p_deal_id uuid, p_pipeline text, p_stage text, p_owner_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_entry_id    uuid;
  v_pipeline_id uuid;
BEGIN
  -- ── Recorte por inquilino, antes de tudo ──────────────────────────────────
  -- A API roda como service_role: RLS não protege este caminho.
  IF NOT EXISTS (
    SELECT 1 FROM public.deals d
     WHERE d.id = p_deal_id AND d.organization_id = p_org AND d.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Negócio % não encontrado nesta organização.', p_deal_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── Funil customizado: recusa ANTES de resolver ──────────────────────────
  -- A função de banco também recusa, mas a mensagem dela fala de card e de
  -- tabela. Esta fala de Negócio e de histórico, que é o que quem integra
  -- precisa entender para decidir o que fazer.
  IF p_pipeline LIKE 'custom:%' THEN
    RAISE EXCEPTION
      'Mover para funil customizado não é suportado: o card mudaria de identidade e perderia o histórico.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT pip.id INTO v_pipeline_id
    FROM public.pipelines pip
   WHERE pip.organization_id = p_org
     AND pip.slug = p_pipeline
     AND pip.type = 'system'
   LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Funil de sistema % não existe nesta organização.', p_pipeline
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── A posição do Negócio ─────────────────────────────────────────────────
  -- O índice único sobre `deal_id` garante que existe no máximo UMA. Se não
  -- existe nenhuma, o Negócio está órfão — 11.710 assim em produção — e mover
  -- não é a operação certa: não há o que mover.
  SELECT pe.id INTO v_entry_id
    FROM public.pipeline_entries pe
   WHERE pe.deal_id = p_deal_id;

  IF v_entry_id IS NULL THEN
    RAISE EXCEPTION
      'Negócio % não tem posição em nenhum funil — não há o que mover.', p_deal_id
      USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public.mover_negocio(v_entry_id, v_pipeline_id, p_stage, NULL, p_owner_id);

  RETURN (SELECT to_jsonb(t) FROM (
    SELECT d.id, d.last_activity_at, d.created_at,
           d.title, d.value, d.source,
           d.won, d.closed_at, d.loss_reason,
           d.owner_id, d.source_lead_id,
           pip.slug AS pipeline_slug, pe.stage_key
      FROM public.deals d
      LEFT JOIN public.pipeline_entries pe ON pe.deal_id = d.id
      LEFT JOIN public.pipelines pip ON pip.id = pe.pipeline_id
     WHERE d.id = p_deal_id
     LIMIT 1
  ) t);
END;
$function$

;

CREATE OR REPLACE FUNCTION public.api_create_deal(p_org uuid, p_lead_id uuid, p_pipe text, p_stage text, p_owner_id uuid DEFAULT NULL::uuid, p_value numeric DEFAULT NULL::numeric, p_title text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_source text DEFAULT 'api'::text, p_idempotency_key text DEFAULT NULL::text)
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
$function$

;

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
$function$

;

DROP FUNCTION IF EXISTS public.fn_resolver_funil(uuid, text);
