-- ============================================================================
-- `api_create_deal` — o guardião do registro por trás de POST /deals. (#1769)
--
-- ── FINA POR DESENHO ──────────────────────────────────────────────────────
-- Não reimplementa a abertura de Negócio: delega para `abrir_negocio`, que é a
-- porta única (ADR-0023 decisão 3). Duplicar a lógica aqui garantiria que as
-- duas divergissem — e a divergência apareceria como Negócio aberto pela API se
-- comportando diferente do aberto pela tela.
--
-- O que esta função acrescenta e a porta não tem:
--   • resolução da organização a partir da CHAVE, não do corpo — a API roda como
--     service_role, e sem isto o chamador escolheria em qual org escreve;
--   • idempotência, com a mesma mecânica do `api_create_lead`;
--   • o aviso de segundo Negócio aberto no mesmo funil.
--
-- ── SECURITY DEFINER, E POR QUÊ ───────────────────────────────────────────
-- `abrir_negocio` é INVOKER e se apoia em RLS para impedir escrita cross-org. A
-- API não tem usuário: roda como service_role, para quem RLS não vale. Por isso
-- o recorte por organização é feito AQUI, explicitamente, antes de delegar — e é
-- a primeira coisa que a função faz.
--
-- ── O AVISO DE SEGUNDO NEGÓCIO ────────────────────────────────────────────
-- Decisão do CTO: cria e sinaliza. É legal pelo modelo — é assim que recompra se
-- representa. Mas o caso comum não é recompra, é a mesma pessoa preenchendo o
-- mesmo anúncio duas vezes. Medido em produção em 2026-08-23, logo após o
-- backfill: ZERO Leads com dois Negócios abertos no mesmo funil. Capacidade
-- nova, e a primeira vez que acontecer alguém precisa perceber.
-- ============================================================================
BEGIN;

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
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_endpoint constant text := 'POST /deals';
  v_lead_org uuid;
  v_existente uuid;
  v_deal_id  uuid;
  v_aberto   record;
  v_row      public.deals%ROWTYPE;
  v_aviso    jsonb := NULL;
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
     AND pip.slug = p_pipe
   LIMIT 1;

  IF FOUND THEN
    v_aviso := jsonb_build_object(
      'code', 'lead_has_open_deal_in_pipeline',
      'open_deal_id', v_aberto.id,
      'stage', v_aberto.stage_key);
  END IF;

  -- ── Delega para a porta única ─────────────────────────────────────────────
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
$function$;

REVOKE ALL ON FUNCTION public.api_create_deal(uuid, uuid, text, text, uuid, numeric, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_deal(uuid, uuid, text, text, uuid, numeric, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.api_create_deal(uuid, uuid, text, text, uuid, numeric, text, text, text, text) IS
  'POST /api/v1/deals. Casca fina sobre `abrir_negocio`, que segue sendo a porta '
  'única (ADR-0023 decisão 3). Acrescenta o recorte por organização — feito aqui '
  'porque a API roda como service_role e RLS não vale para ela —, idempotência, e '
  'o aviso de segundo Negócio aberto no mesmo funil.';

DO $do$
DECLARE v_n int; v_anon boolean; v_auth boolean;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'api_create_deal';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL: % assinatura(s) de api_create_deal.', v_n;
  END IF;

  SELECT has_function_privilege('anon', p.oid, 'EXECUTE'),
         has_function_privilege('authenticated', p.oid, 'EXECUTE')
    INTO v_anon, v_auth
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'api_create_deal';

  IF v_anon OR v_auth THEN
    RAISE EXCEPTION
      'FAIL: anon ou authenticated com EXECUTE em api_create_deal. Ela é DEFINER e recebe a org por parâmetro — só service_role pode chamá-la.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: api_create_deal criada, uma assinatura, só service_role executa.';
END$do$;

COMMIT;
