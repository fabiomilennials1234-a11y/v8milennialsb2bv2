-- ============================================================================
-- SCRUM-625 (W3, Funil é Funil): API pública e RPCs de Negócio aceitam
-- QUALQUER funil — sistema ou personalizado, endereçado por id (uuid) ou slug.
--
-- ── O que morre aqui ────────────────────────────────────────────────────────
--   • `abrir_negocio`: o despacho por STRING crua (`IF p_pipe = 'whatsapp'...`)
--     e a exigência do prefixo `custom:` — o prefixo segue ACEITO como legado,
--     mas deixa de ser a única porta para funil personalizado.
--   • `mover_negocio`: a recusa 'Destino não é funil de sistema'. Pós-621
--     (inversão do silo) card de funil custom vive na MESMA tabela
--     (`pipeline_entries`) — mover é o MESMO UPDATE na MESMA linha, nenhuma
--     identidade se perde. A justificativa da recusa deixou de ser verdade.
--   • `api_move_deal`: a recusa `custom:%` (o 422 custom_pipeline_not_supported
--     da rota TS morre junto) e o filtro de tipo-sistema do lookup.
--   • `api_list_pipelines`: o CASE por tipo. Pós-616 TODAS as etapas vivem em
--     `pipeline_stages` com `pipeline_id`; medido em prod (2026-09-02): as
--     únicas linhas com `pipeline_id IS NULL` (1.181) são de orgs/tipos SEM
--     linha correspondente em `pipelines` (upsell_* e órfãs) — o braço de
--     fallback do CASE não casa nada. Colapso provado por igualdade de output
--     no ensaio.
--
-- ── Migration fantasma documentada ──────────────────────────────────────────
-- Prod tem `20270908000000_api_aceita_o_funil_que_publica` FORA do repo. Pelo
-- diff de pg_get_functiondef (2026-09-02) ela:
--   • `api_create_deal`: passou a aceitar slug/uuid/custom:uuid (tradução de
--     endereço + tradução stage_key→stage_id para custom) e o aviso
--     lead_has_open_deal casando por pipeline_id;
--   • `api_list_pipelines`: acrescentou `id` em cada etapa e o casamento
--     `ps.pipeline_id = pip.id OR (ps.pipeline_id IS NULL AND ...)`;
--   • NÃO tocou abrir_negocio / mover_negocio / api_move_deal.
-- Esta migration constrói SOBRE esse estado e o supera: as definições abaixo
-- absorvem o que a fantasma fez (o `id` das etapas fica; a tradução de etapa
-- desce para `abrir_negocio`, que é a porta única).
--
-- ── Contrato (D10 — aditivo, nada quebra) ───────────────────────────────────
-- Assinaturas idênticas (CREATE OR REPLACE preserva ACL). Chamada antiga —
-- slug de sistema, `custom:<uuid>` + etapa por uuid — produz o mesmo efeito.
-- Formas novas: funil por uuid puro; funil custom por slug; etapa custom por
-- stage_key; aliases legados (qualificacao, pipe_*) como no adapter da 623.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 0. O resolvedor — um só, espelho SQL do resolvePipeline do adapter (623)
-- ────────────────────────────────────────────────────────────────────────────
-- uuid → busca por id; senão slug; senão alias legado. Funil real com um slug
-- igual a um alias sempre ganha do alias (mesma precedência do adapter).
-- Inativo é recusado com erro próprio (0 funis inativos em prod hoje — a
-- recusa não muda comportamento observável, só fecha a porta com coerência:
-- catálogo e webhook já não enxergam funil inativo).
CREATE OR REPLACE FUNCTION public.fn_resolver_funil(p_org uuid, p_ref text)
RETURNS public.pipelines
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_ref   text := NULLIF(btrim(COALESCE(p_ref, '')), '');
  v_alias text;
  v_pip   public.pipelines%ROWTYPE;
BEGIN
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Funil é obrigatório.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Prefixo legado da era do silo: 'custom:<uuid>' endereça o mesmo funil que
  -- o uuid puro. Aceito para sempre — 73 chaves de API não releem changelog.
  IF v_ref LIKE 'custom:%' THEN
    v_ref := NULLIF(btrim(substring(v_ref FROM 8)), '');
    IF v_ref IS NULL OR v_ref !~ v_uuid_re THEN
      RAISE EXCEPTION 'Funil "%" não existe nesta organização.', p_ref
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  IF v_ref ~ v_uuid_re THEN
    SELECT * INTO v_pip FROM public.pipelines
     WHERE organization_id = p_org AND id = v_ref::uuid;
  ELSE
    SELECT * INTO v_pip FROM public.pipelines
     WHERE organization_id = p_org AND slug = v_ref;

    IF NOT FOUND THEN
      v_alias := CASE lower(v_ref)
        WHEN 'qualificacao'     THEN 'whatsapp'
        WHEN 'pipe_whatsapp'    THEN 'whatsapp'
        WHEN 'pipe_confirmacao' THEN 'confirmacao'
        WHEN 'pipe_propostas'   THEN 'propostas'
      END;
      IF v_alias IS NOT NULL THEN
        SELECT * INTO v_pip FROM public.pipelines
         WHERE organization_id = p_org AND slug = v_alias;
      END IF;
    END IF;
  END IF;

  IF v_pip.id IS NULL THEN
    RAISE EXCEPTION 'Funil "%" não existe nesta organização. Use o id (uuid) ou o slug de um funil da organização.', p_ref
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Só `false` explícito conta (mesma regra do adapter): NULL trata como ativo.
  IF v_pip.is_active IS FALSE THEN
    RAISE EXCEPTION 'Funil "%" está inativo nesta organização.', p_ref
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  RETURN v_pip;
END;
$$;

COMMENT ON FUNCTION public.fn_resolver_funil(uuid, text) IS
  'Resolve funil por id (uuid), slug ou alias legado (qualificacao, pipe_*); aceita o prefixo custom: como legado. Erra alto: invalid_parameter_value quando não existe, object_not_in_prerequisite_state quando inativo. Espelho SQL do resolvePipeline (SCRUM-623). SCRUM-625.';

REVOKE ALL ON FUNCTION public.fn_resolver_funil(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_resolver_funil(uuid, text) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. abrir_negocio — a porta única resolve qualquer funil
-- ────────────────────────────────────────────────────────────────────────────
-- Mesma assinatura, SECURITY INVOKER preservado (a org vem do lead e a RLS
-- recorta). O despacho por string morre: primeiro resolve-se a LINHA do funil,
-- depois roteia-se pelo que ela é. Os três ramos de sistema continuam
-- entrando pelas views pipe_* — são elas que carregam a semântica de
-- meeting_date/sale_value/sdr/closer em metadata — mas agora um funil de
-- sistema endereçado por uuid chega ao mesmo lugar. O ramo custom delega ao
-- caminho único (custom_pipe_entries é view sobre pipeline_entries pós-621) e
-- passa a aceitar a etapa por stage_key além de uuid.
CREATE OR REPLACE FUNCTION public.abrir_negocio(
  p_lead_id      uuid,
  p_pipe         text,
  p_stage        text,
  p_owner_id     uuid        DEFAULT NULL,
  p_value        numeric     DEFAULT NULL,
  p_meeting_date timestamptz DEFAULT NULL,
  p_notes        text        DEFAULT NULL,
  p_title        text        DEFAULT NULL,
  p_source       text        DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamptz, text, text, text) IS
  'Porta única de abertura de Negócio. Aceita qualquer funil por id/slug/alias (custom: legado aceito); etapa custom por stage_key ou uuid. SECURITY INVOKER — org vem do lead via RLS. SCRUM-625.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. mover_negocio — destino custom deixa de ser recusado
-- ────────────────────────────────────────────────────────────────────────────
-- Mover é mover: o MESMO UPDATE na MESMA linha de pipeline_entries, para
-- qualquer tipo de destino. O espelho stage_id↔stage_key (trg_pe_stage_mirror,
-- SCRUM-617) resolve o stage_id quando o funil muda. Para destino custom a
-- etapa é validada aqui (por key ou uuid) — o espelho tolera etapa-fantasma
-- por design (D-a), mas quem chama mover com etapa errada precisa de erro, não
-- de card invisível. Para destino de sistema a laxidão histórica é preservada.
CREATE OR REPLACE FUNCTION public.mover_negocio(
  p_entry_id           uuid,
  p_target_pipeline_id uuid,
  p_target_stage_key   text,
  p_stage_origem       text DEFAULT NULL,
  p_assigned_to        uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_org        uuid;
  v_lead       uuid;
  v_pipe_atual uuid;
  v_stage_atual text;
  v_tipo_alvo  text;
  v_org_alvo   uuid;
  v_stage_key  text;
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

  IF p_target_stage_key IS NULL OR btrim(p_target_stage_key) = '' THEN
    RAISE EXCEPTION 'Etapa de destino é obrigatória.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_stage_key := btrim(p_target_stage_key);

  -- Etapa por uuid (qualquer destino) resolve para a key; por key, destino
  -- custom valida pertencimento. Um uuid que não é etapa do destino era, na
  -- prática antiga, gravado cru em stage_key — o bug do card invisível que o
  -- reparo 2b da SCRUM-617 teve que curar. Errar alto aqui evita a recaída.
  IF v_stage_key ~ v_uuid_re THEN
    SELECT ps.stage_key INTO v_stage_key
      FROM public.pipeline_stages ps
     WHERE ps.id = v_stage_key::uuid AND ps.pipeline_id = p_target_pipeline_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Etapa "%" não existe no funil %.', p_target_stage_key, p_target_pipeline_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSIF v_tipo_alvo = 'custom' THEN
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages ps
                    WHERE ps.pipeline_id = p_target_pipeline_id
                      AND ps.stage_key = v_stage_key) THEN
      RAISE EXCEPTION 'Etapa "%" não existe no funil %.', p_target_stage_key, p_target_pipeline_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
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
  -- O espelho (trg_pe_stage_mirror) re-resolve stage_id ao ver o funil mudar.
  UPDATE public.pipeline_entries
     SET pipeline_id = p_target_pipeline_id,
         stage_key   = v_stage_key,
         assigned_to = COALESCE(p_assigned_to, assigned_to)
   WHERE id = p_entry_id;

  RETURN p_entry_id;
END;
$$;

COMMENT ON FUNCTION public.mover_negocio(uuid, uuid, text, text, uuid) IS
  'Move o card (pipeline_entries) para qualquer funil da org — sistema ou custom — na MESMA linha. Etapa por stage_key ou uuid; destino custom valida a etapa. SCRUM-625.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. api_move_deal — POST /deals/{id}/move aceita qualquer funil
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_move_deal(
  p_org      uuid,
  p_deal_id  uuid,
  p_pipeline text,
  p_stage    text,
  p_owner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry_id uuid;
  v_pip      public.pipelines%ROWTYPE;
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

  -- Qualquer funil, por id/slug/alias — a recusa de funil custom morreu com a
  -- inversão do silo (621): mover é o mesmo UPDATE na mesma linha, o card não
  -- muda de identidade e nenhum histórico se perde.
  v_pip := public.fn_resolver_funil(p_org, p_pipeline);

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

  PERFORM public.mover_negocio(v_entry_id, v_pip.id, p_stage, NULL, p_owner_id);

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
$$;

COMMENT ON FUNCTION public.api_move_deal(uuid, uuid, text, text, uuid) IS
  'POST /api/v1/deals/{id}/move. Aceita qualquer funil por id/slug (custom: legado aceito). Delega em mover_negocio — mover é mover, mesma linha. SCRUM-625.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. api_create_deal — encolhe: a tradução desceu para abrir_negocio
-- ────────────────────────────────────────────────────────────────────────────
-- A fantasma 20270908000000 ensinou ESTA função a traduzir endereço de funil e
-- etapa. Com a porta única sabendo resolver (acima), aqui sobra o que é da
-- API: tenancy, replay, aviso — e o funil é resolvido UMA vez, pelo mesmo
-- resolvedor, para ancorar o aviso por pipeline_id (slug é único por org —
-- `pipelines_organization_id_slug_key` — e sempre presente: 0 sem slug em prod).
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
$$;

COMMENT ON FUNCTION public.api_create_deal(uuid, uuid, text, text, uuid, numeric, text, text, text, text) IS
  'POST /api/v1/deals. Funil por id/slug de qualquer tipo; etapa custom por stage_key ou uuid (tradução na porta única). Aviso lead_has_open_deal ancorado por pipeline_id. SCRUM-625.';

-- ────────────────────────────────────────────────────────────────────────────
-- 5. api_list_pipelines — o CASE por tipo colapsa
-- ────────────────────────────────────────────────────────────────────────────
-- Pós-616 TODA etapa endereça o funil por `pipeline_id`. O braço de fallback
-- (`ps.pipeline_id IS NULL AND ps.pipeline_type = pip.slug`) não casa nenhuma
-- linha em prod: as 1.181 etapas com pipeline_id NULL são de tipos sem linha
-- em `pipelines` (upsell_*, órfãs) — invisíveis para este catálogo por
-- construção. Igualdade de output provada no ensaio (org a org). O `id` de
-- cada etapa (novidade da fantasma) fica: é o que o Make usa em dropdown.
CREATE OR REPLACE FUNCTION public.api_list_pipelines(p_org uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pip.id, 'name', pip.name, 'slug', pip.slug,
    'type', pip.type, 'color', pip.color, 'icon', pip.icon, 'display_order', pip.display_order,
    'is_active', pip.is_active,
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', ps.id, 'stage_key', ps.stage_key, 'name', ps.name,
        'color', ps.color, 'position', ps.position, 'is_active', ps.is_active,
        'is_final_positive', ps.is_final_positive, 'is_final_negative', ps.is_final_negative)
        ORDER BY ps.position)
      FROM pipeline_stages ps
      WHERE ps.organization_id = p_org AND ps.pipeline_id = pip.id), '[]'::jsonb)
  ) ORDER BY pip.display_order), '[]'::jsonb)
  FROM pipelines pip WHERE pip.organization_id = p_org AND pip.is_active = true;
$$;

COMMENT ON FUNCTION public.api_list_pipelines(uuid) IS
  'GET /api/v1/pipelines. Etapas de QUALQUER funil vêm de pipeline_stages por pipeline_id (unificado pós-616). Cada etapa publica id e stage_key. SCRUM-625.';

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Asserções (padrão da 626): grants e forma
-- ────────────────────────────────────────────────────────────────────────────
DO $assert$
DECLARE
  r record;
  v_n oid;
BEGIN
  -- api_move_deal não pode mais conter a recusa custom.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'api_move_deal'
       AND pg_get_functiondef(p.oid) ILIKE '%não é suportado%'
  ) THEN
    RAISE EXCEPTION 'SCRUM-625: api_move_deal ainda recusa funil customizado';
  END IF;

  -- mover_negocio não pode mais conter a recusa de destino não-sistema.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'mover_negocio'
       AND pg_get_functiondef(p.oid) ILIKE '%Destino não é funil de sistema%'
  ) THEN
    RAISE EXCEPTION 'SCRUM-625: mover_negocio ainda recusa destino custom';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      -- fn                    anon   authenticated  secdef_deve
      ('fn_resolver_funil',    false, true,          false),
      ('abrir_negocio',        false, true,          false),
      ('mover_negocio',        false, true,          false),
      ('api_move_deal',        false, false,         true),
      ('api_create_deal',      false, false,         true),
      ('api_list_pipelines',   false, false,         true)
    ) AS g(fn, anon_deve, auth_deve, secdef_deve)
  LOOP
    FOR v_n IN
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = r.fn
    LOOP
      IF has_function_privilege('anon', v_n::oid, 'EXECUTE') IS DISTINCT FROM r.anon_deve THEN
        RAISE EXCEPTION 'SCRUM-625: grant de anon errado em % (esperado %)', r.fn, r.anon_deve;
      END IF;
      IF has_function_privilege('authenticated', v_n::oid, 'EXECUTE') IS DISTINCT FROM r.auth_deve THEN
        RAISE EXCEPTION 'SCRUM-625: grant de authenticated errado em % (esperado %)', r.fn, r.auth_deve;
      END IF;
      IF NOT has_function_privilege('service_role', v_n::oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'SCRUM-625: service_role sem EXECUTE em %', r.fn;
      END IF;
      IF (SELECT prosecdef FROM pg_proc WHERE oid = v_n) IS DISTINCT FROM r.secdef_deve THEN
        RAISE EXCEPTION 'SCRUM-625: SECURITY DEFINER errado em % (esperado %)', r.fn, r.secdef_deve;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'SCRUM-625: API aceita qualquer funil — asserções OK';
END;
$assert$;
