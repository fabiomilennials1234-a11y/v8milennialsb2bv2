-- C1a — o caderno de vendas passa a aceitar quem realmente decidiu.
--
-- Decisão do CTO: o desfecho do negócio (botão / automação / arrastar) vira a
-- fonte, e o funil deixa de ser o dono da métrica. Esta fatia destrava o
-- caminho — hoje ele ESTOURA.
--
-- ── O defeito, reproduzido em prod (transação revertida) ─────────────────
-- Mover um card QUE TEM NEGÓCIO para uma etapa de ganho/perda levanta:
--
--   ERROR 23514: new row for relation "sale_events"
--   violates check constraint "sale_events_source_check"
--
-- A cadeia inteira, e onde ela parte:
--
--   card → pipeline_stage_events → fn_capture_sale_event
--        → UPDATE deals SET outcome_source = 'stage'
--        → fn_deal_outcome_para_caderno passa esse 'stage' adiante
--        → INSERT em sale_events ✗
--
-- Duas tabelas com vocabulários que ninguém casou:
--
--   deals.outcome_source  aceita  stage · workflow · ui · backfill · api
--   sale_events.source    aceita  trigger · backfill
--
-- `fn_deal_outcome_para_caderno` lê de uma e escreve na outra. Qualquer valor
-- que não seja `backfill` estoura.
--
-- ── O alcance, medido ────────────────────────────────────────────────────
-- 34.816 negócios têm entrada em funil. Para TODOS eles, marcar ganho ou perda
-- pela etapa falha. O botão da UI (`ui`) e o nó de automação (`workflow`)
-- percorrem o mesmo trecho e falham igual.
--
-- É o que explica os zeros que a investigação vinha encontrando sem entender:
--
--   deals com outcome_source em (stage, ui, workflow) ....... 0
--   sale_events com source em (stage, ui, workflow) ......... 0
--   workflows usando win_deal / lose_deal ................... 0
--
-- Não é "construído e nunca ligado". É construído e quebrado no último
-- centímetro. As vendas que ENTRAM no caderno hoje (1.876) vêm todas de cards
-- SEM negócio, que caem no ramo de fallback e gravam `'trigger'` — um dos dois
-- valores que o CHECK admite.
--
-- ⚠️ `runtime_logs` não tem UMA ocorrência disso. O erro sobe como falha da
-- operação de arrastar e morre no cliente. Não é possível provar quantos
-- usuários bateram nele — só que o caminho está fechado.
--
-- ── SEGUNDO bloqueio, no mesmo caminho ───────────────────────────────────
-- Ampliar o CHECK de `source` sozinho destravaria 34.816 negócios e deixaria
-- 453 quebrados por outro motivo. `sale_events.producer` tem DEFAULT 'funnel',
-- e `sale_events_producer_funnel_coherence` exige `pipeline_id` e `stage_key`
-- não-nulos quando o produtor é funil. Apertar o botão num negócio que não
-- está em funil nenhum (453 em prod) resolve os dois como NULL e viola a
-- coerência.
--
-- Entra o produtor `deal`: o evento veio do NEGÓCIO, não do funil, e dizer
-- 'funnel' ali seria mentira gravada no caderno. A coerência continua valendo
-- para os dois produtores antigos e ganha a regra do novo.
--
-- ── Por que AMPLIAR o vocabulário em vez de achatar para 'trigger' ───────
-- Traduzir tudo para `'trigger'` na fronteira faria o INSERT passar hoje e
-- apagaria PARA SEMPRE a distinção entre "o vendedor arrastou o card", "o
-- vendedor clicou no botão" e "uma automação decidiu". Essa é exatamente a
-- pergunta que a próxima fatia precisa responder para aposentar as etapas com
-- segurança. Procedência achatada não se recupera depois.

-- ── 1. O caderno aceita as origens vivas ─────────────────────────────────
ALTER TABLE public.sale_events DROP CONSTRAINT IF EXISTS sale_events_source_check;
ALTER TABLE public.sale_events
  ADD CONSTRAINT sale_events_source_check
  CHECK (source = ANY (ARRAY['trigger'::text, 'backfill'::text,
                             'stage'::text, 'ui'::text, 'workflow'::text, 'api'::text]));

COMMENT ON COLUMN public.sale_events.source IS
  'Quem decidiu o desfecho: stage (arrastou o card) | ui (botão no negócio) | workflow (automação) | api | trigger (caminho legado, card sem negócio) | backfill. Espelha deals.outcome_source.';

-- ── 2. Produtor `deal`, para o negócio fora de funil ─────────────────────
-- 🚨 São TRÊS restrições, não uma. Descobri as duas últimas uma a uma, com o
-- ensaio estourando em cada — porque li a lista de constraints truncada na
-- primeira vez. `sale_events` tem NOVE CHECKs; três tocam este caminho.
ALTER TABLE public.sale_events DROP CONSTRAINT IF EXISTS sale_events_producer_check;
ALTER TABLE public.sale_events
  ADD CONSTRAINT sale_events_producer_check
  CHECK (producer = ANY (ARRAY['funnel'::text, 'carteira'::text, 'deal'::text]));

-- `origin_record_id` é metade da chave de idempotência de `carteira`
-- (`uq_sale_events_producer_origin_event`, único em produtor+origem+tipo) e
-- aponta `upsell_orders.id`.
--
-- O produtor `deal` NÃO usa esse mecanismo, e não é omissão: usar o id do
-- negócio como origem QUEBRARIA o ciclo legítimo ganhar → reabrir → ganhar de
-- novo, que colidiria na segunda venda com a mesma tripla. A idempotência do
-- negócio vem de outro lugar e já existe: `fn_deal_outcome_para_caderno` só
-- dispara quando `outcome` MUDA, e `_registrar_desfecho_no_caderno` retorna
-- cedo quando o de e o para são iguais. Desfecho repetido não escreve nada.
ALTER TABLE public.sale_events DROP CONSTRAINT IF EXISTS sale_events_origin_required_off_funnel;
ALTER TABLE public.sale_events
  ADD CONSTRAINT sale_events_origin_required_off_funnel
  CHECK (producer IN ('funnel', 'deal') OR origin_record_id IS NOT NULL);

ALTER TABLE public.sale_events DROP CONSTRAINT IF EXISTS sale_events_producer_funnel_coherence;
ALTER TABLE public.sale_events
  ADD CONSTRAINT sale_events_producer_funnel_coherence
  CHECK (
    CASE producer
      WHEN 'funnel'   THEN pipeline_id IS NOT NULL AND stage_key IS NOT NULL
      WHEN 'carteira' THEN true
      -- Evento nascido do NEGÓCIO. Não tem funil por definição; o que ele
      -- precisa ter é o negócio, senão não dá para dizer de quem é a venda.
      WHEN 'deal'     THEN deal_id IS NOT NULL
      ELSE false
    END
  );

-- ── 3. O escritor declara o produtor em vez de herdar o DEFAULT ──────────
-- Corpo vigente de `_registrar_desfecho_no_caderno` com UMA coluna a mais nos
-- dois INSERT (venda e estorno) — extraído de `pg_get_functiondef`, não
-- redigitado.
CREATE OR REPLACE FUNCTION public._registrar_desfecho_no_caderno(p_org uuid, p_lead uuid, p_pipeline uuid, p_stage_key text, p_stage_event_id uuid, p_deal_id uuid, p_de text, p_para text, p_actor uuid, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meta jsonb; v_sale_value numeric; v_currency text;
  v_sale_resp uuid; v_pre_resp uuid; v_stream text;
  v_original public.sale_events%ROWTYPE; v_enabled boolean;
BEGIN
  IF p_de IS NOT DISTINCT FROM p_para THEN
    RETURN;
  END IF;

  -- ── Estorno: saiu de ganho ────────────────────────────────────────────────
  IF p_de = 'won' THEN
    SELECT s.* INTO v_original FROM public.sale_events s
     WHERE s.lead_id = p_lead
       AND s.pipeline_id IS NOT DISTINCT FROM p_pipeline
       AND s.event_type = 'sale'
       AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                        WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = s.id)
     ORDER BY s.sold_at DESC, s.created_at DESC
     LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.sale_events
        (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type,
         reversed_event_id, sold_at, sale_value, currency, revenue_stream,
         sale_responsible_id, pre_sale_responsible_id, actor, source, deal_id, producer)
      VALUES
        (p_org, p_lead, p_pipeline, p_stage_key, p_stage_event_id, 'sale_reversed',
         v_original.id, now(), v_original.sale_value, v_original.currency, v_original.revenue_stream,
         v_original.sale_responsible_id, v_original.pre_sale_responsible_id, p_actor, p_source, p_deal_id,
         CASE WHEN p_pipeline IS NULL THEN 'deal' ELSE 'funnel' END);
    END IF;
  END IF;

  IF p_para NOT IN ('won', 'lost') THEN
    RETURN;
  END IF;

  -- ── Valor: coluna tipada primeiro, metadata como queda ────────────────────
  SELECT pe.metadata INTO v_meta
    FROM public.pipeline_entries pe
   WHERE (p_deal_id IS NOT NULL AND pe.deal_id = p_deal_id)
      OR (p_deal_id IS NULL AND pe.lead_id = p_lead AND pe.pipeline_id IS NOT DISTINCT FROM p_pipeline)
   ORDER BY pe.closed_at NULLS FIRST, pe.entered_at DESC
   LIMIT 1;

  BEGIN
    v_sale_value := NULLIF(v_meta->>'sale_value', '')::numeric;
  EXCEPTION WHEN OTHERS THEN v_sale_value := NULL;
  END;

  IF p_deal_id IS NOT NULL THEN
    SELECT COALESCE(d.value, v_sale_value) INTO v_sale_value
      FROM public.deals d WHERE d.id = p_deal_id;
  END IF;

  v_currency := COALESCE(NULLIF(upper(v_meta->>'currency'), ''), 'BRL');
  IF v_currency !~ '^[A-Z]{3}$' THEN v_currency := 'BRL'; END IF;

  -- Cadeia PRESERVADA do corpo vigente de fn_capture_sale_event, não introduzida
  -- aqui. O lint tem razão no geral — cadeia de atribuição faz SUM(membro) ≠
  -- total —, mas trocar a chave nesta migration reescreveria a atribuição de
  -- 1.869 eventos já gravados. A dívida é do modelo, não deste arquivo.
  SELECT COALESCE(l.sale_responsible_id, l.closer_id), l.pre_sale_responsible_id -- metric-lint-allow: cópia literal do comportamento vigente (ADR-0017); trocar a chave aqui reescreveria a atribuição histórica
    INTO v_sale_resp, v_pre_resp
    FROM public.leads l WHERE l.id = p_lead AND l.organization_id = p_org;

  SELECT o.carteira_emits_revenue_enabled INTO v_enabled
    FROM public.organizations o WHERE o.id = p_org;

  IF COALESCE(v_enabled, false) THEN
    v_stream := public.metric_revenue_stream(p_org, p_lead, now());
  ELSE
    v_stream := CASE WHEN EXISTS (
        SELECT 1 FROM public.upsell_clients uc
         WHERE uc.organization_id = p_org AND uc.lead_id = p_lead AND uc.is_active
      ) THEN 'carteira' ELSE 'novo_negocio' END;
  END IF;

  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type,
     reversed_event_id, sold_at, sale_value, currency, revenue_stream,
     sale_responsible_id, pre_sale_responsible_id, actor, source, deal_id, producer)
  VALUES
    (p_org, p_lead, p_pipeline, p_stage_key, p_stage_event_id,
     CASE WHEN p_para = 'won' THEN 'sale' ELSE 'sale_lost' END,
     NULL, now(), v_sale_value, v_currency, v_stream,
     v_sale_resp, v_pre_resp, p_actor, p_source, p_deal_id,
     CASE WHEN p_pipeline IS NULL THEN 'deal' ELSE 'funnel' END);
END;
$function$
;

-- ── 4. O carimbo de data cobre as origens novas ──────────────────────────
-- `fn_sale_events_force_sold_at` carimbava `sold_at := now()` só quando
-- `source = 'trigger'`. A intenção é "evento AO VIVO usa agora; carga
-- histórica preserva a data" — e com o vocabulário ampliado, `stage`, `ui`,
-- `workflow` e `api` são todos ao vivo e ficariam de fora do carimbo.
-- O predicado passa a dizer a intenção: tudo que não é `backfill`.
CREATE OR REPLACE FUNCTION public.fn_sale_events_force_sold_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.source <> 'backfill' AND NEW.producer <> 'carteira' THEN
    NEW.sold_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Guarda ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src boolean; v_prod boolean;
BEGIN
  SELECT pg_get_constraintdef(oid) LIKE '%workflow%' INTO v_src
    FROM pg_constraint WHERE conname = 'sale_events_source_check';
  IF NOT COALESCE(v_src, false) THEN
    RAISE EXCEPTION 'sale_events_source_check nao aceita as origens novas';
  END IF;

  -- As TRÊS restrições do produtor, conferidas uma a uma: a que lista os
  -- valores, a que exige coerência com o funil, e a que exige origem fora dele.
  SELECT bool_and(pg_get_constraintdef(oid) LIKE '%deal%') INTO v_prod
    FROM pg_constraint
   WHERE conname IN ('sale_events_producer_check',
                     'sale_events_producer_funnel_coherence',
                     'sale_events_origin_required_off_funnel');
  IF NOT COALESCE(v_prod, false) THEN
    RAISE EXCEPTION 'alguma restricao de producer ainda nao conhece o produtor deal';
  END IF;
END $$;
