-- 20260722240000_carteira_emits_sale_events.sql
--
-- ISSUE #1201 (PRD #1194 · #986) — Métricas Montáveis S7.
-- Pedido de Carteira aprovado passa a aparecer na receita da empresa.
--
-- A FLAG NASCE DESLIGADA EM TODAS AS ORGS. Com a flag off, o comportamento é
-- idêntico ao de hoje, byte a byte — provado por impressão digital md5 por
-- linha em scripts/reconcile-carteira-emission-1201.deltas.md.
--
-- GATILHO, NÃO JOB
-- ----------------
-- A aprovação já é um UPDATE único com guarda de estado, então o gatilho torna
-- a emissão ATÔMICA com a aprovação: não existe janela em que dinheiro está
-- aprovado e fora do livro. Um job introduziria um segundo modelo de
-- consistência para o mesmo caderno, precisaria de marca d'água, e ainda assim
-- precisaria do índice único da #1199 para não duplicar.
--
-- O QUE ESTA FATIA **NÃO** FAZ
-- ----------------------------
-- · Não faz backfill dos 273 pedidos existentes. Isto é RUNTIME. O vínculo
--   pedido↔proposta está morto desde a consolidação de pipelines (o DROP TABLE
--   CASCADE levou o gatilho junto), então os 40 pedidos com pipe_proposta_id
--   são histórico congelado — nenhum pedido novo nasce com vínculo. A regra
--   "pedido manda, etapa não emite" é regra de BACKFILL sobre conjunto fechado,
--   e o backfill é outra fatia.
-- · Não liga comissão. Ao contrário: BLOQUEIA, explicitamente (ver §4).
-- · Não reetiqueta nada. Isso é a #1203, que ativa junto com esta, por org.

-- ---------------------------------------------------------------------------
-- 1. A FLAG — por org, nascida desligada
-- ---------------------------------------------------------------------------
-- Coluna booleana dedicada em `organizations`, seguindo o precedente de
-- `send_governor_cold_gate_enabled`: é um portão de ROLLOUT de infraestrutura.
--
-- Deliberadamente NÃO usa `org_has_feature`/`feature_flags`: aquele mecanismo é
-- de PLANO de assinatura (`org_get_features_and_limits` resolve por plano), e
-- amarrar emissão de receita ao billing significaria que mudar o plano de uma
-- org ligaria ou desligaria dinheiro no livro-razão. Rollout e direito
-- comercial são eixos diferentes.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS carteira_emits_revenue_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.carteira_emits_revenue_enabled IS
  'Portão de rollout (#1201): quando true, pedido de Carteira aprovado emite '
  'venda no livro-razão e rejeição de pedido aprovado emite estorno. Nasce '
  'false em toda org. NÃO é feature de plano — é rollout de infraestrutura, no '
  'mesmo modelo de send_governor_cold_gate_enabled. Liga junto com a #1203 '
  '(reetiquetagem), por org.';

-- ---------------------------------------------------------------------------
-- 2. EMISSÃO — pedido aprovado vira venda
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_carteira_emit_sale_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_enabled  boolean;
  v_lead_id  uuid;
  v_stream   text;
BEGIN
  -- Portão de rollout. Com a flag desligada o gatilho não faz absolutamente
  -- nada — nem lê, nem escreve, nem levanta. É o que sustenta o critério
  -- "flag off = idêntico byte a byte".
  SELECT o.carteira_emits_revenue_enabled INTO v_enabled
  FROM public.organizations o
  WHERE o.id = NEW.organization_id;

  IF NOT coalesce(v_enabled, false) THEN
    RETURN NULL;  -- AFTER trigger: valor de retorno é ignorado
  END IF;

  -- O livro exige lead_id NOT NULL, e o pedido referencia o CLIENTE de
  -- Carteira, não o lead. A ponte é upsell_clients.lead_id. Se não houver lead
  -- resolvível, não emitimos — dinheiro sem lead é linha órfã, e o livro toda
  -- a leitura canônica indexa por lead. (Medido em prod: os 273 pedidos
  -- existentes resolvem lead, então isto é guarda, não caso comum.)
  SELECT c.lead_id INTO v_lead_id
  FROM public.upsell_clients c
  WHERE c.id = NEW.client_id
    AND c.organization_id = NEW.organization_id;   -- isolamento entre orgs

  IF v_lead_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Etiqueta pela fonte canônica (#1198): existe venda anterior não-estornada
  -- para este lead? A âncora é a data do PEDIDO, não a de agora — senão a
  -- classificação de uma recompra dependeria de quando o backfill rodou.
  v_stream := public.metric_revenue_stream(
    NEW.organization_id, v_lead_id, NEW.sold_at);

  INSERT INTO public.sale_events (
    organization_id, lead_id,
    pipeline_id, stage_key,          -- Carteira não tem funil nem etapa (#1199)
    event_type, sold_at, sale_value, currency, revenue_stream,
    sale_responsible_id,
    pre_sale_responsible_id,
    actor, source, producer, origin_record_id
  ) VALUES (
    NEW.organization_id, v_lead_id,
    NULL, NULL,
    'sale',
    NEW.sold_at,                     -- data do PEDIDO, não da aprovação.
                                     -- A isenção da #1199 preserva isto porque
                                     -- producer = 'carteira'.
    NEW.sale_value,
    'BRL',
    v_stream,
    NEW.sale_responsible_id,         -- SÓ a chave canônica. Nada de coalescer
                                     -- com closer_id/responsible_id: o lint de
                                     -- métrica proíbe, e coalescer foi
                                     -- exatamente o finding R5. Pedido sem
                                     -- responsável cai em não-atribuído, igual
                                     -- ao funil.
    NEW.pre_sale_responsible_id,
    NEW.approved_by,
    'trigger',                       -- fonte segue 'trigger' (#1199): fugir
                                     -- para 'backfill' desligaria a projeção
                                     -- de comissão por efeito colateral.
    'carteira',
    NEW.id                           -- registro de origem = o pedido
  )
  -- Aprovar duas vezes emite UMA vez. A chave de idempotência da #1199 é quem
  -- garante; o ON CONFLICT só evita que a segunda aprovação ABORTE o UPDATE do
  -- usuário. Sem ele o índice levantaria 23505 e a aprovação falharia — a
  -- proteção viraria um bug de UX.
  ON CONFLICT (producer, origin_record_id, event_type)
    WHERE origin_record_id IS NOT NULL   -- inferência tem que repetir o predicado
    DO NOTHING;                          -- do índice PARCIAL da #1199

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_carteira_emit_sale_event() IS
  'Emite venda no livro-razão quando um pedido de Carteira passa a aprovado '
  '(#1201). Atrás de organizations.carteira_emits_revenue_enabled, que nasce '
  'false. Data = a do pedido; etiqueta via metric_revenue_stream; atribuição só '
  'por sale_responsible_id; idempotente pela chave da #1199.';

-- DOIS gatilhos sobre a MESMA função, e não um só com `TG_OP` na cláusula WHEN:
-- `TG_OP` não é visível em WHEN (só dentro do corpo), e o INSERT não tem `OLD`
-- para comparar. Separar é a forma correta — e deixa a condição de cada caminho
-- legível no catálogo.
--
-- INSERT já-aprovado existe de verdade: pedido vindo de integração externa
-- (external_source) nasce aprovado, sem passar por 'pending'.
DROP TRIGGER IF EXISTS trg_carteira_emit_sale_event_ins ON public.upsell_orders;
CREATE TRIGGER trg_carteira_emit_sale_event_ins
  AFTER INSERT ON public.upsell_orders
  FOR EACH ROW
  WHEN (NEW.approval_status = 'approved')
  EXECUTE FUNCTION public.fn_carteira_emit_sale_event();

DROP TRIGGER IF EXISTS trg_carteira_emit_sale_event_upd ON public.upsell_orders;
CREATE TRIGGER trg_carteira_emit_sale_event_upd
  AFTER UPDATE OF approval_status ON public.upsell_orders
  FOR EACH ROW
  WHEN (NEW.approval_status = 'approved'
        AND OLD.approval_status IS DISTINCT FROM 'approved')
  EXECUTE FUNCTION public.fn_carteira_emit_sale_event();

-- ---------------------------------------------------------------------------
-- 3. ESTORNO — pedido aprovado que é rejeitado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_carteira_reverse_sale_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_enabled boolean;
  v_sale    public.sale_events%ROWTYPE;
BEGIN
  SELECT o.carteira_emits_revenue_enabled INTO v_enabled
  FROM public.organizations o
  WHERE o.id = NEW.organization_id;

  IF NOT coalesce(v_enabled, false) THEN
    RETURN NULL;
  END IF;

  -- A venda daquele pedido, encontrada pela identidade de produtor + origem.
  -- Se a flag foi ligada DEPOIS da aprovação, não existe venda para estornar —
  -- e aí não há o que fazer. Estornar sem venda criaria crédito do nada.
  SELECT * INTO v_sale
  FROM public.sale_events se
  WHERE se.producer         = 'carteira'
    AND se.origin_record_id = NEW.id
    AND se.event_type       = 'sale'
    AND se.organization_id  = NEW.organization_id;

  IF v_sale.id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.sale_events (
    organization_id, lead_id, pipeline_id, stage_key,
    event_type, reversed_event_id, sold_at, sale_value, currency,
    revenue_stream, sale_responsible_id, pre_sale_responsible_id,
    actor, source, producer, origin_record_id
  ) VALUES (
    v_sale.organization_id, v_sale.lead_id, NULL, NULL,
    'sale_reversed',                 -- o valor QUE JÁ EXISTE no enum. O brief
                                     -- do PRD o chamava de 'sale_reversal';
                                     -- reconciliação de nome, não decisão nova.
    v_sale.id,
    NEW.sold_at,                     -- ancorado no pedido, coerente com a venda
    v_sale.sale_value,
    v_sale.currency,
    v_sale.revenue_stream,           -- espelha a venda estornada
    v_sale.sale_responsible_id,
    v_sale.pre_sale_responsible_id,
    NEW.approved_by,
    'trigger', 'carteira', NEW.id
  )
  -- Rejeitar duas vezes estorna UMA vez.
  ON CONFLICT (producer, origin_record_id, event_type)
    WHERE origin_record_id IS NOT NULL   -- inferência tem que repetir o predicado
    DO NOTHING;                          -- do índice PARCIAL da #1199

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_carteira_reverse_sale_event() IS
  'Emite estorno (sale_reversed) quando um pedido de Carteira APROVADO passa a '
  'rejeitado (#1201). Atrás da mesma flag. Idempotente pela chave da #1199. '
  'Não estorna se não houver venda daquele pedido — crédito do nada.';

DROP TRIGGER IF EXISTS trg_carteira_reverse_sale_event ON public.upsell_orders;
CREATE TRIGGER trg_carteira_reverse_sale_event
  AFTER UPDATE OF approval_status ON public.upsell_orders
  FOR EACH ROW
  WHEN (OLD.approval_status = 'approved' AND NEW.approval_status = 'rejected')
  EXECUTE FUNCTION public.fn_carteira_reverse_sale_event();

-- ---------------------------------------------------------------------------
-- 4. BLOQUEIO DE COMISSÃO PARA CARTEIRA — declarado, não presumido
-- ---------------------------------------------------------------------------
-- Decisão de contrato: Carteira NÃO projeta comissão até o CTO decidir desde
-- quando e para quem, em fatia própria. Emitir com source='trigger' faria a
-- projeção rodar sobre pedidos que nunca geraram comissão — isso é criar
-- passivo financeiro sem decisão.
--
-- ESTADO MEDIDO EM PRODUÇÃO: o gatilho de projeção
-- (`trg_sale_events_project_commission`) e a função de projeção NÃO EXISTEM em
-- prod; só a coluna `commissions.source` chegou lá, e `commissions` tem 0
-- linhas. Ou seja, hoje não há projeção viva para bloquear.
--
-- O bloqueio é feito MESMO ASSIM, e por isso: quando a projeção for religada,
-- ela tem que cair do lado certo SEM que ninguém precise lembrar desta
-- conversa. Um guard declarado sobrevive à memória de quem o escreveu.
CREATE OR REPLACE FUNCTION public.fn_block_commission_for_carteira()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE v_producer text;
BEGIN
  IF NEW.sale_event_id IS NULL THEN
    RETURN NEW;   -- comissão manual, fora do escopo deste guard
  END IF;

  SELECT se.producer INTO v_producer
  FROM public.sale_events se WHERE se.id = NEW.sale_event_id;

  IF v_producer = 'carteira' THEN
    RAISE EXCEPTION
      'comissão bloqueada para produtor "carteira" (#1201): a decisão de desde '
      'quando e para quem Carteira gera comissão é do CTO, em fatia própria'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_block_commission_for_carteira() IS
  'Guard declarado (#1201): impede projeção de comissão sobre linha de '
  'sale_events com producer = "carteira". Existe para que, quando a projeção '
  'for religada, Carteira caia do lado certo sem depender de memória.';

DROP TRIGGER IF EXISTS trg_block_commission_for_carteira ON public.commissions;
CREATE TRIGGER trg_block_commission_for_carteira
  BEFORE INSERT ON public.commissions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_commission_for_carteira();
