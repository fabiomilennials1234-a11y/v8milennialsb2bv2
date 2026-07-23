-- =============================================================================
-- Dedup guard: prevent duplicate upsell_orders from concurrent trigger fires
-- =============================================================================

-- 1. Partial unique index — DB-level guarantee, no duplicates even under race
CREATE UNIQUE INDEX IF NOT EXISTS idx_upsell_orders_proposta_unique
  ON upsell_orders(pipe_proposta_id)
  WHERE pipe_proposta_id IS NOT NULL;

-- 2. Replace trigger function with advisory-lock + conflict-safe version
CREATE OR REPLACE FUNCTION public.handle_proposta_vendida()
RETURNS TRIGGER AS $$
DECLARE
  v_lead RECORD;
  v_client_id UUID;
  v_org_id UUID;
  v_item RECORD;
  v_has_items BOOLEAN := false;
  v_lock_key BIGINT;
BEGIN
  IF NEW.status <> 'vendido' OR (OLD.status IS NOT NULL AND OLD.status = 'vendido') THEN
    RETURN NEW;
  END IF;

  -- Advisory lock serializes concurrent updates to same proposta
  v_lock_key := ('x' || left(replace(NEW.id::text, '-', ''), 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF EXISTS (SELECT 1 FROM upsell_orders WHERE pipe_proposta_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_lead FROM leads WHERE id = NEW.lead_id;
  IF v_lead IS NULL THEN
    RETURN NEW;
  END IF;
  v_org_id := v_lead.organization_id;
  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO upsell_clients (
    organization_id, lead_id, name, company, email, phone,
    closer_id, first_sale_at
  ) VALUES (
    v_org_id, NEW.lead_id, v_lead.name, v_lead.company,
    v_lead.email, v_lead.phone, NEW.closer_id,
    COALESCE(NEW.closed_at, now())
  )
  ON CONFLICT (organization_id, lead_id) DO UPDATE
    SET updated_at = now()
  RETURNING id INTO v_client_id;

  FOR v_item IN
    SELECT ppi.*, p.name AS prod_name, p.type AS prod_type
    FROM pipe_proposta_items ppi
    LEFT JOIN products p ON p.id = ppi.product_id
    WHERE ppi.pipe_proposta_id = NEW.id
  LOOP
    v_has_items := true;

    INSERT INTO upsell_client_products (
      client_id, product_id, product_name, product_type,
      sale_value, contract_duration
    ) VALUES (
      v_client_id, v_item.product_id,
      COALESCE(v_item.prod_name, 'Produto'),
      COALESCE(v_item.prod_type, 'projeto'),
      COALESCE(v_item.sale_value, 0),
      NEW.contract_duration
    );

    IF COALESCE(v_item.sale_value, 0) > 0 THEN
      INSERT INTO upsell_orders (
        organization_id, client_id, closer_id,
        product_id, product_name, product_type,
        sale_value, origin, pipe_proposta_id, sold_at
      ) VALUES (
        v_org_id, v_client_id, NEW.closer_id,
        v_item.product_id,
        COALESCE(v_item.prod_name, 'Produto'),
        COALESCE(v_item.prod_type, 'projeto'),
        v_item.sale_value,
        'new_business',
        NEW.id,
        COALESCE(NEW.closed_at, now())
      )
      ON CONFLICT (pipe_proposta_id) WHERE pipe_proposta_id IS NOT NULL DO NOTHING;
    END IF;
  END LOOP;

  IF NOT v_has_items AND COALESCE(NEW.sale_value, 0) > 0 THEN
    INSERT INTO upsell_client_products (
      client_id, product_id, product_name, product_type,
      sale_value, contract_duration
    ) VALUES (
      v_client_id, NEW.product_id,
      COALESCE((SELECT name FROM products WHERE id = NEW.product_id), 'Produto'),
      COALESCE(NEW.product_type::TEXT, 'projeto'),
      NEW.sale_value,
      NEW.contract_duration
    );

    INSERT INTO upsell_orders (
      organization_id, client_id, closer_id,
      product_id, product_name, product_type,
      sale_value, origin, pipe_proposta_id, sold_at
    ) VALUES (
      v_org_id, v_client_id, NEW.closer_id,
      NEW.product_id,
      COALESCE((SELECT name FROM products WHERE id = NEW.product_id), 'Produto'),
      COALESCE(NEW.product_type::TEXT, 'projeto'),
      NEW.sale_value,
      'new_business',
      NEW.id,
      COALESCE(NEW.closed_at, now())
    )
    ON CONFLICT (pipe_proposta_id) WHERE pipe_proposta_id IS NOT NULL DO NOTHING;
  END IF;

  INSERT INTO upsell_campanhas (
    organization_id, client_id, closer_id,
    status, data_venda
  ) VALUES (
    v_org_id, v_client_id, NEW.closer_id,
    'vendido', COALESCE(NEW.closed_at, now())
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
