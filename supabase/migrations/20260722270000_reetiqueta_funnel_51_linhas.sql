-- 20260722270000_reetiqueta_funnel_51_linhas.sql
--
-- ISSUE — Opção B (decisão do CTO): reescrever as vendas de funil etiquetadas
-- 'carteira' que, contra o livro COMPLETO, são primeira compra (deveriam ser
-- 'novo_negocio'). PRD #1194 · #986.
--
-- ESTA MIGRATION SÓ CRIA AS FUNÇÕES. NÃO EXECUTA A REESCRITA.
-- Rodar é ato deliberado: SELECT public.fn_reetiqueta_funnel_streams(...).
-- Reescrever dinheiro no livro-razão é decisão do CTO, no molde do #1202/#1209.
--
-- ⚠️ ORDEM DE EXECUÇÃO É PARTE DO CONTRATO — CORRIGIDO NA VOLTA 1 (REPROVA DO CRIVO)
-- ------------------------------------------------------------------------------
-- Esta fatia SÓ pode rodar DEPOIS que o backfill de Carteira (#1202) já inseriu
-- as vendas de Carteira no livro. Rodar antes reescreve ERRADO.
--
-- Por quê: metric_revenue_stream conta QUALQUER venda anterior (event_type='sale')
-- como "prior" — inclusive as do produtor de Carteira. Medido em prod na volta 1:
--   · 46 das 51 linhas (R$ 191.533,66) têm um pedido de Carteira APROVADO com
--     sold_at ANTERIOR à venda de funil. Quando o #1202 insere essas vendas de
--     Carteira no livro, essas 46 viram RECOMPRA LEGÍTIMA → canonical = carteira
--     → a etiqueta 'carteira' que elas já têm está CERTA. Reescrevê-las para
--     novo_negocio INVERTERIA o erro.
--   · só 5 linhas (R$ 7.151,30) são primeira compra de verdade, sem nenhum
--     pedido de Carteira antes. ESSAS são o alvo real.
--
-- A medição anterior de "51 divergentes" foi feita contra o livro INCOMPLETO —
-- sem as vendas de Carteira, porque o #1202 ainda não havia rodado. Assim que a
-- Carteira entra no livro, 46 deixam de divergir. O deliverable dependia de uma
-- ordem que ninguém havia fixado, e a ordem certa colapsa 51 → 5.
--
-- GUARD: a função RECUSA rodar se o livro ainda não tem nenhuma venda de
-- produtor 'carteira' na org — torna impossível reescrever contra o livro
-- incompleto e congelar as 46 erradas. Ver o RAISE no corpo.
--
-- O QUE MUDA E O QUE NÃO MUDA
-- ---------------------------
-- O #1203 conserta o FLUXO. Esta fatia conserta o HISTÓRICO das ~5 linhas que
-- são primeira compra de verdade. O livro é append-only, então "corrigir" é
-- estorno + reemissão, não UPDATE — molde do #1202.
--
-- RECEITA TOTAL INALTERADA: o estorno anula a linha, a reemissão repõe o MESMO
-- valor com a etiqueta certa. Só a divisão Funil/Carteira muda.
--
-- ORDEM / EMPATE entre as linhas-alvo: irrelevante. Cada linha errada é a única
-- do seu lead; reetiquetar uma não altera nenhuma outra. A reetiqueta passa por
-- metric_revenue_stream (fonte canônica) e exclui a própria linha do cálculo.
--
-- ATRIBUIÇÃO / VALOR: preservados exatos da linha original.

CREATE OR REPLACE FUNCTION public.fn_reetiqueta_funnel_streams(
  p_org_id  uuid    DEFAULT NULL,   -- NULL = todas as orgs
  p_dry_run boolean DEFAULT true    -- padrão SEGURO
)
RETURNS TABLE (
  avaliadas       integer,
  reescritas      integer,
  ja_corrigidas   integer,
  valor_movido    numeric,
  para_novo       integer,
  para_carteira   integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r          record;
  v_stream   text;
  v_rev_id   uuid;
  v_new_id   uuid;
  n_aval     integer := 0;
  n_reesc    integer := 0;
  n_ja       integer := 0;
  v_valor    numeric := 0;
  n_novo     integer := 0;
  n_cart     integer := 0;
BEGIN
  -- GUARD DE ORDEM (volta 1 do Crivo). Sem uma venda de produtor 'carteira' no
  -- livro da org, o backfill de Carteira (#1202) ainda não rodou, e o livro está
  -- INCOMPLETO: metric_revenue_stream não enxerga os pedidos de Carteira
  -- anteriores, então classifica como primeira compra 46 linhas que na verdade
  -- são recompra. Reescrevê-las aqui inverteria o erro. Recusamos rodar.
  --
  -- Exceção: dry-run NÃO é bloqueado — o ensaio precisa poder rodar antes para
  -- conferir volume. Mas ele avisa (RAISE NOTICE) que o número virá inflado se o
  -- #1202 não tiver rodado.
  --
  -- Escopo do guard: quando p_org_id é dado, checa aquela org; quando é NULL
  -- (todas), exige Carteira em QUALQUER org — a operação global só faz sentido
  -- depois que o backfill global rodou.
  IF NOT p_dry_run THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.sale_events se
      WHERE se.producer = 'carteira' AND se.event_type = 'sale'
        AND (p_org_id IS NULL OR se.organization_id = p_org_id)
    ) THEN
      RAISE EXCEPTION
        'reetiqueta bloqueada: o livro não tem venda de produtor "carteira"%. '
        'O backfill de Carteira (#1202) precisa rodar ANTES — senão 46 das 51 '
        'linhas, que são recompra legítima, seriam reescritas erradas. Ver a '
        'reprovação do Crivo (volta 1).',
        CASE WHEN p_org_id IS NULL THEN ' em nenhuma org' ELSE ' nesta org' END
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.sale_events se
      WHERE se.producer = 'carteira' AND se.event_type = 'sale'
        AND (p_org_id IS NULL OR se.organization_id = p_org_id)
    ) THEN
      RAISE NOTICE
        'ENSAIO contra livro possivelmente INCOMPLETO: sem venda de Carteira no '
        'livro, o número virá inflado (as recompras via Carteira ainda não estão '
        'presentes). Rode o #1202 antes da execução real.';
    END IF;
  END IF;

  -- Alvo: vendas VIVAS de funil cuja etiqueta atual diverge da canônica.
  -- "Viva" = 'sale' sem 'sale_reversed' apontando pra ela. "De funil" =
  -- producer = 'funnel' (as linhas históricas retroagiram a 'funnel' na #1199).
  FOR r IN
    SELECT se.*
    FROM public.sale_events se
    WHERE se.event_type = 'sale'
      AND se.producer = 'funnel'
      AND (p_org_id IS NULL OR se.organization_id = p_org_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_events x
        WHERE x.event_type = 'sale_reversed' AND x.reversed_event_id = se.id)
      AND se.revenue_stream <> public.metric_revenue_stream(
            se.organization_id, se.lead_id, se.sold_at, se.id)
    ORDER BY se.sold_at, se.id
  LOOP
    n_aval := n_aval + 1;

    -- Idempotência: se ESTA linha já foi reescrita numa corrida anterior, ela
    -- teria um estorno de origem = seu id. A chave da #1199 (producer,
    -- origin_record_id, event_type) barra o segundo estorno; aqui a gente
    -- detecta antes pra contar certo e não tentar de novo.
    IF EXISTS (
      SELECT 1 FROM public.sale_events x
      WHERE x.producer = 'funnel' AND x.origin_record_id = r.id
        AND x.event_type = 'sale_reversed'
    ) THEN
      n_ja := n_ja + 1;
      CONTINUE;
    END IF;

    -- A etiqueta correta, excluindo a própria linha do cálculo. O estorno já a
    -- anularia, mas excluir é explícito e à prova de reordenação.
    v_stream := public.metric_revenue_stream(
      r.organization_id, r.lead_id, r.sold_at, r.id);

    IF p_dry_run THEN
      n_reesc := n_reesc + 1;
      v_valor := v_valor + coalesce(r.sale_value, 0);
      IF v_stream = 'novo_negocio' THEN n_novo := n_novo + 1; ELSE n_cart := n_cart + 1; END IF;
      CONTINUE;
    END IF;

    -- 1) ESTORNO da linha errada. origin_record_id = id da própria linha, que é
    --    o que torna a operação idempotente e reversível por identidade.
    INSERT INTO public.sale_events (
      organization_id, lead_id, pipeline_id, stage_key, event_type,
      reversed_event_id, sold_at, sale_value, currency, revenue_stream,
      sale_responsible_id, pre_sale_responsible_id, actor, source,
      producer, origin_record_id
    ) VALUES (
      r.organization_id, r.lead_id, r.pipeline_id, r.stage_key, 'sale_reversed',
      r.id, r.sold_at, r.sale_value, r.currency, r.revenue_stream,
      r.sale_responsible_id, r.pre_sale_responsible_id, r.actor, 'backfill',
      'funnel', r.id
    )
    ON CONFLICT (producer, origin_record_id, event_type)
      WHERE origin_record_id IS NOT NULL
      DO NOTHING
    RETURNING id INTO v_rev_id;

    IF v_rev_id IS NULL THEN
      -- Corrida perdida com outra execução simultânea: já estornado. Conta como
      -- já-corrigida e não reemite (senão duplicaria a venda).
      n_ja := n_ja + 1;
      CONTINUE;
    END IF;

    -- 2) REEMISSÃO com a etiqueta certa. MESMO valor, MESMA atribuição, MESMA
    --    data. Só revenue_stream muda. origin_record_id = id da linha original,
    --    event_type='sale' → a chave da #1199 garante uma reemissão por linha.
    INSERT INTO public.sale_events (
      organization_id, lead_id, pipeline_id, stage_key, event_type,
      sold_at, sale_value, currency, revenue_stream,
      sale_responsible_id, pre_sale_responsible_id, actor, source,
      producer, origin_record_id
    ) VALUES (
      r.organization_id, r.lead_id, r.pipeline_id, r.stage_key, 'sale',
      r.sold_at, r.sale_value, r.currency, v_stream,
      r.sale_responsible_id, r.pre_sale_responsible_id, r.actor, 'backfill',
      'funnel', r.id
    )
    ON CONFLICT (producer, origin_record_id, event_type)
      WHERE origin_record_id IS NOT NULL
      DO NOTHING
    RETURNING id INTO v_new_id;

    n_reesc := n_reesc + 1;
    v_valor := v_valor + coalesce(r.sale_value, 0);
    IF v_stream = 'novo_negocio' THEN n_novo := n_novo + 1; ELSE n_cart := n_cart + 1; END IF;
  END LOOP;

  RETURN QUERY SELECT n_aval, n_reesc, n_ja, round(v_valor, 2), n_novo, n_cart;
END;
$function$;

COMMENT ON FUNCTION public.fn_reetiqueta_funnel_streams(uuid, boolean) IS
  'Reescreve (estorno + reemissão) as vendas VIVAS de funil cuja revenue_stream '
  'diverge de metric_revenue_stream (#1198). Opção B do CTO. Receita total '
  'inalterada — só a divisão Funil/Carteira muda. Idempotente pela chave da '
  '#1199. source=backfill (não projeta comissão). p_dry_run=true por padrão. '
  'NÃO é executada por migration.';

REVOKE EXECUTE ON FUNCTION public.fn_reetiqueta_funnel_streams(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_reetiqueta_funnel_streams(uuid, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- REVERSÃO — construída junto, testada como passo 1
-- ---------------------------------------------------------------------------
-- Remove SÓ as linhas que esta reescrita criou: producer='funnel',
-- source='backfill', origin_record_id apontando para uma linha de sale viva de
-- funil da mesma org. Ou seja, o par (estorno + reemissão) de cada correção.
--
-- Precisa desabilitar trg_sale_events_immutable na transação — mesma justificativa
-- do #1202: desfazer uma reescrita identificada por identidade é administração
-- deliberada, não edição casual. Só service_role.
CREATE OR REPLACE FUNCTION public.fn_rollback_reetiqueta_funnel(
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

  -- As linhas desta operação são as que têm source='backfill', producer='funnel'
  -- e origin_record_id = id de uma OUTRA sale_events (a linha original errada).
  -- Isso as distingue tanto do backfill de Carteira (#1202, origin = pedido)
  -- quanto das linhas originais (origin_record_id NULL nas de funil legado).
  DELETE FROM public.sale_events se
  WHERE se.producer = 'funnel'
    AND se.source   = 'backfill'
    AND se.origin_record_id IN (
      SELECT o.id FROM public.sale_events o
      WHERE o.event_type = 'sale' AND o.producer = 'funnel'
        AND o.origin_record_id IS NULL
    )
    AND (p_org_id IS NULL OR se.organization_id = p_org_id);
  GET DIAGNOSTICS n = ROW_COUNT;

  ALTER TABLE public.sale_events ENABLE TRIGGER trg_sale_events_immutable;
  RETURN n;
END;
$function$;

COMMENT ON FUNCTION public.fn_rollback_reetiqueta_funnel(uuid) IS
  'Desfaz a reescrita das 51 linhas. Remove só producer=funnel + source=backfill '
  'cujo origin_record_id aponta pra uma linha de funil ORIGINAL (origin nulo). '
  'Não toca backfill de Carteira nem linhas originais. Só service_role.';

REVOKE EXECUTE ON FUNCTION public.fn_rollback_reetiqueta_funnel(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_rollback_reetiqueta_funnel(uuid) TO service_role;
