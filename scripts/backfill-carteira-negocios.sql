-- ============================================================================
-- Backfill: cada pedido de ERP vira um Negócio ganho. UMA org por execução.
--
-- Fecha a ADR-0023 §8 do lado do dado: a Carteira deixa de ser um módulo com
-- venda própria e passa a ser o segundo tempo do mesmo fluxo — lead chega,
-- compra, vira Cliente, e recompra abrindo Negócio novo.
--
-- Medido em prod 2026-08-04: 344 pedidos, 182 leads, 13 orgs. Média de 1,89
-- pedido por cliente, máximo 23.
--
-- ── O QUE ISTO NÃO É ──────────────────────────────────────────────────────
-- Não é automação criando Negócio. A ADR-0023 §3 diz que Negócio nasce por
-- clique humano, e continua valendo: aqui não se inventa pipeline nenhum. São
-- vendas que JÁ ACONTECERAM, com a data real de `sold_at`, sendo registradas
-- no objeto certo. Backfill, não criação.
--
-- ── IDEMPOTÊNCIA ──────────────────────────────────────────────────────────
-- O id do pedido fica em `deals.metadata->>'upsell_order_id'`. Rodar de novo
-- não duplica, e o próximo sync de ERP também não — é a mesma chave que o
-- sync usa para reconhecer o pedido.
--
-- Parâmetro: o runner cria `_param(org uuid)` por bind parameter e este
-- arquivo lê de lá. O uuid nunca vira texto interpolado — interpolar uuid em
-- SQL é o jeito fácil e é injeção.
-- ============================================================================

DO $$
DECLARE
  v_org uuid := (SELECT org FROM _param);
  v_pipeline uuid;
  v_stage text;
  v_criados int := 0;
  v_pulados int := 0;
  v_sem_lead int := 0;
  r record;
  v_deal uuid;
BEGIN
  -- ── Guarda 0: a org existe ───────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org) THEN
    RAISE EXCEPTION 'FALHA: org % não existe', v_org;
  END IF;

  -- ── Guarda 1: existe destino para o Negócio ganho ───────────────────────
  -- O Negócio precisa de posição, e a posição precisa de uma etapa com papel
  -- `won` num funil da org. Sem isso o backfill inventaria um lugar — que é
  -- exatamente o defeito dos 83 funis customizados sem desfecho.
  SELECT p.id, s.stage_key INTO v_pipeline, v_stage
    FROM public.pipelines p
    JOIN public.pipeline_stages s
      ON s.organization_id = p.organization_id
     AND s.pipeline_type = 'propostas'
     AND s.stage_role = 'won'
     AND s.is_active
   WHERE p.organization_id = v_org
     AND p.slug = 'propostas'
     AND p.is_active
   ORDER BY s.position
   LIMIT 1;

  IF v_pipeline IS NULL THEN
    RAISE EXCEPTION 'FALHA: org % não tem funil de Orçamentos com etapa de ganho ativa. Configure o desfecho antes.', v_org;
  END IF;

  -- ── O laço ──────────────────────────────────────────────────────────────
  FOR r IN
    SELECT o.id,
           o.sale_value,
           o.sold_at,
           o.product_name,
           o.sale_responsible_id,
           o.pre_sale_responsible_id,
           o.external_id,
           o.tiny_order_id,
           o.source,
           c.lead_id
      FROM public.upsell_orders o
      JOIN public.upsell_clients c ON c.id = o.client_id
     WHERE c.organization_id = v_org
     ORDER BY o.sold_at NULLS LAST, o.id
  LOOP
    -- Pedido sem lead não vira Negócio: Negócio pertence a exatamente um Lead
    -- (ADR-0023 §2). Contamos e seguimos, em vez de inventar dono.
    IF r.lead_id IS NULL THEN
      v_sem_lead := v_sem_lead + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.deals d
       WHERE d.organization_id = v_org
         AND d.metadata->>'upsell_order_id' = r.id::text
    ) THEN
      v_pulados := v_pulados + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.deals (
      organization_id, title, value, source_lead_id, owner_id,
      won, closed_at, metadata, created_at
    )
    VALUES (
      v_org,
      -- Título derivado (ADR-0023 §9). O nome do produto identifica melhor que
      -- "Negócio de mês/ano" quando existe; sem ele, cai na forma padrão.
      COALESCE(NULLIF(btrim(r.product_name), ''),
               'Compra de ' || to_char(COALESCE(r.sold_at, now()), 'MM/YYYY')),
      COALESCE(r.sale_value, 0),
      r.lead_id,
      COALESCE(r.sale_responsible_id, r.pre_sale_responsible_id),
      true,
      r.sold_at,
      jsonb_strip_nulls(jsonb_build_object(
        'upsell_order_id', r.id::text,
        'origem', 'carteira_erp',
        'external_id', r.external_id,
        'tiny_order_id', r.tiny_order_id,
        'source', r.source
      )),
      COALESCE(r.sold_at, now())
    )
    RETURNING id INTO v_deal;

    -- A posição. O índice único em `deal_id` garante uma posição por Negócio;
    -- vários Negócios do MESMO lead no MESMO funil só são possíveis porque a
    -- migration 20270730000050 derrubou as três travas — e é exatamente a
    -- recompra que elas proibiam.
    INSERT INTO public.pipeline_entries (
      organization_id, pipeline_id, lead_id, deal_id, stage_key,
      entered_at, stage_changed_at, closed_at, metadata
    )
    VALUES (
      v_org, v_pipeline, r.lead_id, v_deal, v_stage,
      COALESCE(r.sold_at, now()), COALESCE(r.sold_at, now()), r.sold_at,
      jsonb_build_object('sale_value', COALESCE(r.sale_value, 0), 'origem', 'carteira_erp')
    );

    v_criados := v_criados + 1;
  END LOOP;

  RAISE NOTICE '   Negócios criados: %', v_criados;
  RAISE NOTICE '   Já existiam (pulados): %', v_pulados;
  RAISE NOTICE '   Pedidos sem lead vinculado: %', v_sem_lead;

  -- ── Prova: um Negócio por pedido, nem mais nem menos ────────────────────
  DECLARE
    v_pedidos int;
    v_negocios int;
    v_orfaos int;
  BEGIN
    SELECT count(*) INTO v_pedidos
      FROM public.upsell_orders o
      JOIN public.upsell_clients c ON c.id = o.client_id
     WHERE c.organization_id = v_org AND c.lead_id IS NOT NULL;

    SELECT count(*) INTO v_negocios
      FROM public.deals d
     WHERE d.organization_id = v_org
       AND d.metadata->>'origem' = 'carteira_erp';

    IF v_negocios <> v_pedidos THEN
      RAISE EXCEPTION 'FALHA: % pedido(s) com lead mas % negócio(s) — a prova 1:1 não fecha', v_pedidos, v_negocios;
    END IF;

    SELECT count(*) INTO v_orfaos
      FROM public.deals d
      LEFT JOIN public.pipeline_entries pe ON pe.deal_id = d.id
     WHERE d.organization_id = v_org
       AND d.metadata->>'origem' = 'carteira_erp'
       AND pe.id IS NULL;

    IF v_orfaos <> 0 THEN
      RAISE EXCEPTION 'FALHA: % negócio(s) sem posição — Negócio sem card não aparece em lugar nenhum', v_orfaos;
    END IF;

    RAISE NOTICE '   VALIDATION PASSED: % pedido(s) = % negócio(s), todos posicionados.', v_pedidos, v_negocios;
  END;
END $$;
