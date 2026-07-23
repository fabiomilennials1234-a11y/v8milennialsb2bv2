-- 20260722230000_metric_revenue_stream_canonical.sql
--
-- ISSUE #1198 (PRD #1194 · #986) — Métricas Montáveis S4.
-- Etiqueta de fluxo de receita pelo MOMENTO DO CLIENTE.
--
-- ESTA FATIA É READ-ONLY. Cria uma função e nada mais: nenhum UPDATE em
-- sale_events, nenhum produtor alterado. Quem reetiqueta o livro vivo é a
-- #1203, e ela ativa junto com a #1201. Reverter isto é um DROP FUNCTION.
--
-- O DEFEITO QUE ELA EXISTE PARA CORRIGIR
-- --------------------------------------
-- Hoje os DOIS produtores de sale_events decidem a etiqueta com a mesma
-- expressão (fn_capture_sale_event e fn_backfill_state_sales):
--
--     CASE WHEN EXISTS (
--       SELECT 1 FROM public.upsell_clients uc
--       WHERE uc.organization_id = ... AND uc.lead_id = ... AND uc.is_active
--     ) THEN 'carteira' ELSE 'novo_negocio' END
--
-- Isso responde "este lead É CLIENTE DE CARTEIRA?", não "esta venda É
-- RECOMPRA?". São perguntas diferentes, e a decisão 6 do CTO travou a
-- segunda: primeira compra é novo_negocio, recompra é carteira.
--
-- Além de responder a pergunta errada, a expressão NÃO É DETERMINÍSTICA sobre
-- histórico: depende de `uc.is_active`, que é estado de AGORA. Recalcular a
-- etiqueta de uma venda de janeiro daria uma resposta diferente conforme o
-- cliente esteja ativo hoje ou não. Uma etiqueta de livro-razão não pode mudar
-- porque o mundo mudou depois.
--
-- A REGRA CANÔNICA
-- ----------------
-- Existe venda ANTERIOR e NÃO-ESTORNADA para este lead nesta org?
--   sim → 'carteira'      (recompra)
--   não → 'novo_negocio'  (primeira compra)
--
-- Determinística porque depende só de (a) o próprio livro de vendas e (b) a
-- âncora temporal passada pelo chamador. Não lê estado de cliente, não lê
-- pipeline, não lê nada que possa mudar retroativamente.
--
-- SERVE OS DOIS PRODUTORES: transição de etapa (passa o sold_at do evento) e
-- pedido de Carteira (passa a data do pedido). A mesma pergunta, uma resposta.
--
-- DECISÕES DE BORDA, explícitas para não virarem folclore
-- -------------------------------------------------------
-- 1. ESTORNO. Uma venda estornada NÃO conta como anterior — o estorno desfaz o
--    fato. Detectado por sale_events.reversed_event_id apontando para ela, que
--    é como o resto do sistema já modela reversão.
-- 2. EMPATE EXATO de sold_at NÃO conta como anterior (comparação estrita `<`).
--    Duas vendas no mesmo instante não podem ser recompra uma da outra; sem a
--    comparação estrita o resultado dependeria da ordem de inserção, e aí a
--    função deixaria de ser determinística.
-- 3. p_exclude_sale_event_id existe para recálculo sobre uma linha que JÁ está
--    no livro (o caso da #1203): sem ele o evento se veria no espelho. Não é
--    otimização, é correção.
-- 4. SECURITY INVOKER de propósito. A RLS de sale_events é org-scoped
--    (`organization_id IN (SELECT get_my_organization_ids())`), não
--    por-responsável, então qualquer membro da org enxerga o livro inteiro da
--    org e a resposta é a mesma para todos. Não há motivo para DEFINER aqui, e
--    DEFINER exigiria auditoria por permitir inferência cross-tenant.
--    Consequência assumida: quem NÃO tem acesso à org recebe 'novo_negocio'
--    porque não enxerga venda alguma. Inofensivo — essa pessoa também não
--    consegue inserir venda naquela org.

CREATE OR REPLACE FUNCTION public.metric_revenue_stream(
  p_org_id                uuid,
  p_lead_id               uuid,
  p_sold_at               timestamptz,
  p_exclude_sale_event_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.sale_events e
      WHERE e.organization_id = p_org_id
        AND e.lead_id         = p_lead_id
        AND e.event_type      = 'sale'
        AND e.sold_at         < p_sold_at
        AND (p_exclude_sale_event_id IS NULL OR e.id <> p_exclude_sale_event_id)
        AND NOT EXISTS (
          SELECT 1
          FROM public.sale_events r
          WHERE r.event_type        = 'sale_reversed'
            AND r.reversed_event_id = e.id
        )
    )
    THEN 'carteira'
    ELSE 'novo_negocio'
  END;
$function$;

COMMENT ON FUNCTION public.metric_revenue_stream(uuid, uuid, timestamptz, uuid) IS
  'Fonte canônica do fluxo de receita (ADR-0017 / #1198). Responde pelo MOMENTO '
  'DO CLIENTE: existe venda anterior não-estornada para este lead nesta org? '
  'sim = carteira (recompra), não = novo_negocio (primeira compra). '
  'Determinística: lê só o livro de vendas e a âncora temporal recebida — nunca '
  'estado atual do cliente. Serve aos dois produtores (transição de etapa e '
  'pedido de Carteira) e a recálculo sobre histórico. Empate exato de sold_at '
  'não conta como anterior. p_exclude_sale_event_id evita que uma linha já '
  'gravada se veja no espelho ao ser recalculada.';

-- Índice de apoio: a função filtra por (org, lead, event_type) e ordena por
-- sold_at. Sem ele, cada chamada varre sale_events — e a #1203 vai chamá-la uma
-- vez por linha do livro.
CREATE INDEX IF NOT EXISTS idx_sale_events_org_lead_sold_at
  ON public.sale_events (organization_id, lead_id, sold_at)
  WHERE event_type = 'sale';

REVOKE EXECUTE ON FUNCTION public.metric_revenue_stream(uuid, uuid, timestamptz, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metric_revenue_stream(uuid, uuid, timestamptz, uuid) TO authenticated, service_role;
