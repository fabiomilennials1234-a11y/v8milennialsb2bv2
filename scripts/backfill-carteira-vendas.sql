-- ============================================================================
-- Backfill: vendas já ganhas viram clientes na Carteira.
--
-- Roda DEPOIS da migration `20270806000000_carteira_admite_venda_ganha.sql`.
-- A trigger só vale para venda NOVA; o histórico é este script.
--
-- É DML de dado de cliente — por isso vive aqui e não numa migration
-- (guarda F4 do CLAUDE.md: migration é só schema).
--
-- ESCOPO: uma organização por execução. Trocar `v_org` para rodar em outra.
--   Chique Distribuidora = 38f3bea4-44c6-4732-bb20-065f547a7ed8
--
-- Medido em prod 2026-08-06, antes de escrever: 176 leads com venda viva e sem
-- cliente na Carteira, em 21 orgs. Chique responde por 7. Rodar org a org é
-- deliberado — cada uma é uma decisão de operação, não um lote.
--
-- ── STATUS ────────────────────────────────────────────────────────────────
-- Chique: RODADO em prod 2026-08-06 → 7 clientes, 7 pedidos, R$ 8.778,13.
-- As outras 20 orgs (169 leads — Milennials 58, Basic4u 43, Happyneis 14,
-- Vanilla Brasil 10, …): PENDENTES.
--
-- Milennials tem `carteira_emits_revenue_enabled = true`: lá o script cria o
-- cliente e **não** cria pedido, porque pedido aprovado emite `sale_events`
-- (producer='carteira') e a venda já está no caderno pelo funil. Sem isso, a
-- receita apareceria em dobro. A Carteira fica com o cliente e LTV zerado até
-- chegar pedido do ERP — que é o comportamento correto para essa org.
--
-- Para varrer todas de uma vez, envolver o corpo num loop sobre
--   SELECT DISTINCT organization_id FROM sale_events WHERE producer='funnel'
-- lendo `carteira_emits_revenue_enabled` por org dentro do laço.
--
-- Idempotente: reexecutar não duplica (ON CONFLICT nos dois inserts).
-- Reverter: DELETE dos `upsell_orders` com external_source='funnel_sale_event'
-- da org + DELETE dos `upsell_clients` criados (nenhum tem tiny_contact_id).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_org            uuid := '38f3bea4-44c6-4732-bb20-065f547a7ed8';  -- Chique Distribuidora
  v_emite_receita  boolean;
  v_clientes_antes int;
  v_clientes_novos int;
  v_pedidos_novos  int;
  v_esperado       int;
  r                record;
  v_client_id      uuid;
BEGIN
  SELECT coalesce(carteira_emits_revenue_enabled, false) INTO v_emite_receita
    FROM public.organizations WHERE id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FALHA: organização % não existe', v_org;
  END IF;

  SELECT count(*) INTO v_clientes_antes
    FROM public.upsell_clients WHERE organization_id = v_org;

  -- Uma venda por lead-evento, ignorando as estornadas e os leads na lixeira.
  FOR r IN
    SELECT s.id            AS sale_event_id,
           s.lead_id,
           s.sold_at,
           coalesce(s.sale_value, (pe.metadata->>'sale_value')::numeric) AS sale_value,
           -- Atribuição só do evento (ADR-0017 R5): o lead pode ter mudado de
           -- dono depois da venda, e o caderno é quem sabe quem vendeu.
           s.sale_responsible_id,
           s.pre_sale_responsible_id,
           l.name, l.company, l.email, l.phone, l.closer_id, l.responsible_id
      FROM public.sale_events s
      JOIN public.leads l
        ON l.id = s.lead_id
       AND l.organization_id = s.organization_id
       AND l.deleted_at IS NULL
      LEFT JOIN public.pipeline_stage_events pse ON pse.id = s.stage_event_id
      LEFT JOIN public.pipeline_entries pe       ON pe.id = pse.entry_id
     WHERE s.organization_id = v_org
       AND s.event_type = 'sale'
       AND s.producer = 'funnel'
       AND NOT EXISTS (
             SELECT 1 FROM public.sale_events rv
              WHERE rv.event_type = 'sale_reversed'
                AND rv.reversed_event_id = s.id
           )
     ORDER BY s.sold_at
  LOOP
    INSERT INTO public.upsell_clients (
      organization_id, lead_id, name, company, email, phone,
      first_sale_at, closer_id, responsible_id,
      sale_responsible_id, pre_sale_responsible_id,
      segment, gestao_stage
    ) VALUES (
      v_org, r.lead_id, r.name, r.company, r.email, r.phone,
      r.sold_at, r.closer_id, r.responsible_id,
      r.sale_responsible_id, r.pre_sale_responsible_id,
      'novo', 'primeira_compra'
    )
    ON CONFLICT (organization_id, lead_id) DO UPDATE
      SET first_sale_at = LEAST(public.upsell_clients.first_sale_at, EXCLUDED.first_sale_at),
          is_active     = true,
          churned_at    = NULL,
          updated_at    = now()
    RETURNING id INTO v_client_id;

    IF NOT v_emite_receita AND coalesce(r.sale_value, 0) > 0 THEN
      INSERT INTO public.upsell_orders (
        organization_id, client_id, closer_id,
        product_name, product_type, sale_value,
        origin, source, sold_at,
        approval_status, approved_at,
        responsible_id, pre_sale_responsible_id, sale_responsible_id,
        external_source, external_id
      ) VALUES (
        v_org, v_client_id, r.closer_id,
        'Venda do funil', 'projeto', r.sale_value,
        'new_business', 'pipe', r.sold_at,
        'approved', now(),
        r.responsible_id, r.pre_sale_responsible_id, r.sale_responsible_id,
        'funnel_sale_event', r.sale_event_id::text
      )
      ON CONFLICT (organization_id, external_source, external_id)
        WHERE external_source IS NOT NULL AND external_id IS NOT NULL
        DO NOTHING;
    END IF;

    PERFORM public.recalc_upsell_client_metrics(v_client_id);
  END LOOP;

  -- ── Prova ───────────────────────────────────────────────────────────────
  SELECT count(DISTINCT s.lead_id) INTO v_esperado
    FROM public.sale_events s
    JOIN public.leads l ON l.id = s.lead_id AND l.organization_id = s.organization_id AND l.deleted_at IS NULL
   WHERE s.organization_id = v_org
     AND s.event_type = 'sale'
     AND s.producer = 'funnel'
     AND NOT EXISTS (
           SELECT 1 FROM public.sale_events rv
            WHERE rv.event_type = 'sale_reversed' AND rv.reversed_event_id = s.id
         );

  SELECT count(*) INTO v_clientes_novos
    FROM public.upsell_clients WHERE organization_id = v_org;

  SELECT count(*) INTO v_pedidos_novos
    FROM public.upsell_orders
   WHERE organization_id = v_org AND external_source = 'funnel_sale_event';

  IF v_clientes_novos < v_esperado THEN
    RAISE EXCEPTION 'FALHA: esperava >= % clientes, tem %', v_esperado, v_clientes_novos;
  END IF;

  RAISE NOTICE 'OK org %: clientes % -> % (esperado >= %), pedidos do funil = %',
    v_org, v_clientes_antes, v_clientes_novos, v_esperado, v_pedidos_novos;
END $$;

COMMIT;
