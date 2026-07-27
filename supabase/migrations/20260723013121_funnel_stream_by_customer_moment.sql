-- 20260722260000_funnel_stream_by_customer_moment.sql
--
-- ISSUE #1203 (PRD #1194 · #986) — Métricas Montáveis S9.
-- O produtor de FUNIL passa a etiquetar revenue_stream pelo momento do cliente.
--
-- ESTA É A ÚNICA FATIA QUE MUDA ETIQUETA DE RECEITA VIVA.
-- Tratada com o cuidado de dinheiro: atrás de flag, byte-a-byte com a flag off,
-- reconciliação por impressão digital md5 por linha.
--
-- O DEFEITO
-- ---------
-- O gatilho vivo de funil (fn_capture_sale_event) decide revenue_stream por:
--
--   CASE WHEN EXISTS (SELECT 1 FROM upsell_clients uc
--                     WHERE ... AND uc.is_active) THEN 'carteira' ELSE 'novo_negocio' END
--
-- Isso responde "este lead É CLIENTE DE CARTEIRA?", não "esta venda É
-- RECOMPRA?". Contra a decisão 6 do CTO. Medido em prod (#1198): 51 de 205
-- vendas vivas (R$ 198.684,96) etiquetadas errado, TODAS no sentido
-- carteira → deveria-ser-novo_negocio.
--
-- A CORREÇÃO — uma regra, dois produtores
-- ----------------------------------------
-- O funil passa a usar a MESMA metric_revenue_stream(#1198) que o produtor de
-- Carteira (#1201). A âncora é now() — o sold_at que o funil grava (o gatilho
-- de normalização força now() para source='trigger', producer='funnel'). A
-- venda que está prestes a ser inserida ainda não existe no livro, então não se
-- vê no espelho: metric_revenue_stream usa `<` estrito.
--
-- FLAG — a MESMA da #1201, de propósito
-- --------------------------------------
-- Reusa organizations.carteira_emits_revenue_enabled. O Crivo travou que #1201
-- e #1203 LIGAM JUNTAS, por org. "Uma regra, dois produtores" vale também para
-- o interruptor: duas flags que têm que ligar juntas são convite para alguém
-- ligar só uma e deixar o livro meio-certo. Uma flag, uma decisão operacional.
--
-- Com a flag DESLIGADA, o funil mantém EXATAMENTE a expressão antiga — nem a
-- ordem de avaliação muda. É o que sustenta "flag off = idêntico byte-a-byte".
--
-- O QUE ESTA FATIA NÃO FAZ
-- ------------------------
-- · Não reetiqueta as 51 linhas já gravadas. Elas são histórico no livro
--   imutável (trg_sale_events_immutable bloqueia UPDATE). Corrigi-las é
--   operação à parte (reescreve-via-produtor, como o #1202) — medida no
--   relatório, decisão do CTO. Este gatilho conserta o FLUXO, daqui pra frente.
-- · Não toca fn_backfill_state_sales. Ele tem a mesma expressão antiga, mas é
--   set-based (INSERT...SELECT) e histórico: alinhá-lo com metric_revenue_stream
--   reintroduziria o problema 1-vs-N (cascata não acontece dentro de um único
--   INSERT — provado na #1202). Ele não roda em runtime. Alinhamento é fatia
--   de limpeza própria; apontado no relatório.
-- · Não muda atribuição. O funil segue com COALESCE(sale_responsible_id,
--   closer_id) que já tinha — mexer nisso é outro escopo (e outro finding).

CREATE OR REPLACE FUNCTION public.fn_capture_sale_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from_role public.stage_role; v_to_role public.stage_role;
  v_meta jsonb; v_sale_value numeric; v_currency text;
  v_sale_resp uuid; v_pre_resp uuid; v_stream text; v_original public.sale_events%ROWTYPE;
  v_enabled boolean;                                   -- #1203
BEGIN
  v_from_role := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.from_stage_key);
  v_to_role := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.to_stage_key);
  IF v_from_role IS DISTINCT FROM 'won' AND v_to_role IS DISTINCT FROM 'won' AND v_to_role IS DISTINCT FROM 'lost' THEN
    RETURN NEW;
  END IF;
  IF v_from_role = 'won' AND v_to_role IS DISTINCT FROM 'won' THEN
    SELECT s.* INTO v_original FROM public.sale_events s
    WHERE s.lead_id = NEW.lead_id AND s.pipeline_id = NEW.pipeline_id AND s.event_type = 'sale'
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = s.id)
    ORDER BY s.sold_at DESC, s.created_at DESC LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.sale_events
        (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type, reversed_event_id, sold_at, sale_value, currency, revenue_stream, sale_responsible_id, pre_sale_responsible_id, actor, source)
      VALUES
        (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.to_stage_key, NEW.id, 'sale_reversed', v_original.id, now(),
         v_original.sale_value, v_original.currency, v_original.revenue_stream, v_original.sale_responsible_id, v_original.pre_sale_responsible_id, NEW.actor, 'trigger');
    END IF;
  END IF;
  IF (v_to_role = 'won' AND v_from_role IS DISTINCT FROM 'won') OR (v_to_role = 'lost' AND v_from_role IS DISTINCT FROM 'lost') THEN
    SELECT pe.metadata INTO v_meta FROM public.pipeline_entries pe WHERE pe.id = NEW.entry_id;
    BEGIN
      v_sale_value := NULLIF(v_meta->>'sale_value', '')::numeric;
    EXCEPTION WHEN OTHERS THEN v_sale_value := NULL;
    END;
    v_currency := COALESCE(NULLIF(upper(v_meta->>'currency'), ''), 'BRL');
    IF v_currency !~ '^[A-Z]{3}$' THEN v_currency := 'BRL'; END IF;
    SELECT COALESCE(l.sale_responsible_id, l.closer_id), l.pre_sale_responsible_id -- metric-lint-allow: expressão herdada, preservada byte-a-byte pelo #1203 (que só troca o etiquetamento de revenue_stream). Trocar pela chave canônica muda atribuição de venda em prod e é dívida própria — ver #1285.
      INTO v_sale_resp, v_pre_resp
    FROM public.leads l WHERE l.id = NEW.lead_id AND l.organization_id = NEW.organization_id;

    -- #1203 — a única mudança. Com a flag ligada, etiqueta pelo MOMENTO DO
    -- CLIENTE (metric_revenue_stream, #1198). Com a flag desligada, mantém a
    -- expressão antiga LITERALMENTE — garante byte-a-byte.
    SELECT o.carteira_emits_revenue_enabled INTO v_enabled
    FROM public.organizations o WHERE o.id = NEW.organization_id;

    IF coalesce(v_enabled, false) THEN
      -- Âncora = now(): é o sold_at que esta venda vai gravar. A própria venda
      -- ainda não está no livro, e metric_revenue_stream usa `<` estrito, então
      -- ela não se conta como anterior de si mesma.
      v_stream := public.metric_revenue_stream(NEW.organization_id, NEW.lead_id, now());
    ELSE
      v_stream := CASE WHEN EXISTS (
          SELECT 1 FROM public.upsell_clients uc WHERE uc.organization_id = NEW.organization_id AND uc.lead_id = NEW.lead_id AND uc.is_active
        ) THEN 'carteira' ELSE 'novo_negocio' END;
    END IF;

    INSERT INTO public.sale_events
      (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type, reversed_event_id, sold_at, sale_value, currency, revenue_stream, sale_responsible_id, pre_sale_responsible_id, actor, source)
    VALUES
      (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.to_stage_key, NEW.id,
       CASE WHEN v_to_role = 'won' THEN 'sale' ELSE 'sale_lost' END,
       NULL, now(), v_sale_value, v_currency, v_stream, v_sale_resp, v_pre_resp, NEW.actor, 'trigger');
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_capture_sale_event() IS
  'Gatilho vivo de captura de venda de funil. Desde #1203, quando '
  'organizations.carteira_emits_revenue_enabled está ligada, etiqueta '
  'revenue_stream pelo MOMENTO DO CLIENTE (metric_revenue_stream, #1198) — a '
  'mesma regra do produtor de Carteira. Flag desligada: mantém a expressão '
  'antiga (é cliente de Carteira ativo) byte-a-byte.';
