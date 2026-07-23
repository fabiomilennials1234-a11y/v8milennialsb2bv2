-- ============================================
-- CUSTOMER PORTFOLIO — Schema Evolution
-- ============================================
-- Evolves upsell module with health scores, reorder prediction,
-- segmentation, and granular purchase items.
-- IMPACT: Adds columns to upsell_clients, upsell_orders, copilot_agents.
--         Creates new tables client_purchase_items, client_alerts.
--         No existing data modified.
-- ============================================

-- 1. NEW COLUMNS ON upsell_clients
ALTER TABLE upsell_clients
  ADD COLUMN IF NOT EXISTS reorder_cycle_days    INTEGER,
  ADD COLUMN IF NOT EXISTS days_since_last_order INTEGER,
  ADD COLUMN IF NOT EXISTS last_order_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_order_expected   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS order_count           INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_value        NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_ticket            NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS health_score          INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS health_status         TEXT DEFAULT 'saudavel',
  ADD COLUMN IF NOT EXISTS health_updated_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS segment               TEXT DEFAULT 'novo',
  ADD COLUMN IF NOT EXISTS company_id            UUID;

-- Constraints (idempotent via DO block)
DO $$ BEGIN
  ALTER TABLE upsell_clients
    ADD CONSTRAINT upsell_clients_health_status_check
    CHECK (health_status IN ('saudavel','atencao','risco','inativo'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE upsell_clients
    ADD CONSTRAINT upsell_clients_segment_check
    CHECK (segment IN ('ouro','prata','novo','resgate','dormindo'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE upsell_clients
    ADD CONSTRAINT upsell_clients_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes for health/segment queries
CREATE INDEX IF NOT EXISTS idx_upsell_clients_health
  ON upsell_clients(organization_id, health_status);
CREATE INDEX IF NOT EXISTS idx_upsell_clients_segment
  ON upsell_clients(organization_id, segment);
CREATE INDEX IF NOT EXISTS idx_upsell_clients_next_order
  ON upsell_clients(organization_id, next_order_expected)
  WHERE is_active = true;

-- 2. NEW COLUMN ON upsell_orders
ALTER TABLE upsell_orders
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'pipe';

DO $$ BEGIN
  ALTER TABLE upsell_orders
    ADD CONSTRAINT upsell_orders_source_check
    CHECK (source IN ('pipe','manual','erp','copilot','csv_import'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. NEW COLUMNS ON copilot_agents
ALTER TABLE copilot_agents
  ADD COLUMN IF NOT EXISTS retention_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS retention_config  JSONB DEFAULT '{}';

-- 4. NEW TABLE: client_purchase_items
CREATE TABLE IF NOT EXISTS client_purchase_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES upsell_orders(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name  TEXT NOT NULL,
  quantity      NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(12,2) NOT NULL,
  total_price   NUMERIC(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  unit          TEXT DEFAULT 'un',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_order
  ON client_purchase_items(order_id);

-- 5. NEW TABLE: client_alerts
CREATE TABLE IF NOT EXISTS client_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES upsell_clients(id) ON DELETE CASCADE,
  alert_type      TEXT NOT NULL CHECK (alert_type IN (
    'reorder_overdue','ticket_declining','product_missing',
    'cycle_stretching','engagement_cold','nps_low'
  )),
  severity        TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  title           TEXT NOT NULL,
  description     TEXT,
  metadata        JSONB DEFAULT '{}',
  is_resolved     BOOLEAN DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_alerts_org_active
  ON client_alerts(organization_id, is_resolved)
  WHERE is_resolved = false;
CREATE INDEX IF NOT EXISTS idx_client_alerts_client
  ON client_alerts(client_id, is_resolved);

-- 6. RLS for new tables

ALTER TABLE client_purchase_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchase_items_select" ON client_purchase_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.id = client_purchase_items.order_id
    AND c.organization_id = public.get_user_organization_id()
  ));

CREATE POLICY "purchase_items_insert" ON client_purchase_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.id = client_purchase_items.order_id
    AND c.organization_id = public.get_user_organization_id()
  ));

CREATE POLICY "purchase_items_update" ON client_purchase_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.id = client_purchase_items.order_id
    AND c.organization_id = public.get_user_organization_id()
  ));

CREATE POLICY "purchase_items_delete" ON client_purchase_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.id = client_purchase_items.order_id
    AND c.organization_id = public.get_user_organization_id()
  ));

ALTER TABLE client_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_alerts_select_org" ON client_alerts
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "client_alerts_insert_org" ON client_alerts
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "client_alerts_update_org" ON client_alerts
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "client_alerts_delete_org" ON client_alerts
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- 7. SERVICE ROLE policies for cron (health calculator runs as service_role)
CREATE POLICY "purchase_items_service_all" ON client_purchase_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "client_alerts_service_all" ON client_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
