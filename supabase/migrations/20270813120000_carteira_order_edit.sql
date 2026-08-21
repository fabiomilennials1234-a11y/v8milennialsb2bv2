-- 20270813120000_carteira_order_edit.sql
--
-- CARTEIRA — listar pedidos e editar os SEM vínculo com ERP (FATIA 1).
--
-- Cliente em produção: "preciso editar alguns clientes que foram faturados
-- errado, não tem como editar ou excluir o pedido?". Hoje pedido aprovado é
-- imutável pela UI.
--
-- ESCOPO (decisão do CTO): "no escopo desse pedido quero apenas listar os
-- pedidos e poder editar aqueles sem link com o ERP".
--
--   ✔ listar (busca, paginação, procedência resolvida no servidor)
--   ✔ editar pedido MANUAL — 6 campos + itens, numa transação só
--   ✘ cancelar / descancelar  — fora desta fatia, inteiramente
--   ✘ excluir (hard delete)   — fatia 2
--   ✘ upsell_client_products  — fatia 3
--
-- POR QUE O GATE É PROCEDÊNCIA, E NÃO NOTA FISCAL
-- ------------------------------------------------
-- Se o pedido nasceu no ERP (ou foi espelhado para lá), o ERP é a fonte da
-- verdade. Editar do lado do CRM produziria duas verdades sobre o mesmo pedido,
-- e a divergência só apareceria na conciliação, semanas depois.
--
-- MEDIDO em prod: 534 pedidos aprovados — 302 manuais / 232 com vínculo ERP.
-- `notas_fiscais` tem 0 linhas na base inteira, então o vínculo real hoje vem
-- de `tiny_order_id` e de `external_source`. Atenção ao ler os dois números
-- soltos: `external_source` tem 95 não-nulos, mas só conta como ERP quando vale
-- `tiny`/`omie` — `funnel_sale_event` não é ERP e continua editável. Somados
-- sem esse filtro dariam 255, que é errado. É por isso que a UI rotula
-- pela PROCEDÊNCIA (TinyERP/Omie/NF-e) e não pela palavra "faturado": dizer
-- "cancele a nota" para 232 pedidos sem nota mandaria o usuário caçar um
-- documento que não existe.
--
-- ESTA MIGRATION NÃO TOCA RLS. As policies de `upsell_orders` ficam como no
-- baseline. Consequência declarada: o gate de "ERP é read-only" vive na RPC, e
-- um PATCH cru via PostgREST ainda alcança a tabela — superfície PRÉ-EXISTENTE,
-- não introduzida aqui. Registrada para o CTO.
--
-- LIMITAÇÃO DECLARADA — EDIÇÃO NÃO CORRIGE O LIVRO-RAZÃO
-- -----------------------------------------------------
-- Editar um pedido aprovado altera `upsell_orders` e, por consequência, as
-- métricas derivadas de `upsell_clients` (lifetime_value, avg_ticket,
-- order_count, recompra — via trg_upsell_order_recalc_metrics). **Não** emite
-- correção em `sale_events`.
--
-- O motivo é estrutural: os gatilhos de 20260723013018 escutam apenas
-- `AFTER INSERT WHEN approved` e `AFTER UPDATE OF approval_status`. Nenhum
-- deles observa sale_value, sold_at, client_id ou sale_responsible_id. Uma
-- venda já emitida fica congelada no caderno com os valores do momento da
-- aprovação.
--
-- CONSEQUÊNCIA: org com `organizations.carteira_emits_revenue_enabled = true`
-- verá divergência entre a Carteira e a receita canônica do ADR-0017. Medido:
-- hoje **uma** org tem a flag ligada (Milennials, 41 pedidos, todos editáveis e
-- todos com linha no caderno) — ou seja, interseção de 100% naquela org e zero
-- clientes expostos fora dela.
--
-- DECISÃO DO CTO: aceitar a divergência nesta fatia e não afirmar o contrário
-- em lugar nenhum da UI. O caminho de saída, quando for priorizado, é emitir um
-- PAR CORRETIVO (`sale_reversed` do evento antigo + `sale` novo) atrás da mesma
-- flag `carteira_emits_revenue_enabled`, respeitando a chave de idempotência da
-- #1199. Não é o que esta fatia faz.

-- ===========================================================================
-- 1. AUDITORIA — order_events ganha payload e o tipo 'edited'
-- ===========================================================================
-- Inegociável: editar valor de venda sem rastro, com PITR OFF, é exatamente o
-- buraco que já queimou este repo antes (hard-delete sem rastro em leads).

ALTER TABLE public.order_events
  ADD COLUMN IF NOT EXISTS payload jsonb;

COMMENT ON COLUMN public.order_events.payload IS
  'Detalhe estruturado do evento. edited → {scope, before, after} com o '
  'snapshot dos campos editáveis.';

-- DROP + ADD direto, sem NOT VALID/VALIDATE: a migration roda dentro de UMA
-- transação, e ali o split não reduz lock nenhum — o ACCESS EXCLUSIVE fica
-- retido até o commit de qualquer forma. Com 499 linhas em order_events o
-- ganho seria zero e o comentário viraria folclore copiado adiante.
ALTER TABLE public.order_events
  DROP CONSTRAINT IF EXISTS order_events_event_type_check;

ALTER TABLE public.order_events
  ADD CONSTRAINT order_events_event_type_check
  CHECK (event_type = ANY (ARRAY['created', 'approved', 'rejected', 'edited']));

-- ===========================================================================
-- 2. ÍNDICES
-- ===========================================================================
-- A lista filtra por (org, status) e ordena por sold_at desc.
CREATE INDEX IF NOT EXISTS idx_upsell_orders_org_status_sold
  ON public.upsell_orders (organization_id, approval_status, sold_at DESC);

-- Resolução de procedência — sem índice, dois EXISTS por linha viram seq scan.
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_order_id
  ON public.notas_fiscais (order_id) WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tinyerp_order_mappings_upsell_order_id
  ON public.tinyerp_order_mappings (upsell_order_id) WHERE upsell_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_events_order_id_created
  ON public.order_events (order_id, created_at DESC);

-- ===========================================================================
-- 3. PROCEDÊNCIA DO PEDIDO
-- ===========================================================================
-- Uma função só, dois chamadores (lista e update). Os 4 caminhos vivendo em
-- dois lugares é como eles divergem: a lista diria "editável" e a RPC diria que
-- não, e o usuário levaria erro num botão que a própria UI ofereceu.
--
-- Recebe as COLUNAS (e não só o id) para poder ser chamada no LATERAL da lista
-- sem re-consultar upsell_orders uma vez por linha.
CREATE OR REPLACE FUNCTION public.carteira_erp_source(
  p_order_id        uuid,
  p_org_id          uuid,
  p_tiny_order_id   text,
  p_external_source text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.notas_fiscais n
      WHERE n.order_id = p_order_id AND n.organization_id = p_org_id
    ) THEN 'nfe'
    WHEN COALESCE(p_external_source, '') = 'omie' THEN 'omie'
    WHEN p_tiny_order_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.tinyerp_order_mappings m
        WHERE m.upsell_order_id = p_order_id AND m.organization_id = p_org_id
      )
      OR COALESCE(p_external_source, '') = 'tiny' THEN 'tiny'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.carteira_erp_source(uuid, uuid, text, text) IS
  'Procedência do pedido: nfe | tiny | omie | NULL (manual). NULL = editável '
  'pelo CRM; qualquer outro valor = read-only, o ERP é a fonte da verdade. '
  'Fonte única dos 4 caminhos de vínculo — consumida por carteira_list_orders '
  'e carteira_update_order.';

-- Sem GRANT para authenticated de propósito: os dois chamadores são funções
-- SECURITY DEFINER de owner postgres, que já executam com privilégio próprio.
REVOKE ALL ON FUNCTION public.carteira_erp_source(uuid, uuid, text, text) FROM PUBLIC;

-- ===========================================================================
-- 4. AUDITORIA — handle_order_event_audit reescrita
-- ===========================================================================
-- Antes: AFTER INSERT OR UPDATE OF approval_status, gravando só quando o status
-- novo era 'approved'/'rejected'. Edição de valor passava em silêncio total.
--
-- Agora: também grava 'edited' com o snapshot {before, after} dos campos
-- editáveis. O comportamento de status fica idêntico ao anterior — esta fatia
-- não mexe em aprovação.
--
-- ANTI-SPAM (obrigatório): o trigger passa a ouvir TODO update, e três caminhos
-- de ERP re-sincronizam pedidos existentes a cada ciclo —
-- tinyerp-pull-orders/index.ts:297, erp-order-webhook/index.ts:197,
-- _shared/erp/sync/upsert-order.ts:81. Sem o guard `IS DISTINCT FROM` sobre o
-- snapshot, cada ciclo geraria um 'edited' por pedido e o log viraria ruído em
-- dias. Re-sync com payload idêntico não grava nada.
CREATE OR REPLACE FUNCTION public.handle_order_event_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_events (organization_id, order_id, event_type, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'created', auth.uid());
    RETURN NEW;
  END IF;

  -- Status: comportamento preservado do baseline (12230-12252).
  IF OLD.approval_status IS DISTINCT FROM NEW.approval_status
     AND NEW.approval_status IN ('approved', 'rejected') THEN
    INSERT INTO public.order_events (
      organization_id, order_id, event_type, actor_id, comment
    )
    VALUES (
      NEW.organization_id,
      NEW.id,
      NEW.approval_status,
      COALESCE(NEW.approved_by, auth.uid()),
      NEW.approval_comment
    );
  END IF;

  -- ATENÇÃO: este snapshot cobre EXATAMENTE os 6 campos editáveis de
  -- carteira_update_order. Abrir um campo novo à edição (notes, product_type,
  -- origin, ...) exige estendê-lo NA MESMA MUDANÇA — senão a edição desse
  -- campo passa sem rastro e o audit log mente por omissão.
  v_before := jsonb_build_object(
    'sale_value',          OLD.sale_value,
    'sold_at',             OLD.sold_at,
    'product_name',        OLD.product_name,
    'closer_id',           OLD.closer_id,
    'sale_responsible_id', OLD.sale_responsible_id,
    'client_id',           OLD.client_id
  );
  v_after := jsonb_build_object(
    'sale_value',          NEW.sale_value,
    'sold_at',             NEW.sold_at,
    'product_name',        NEW.product_name,
    'closer_id',           NEW.closer_id,
    'sale_responsible_id', NEW.sale_responsible_id,
    'client_id',           NEW.client_id
  );

  IF v_before IS DISTINCT FROM v_after THEN
    INSERT INTO public.order_events (
      organization_id, order_id, event_type, actor_id, payload
    )
    VALUES (
      NEW.organization_id, NEW.id, 'edited', auth.uid(),
      jsonb_build_object('scope', 'order', 'before', v_before, 'after', v_after)
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_order_event_audit() IS
  'Audit log de upsell_orders. Preserva created/approved/rejected do baseline e '
  'acrescenta edited com snapshot {before,after} dos 6 campos editáveis. '
  'edited só grava quando um deles muda de fato — re-sync do ERP com payload '
  'idêntico não gera evento (tinyerp-pull-orders:297, erp-order-webhook:197, '
  'upsert-order.ts:81).';

-- Passa a ouvir todas as colunas: sem isso a edição não seria vista.
DROP TRIGGER IF EXISTS trg_order_event_audit ON public.upsell_orders;
CREATE TRIGGER trg_order_event_audit
  AFTER INSERT OR UPDATE ON public.upsell_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_event_audit();

-- ===========================================================================
-- 5. RPC — LISTAR
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.carteira_list_orders(
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text    DEFAULT NULL,
  p_org_id uuid    DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  client_id             uuid,
  client_name           text,
  client_company        text,
  product_name          text,
  product_type          text,
  sale_value            numeric,
  sold_at               timestamptz,
  source                text,
  origin                text,
  notes                 text,
  approval_status       text,
  closer_id             uuid,
  closer_name           text,
  sale_responsible_id   uuid,
  sale_responsible_name text,
  approved_at           timestamptz,
  created_at            timestamptz,
  is_erp_linked         boolean,
  erp_source            text,
  items                 jsonb,
  total_count           bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org    uuid;
  v_limit  integer;
  v_offset integer;
  v_search text;
BEGIN
  -- p_org_id é ADITIVO e existe para o master ghost, que não tem
  -- get_user_organization_id(). assert_org_access é quem impede que vire IDOR:
  -- membro que passa org alheia leva access_denied.
  v_org := COALESCE(p_org_id, public.get_user_organization_id());
  PERFORM public.assert_org_access(v_org);
  PERFORM public.assert_org_member(v_org);

  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_search := NULLIF(btrim(COALESCE(p_search, '')), '');

  RETURN QUERY
  SELECT
    o.id,
    o.client_id,
    c.name,
    c.company,
    o.product_name,
    o.product_type,
    o.sale_value,
    o.sold_at,
    o.source,
    o.origin,
    o.notes,
    o.approval_status,
    o.closer_id,
    closer.name,
    o.sale_responsible_id,
    resp.name,
    o.approved_at,
    o.created_at,
    erp.source IS NOT NULL,
    erp.source,
    COALESCE(it.items, '[]'::jsonb),
    COUNT(*) OVER ()
  FROM public.upsell_orders o
  JOIN public.upsell_clients c
    ON c.id = o.client_id
   AND c.organization_id = o.organization_id
  -- `AND organization_id` nos dois joins de responsável: sem ele, um
  -- closer_id/sale_responsible_id com drift (apontando para membro de outra
  -- org) faria a lista devolver o NOME de alguém de outro tenant.
  LEFT JOIN public.team_members closer
    ON closer.id = o.closer_id
   AND closer.organization_id = o.organization_id
  LEFT JOIN public.team_members resp
    ON resp.id = o.sale_responsible_id
   AND resp.organization_id = o.organization_id
  -- Procedência resolvida no SERVIDOR. Os 4 caminhos avaliados no cliente
  -- seriam N+1 por página (50 pedidos = 100 round-trips extras).
  CROSS JOIN LATERAL (
    SELECT public.carteira_erp_source(
             o.id, o.organization_id, o.tiny_order_id, o.external_source
           ) AS source
  ) erp
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'id',           i.id,
               'product_id',   i.product_id,
               'product_name', i.product_name,
               'quantity',     i.quantity,
               'unit_price',   i.unit_price,
               'unit',         i.unit
             ) ORDER BY i.created_at, i.id
           ) AS items
    FROM public.client_purchase_items i
    WHERE i.order_id = o.id
  ) it ON true
  WHERE o.organization_id = v_org
    AND o.approval_status = 'approved'
    AND (
      v_search IS NULL
      OR c.name         ILIKE '%' || v_search || '%'
      OR c.company      ILIKE '%' || v_search || '%'
      OR o.product_name ILIKE '%' || v_search || '%'
    )
  ORDER BY o.sold_at DESC, o.created_at DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION public.carteira_list_orders(integer, integer, text, uuid) IS
  'Aba Pedidos da Carteira — pedidos APROVADOS da org. Devolve is_erp_linked + '
  'erp_source já resolvidos via carteira_erp_source (notas_fiscais, '
  'tiny_order_id, tinyerp_order_mappings, external_source tiny/omie) e os itens '
  'agregados, para não gerar N+1 por página. Pedido com erp_source não-nulo é '
  'read-only. total_count via window function.';

REVOKE ALL ON FUNCTION public.carteira_list_orders(integer, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carteira_list_orders(integer, integer, text, uuid) TO authenticated;

-- ===========================================================================
-- 6. RPC — EDITAR
-- ===========================================================================
-- admin + membro (editar é direito de quem pertence à org). Cabeçalho e itens
-- no MESMO commit: uma RPC que atualizasse o header e deixasse os itens para
-- uma segunda chamada do cliente pode ser interrompida no meio e deixar
-- sale_value divergindo da soma dos itens — que é exatamente o estado
-- "faturado errado" que o cliente pediu para consertar.
CREATE OR REPLACE FUNCTION public.carteira_update_order(
  p_order_id uuid,
  p_patch    jsonb DEFAULT '{}'::jsonb,
  p_items    jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order        public.upsell_orders%ROWTYPE;
  v_patch        jsonb := COALESCE(p_patch, '{}'::jsonb);
  v_sale_value   numeric;
  v_sold_at      timestamptz;
  v_product_name text;
  v_closer_id    uuid;
  v_resp_id      uuid;
  v_client_id    uuid;
  v_items_before jsonb;
  v_items_after  jsonb;
  v_bad_item     integer;
  v_erp_source   text;
  v_rows         integer;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- FOR UPDATE: esta função escreve em DUAS tabelas (itens e cabeçalho) na
  -- mesma transação. O lock serializa editores concorrentes, e em READ
  -- COMMITTED o SELECT re-lê a linha depois de obtê-lo — então os gates abaixo
  -- enxergam o estado ATUAL, não o de antes da espera.
  --
  -- O que isso NÃO faz: não detecta edição concorrente. Duas edições do mesmo
  -- pedido resolvem por LAST-WRITE-WINS silencioso — a segunda espera o lock e
  -- sobrescreve a primeira. Detecção exigiria versionamento otimista (coluna de
  -- versão ou comparação de snapshot), que não está nesta fatia.
  SELECT * INTO v_order
  FROM public.upsell_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Gate de tenancy ANTES de qualquer leitura derivada.
  PERFORM public.assert_org_access(v_order.organization_id);
  PERFORM public.assert_org_member(v_order.organization_id);

  -- Só pedido APROVADO é editável. A lista só devolve aprovados, mas a RPC tem
  -- GRANT EXECUTE TO authenticated e vive no PostgREST: sem este gate, um
  -- membro alcança pedido PENDENTE por chamada direta e muda o valor ANTES da
  -- aprovação — esvaziando o gate de aprovação inteiro. A whitelist já impede
  -- mexer no próprio approval_status; o que faltava era recusar a linha.
  IF v_order.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'order_not_approved' USING ERRCODE = '42501';
  END IF;

  -- Procedência: pedido vindo do ERP é read-only no CRM.
  v_erp_source := public.carteira_erp_source(
    v_order.id, v_order.organization_id,
    v_order.tiny_order_id, v_order.external_source
  );
  IF v_erp_source IS NOT NULL THEN
    RAISE EXCEPTION 'order_erp_linked' USING ERRCODE = '42501';
  END IF;

  -- Whitelist estrita: chave desconhecida é erro, não silêncio. Silêncio aqui
  -- significaria "salvei" na UI com o campo intacto no banco.
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(v_patch) AS k
    WHERE k NOT IN (
      'sale_value', 'sold_at', 'product_name',
      'closer_id', 'sale_responsible_id', 'client_id'
    )
  ) THEN
    RAISE EXCEPTION 'invalid_patch_field' USING ERRCODE = '22023';
  END IF;

  v_sale_value   := CASE WHEN v_patch ? 'sale_value'   THEN NULLIF(v_patch->>'sale_value','')::numeric   ELSE v_order.sale_value END;
  v_sold_at      := CASE WHEN v_patch ? 'sold_at'      THEN NULLIF(v_patch->>'sold_at','')::timestamptz  ELSE v_order.sold_at END;
  v_product_name := CASE WHEN v_patch ? 'product_name' THEN btrim(COALESCE(v_patch->>'product_name','')) ELSE v_order.product_name END;
  v_closer_id    := CASE WHEN v_patch ? 'closer_id'    THEN NULLIF(v_patch->>'closer_id','')::uuid       ELSE v_order.closer_id END;
  v_resp_id      := CASE WHEN v_patch ? 'sale_responsible_id' THEN NULLIF(v_patch->>'sale_responsible_id','')::uuid ELSE v_order.sale_responsible_id END;
  v_client_id    := CASE WHEN v_patch ? 'client_id'    THEN NULLIF(v_patch->>'client_id','')::uuid       ELSE v_order.client_id END;

  -- ── Itens ────────────────────────────────────────────────────────────────
  IF p_items IS NOT NULL THEN
    IF jsonb_typeof(p_items) <> 'array' THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'items_required' USING ERRCODE = '22023';
    END IF;

    SELECT COUNT(*) INTO v_bad_item
    FROM jsonb_array_elements(p_items) AS e
    WHERE COALESCE(btrim(e->>'product_name'), '') = ''
       OR COALESCE((e->>'quantity')::numeric, 0) <= 0
       OR COALESCE((e->>'unit_price')::numeric, -1) < 0;

    IF v_bad_item > 0 THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;

    -- Itens mandam no total. Deixar o usuário informar itens E um sale_value
    -- divergente seria reabrir a porta do "faturado errado".
    SELECT SUM((e->>'quantity')::numeric * (e->>'unit_price')::numeric)
      INTO v_sale_value
    FROM jsonb_array_elements(p_items) AS e;

    -- product_name espelha os itens, igual a useNewOrder.ts:75-77 — a menos
    -- que o usuário o tenha editado explicitamente no mesmo patch.
    IF NOT (v_patch ? 'product_name') THEN
      SELECT string_agg(btrim(e->>'product_name'), ', ')
        INTO v_product_name
      FROM jsonb_array_elements(p_items) AS e;
    END IF;
  END IF;

  -- ── Validações de domínio (espelham os CHECKs da tabela) ─────────────────
  IF v_sale_value IS NULL OR v_sale_value <= 0 THEN
    RAISE EXCEPTION 'invalid_sale_value' USING ERRCODE = '22023';
  END IF;
  IF v_product_name IS NULL OR v_product_name = '' THEN
    RAISE EXCEPTION 'invalid_product_name' USING ERRCODE = '22023';
  END IF;
  IF v_sold_at IS NULL THEN
    RAISE EXCEPTION 'invalid_sold_at' USING ERRCODE = '22023';
  END IF;

  -- Cross-tenant: cliente e responsáveis TÊM que ser da org do pedido. Sem
  -- isto a RPC (que bypassa RLS) seria um IDOR de escrita — mover receita para
  -- um cliente de outro tenant com um uuid adivinhado.
  IF v_client_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.upsell_clients c
    WHERE c.id = v_client_id AND c.organization_id = v_order.organization_id
  ) THEN
    RAISE EXCEPTION 'invalid_client' USING ERRCODE = '22023';
  END IF;

  IF v_closer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.id = v_closer_id AND tm.organization_id = v_order.organization_id
  ) THEN
    RAISE EXCEPTION 'invalid_closer' USING ERRCODE = '22023';
  END IF;

  IF v_resp_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.id = v_resp_id AND tm.organization_id = v_order.organization_id
  ) THEN
    RAISE EXCEPTION 'invalid_sale_responsible' USING ERRCODE = '22023';
  END IF;

  -- ── Escrita ──────────────────────────────────────────────────────────────
  IF p_items IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'product_name', i.product_name,
               'quantity',     i.quantity,
               'unit_price',   i.unit_price,
               'unit',         i.unit
             ) ORDER BY i.created_at, i.id
           ), '[]'::jsonb)
      INTO v_items_before
    FROM public.client_purchase_items i
    WHERE i.order_id = v_order.id;

    DELETE FROM public.client_purchase_items WHERE order_id = v_order.id;

    INSERT INTO public.client_purchase_items (
      order_id, product_id, product_name, quantity, unit_price, unit
    )
    SELECT
      v_order.id,
      NULLIF(e->>'product_id', '')::uuid,
      btrim(e->>'product_name'),
      (e->>'quantity')::numeric,
      (e->>'unit_price')::numeric,
      COALESCE(NULLIF(btrim(COALESCE(e->>'unit', '')), ''), 'un')
    FROM jsonb_array_elements(p_items) AS e;

    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'product_name', i.product_name,
               'quantity',     i.quantity,
               'unit_price',   i.unit_price,
               'unit',         i.unit
             ) ORDER BY i.created_at, i.id
           ), '[]'::jsonb)
      INTO v_items_after
    FROM public.client_purchase_items i
    WHERE i.order_id = v_order.id;
  END IF;

  UPDATE public.upsell_orders o
     SET sale_value          = v_sale_value,
         sold_at             = v_sold_at,
         product_name        = v_product_name,
         closer_id           = v_closer_id,
         sale_responsible_id = v_resp_id,
         client_id           = v_client_id
   WHERE o.id = v_order.id
     AND o.approval_status = v_order.approval_status;

  -- Guarda defensiva, NÃO proteção contra corrida.
  --
  -- Com o FOR UPDATE acima, `v_order.approval_status` é lido sob lock e
  -- comparado consigo mesmo — o predicado não tem como falhar hoje, e isto foi
  -- verificado com duas sessões concorrentes reais. O check existe para o dia
  -- em que alguém remover o lock: os itens já foram apagados e reinseridos na
  -- mesma transação, então um UPDATE que casasse 0 linhas deixaria sale_value
  -- velho com itens novos E retornaria sucesso — o próprio defeito que esta
  -- feature existe para consertar. Custa nada e falha alto.
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'order_state_changed' USING ERRCODE = 'P0001';
  END IF;

  -- Auditoria dos ITENS. O trigger só enxerga colunas de upsell_orders, então
  -- troca de item que não mexa no total (ex.: trocar produto mantendo preço)
  -- passaria sem rastro. Evento separado, com scope='items'.
  IF v_items_before IS DISTINCT FROM v_items_after THEN
    INSERT INTO public.order_events (
      organization_id, order_id, event_type, actor_id, payload
    )
    VALUES (
      v_order.organization_id, v_order.id, 'edited', auth.uid(),
      jsonb_build_object('scope', 'items', 'before', v_items_before, 'after', v_items_after)
    );
  END IF;

  RETURN jsonb_build_object(
    'id',                  v_order.id,
    'sale_value',          v_sale_value,
    'sold_at',             v_sold_at,
    'product_name',        v_product_name,
    'closer_id',           v_closer_id,
    'sale_responsible_id', v_resp_id,
    'client_id',           v_client_id,
    'previous_client_id',  v_order.client_id,
    'items_changed',       (v_items_before IS DISTINCT FROM v_items_after)
  );
END;
$$;

COMMENT ON FUNCTION public.carteira_update_order(uuid, jsonb, jsonb) IS
  'Edita pedido MANUAL e APROVADO da Carteira (admin + membro). Recusa pedido '
  'não-aprovado (order_not_approved) e pedido com vínculo ERP '
  '(order_erp_linked). Cabeçalho e itens no mesmo commit, sob FOR UPDATE. '
  'Whitelist estrita de 6 campos. Se p_items vier, sale_value passa a ser a '
  'soma e product_name espelha os itens (salvo patch explícito). Valida cliente '
  'e responsáveis contra a org do pedido — a RPC bypassa RLS. NÃO emite '
  'correção em sale_events: ver limitação declarada no cabeçalho da migration.';

REVOKE ALL ON FUNCTION public.carteira_update_order(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carteira_update_order(uuid, jsonb, jsonb) TO authenticated;
