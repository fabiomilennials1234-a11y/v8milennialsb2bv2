-- 20260722250000_backfill_carteira_orders.sql
--
-- ISSUE #1202 (PRD #1194 · #986) — Métricas Montáveis S8.
-- Backfill dos pedidos históricos de Carteira para o livro-razão.
--
-- ESTA MIGRATION SÓ CRIA A FUNÇÃO. NÃO EXECUTA O BACKFILL.
-- Rodar é ato deliberado: `SELECT public.fn_backfill_carteira_orders(...)`.
-- Escrever dinheiro no livro-razão é decisão do CTO, não efeito colateral de
-- aplicar uma migration.
--
-- ORDEM CRONOLÓGICA É REQUISITO, NÃO DETALHE
-- -------------------------------------------
-- Medido na #1200, em produção:
--   · avaliando cada pedido contra o livro COMO ESTÁ HOJE  →  1 `carteira`
--   · inserindo em ordem cronológica, em cascata           → 55 `carteira`
-- Diferença: 54 rótulos e R$ 446.831,97 classificados errado.
--
-- A razão é o mecanismo: `metric_revenue_stream` (#1198) pergunta "existe venda
-- anterior NO LIVRO?". Um pedido só é reconhecido como recompra se o pedido
-- anterior do mesmo cliente JÁ ESTIVER no livro. Inserção em lote — um único
-- INSERT ... SELECT — avalia todos contra o estado inicial e produz o primeiro
-- cenário. Por isso o corpo abaixo é um LOOP com ORDER BY, e não um set-based
-- insert: aqui a lentidão é a correção.
--
-- EMPATES
-- -------
-- 61 grupos (131 pedidos, R$ 230.022,44 — 48% do conjunto) têm `sold_at`
-- idêntico ao de outro pedido do mesmo cliente. A #1198 decidiu que empate
-- exato NÃO conta como anterior, então todos saem como primeira compra. Isso é
-- determinístico: o resultado não depende da ordem dentro do grupo empatado.
--
-- DECISÃO DO CTO SOBRE SOBREPOSIÇÃO (registrada aqui porque o código a executa)
-- ----------------------------------------------------------------------------
-- Emitir tudo, MENOS os pedidos cujo valor é IDÊNTICO ao de uma venda de funil
-- do mesmo lead na mesma semana. Em produção esse conjunto tem UM elemento:
-- `f6d01a1d-8768-4947-ba5a-d31214059c59` (Basic4u, R$ 638,40).
--
-- Racional: dos 40 pedidos com vínculo de proposta, 37 têm venda de funil do
-- mesmo lead — e isso NÃO é duplicidade. Funil é a aquisição; o pedido é compra
-- posterior real, que é exatamente o que a Carteira existe para capturar. Não
-- emitir os 40 jogaria fora ~R$ 99 mil de recompra legítima para evitar R$ 638
-- de sobreposição. Igualdade EXATA de valor é o sinal de duplicidade, não
-- proximidade de data.
--
-- A lista de exclusão é PARÂMETRO, não constante embutida: o mesmo código roda
-- em qualquer ambiente, e a decisão de negócio fica no ato de chamar.

CREATE OR REPLACE FUNCTION public.fn_backfill_carteira_orders(
  p_org_id       uuid    DEFAULT NULL,          -- NULL = todas as orgs
  p_exclude_ids  uuid[]  DEFAULT '{}'::uuid[],  -- pedidos a não emitir
  p_dry_run      boolean DEFAULT true           -- padrão SEGURO
)
RETURNS TABLE (
  pedidos_avaliados integer,
  emitidos          integer,
  ja_existiam       integer,
  excluidos         integer,
  sem_lead          integer,
  valor_emitido     numeric,
  carteira          integer,
  novo_negocio      integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r            record;
  v_lead_id    uuid;
  v_stream     text;
  v_inserted   uuid;
  n_aval       integer := 0;
  n_emit       integer := 0;
  n_ja         integer := 0;
  n_excl       integer := 0;
  n_sem_lead   integer := 0;
  v_valor      numeric := 0;
  n_carteira   integer := 0;
  n_novo       integer := 0;
BEGIN
  -- ORDER BY sold_at, id é o coração desta função. Sem ele o rótulo sai errado
  -- em 54 linhas. O `id` é desempate estável para que duas execuções percorram
  -- o conjunto na mesma sequência.
  FOR r IN
    SELECT o.id, o.organization_id, o.client_id, o.sold_at, o.sale_value,
           o.sale_responsible_id, o.pre_sale_responsible_id, o.approved_by
    FROM public.upsell_orders o
    WHERE o.approval_status = 'approved'
      AND (p_org_id IS NULL OR o.organization_id = p_org_id)
    ORDER BY o.sold_at, o.id
  LOOP
    n_aval := n_aval + 1;

    IF r.id = ANY (p_exclude_ids) THEN
      n_excl := n_excl + 1;
      CONTINUE;
    END IF;

    SELECT c.lead_id INTO v_lead_id
    FROM public.upsell_clients c
    WHERE c.id = r.client_id AND c.organization_id = r.organization_id;

    IF v_lead_id IS NULL THEN
      n_sem_lead := n_sem_lead + 1;
      CONTINUE;
    END IF;

    -- Avaliada AGORA, dentro do loop, para enxergar o que já foi inserido.
    v_stream := public.metric_revenue_stream(r.organization_id, v_lead_id, r.sold_at);

    IF p_dry_run THEN
      -- No ensaio não escrevemos, mas ainda contamos o rótulo. Ele será
      -- OTIMISTA para as recompras: sem as inserções anteriores no livro, a
      -- cascata não acontece. É por isso que o ensaio serve para conferir
      -- volume e exclusões, NÃO para conferir a distribuição de rótulo.
      IF EXISTS (SELECT 1 FROM public.sale_events se
                 WHERE se.producer='carteira' AND se.origin_record_id = r.id
                   AND se.event_type='sale') THEN
        n_ja := n_ja + 1;
      ELSE
        n_emit  := n_emit + 1;
        v_valor := v_valor + coalesce(r.sale_value, 0);
        IF v_stream = 'carteira' THEN n_carteira := n_carteira + 1;
        ELSE n_novo := n_novo + 1; END IF;
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.sale_events (
      organization_id, lead_id, pipeline_id, stage_key,
      event_type, sold_at, sale_value, currency, revenue_stream,
      sale_responsible_id, pre_sale_responsible_id,
      actor, source, producer, origin_record_id
    ) VALUES (
      r.organization_id, v_lead_id, NULL, NULL,
      'sale', r.sold_at, r.sale_value, 'BRL', v_stream,
      r.sale_responsible_id,          -- SÓ a chave canônica (finding R5)
      r.pre_sale_responsible_id,
      r.approved_by,
      'backfill',                     -- honesto: estas linhas NÃO vêm de um
                                      -- gatilho vivo. E dá uma segunda camada
                                      -- contra projeção de comissão, que
                                      -- dispara em source='trigger' — além do
                                      -- guard por produtor da #1201.
      'carteira', r.id
    )
    ON CONFLICT (producer, origin_record_id, event_type)
      WHERE origin_record_id IS NOT NULL
      DO NOTHING
    RETURNING id INTO v_inserted;

    IF v_inserted IS NULL THEN
      -- Já existia: rodar de novo não duplica. É a chave da #1199 trabalhando.
      n_ja := n_ja + 1;
    ELSE
      n_emit  := n_emit + 1;
      v_valor := v_valor + coalesce(r.sale_value, 0);
      IF v_stream = 'carteira' THEN n_carteira := n_carteira + 1;
      ELSE n_novo := n_novo + 1; END IF;
    END IF;

    v_inserted := NULL;
  END LOOP;

  RETURN QUERY SELECT n_aval, n_emit, n_ja, n_excl, n_sem_lead,
                      round(v_valor, 2), n_carteira, n_novo;
END;
$function$;

COMMENT ON FUNCTION public.fn_backfill_carteira_orders(uuid, uuid[], boolean) IS
  'Backfill dos pedidos de Carteira aprovados para o livro-razão (#1202). '
  'Percorre em ORDEM CRONOLÓGICA — requisito, não detalhe: em lote o rótulo sai '
  'errado em 54 linhas (medido na #1200). Idempotente pela chave da #1199. '
  'p_dry_run = true por padrão. NÃO é executada por migration alguma.';

REVOKE EXECUTE ON FUNCTION public.fn_backfill_carteira_orders(uuid, uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_backfill_carteira_orders(uuid, uuid[], boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- REVERSÃO — construída junto, não depois
-- ---------------------------------------------------------------------------
-- O livro é append-only e `trg_sale_events_immutable` bloqueia UPDATE sempre e
-- DELETE quando lead e org existem. Reverter um backfill exige, portanto,
-- desabilitar o gatilho na transação — o que só o dono da tabela consegue, e é
-- por isso que esta função é SECURITY DEFINER e só service_role executa.
--
-- Isto NÃO é um furo na imutabilidade: a imutabilidade protege o livro de
-- edição casual. Desfazer um backfill identificado por produtor + origem é
-- operação de administração, deliberada e auditável — e a alternativa seria não
-- ter como voltar atrás de uma escrita de 270 linhas de dinheiro.
CREATE OR REPLACE FUNCTION public.fn_rollback_carteira_backfill(
  p_org_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE n integer;
BEGIN
  ALTER TABLE public.sale_events DISABLE TRIGGER trg_sale_events_immutable;

  DELETE FROM public.sale_events se
  WHERE se.producer = 'carteira'
    AND se.source   = 'backfill'          -- só linhas DE BACKFILL. Linhas
                                          -- emitidas pelo gatilho vivo (#1201,
                                          -- source='trigger') NÃO são tocadas.
    AND (p_org_id IS NULL OR se.organization_id = p_org_id);
  GET DIAGNOSTICS n = ROW_COUNT;

  ALTER TABLE public.sale_events ENABLE TRIGGER trg_sale_events_immutable;
  RETURN n;
END;
$function$;

COMMENT ON FUNCTION public.fn_rollback_carteira_backfill(uuid) IS
  'Desfaz o backfill da #1202. Remove APENAS producer=carteira AND '
  'source=backfill — linhas do gatilho vivo (#1201) ficam. Desabilita o gatilho '
  'de imutabilidade na transação, o que exige ser dono da tabela; por isso '
  'SECURITY DEFINER e só service_role.';

REVOKE EXECUTE ON FUNCTION public.fn_rollback_carteira_backfill(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_rollback_carteira_backfill(uuid) TO service_role;
