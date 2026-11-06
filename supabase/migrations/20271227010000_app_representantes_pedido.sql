-- App Representantes: pedido atômico e idempotente (Negócio + itens).
-- Origem: rascunho modelo-pedido.sql do repositório Representantes, ensaiado no clone do schema do CRM (imagem torque-crm-real:base) com
-- suítes SQL, mutação e integração. NÃO foi executado em produção.
-- Ordem: depende das migrations anteriores desta série (20271227000000 -> 20271227010000 -> 20271227020000 -> 20271227030000).
-- Rollback: supabase/migrations/rollback/20271227010000_app_representantes_pedido.sql
--
--
-- Decisão do CTO (2026-11-04): o pedido nasce como Negócio novo no funil Orçamentos, sem entidade Pedido.
--
-- O que esta migration faz
--   1. mobile_order_create(...)   cria o Negócio + itens numa transação só, com idempotência por op_id.
--   2. mobile_op_begin/finish     reserva da chave de idempotência (SECURITY DEFINER mínimo; o resto roda como o usuário).
--
-- Decisões de desenho (todas verificadas contra o schema real do CRM, ver W0-DETALHE.md)
--   · SECURITY INVOKER, como abrir_negocio e deal_item_lancar: a RLS do CRM continua sendo a única fonte de "quem pode
--     criar Negócio". Nada aqui concede poder novo. A única parte privilegiada é a reserva da chave (mobile_op_log é
--     fechada a authenticated).
--   · O app manda só produto, quantidade e desconto. PREÇO VEM DO CATÁLOGO (products.ticket), nunca do cliente
--     ("catálogo e preço vêm do Torque"). Piso: products.ticket_minimo. Abaixo dele, recusa; aprovação de desconto
--     é pergunta aberta (Q-aprovação) e não entra aqui.
--   · FUNIL E ETAPA vêm de configuração por organização, não do app, e FALHAM FECHADO: sem configuração, recusa em vez
--     de adivinhar (o CRM não tem um funil literal "Orçamentos": funis são por organização).
--         organizations.feature_flags = {
--           "representantes_app": true,
--           "representantes_pedido": { "pipeline": "<slug ou uuid>", "stage": "<stage_key ou uuid>" }
--         }
--   · Idempotência no padrão do api_create_deal do CRM: advisory lock + hash do corpo. Mesma chave com o mesmo corpo
--     devolve o mesmo Negócio (status 'replayed'); com corpo diferente, PT409. Replay NÃO revalida catálogo nem preço
--     (o retry de uma confirmação perdida tem de devolver o Negócio mesmo que o produto tenha mudado depois).
--   · Erros: 42501 (sem sessão, sem vínculo ou RLS), PT404 (lead inexistente OU de outra organização: sem oráculo de
--     existência), PT409 (op_id reutilizado com outro corpo), PT422 (dado inválido, regra de negócio, configuração).
--
-- Antes de aplicar no CRM: conferir o ledger de prod antes de numerar; chave leads.* e flags já existem no catálogo.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Registro de operações: serve também aos pedidos
-- ───────────────────────────────────────────────────────────────────────────
-- entity_id passa a aceitar NULL: a chave é reservada ANTES de o Negócio existir. A linha nunca é confirmada com NULL
-- (reserva e conclusão acontecem na mesma transação).
ALTER TABLE public.mobile_op_log ALTER COLUMN entity_id DROP NOT NULL;
ALTER TABLE public.mobile_op_log ADD COLUMN IF NOT EXISTS kind         text;   -- 'order'; NULL = operações de endereço (v3)
ALTER TABLE public.mobile_op_log ADD COLUMN IF NOT EXISTS request_hash text;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Reserva da chave de idempotência (única parte privilegiada)
-- ───────────────────────────────────────────────────────────────────────────
-- O ator é SEMPRE auth.uid(): ninguém reserva, nem enxerga, chave de outra pessoa.
CREATE FUNCTION public.mobile_op_begin(p_op_id uuid, p_kind text, p_hash text)
RETURNS TABLE (is_new boolean, entity_id uuid)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor text := auth.uid()::text;
  v_row   record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'sem sessão' USING ERRCODE = '42501';
  END IF;
  IF p_op_id IS NULL OR p_kind IS NULL OR p_hash IS NULL THEN
    RAISE EXCEPTION 'operação sem identificação' USING ERRCODE = 'PT422';
  END IF;

  -- Serializa as chamadas com a mesma chave, inclusive quando a linha ainda não existe: a segunda espera a primeira
  -- confirmar e então enxerga a linha (READ COMMITTED lê o que foi confirmado entre os dois comandos).
  PERFORM pg_advisory_xact_lock(hashtextextended('mobile_op:' || v_actor || ':' || p_op_id::text, 0));

  SELECT l.kind, l.request_hash, l.entity_id INTO v_row
    FROM public.mobile_op_log l
   WHERE l.actor = v_actor AND l.op_id = p_op_id;

  IF FOUND THEN
    IF v_row.kind IS DISTINCT FROM p_kind OR v_row.request_hash IS DISTINCT FROM p_hash THEN
      RAISE EXCEPTION 'op_id reutilizado com outro conteúdo' USING ERRCODE = 'PT409';
    END IF;
    IF v_row.entity_id IS NULL THEN
      RAISE EXCEPTION 'operação reservada sem resultado' USING ERRCODE = 'XX000';  -- não deve existir após o commit
    END IF;
    RETURN QUERY SELECT false, v_row.entity_id;
    RETURN;
  END IF;

  INSERT INTO public.mobile_op_log (actor, op_id, entity_id, kind, request_hash)
  VALUES (v_actor, p_op_id, NULL, p_kind, p_hash);
  RETURN QUERY SELECT true, NULL::uuid;
END;
$fn$;

CREATE FUNCTION public.mobile_op_finish(p_op_id uuid, p_entity_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sem sessão' USING ERRCODE = '42501';
  END IF;
  UPDATE public.mobile_op_log
     SET entity_id = p_entity_id
   WHERE actor = auth.uid()::text AND op_id = p_op_id AND entity_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operação não reservada' USING ERRCODE = 'PT422';
  END IF;
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. O pedido
-- ───────────────────────────────────────────────────────────────────────────
-- p_items: [{ "product_id": uuid, "quantity": numeric > 0, "discount_percent": numeric 0..100 (opcional) }, ...]
--          Qualquer outro campo (inclusive preço) é IGNORADO. 1 a 50 linhas, sem produto repetido.
CREATE FUNCTION public.mobile_order_create(
  p_lead_id       uuid,
  p_op_id         uuid,
  p_items         jsonb,
  p_notes         text DEFAULT NULL,
  p_title         text DEFAULT NULL,
  p_lead_phone_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_org     uuid;
  v_flags   jsonb;
  v_pipe    text;
  v_stage   text;
  v_owner   uuid;
  v_item    record;
  v_prod    record;
  v_norm    jsonb := '[]'::jsonb;   -- só o que o cliente mandou, normalizado e ordenado: base do hash
  v_lines   jsonb := '[]'::jsonb;   -- o que será lançado (preço do catálogo)
  v_total   numeric := 0;
  v_net     numeric;
  v_count   integer;
  v_distinct integer;
  v_hash    text;
  v_begin   record;
  v_deal    uuid;
  v_notes   text := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_title   text := NULLIF(btrim(COALESCE(p_title, '')), '');
  v_line    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sem sessão' USING ERRCODE = '42501';
  END IF;
  IF p_op_id IS NULL THEN
    RAISE EXCEPTION 'op_id é obrigatório' USING ERRCODE = 'PT422';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'o pedido precisa de 1 a 50 itens' USING ERRCODE = 'PT422';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN  -- só chega aqui com array (o IF acima já barrou o resto)
    RAISE EXCEPTION 'o pedido precisa de 1 a 50 itens' USING ERRCODE = 'PT422';
  END IF;
  IF char_length(COALESCE(v_notes, '')) > 2000 OR char_length(COALESCE(v_title, '')) > 200 THEN
    RAISE EXCEPTION 'observação ou título longo demais' USING ERRCODE = 'PT422';
  END IF;

  -- ── 3.1 Forma dos itens (sem tocar no banco) ───────────────────────────────
  BEGIN
    FOR v_item IN
      SELECT e AS j FROM jsonb_array_elements(p_items) AS t(e)
    LOOP
      IF jsonb_typeof(v_item.j) <> 'object'
         OR jsonb_typeof(v_item.j -> 'product_id') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_item.j -> 'quantity') IS DISTINCT FROM 'number'
         OR (v_item.j ? 'discount_percent' AND jsonb_typeof(v_item.j -> 'discount_percent') IS DISTINCT FROM 'number') THEN
        RAISE EXCEPTION 'item inválido: informe product_id (texto), quantity e, se houver, discount_percent (números)'
          USING ERRCODE = 'PT422';
      END IF;
      v_norm := v_norm || jsonb_build_array(jsonb_build_object(
        'product_id', (v_item.j ->> 'product_id')::uuid,
        'quantity', (v_item.j ->> 'quantity')::numeric,
        'discount_percent', COALESCE((v_item.j ->> 'discount_percent')::numeric, 0)));
    END LOOP;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'item inválido: valor fora do formato' USING ERRCODE = 'PT422';
  END;

  SELECT count(*), count(DISTINCT e ->> 'product_id') INTO v_count, v_distinct
    FROM jsonb_array_elements(v_norm) AS t(e);
  IF v_count <> v_distinct THEN
    RAISE EXCEPTION 'produto repetido no pedido: some as quantidades numa linha só' USING ERRCODE = 'PT422';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_norm) AS t(e)
              WHERE (e ->> 'quantity')::numeric <= 0 OR (e ->> 'quantity')::numeric > 100000
                 OR (e ->> 'discount_percent')::numeric < 0 OR (e ->> 'discount_percent')::numeric > 100) THEN
    RAISE EXCEPTION 'quantidade deve ficar entre 0 e 100000 (exclusive o zero) e desconto entre 0 e 100' USING ERRCODE = 'PT422';
  END IF;

  SELECT jsonb_agg(e ORDER BY e ->> 'product_id') INTO v_norm FROM jsonb_array_elements(v_norm) AS t(e);

  -- ── 3.2 O lead é visível a quem pede? (RLS decide; org alheia e inexistente são indistinguíveis) ─
  SELECT l.organization_id INTO v_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'lead não encontrado' USING ERRCODE = 'PT404';
  END IF;

  -- ── 3.2b Um pedido por vez por lead ────────────────────────────────────────
  -- O CRM tem um trigger (refresh_lead_relacao) que, ao inserir Negócio/card/item, faz SELECT ... FOR UPDATE na linha do
  -- lead. Duas transações que acabam de inserir já seguram FOR KEY SHARE nela (pela FK) e ambas tentam subir para
  -- FOR UPDATE: deadlock de upgrade (medido: 58 de 60 pedidos simultâneos falharam). Este lock consultivo, tomado ANTES de
  -- qualquer escrita e sempre nesta ordem (lead, depois chave), serializa os pedidos do MESMO lead e não exige privilégio
  -- de UPDATE em leads (um FOR UPDATE aqui falharia em silêncio sob RLS). Não protege contra o web/API do CRM criando
  -- Negócio no mesmo lead ao mesmo tempo: esse caminho é do CRM, e o app trata o deadlock como falha transitória.
  PERFORM pg_advisory_xact_lock(hashtextextended('mobile_order:lead:' || p_lead_id::text, 0));

  -- ── 3.3 Idempotência: o corpo é o que o cliente mandou, não o que o catálogo resolveu depois ─
  v_hash := encode(sha256(convert_to(jsonb_build_object(
              'lead', p_lead_id, 'items', v_norm, 'notes', v_notes, 'title', v_title, 'phone', p_lead_phone_id)::text, 'UTF8')), 'hex');
  SELECT * INTO v_begin FROM public.mobile_op_begin(p_op_id, 'order', v_hash);
  IF NOT v_begin.is_new THEN
    RETURN jsonb_build_object(
      'status', 'replayed',
      'deal_id', v_begin.entity_id,
      'value', (SELECT d.value FROM public.deals d WHERE d.id = v_begin.entity_id));
  END IF;

  -- ── 3.4 Empresa liberada e funil de pedidos configurado (falha fechado) ────
  SELECT o.feature_flags INTO v_flags FROM public.organizations o WHERE o.id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead não encontrado' USING ERRCODE = 'PT404';
  END IF;
  IF COALESCE(v_flags -> 'representantes_app', 'false'::jsonb) <> 'true'::jsonb THEN
    RAISE EXCEPTION 'o app de representantes não está liberado para esta empresa' USING ERRCODE = 'PT422';
  END IF;
  v_pipe  := NULLIF(btrim(COALESCE(v_flags -> 'representantes_pedido' ->> 'pipeline', '')), '');
  v_stage := NULLIF(btrim(COALESCE(v_flags -> 'representantes_pedido' ->> 'stage', '')), '');
  IF v_pipe IS NULL OR v_stage IS NULL THEN
    RAISE EXCEPTION 'funil de pedidos não configurado para esta empresa' USING ERRCODE = 'PT422';
  END IF;

  SELECT m.id INTO v_owner
    FROM public.team_members m
   WHERE m.user_id = v_uid AND m.organization_id = v_org AND m.is_active;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'sem vínculo ativo com a empresa deste lead' USING ERRCODE = '42501';
  END IF;

  -- ── 3.5 Catálogo: preço do servidor e piso ─────────────────────────────────
  FOR v_item IN
    SELECT (e ->> 'product_id')::uuid AS product_id, (e ->> 'quantity')::numeric AS quantity,
           (e ->> 'discount_percent')::numeric AS discount
      FROM jsonb_array_elements(v_norm) AS t(e)
  LOOP
    SELECT p.name, p.ticket, p.ticket_minimo, p.is_active INTO v_prod
      FROM public.products p
     WHERE p.id = v_item.product_id AND p.organization_id = v_org;
    IF NOT FOUND OR NOT v_prod.is_active THEN
      RAISE EXCEPTION 'produto % não está disponível no catálogo da empresa', v_item.product_id USING ERRCODE = 'PT422';
    END IF;
    IF v_prod.ticket IS NULL OR v_prod.ticket < 0 THEN
      RAISE EXCEPTION 'produto "%" sem preço no catálogo', v_prod.name USING ERRCODE = 'PT422';
    END IF;
    v_net := round(v_prod.ticket * (100 - v_item.discount) / 100, 2);
    IF v_prod.ticket_minimo IS NOT NULL AND v_net < v_prod.ticket_minimo THEN
      RAISE EXCEPTION 'produto "%": preço com desconto (%) abaixo do mínimo permitido (%)', v_prod.name, v_net, v_prod.ticket_minimo
        USING ERRCODE = 'PT422';
    END IF;
    v_total := v_total + round(v_net * v_item.quantity, 2);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_item.product_id, 'name', v_prod.name, 'quantity', v_item.quantity,
      'unit_price', v_prod.ticket, 'discount', v_item.discount));
  END LOOP;

  -- ── 3.6 Negócio + itens (mesma transação: erro em qualquer ponto desfaz tudo, inclusive a reserva da chave) ─
  BEGIN
    v_deal := public.abrir_negocio(p_lead_id, v_pipe, v_stage, v_owner, v_total, NULL, v_notes, v_title, 'human', p_lead_phone_id);
    FOR v_line IN SELECT e FROM jsonb_array_elements(v_lines) AS t(e)
    LOOP
      PERFORM public.deal_item_lancar(
        v_deal, (v_line ->> 'product_id')::uuid, v_line ->> 'name', (v_line ->> 'quantity')::numeric,
        (v_line ->> 'unit_price')::numeric, (v_line ->> 'discount')::numeric);
    END LOOP;
  EXCEPTION WHEN check_violation OR invalid_parameter_value OR no_data_found THEN
    -- Regra de negócio do CRM (telefone obrigatório, funil ou etapa inexistente...): a mensagem já diz o que fazer.
    RAISE EXCEPTION '%', SQLERRM USING ERRCODE = 'PT422';
  END;

  PERFORM public.mobile_op_finish(p_op_id, v_deal);
  RETURN jsonb_build_object('status', 'created', 'deal_id', v_deal,
                            'value', (SELECT d.value FROM public.deals d WHERE d.id = v_deal));
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Privilégios (o padrão do projeto dá ALL a anon/authenticated/service_role: revogar explicitamente)
-- ───────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.mobile_op_begin(uuid, text, text)   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mobile_op_finish(uuid, uuid)        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mobile_order_create(uuid, uuid, jsonb, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
-- authenticated precisa executar as três: a função é INVOKER e chama os auxiliares com o privilégio do usuário.
-- Os auxiliares só enxergam o próprio ator (auth.uid()), então a exposição não cruza usuários.
GRANT EXECUTE ON FUNCTION public.mobile_op_begin(uuid, text, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_op_finish(uuid, uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_order_create(uuid, uuid, jsonb, text, text, uuid) TO authenticated;

COMMIT;

