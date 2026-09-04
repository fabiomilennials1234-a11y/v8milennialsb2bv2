-- 20270930000000_as_invariantes_viram_funcao.sql
--
-- SCRUM-674, passo 1 de 4. ADITIVA: cria as funções, não troca nenhum chamador.
-- Nada muda de comportamento com esta migration aplicada — ela só coloca as
-- invariantes num lugar só, para que o passo 2 (os INSTEAD OF delegam) e o
-- passo 3 (as 5 escritoras delegam) sejam trocas de chamador, não reescritas.
--
-- ── POR QUE ────────────────────────────────────────────────────────────────
-- Medido em prod 2026-09-04: 5 objetos SQL escrevem PELOS espelhos, e 4 deles
-- são as RPCs "canônicas" (abrir_negocio, create_lead_with_pipe,
-- create_lead_from_social_conversation, import_lead_into_custom_pipeline).
-- O quinto é sync_responsible_from_lead_to_pipes, TRIGGER habilitada em `leads`.
-- Enquanto existirem, a janela de 7 dias da SCRUM-639 não zera — nenhuma
-- migração de front resolve, porque quem escreve pela view é o próprio banco.
--
-- A tentação era reescrever as 5 para gravar direto em pipeline_entries. Isso
-- duplicaria as invariantes dos INSTEAD OF em cinco lugares, que é o defeito-raiz
-- do ADR-0017. Em vez disso: extrair, e apontar os DOIS lados para o mesmo
-- código. Enquanto a transição durar, escrever pela view e escrever pela função
-- executam literalmente as mesmas linhas — a equivalência vira propriedade de
-- construção, não resultado de teste.
--
-- ── DUAS DECISÕES DO CTO QUE ESTE ARQUIVO OBEDECE ──────────────────────────
--
-- 1. VOCABULÁRIO É O PAR. `pre_sale_responsible_id` e `sale_responsible_id`.
--    O trio legado (`responsible_id`, `sdr_id`, `closer_id`) NÃO entra aqui: ele
--    vive só dentro dos INSTEAD OF, que morrem com as views. Medido: o par está
--    povoado (propostas 805/986 e 754/986) e o trio é resíduo.
--
-- 2. `assigned_to` DEIXA DE SER DERIVADO. Hoje o UPDATE pela view recalcula esse
--    campo por um COALESCE do trio, com regra diferente em cada funil. Medido:
--    nenhuma regra candidata reproduz o valor que está em prod — nem a atual
--    (propostas: só 726 de 986 batem). `assigned_to` não é função pura do
--    metadata; foi gravado por caminhos diferentes ao longo do tempo, e a view
--    só o recalcula quando a escrita passa por ela.
--    Consequência: derivar aqui moveria de 2.800 a 7.900 cards de dono, vazando
--    card a card conforme cada um fosse editado. Estas funções só mexem em
--    `assigned_to` quando o chamador MANDA — a atribuição passa a ser um ato,
--    nunca um efeito colateral. A adoção do par com backfill medido é card
--    próprio.
--
-- ── UMA DIFERENÇA QUE **NÃO** PODE SER UNIFORMIZADA ────────────────────────
-- A família de sistema (pipe_*) usa `jsonb_build_object` puro e grava NULO
-- EXPLÍCITO no metadata. A família custom usa `jsonb_strip_nulls` e OMITE a
-- chave. Para o leitor, `metadata->>'x' IS NULL` e "chave ausente" não são a
-- mesma coisa (`?` e `->>` respondem diferente). As funções preservam a
-- diferença de propósito. Uniformizar seria mudar o dado de 31 mil linhas sem
-- ninguém ter pedido.

-- ───────────────────────────────────────────────────────────────────────────
-- Família de SISTEMA — pipe_whatsapp / pipe_confirmacao / pipe_propostas
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_entrada_sistema_criar(
  p_organization_id         uuid,
  p_slug                    text,
  p_lead_id                 uuid,
  p_stage_key               text        DEFAULT NULL,
  p_assigned_to             uuid        DEFAULT NULL,
  p_pre_sale_responsible_id uuid        DEFAULT NULL,
  p_sale_responsible_id     uuid        DEFAULT NULL,
  p_metadata                jsonb       DEFAULT '{}'::jsonb,
  p_notes                   text        DEFAULT NULL,
  p_closed_at               timestamptz DEFAULT NULL,
  p_id                      uuid        DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_pipe        public.pipelines%ROWTYPE;
  v_pipeline_id uuid;
  v_stage_key   text;
  v_id          uuid;
BEGIN
  IF p_slug NOT IN ('whatsapp', 'confirmacao', 'propostas') THEN
    RAISE EXCEPTION 'fn_entrada_sistema_criar: slug % não é funil de sistema', p_slug;
  END IF;

  -- Invariante 1: resolver o funil. Delega ao resolvedor canônico em vez de
  -- repetir a query — é ele que já conhece uuid, slug, o prefixo legado
  -- `custom:<uuid>` e os aliases de API que 73 chaves ainda usam.
  BEGIN
    v_pipe := public.fn_resolver_funil(p_organization_id, p_slug);
  EXCEPTION WHEN OTHERS THEN
    -- Mensagem preservada do corpo dos INSTEAD OF: há tratamento a jusante que
    -- casa por texto, e trocá-la aqui quebraria quem depende dele.
    RAISE EXCEPTION 'Pipeline % not found for org %', p_slug, p_organization_id;
  END;

  IF v_pipe.id IS NULL THEN
    RAISE EXCEPTION 'Pipeline % not found for org %', p_slug, p_organization_id;
  END IF;

  -- Esta função é, por contrato, só para os três funis de fábrica. Sem esta
  -- checagem, uma org com funil CUSTOM de slug 'propostas' receberia o card no
  -- funil errado.
  -- metric-lint-allow: a regra R3 existe para impedir MÉTRICA de filtrar por
  -- type='system' (cega funil custom). Esta é função de ESCRITA, e o recorte
  -- por tipo é o contrato dela, não um filtro de métrica.
  IF v_pipe.type IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'fn_entrada_sistema_criar: funil % da org % não é de sistema (type=%)',
      p_slug, p_organization_id, v_pipe.type;
  END IF;

  v_pipeline_id := v_pipe.id;

  -- Default de etapa, por funil, exatamente como nos INSTEAD OF de hoje.
  v_stage_key := COALESCE(p_stage_key, CASE p_slug
    WHEN 'whatsapp'    THEN 'novo_lead'
    WHEN 'confirmacao' THEN 'marcada'
    WHEN 'propostas'   THEN 'enviada'
  END);

  -- Invariante 3: tenancy do par.
  PERFORM public.fn_assert_member_in_org(p_pre_sale_responsible_id, p_organization_id, 'pre_sale_responsible_id');
  PERFORM public.fn_assert_member_in_org(p_sale_responsible_id,     p_organization_id, 'sale_responsible_id');

  v_id := COALESCE(p_id, gen_random_uuid());

  INSERT INTO public.pipeline_entries
    (id, lead_id, organization_id, pipeline_id, stage_key, assigned_to, metadata, notes, closed_at)
  VALUES (
    v_id, p_lead_id, p_organization_id, v_pipeline_id, v_stage_key,
    -- `assigned_to` NÃO é derivado: vem do chamador ou fica nulo.
    p_assigned_to,
    -- Nulo explícito preservado nesta família (sem strip_nulls). O par entra
    -- por cima do que o chamador mandou, porque é ele o vocabulário canônico.
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'pre_sale_responsible_id', p_pre_sale_responsible_id,
      'sale_responsible_id',     p_sale_responsible_id),
    p_notes, p_closed_at
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.fn_entrada_sistema_criar IS
  'SCRUM-674: cria entrada em funil de sistema carregando as invariantes que viviam nos INSTEAD OF. Vocabulário é o par pre_sale/sale. assigned_to não é derivado.';

CREATE OR REPLACE FUNCTION public.fn_entrada_sistema_atualizar(
  p_entry_id uuid,
  p_patch    jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_org  uuid;
  v_meta jsonb;
BEGIN
  SELECT organization_id INTO v_org FROM public.pipeline_entries WHERE id = p_entry_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'fn_entrada_sistema_atualizar: entrada % não existe', p_entry_id;
  END IF;

  -- Tenancy só do que o patch de fato traz.
  IF p_patch ? 'pre_sale_responsible_id' THEN
    PERFORM public.fn_assert_member_in_org(
      NULLIF(p_patch->>'pre_sale_responsible_id','')::uuid, v_org, 'pre_sale_responsible_id');
  END IF;
  IF p_patch ? 'sale_responsible_id' THEN
    PERFORM public.fn_assert_member_in_org(
      NULLIF(p_patch->>'sale_responsible_id','')::uuid, v_org, 'sale_responsible_id');
  END IF;

  -- As chaves de coluna saem do patch; o RESTO é metadata, mesclado por cima do
  -- que já existe (nunca sobrescrevendo o objeto inteiro — é assim que campanha
  -- e responsável se perdem).
  v_meta := p_patch - 'stage_key' - 'notes' - 'closed_at' - 'assigned_to';

  UPDATE public.pipeline_entries pe SET
    stage_key   = CASE WHEN p_patch ? 'stage_key'
                       THEN p_patch->>'stage_key' ELSE pe.stage_key END,
    notes       = CASE WHEN p_patch ? 'notes'
                       THEN p_patch->>'notes' ELSE pe.notes END,
    closed_at   = CASE WHEN p_patch ? 'closed_at'
                       THEN NULLIF(p_patch->>'closed_at','')::timestamptz ELSE pe.closed_at END,
    -- Presença da CHAVE decide, não o valor: `{"assigned_to": null}` desatribui
    -- de propósito, e um patch sem a chave não encosta no dono do card.
    assigned_to = CASE WHEN p_patch ? 'assigned_to'
                       THEN NULLIF(p_patch->>'assigned_to','')::uuid ELSE pe.assigned_to END,
    metadata    = CASE WHEN v_meta = '{}'::jsonb
                       THEN pe.metadata
                       ELSE COALESCE(pe.metadata, '{}'::jsonb) || v_meta END,
    updated_at  = now()
  WHERE pe.id = p_entry_id;
END;
$$;

COMMENT ON FUNCTION public.fn_entrada_sistema_atualizar IS
  'SCRUM-674: atualiza entrada de funil de sistema. Presença da chave no patch decide o que muda; assigned_to nunca é recalculado.';

-- ───────────────────────────────────────────────────────────────────────────
-- Família CUSTOM — custom_pipe_entries
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_entrada_custom_criar(
  p_organization_id         uuid,
  p_pipeline_id             uuid,
  p_lead_id                 uuid,
  p_stage_id                uuid,
  p_assigned_to             uuid        DEFAULT NULL,
  p_pre_sale_responsible_id uuid        DEFAULT NULL,
  p_sale_responsible_id     uuid        DEFAULT NULL,
  p_deal_id                 uuid        DEFAULT NULL,
  p_notes                   text        DEFAULT NULL,
  p_entered_at              timestamptz DEFAULT NULL,
  p_stage_changed_at        timestamptz DEFAULT NULL,
  p_id                      uuid        DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_pipe  public.pipelines%ROWTYPE;
  v_stage public.pipeline_stages%ROWTYPE;
  v_org   uuid;
  v_id    uuid;
BEGIN
  -- As cinco validações do custom_pipe_entries_insert_fn, com as mensagens
  -- preservadas.
  IF p_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: pipeline_id é obrigatório';
  END IF;

  SELECT * INTO v_pipe FROM public.pipelines WHERE id = p_pipeline_id;
  IF v_pipe.id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: funil % não existe em pipelines', p_pipeline_id;
  END IF;
  IF v_pipe.type <> 'custom' THEN
    RAISE EXCEPTION 'custom_pipe_entries: funil % não é custom (type=%)', p_pipeline_id, v_pipe.type;
  END IF;
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: lead_id é obrigatório' USING ERRCODE = 'not_null_violation';
  END IF;
  IF p_stage_id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: stage_id é obrigatório' USING ERRCODE = 'not_null_violation';
  END IF;

  SELECT * INTO v_stage FROM public.pipeline_stages WHERE id = p_stage_id;
  IF v_stage.id IS NULL THEN
    RAISE EXCEPTION 'custom_pipe_entries: etapa % não existe', p_stage_id;
  END IF;
  IF v_stage.pipeline_id IS DISTINCT FROM p_pipeline_id THEN
    RAISE EXCEPTION 'custom_pipe_entries: etapa % pertence ao funil %, não ao funil % do card',
      p_stage_id, v_stage.pipeline_id, p_pipeline_id;
  END IF;

  v_org := COALESCE(p_organization_id, v_pipe.organization_id);

  PERFORM public.fn_assert_member_in_org(p_pre_sale_responsible_id, v_org, 'pre_sale_responsible_id');
  PERFORM public.fn_assert_member_in_org(p_sale_responsible_id,     v_org, 'sale_responsible_id');

  v_id := COALESCE(p_id, gen_random_uuid());

  INSERT INTO public.pipeline_entries (
    id, organization_id, pipeline_id, lead_id, deal_id, stage_key, stage_id,
    assigned_to, notes, metadata, entered_at, stage_changed_at
  ) VALUES (
    v_id, v_org, p_pipeline_id, p_lead_id, p_deal_id,
    -- Invariante 2: stage_key DERIVADO da etapa. É o que mantém os
    -- `AFTER ... OF stage_key` da base elegíveis — disparo, workflow, checklist
    -- e história. Gravar só stage_id desliga os quatro, sem erro nenhum.
    v_stage.stage_key, p_stage_id,
    p_assigned_to, p_notes,
    -- strip_nulls preservado NESTA família: aqui chave ausente é o contrato.
    jsonb_strip_nulls(jsonb_build_object(
      'pre_sale_responsible_id', p_pre_sale_responsible_id,
      'sale_responsible_id',     p_sale_responsible_id)),
    COALESCE(p_entered_at, now()),
    COALESCE(p_stage_changed_at, now())
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.fn_entrada_custom_criar IS
  'SCRUM-674: cria entrada em funil custom. Deriva stage_key do stage_id (mantém os AFTER OF stage_key elegíveis) e preserva o strip_nulls do metadata.';

CREATE OR REPLACE FUNCTION public.fn_entrada_custom_atualizar(
  p_entry_id uuid,
  p_patch    jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_org       uuid;
  v_stage_id  uuid;
  v_stage_key text;
  v_meta      jsonb;
BEGIN
  SELECT organization_id INTO v_org FROM public.pipeline_entries WHERE id = p_entry_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'fn_entrada_custom_atualizar: entrada % não existe', p_entry_id;
  END IF;

  IF p_patch ? 'pipeline_id' THEN
    IF NOT EXISTS (SELECT 1 FROM public.pipelines
                    WHERE id = NULLIF(p_patch->>'pipeline_id','')::uuid AND type = 'custom') THEN
      RAISE EXCEPTION 'custom_pipe_entries: funil % não é custom', p_patch->>'pipeline_id';
    END IF;
  END IF;

  IF p_patch ? 'pre_sale_responsible_id' THEN
    PERFORM public.fn_assert_member_in_org(
      NULLIF(p_patch->>'pre_sale_responsible_id','')::uuid, v_org, 'pre_sale_responsible_id');
  END IF;
  IF p_patch ? 'sale_responsible_id' THEN
    PERFORM public.fn_assert_member_in_org(
      NULLIF(p_patch->>'sale_responsible_id','')::uuid, v_org, 'sale_responsible_id');
  END IF;

  -- Invariante 2 de novo: quem manda `stage_id` ganha `stage_key` junto, senão
  -- os AFTER ... OF stage_key não disparam e a movimentação vira invisível para
  -- disparo, workflow, checklist e história.
  IF p_patch ? 'stage_id' THEN
    v_stage_id := NULLIF(p_patch->>'stage_id','')::uuid;
    SELECT ps.stage_key INTO v_stage_key FROM public.pipeline_stages ps WHERE ps.id = v_stage_id;
  END IF;

  v_meta := p_patch - 'pipeline_id' - 'lead_id' - 'stage_id' - 'deal_id'
                    - 'assigned_to' - 'notes' - 'entered_at' - 'stage_changed_at';

  UPDATE public.pipeline_entries pe SET
    pipeline_id      = CASE WHEN p_patch ? 'pipeline_id'
                            THEN NULLIF(p_patch->>'pipeline_id','')::uuid ELSE pe.pipeline_id END,
    lead_id          = CASE WHEN p_patch ? 'lead_id'
                            THEN NULLIF(p_patch->>'lead_id','')::uuid ELSE pe.lead_id END,
    stage_id         = CASE WHEN p_patch ? 'stage_id' THEN v_stage_id ELSE pe.stage_id END,
    stage_key        = CASE WHEN p_patch ? 'stage_id'
                            THEN COALESCE(v_stage_key, pe.stage_key) ELSE pe.stage_key END,
    deal_id          = CASE WHEN p_patch ? 'deal_id'
                            THEN NULLIF(p_patch->>'deal_id','')::uuid ELSE pe.deal_id END,
    assigned_to      = CASE WHEN p_patch ? 'assigned_to'
                            THEN NULLIF(p_patch->>'assigned_to','')::uuid ELSE pe.assigned_to END,
    notes            = CASE WHEN p_patch ? 'notes' THEN p_patch->>'notes' ELSE pe.notes END,
    entered_at       = CASE WHEN p_patch ? 'entered_at'
                            THEN NULLIF(p_patch->>'entered_at','')::timestamptz ELSE pe.entered_at END,
    stage_changed_at = CASE WHEN p_patch ? 'stage_changed_at'
                            THEN NULLIF(p_patch->>'stage_changed_at','')::timestamptz ELSE pe.stage_changed_at END,
    -- Merge com strip_nulls no que ENTRA: chave com nulo some, chave ausente
    -- não encosta no que já estava. É o contrato desta família.
    metadata         = CASE WHEN v_meta = '{}'::jsonb
                            THEN pe.metadata
                            ELSE COALESCE(pe.metadata, '{}'::jsonb) || jsonb_strip_nulls(v_meta) END,
    updated_at       = now()
  WHERE pe.id = p_entry_id;
END;
$$;

COMMENT ON FUNCTION public.fn_entrada_custom_atualizar IS
  'SCRUM-674: atualiza entrada de funil custom. Deriva stage_key quando o stage_id muda; assigned_to nunca é recalculado.';

-- ───────────────────────────────────────────────────────────────────────────
-- Grants — relação/função nova NASCE executável por causa do
-- ALTER DEFAULT PRIVILEGES do schema public. REVOKE FROM PUBLIC não alcança,
-- porque o grant é direto no papel. Fechar nominalmente.
-- Estas funções são chamadas por INSTEAD OF (que roda como o invocador) e por
-- RPCs DEFINER, então `authenticated` PRECISA executar; `anon` não.
-- ───────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.fn_entrada_sistema_criar(uuid, text, uuid, text, uuid, uuid, uuid, jsonb, text, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_entrada_sistema_atualizar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_entrada_custom_criar(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_entrada_custom_atualizar(uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_entrada_sistema_criar(uuid, text, uuid, text, uuid, uuid, uuid, jsonb, text, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_entrada_sistema_atualizar(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_entrada_custom_criar(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_entrada_custom_atualizar(uuid, jsonb) TO authenticated, service_role;

