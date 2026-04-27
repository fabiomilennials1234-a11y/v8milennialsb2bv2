-- ============================================================================
-- TinyERP Integration Tables
-- ============================================================================

-- 1. Connections (1 per organization)
CREATE TABLE tinyerp_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),

    -- Encrypted API token (AES-256-GCM)
    encrypted_api_token TEXT NOT NULL,
    encryption_nonce TEXT NOT NULL,
    encryption_key_id TEXT NOT NULL DEFAULT 'v1',

    -- Display info from connection test
    tiny_account_name TEXT,
    tiny_cnpj TEXT,

    -- Status
    status TEXT NOT NULL DEFAULT 'connected'
        CHECK (status IN ('connected', 'expired', 'disconnected')),

    -- Sync config
    auto_sync_products BOOLEAN DEFAULT false,
    auto_push_orders BOOLEAN DEFAULT false,
    sync_contacts BOOLEAN DEFAULT false,
    last_product_sync_at TIMESTAMPTZ,
    last_order_push_at TIMESTAMPTZ,
    last_error TEXT,

    -- Audit
    connected_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT unique_tinyerp_org UNIQUE(organization_id)
);

-- 2. Sync logs
CREATE TABLE tinyerp_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    operation TEXT NOT NULL CHECK (operation IN (
        'product_import', 'product_sync',
        'order_push', 'order_status_update',
        'contact_sync', 'connection_test',
        'webhook_received'
    )),

    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'pending', 'partial')),
    error_message TEXT,

    items_processed INT DEFAULT 0,
    items_created INT DEFAULT 0,
    items_updated INT DEFAULT 0,
    items_failed INT DEFAULT 0,

    local_reference_id UUID,
    local_reference_type TEXT,
    tiny_reference_id TEXT,

    request_payload JSONB,
    response_payload JSONB,

    initiated_by TEXT NOT NULL DEFAULT 'user'
        CHECK (initiated_by IN ('user', 'system', 'webhook')),

    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Product mappings (CRM product <-> TinyERP product)
CREATE TABLE tinyerp_product_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    tiny_product_id TEXT NOT NULL,
    tiny_sku TEXT,
    last_synced_at TIMESTAMPTZ DEFAULT now(),
    sync_direction TEXT DEFAULT 'from_tiny' CHECK (sync_direction IN ('from_tiny', 'to_tiny', 'bidirectional')),

    CONSTRAINT unique_tiny_product_per_org UNIQUE(organization_id, tiny_product_id),
    CONSTRAINT unique_crm_product_per_org UNIQUE(organization_id, product_id)
);

-- 4. Order mappings (pipe_propostas <-> TinyERP pedidos)
CREATE TABLE tinyerp_order_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    pipe_proposta_id UUID NOT NULL REFERENCES pipe_propostas(id) ON DELETE CASCADE,
    tiny_order_id TEXT NOT NULL,
    tiny_order_number TEXT,
    tiny_nfe_id TEXT,
    tiny_nfe_status TEXT,
    last_synced_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT unique_tiny_order_per_org UNIQUE(organization_id, tiny_order_id),
    CONSTRAINT unique_proposta_tiny_order UNIQUE(pipe_proposta_id)
);

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX idx_tinyerp_connections_org ON tinyerp_connections(organization_id);
CREATE INDEX idx_tinyerp_connections_status ON tinyerp_connections(status);
CREATE INDEX idx_tinyerp_sync_logs_org ON tinyerp_sync_logs(organization_id);
CREATE INDEX idx_tinyerp_sync_logs_created ON tinyerp_sync_logs(created_at DESC);
CREATE INDEX idx_tinyerp_product_mappings_org ON tinyerp_product_mappings(organization_id);
CREATE INDEX idx_tinyerp_order_mappings_org ON tinyerp_order_mappings(organization_id);

-- ============================================================================
-- Triggers (updated_at)
-- ============================================================================
CREATE TRIGGER update_tinyerp_connections_updated_at
    BEFORE UPDATE ON tinyerp_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS Policies
-- ============================================================================
ALTER TABLE tinyerp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE tinyerp_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tinyerp_product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tinyerp_order_mappings ENABLE ROW LEVEL SECURITY;

-- tinyerp_connections: org members can read, service_role can do everything
CREATE POLICY "tinyerp_connections_select" ON tinyerp_connections
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM team_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "tinyerp_connections_insert" ON tinyerp_connections
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM team_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "tinyerp_connections_update" ON tinyerp_connections
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM team_members WHERE user_id = auth.uid()
        )
    );

-- tinyerp_sync_logs: org members can read
CREATE POLICY "tinyerp_sync_logs_select" ON tinyerp_sync_logs
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM team_members WHERE user_id = auth.uid()
        )
    );

-- tinyerp_product_mappings: org members can read
CREATE POLICY "tinyerp_product_mappings_select" ON tinyerp_product_mappings
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM team_members WHERE user_id = auth.uid()
        )
    );

-- tinyerp_order_mappings: org members can read
CREATE POLICY "tinyerp_order_mappings_select" ON tinyerp_order_mappings
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM team_members WHERE user_id = auth.uid()
        )
    );

-- Service role policies (for Edge Functions)
CREATE POLICY "tinyerp_connections_service" ON tinyerp_connections
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tinyerp_sync_logs_service" ON tinyerp_sync_logs
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tinyerp_product_mappings_service" ON tinyerp_product_mappings
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tinyerp_order_mappings_service" ON tinyerp_order_mappings
    FOR ALL USING (auth.role() = 'service_role');
