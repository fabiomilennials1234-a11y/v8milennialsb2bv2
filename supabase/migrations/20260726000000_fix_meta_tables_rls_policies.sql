-- =============================================================================
-- Migration de reparo: Garante que as RLS policies das tabelas Meta existem
-- As tabelas foram criadas mas as policies podem nao ter sido aplicadas
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. channel_messages
-- -----------------------------------------------------------------------------
ALTER TABLE IF EXISTS channel_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "channel_messages_org_access" ON channel_messages;
CREATE POLICY "channel_messages_org_access" ON channel_messages
  FOR ALL USING (
    organization_id = public.get_user_organization_id()
  );

DROP POLICY IF EXISTS "channel_messages_service_role" ON channel_messages;
CREATE POLICY "channel_messages_service_role" ON channel_messages
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- -----------------------------------------------------------------------------
-- 2. meta_connections
-- -----------------------------------------------------------------------------
ALTER TABLE IF EXISTS meta_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meta_connections_org_access" ON meta_connections;
CREATE POLICY "meta_connections_org_access" ON meta_connections
  FOR ALL USING (
    organization_id = public.get_user_organization_id()
  );

DROP POLICY IF EXISTS "meta_connections_service_role" ON meta_connections;
CREATE POLICY "meta_connections_service_role" ON meta_connections
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_meta_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_meta_connections_updated_at ON meta_connections;
CREATE TRIGGER trigger_meta_connections_updated_at
  BEFORE UPDATE ON meta_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_meta_connections_updated_at();

-- -----------------------------------------------------------------------------
-- 3. meta_pages
-- -----------------------------------------------------------------------------
ALTER TABLE IF EXISTS meta_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meta_pages_org_access" ON meta_pages;
CREATE POLICY "meta_pages_org_access" ON meta_pages
  FOR ALL USING (
    organization_id = public.get_user_organization_id()
  );

DROP POLICY IF EXISTS "meta_pages_service_role" ON meta_pages;
CREATE POLICY "meta_pages_service_role" ON meta_pages
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_meta_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_meta_pages_updated_at ON meta_pages;
CREATE TRIGGER trigger_meta_pages_updated_at
  BEFORE UPDATE ON meta_pages
  FOR EACH ROW
  EXECUTE FUNCTION update_meta_pages_updated_at();

-- -----------------------------------------------------------------------------
-- 4. meta_leadgen_configs
-- -----------------------------------------------------------------------------
ALTER TABLE IF EXISTS meta_leadgen_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meta_leadgen_configs_org_access" ON meta_leadgen_configs;
CREATE POLICY "meta_leadgen_configs_org_access" ON meta_leadgen_configs
  FOR ALL USING (
    organization_id = public.get_user_organization_id()
  );

DROP POLICY IF EXISTS "meta_leadgen_configs_service_role" ON meta_leadgen_configs;
CREATE POLICY "meta_leadgen_configs_service_role" ON meta_leadgen_configs
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Realtime para channel_messages
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE channel_messages;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
