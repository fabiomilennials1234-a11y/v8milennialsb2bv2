-- ============================================================================
-- Ganhar um Negócio passa a admitir o Lead na Carteira.
--
-- ── POR QUE ISTO É FEATURE NOVA, NÃO CONSERTO ─────────────────────────────
-- ADR-0005 dizia que `handle_proposta_vendida` era "a única entrada que
-- funciona" na Carteira. ADR-0023 corrigiu o registro: essa função existe com
-- **zero triggers anexados e zero chamadores** — as 739 linhas de Carteira em
-- prod vieram todas de sync do ERP. Ela era trigger da TABELA `pipe_propostas`,
-- que virou VIEW (triggers INSTEAD OF); a trigger não sobreviveu à conversão e
-- ninguém percebeu. Medido de novo em 2026-08-06: Chique Distribuidora tem 7
-- vendas ganhas e 0 clientes na Carteira.
--
-- ── ONDE A TRIGGER ENGATA, E POR QUÊ ──────────────────────────────────────
-- Em `sale_events`, não em `pipeline_entries` nem na view. `sale_events` é o
-- caderno canônico (ADR-0017): já é alimentado por `fn_capture_sale_event` a
-- partir de QUALQUER funil cujo `stage_role = 'won'` — sistema e custom — e já
-- registra o estorno (`sale_reversed`). Engatar aqui dá um choke único em vez
-- de repetir a regra de "o que conta como ganho" numa segunda superfície.
--
-- ── DUPLA CONTAGEM DE RECEITA: A GUARDA ───────────────────────────────────
-- `upsell_orders` aprovado dispara `fn_carteira_emit_sale_event`, que grava
-- OUTRO `sale_events` (producer='carteira') quando a org tem
-- `carteira_emits_revenue_enabled`. Se esta trigger criasse pedido nessas orgs,
-- a mesma venda apareceria duas vezes no caderno — e um pedido criado por ela
-- reentraria aqui. Por isso:
--   • a trigger só reage a `producer = 'funnel'` (nunca ao que a Carteira emite);
--   • pedido só é criado quando a org NÃO emite receita pela Carteira.
-- Nas orgs que emitem (hoje só Milennials), o cliente entra na Carteira e a
-- receita continua vindo de um único lugar: o funil.
--
-- ── O QUE ESTA MIGRATION NÃO FAZ ──────────────────────────────────────────
-- Não escreve dado de cliente (guarda F4 — migration é só schema). O backfill
-- das vendas já ganhas é DML e vive em `scripts/backfill-carteira-vendas.sql`.
-- Reverter é `DROP TRIGGER trg_carteira_admite_venda ON public.sale_events`;
-- nada aqui apaga dado.
--
-- ── APLICADO EM PROD 2026-08-06 ───────────────────────────────────────────
-- Ledger gravou a versão `20260806141759` (`carteira_admite_venda_ganha`), que
-- não bate com o prefixo `2027…` deste arquivo — os prefixos do repo são
-- fictícios e ordenam ACIMA da versão real. É drift esperado: NÃO reaplicar.
-- O revoke de anon/authenticated entrou logo depois como
-- `20260806142137_carteira_admite_venda_revoke_anon`.
--
-- A atribuição foi corrigida DEPOIS do primeiro apply: a versão aplicada às
-- 14:17 encadeava o responsável do evento com o do lead como fallback, que
-- `scripts/check-metric-antipatterns.sh` reprova (R5, ADR-0017). Este
-- arquivo já traz a versão sem fallback, reaplicada em prod como
-- `20260806…_carteira_atribuicao_so_do_evento`. Nenhum dado ficou errado: os 7
-- pedidos do backfill da Chique têm responsável NULL nas duas versões (os leads
-- não têm responsável atribuído).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_carteira_admite_venda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead           record;
  v_client_id      uuid;
  v_estava_inativo boolean := false;
  v_emite_receita  boolean;
  v_vendas_vivas   int;
BEGIN
  -- ── Venda ───────────────────────────────────────────────────────────────
  IF NEW.event_type = 'sale' THEN
    -- Lead na lixeira não vira cliente. `purge_lead` já limpa a Carteira.
    SELECT l.* INTO v_lead
      FROM public.leads l
     WHERE l.id = NEW.lead_id
       AND l.organization_id = NEW.organization_id
       AND l.deleted_at IS NULL;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    SELECT coalesce(o.carteira_emits_revenue_enabled, false)
      INTO v_emite_receita
      FROM public.organizations o
     WHERE o.id = NEW.organization_id;

    SELECT uc.id, NOT uc.is_active
      INTO v_client_id, v_estava_inativo
      FROM public.upsell_clients uc
     WHERE uc.organization_id = NEW.organization_id
       AND uc.lead_id = NEW.lead_id;

    IF v_client_id IS NULL THEN
      INSERT INTO public.upsell_clients (
        organization_id, lead_id, name, company, email, phone,
        first_sale_at, closer_id, responsible_id,
        sale_responsible_id, pre_sale_responsible_id,
        segment, gestao_stage
      ) VALUES (
        NEW.organization_id, NEW.lead_id, v_lead.name, v_lead.company, v_lead.email, v_lead.phone,
        NEW.sold_at, v_lead.closer_id, v_lead.responsible_id,
        -- Atribuição vem do evento e SÓ do evento (ADR-0017 R5). Cair no lead
        -- como fallback faria a venda mudar de dono quando o lead for
        -- reatribuído meses depois — o caderno existe para impedir isso.
        NEW.sale_responsible_id,
        NEW.pre_sale_responsible_id,
        'novo', 'primeira_compra'
      )
      -- Corrida entre duas vendas do mesmo lead na mesma transação.
      ON CONFLICT (organization_id, lead_id) DO UPDATE
        SET updated_at = now()
      RETURNING id INTO v_client_id;
    ELSE
      -- Cliente que voltou a comprar: reativa, mas não reescreve a 1ª venda
      -- para frente (evento antigo chegando depois não pode envelhecer o dado).
      UPDATE public.upsell_clients
         SET is_active      = true,
             churned_at     = NULL,
             reactivated_at = CASE WHEN v_estava_inativo THEN now() ELSE reactivated_at END,
             first_sale_at  = LEAST(first_sale_at, NEW.sold_at),
             updated_at     = now()
       WHERE id = v_client_id;
    END IF;

    IF NOT v_emite_receita AND coalesce(NEW.sale_value, 0) > 0 THEN
      INSERT INTO public.upsell_orders (
        organization_id, client_id, closer_id,
        product_name, product_type, sale_value,
        origin, source, sold_at,
        approval_status, approved_at,
        responsible_id, pre_sale_responsible_id, sale_responsible_id,
        external_source, external_id
      ) VALUES (
        NEW.organization_id, v_client_id, v_lead.closer_id,
        'Venda do funil', 'projeto', NEW.sale_value,
        'new_business', 'pipe', NEW.sold_at,
        'approved', now(),
        v_lead.responsible_id,
        NEW.pre_sale_responsible_id,
        NEW.sale_responsible_id,
        'funnel_sale_event', NEW.id::text
      )
      ON CONFLICT (organization_id, external_source, external_id)
        WHERE external_source IS NOT NULL AND external_id IS NOT NULL
        DO NOTHING;
    END IF;

    PERFORM public.recalc_upsell_client_metrics(v_client_id);
    RETURN NULL;
  END IF;

  -- ── Estorno ─────────────────────────────────────────────────────────────
  -- Desfaz o que ESTA trigger criou. Nunca apaga o cliente: ele pode ter
  -- pedido do ERP, outra venda viva, ou histórico que a operação usa.
  IF NEW.event_type = 'sale_reversed' THEN
    SELECT uc.id INTO v_client_id
      FROM public.upsell_clients uc
     WHERE uc.organization_id = NEW.organization_id
       AND uc.lead_id = NEW.lead_id;
    IF v_client_id IS NULL THEN
      RETURN NULL;
    END IF;

    DELETE FROM public.upsell_orders
     WHERE organization_id = NEW.organization_id
       AND external_source = 'funnel_sale_event'
       AND external_id = NEW.reversed_event_id::text;

    PERFORM public.recalc_upsell_client_metrics(v_client_id);

    SELECT count(*) INTO v_vendas_vivas
      FROM public.sale_events s
     WHERE s.organization_id = NEW.organization_id
       AND s.lead_id = NEW.lead_id
       AND s.event_type = 'sale'
       AND NOT EXISTS (
             SELECT 1 FROM public.sale_events r
              WHERE r.event_type = 'sale_reversed'
                AND r.reversed_event_id = s.id
           );

    IF v_vendas_vivas = 0
       AND NOT EXISTS (SELECT 1 FROM public.upsell_orders uo WHERE uo.client_id = v_client_id)
       AND NOT EXISTS (
             SELECT 1 FROM public.upsell_clients uc
              WHERE uc.id = v_client_id
                AND (uc.tiny_contact_id IS NOT NULL OR uc.external_id IS NOT NULL)
           )
    THEN
      UPDATE public.upsell_clients
         SET is_active  = false,
             churned_at = now(),
             updated_at = now()
       WHERE id = v_client_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_carteira_admite_venda() IS
  'Venda ganha no funil admite o Lead na Carteira (ADR-0023 §7/§8). Reage só a sale_events com producer=funnel; cria pedido apenas em org que não emite receita pela Carteira, para não contar a mesma venda duas vezes.';

-- `FROM PUBLIC` é no-op aqui: em prod o EXECUTE de anon/authenticated vem de um
-- GRANT explícito criado por `ALTER DEFAULT PRIVILEGES`, não do grant a PUBLIC.
-- Medido em 2026-08-06, depois do apply: com só o REVOKE FROM PUBLIC,
-- `has_function_privilege('anon', ...)` continuava `true`.
REVOKE ALL ON FUNCTION public.fn_carteira_admite_venda() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_carteira_admite_venda() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_carteira_admite_venda ON public.sale_events;
CREATE TRIGGER trg_carteira_admite_venda
  AFTER INSERT ON public.sale_events
  FOR EACH ROW
  WHEN (new.producer = 'funnel' AND new.event_type IN ('sale', 'sale_reversed'))
  EXECUTE FUNCTION public.fn_carteira_admite_venda();

-- ── Prova ─────────────────────────────────────────────────────────────────
DO $$
DECLARE v_trg int;
BEGIN
  SELECT count(*) INTO v_trg
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'sale_events'
     AND t.tgname = 'trg_carteira_admite_venda'
     AND NOT t.tgisinternal;
  IF v_trg <> 1 THEN
    RAISE EXCEPTION 'FALHA: trigger de admissão na Carteira não ficou anexada';
  END IF;
  IF has_function_privilege('anon', 'public.fn_carteira_admite_venda()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_carteira_admite_venda()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHA: anon/authenticated ainda executam fn_carteira_admite_venda';
  END IF;
  RAISE NOTICE 'OK: venda ganha passa a admitir o Lead na Carteira.';
END $$;

COMMIT;
