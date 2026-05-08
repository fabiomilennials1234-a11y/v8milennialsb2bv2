-- Wave 4 — Deal Enhancement
-- Weighted pipeline, deal items, quotes, multi-currency, approval workflows.

-- ============================================================================
-- 1. Add probability to pipeline_stages
-- ============================================================================

ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS default_probability int DEFAULT 50
  CHECK (default_probability >= 0 AND default_probability <= 100);

-- ============================================================================
-- 2. deal_items — multi-product line items per deal
-- ============================================================================

CREATE TABLE IF NOT EXISTS deal_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_percent numeric NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  total numeric GENERATED ALWAYS AS (quantity * unit_price * (1 - discount_percent / 100)) STORED,
  sort_order int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deal_items_deal ON deal_items (deal_id);
CREATE INDEX idx_deal_items_org ON deal_items (organization_id);

ALTER TABLE deal_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org deal items"
  ON deal_items FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users manage deal items"
  ON deal_items FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- 3. quotes — proposal/quote versions per deal
-- ============================================================================

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL,
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  title text,
  subtotal numeric NOT NULL DEFAULT 0,
  discount_percent numeric NOT NULL DEFAULT 0,
  tax_percent numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BRL',
  valid_until timestamptz,
  terms text,
  notes text,
  items jsonb NOT NULL DEFAULT '[]',
  template_id text,
  pdf_url text,
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id, version)
);

CREATE INDEX idx_quotes_deal ON quotes (deal_id);
CREATE INDEX idx_quotes_org ON quotes (organization_id, created_at DESC);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org quotes"
  ON quotes FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users manage quotes"
  ON quotes FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- 4. exchange_rates — multi-currency support
-- ============================================================================

CREATE TABLE IF NOT EXISTS exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency text NOT NULL,
  to_currency text NOT NULL,
  rate numeric NOT NULL CHECK (rate > 0),
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_exchange_rates_pair ON exchange_rates (from_currency, to_currency, fetched_at DESC);

-- ============================================================================
-- 5. approval_rules + approval_requests
-- ============================================================================

CREATE TABLE IF NOT EXISTS approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  entity_type text NOT NULL DEFAULT 'deal' CHECK (entity_type IN ('deal', 'quote', 'discount')),
  conditions jsonb NOT NULL DEFAULT '[]',
  approvers jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  auto_reject_hours int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_rules_org ON approval_rules (organization_id);

ALTER TABLE approval_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org approval rules"
  ON approval_rules FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins manage approval rules"
  ON approval_rules FOR ALL
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
    )
  );

CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES approval_rules(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  comment text,
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_requests_entity ON approval_requests (entity_type, entity_id);
CREATE INDEX idx_approval_requests_status ON approval_requests (status, organization_id) WHERE status = 'pending';

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org approvals"
  ON approval_requests FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users create approval requests"
  ON approval_requests FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Approvers decide"
  ON approval_requests FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );
