-- =============================================================================
-- Migration: Master RLS Policies para tabelas Meta
-- Permite que usuarios master visualizem/gerenciem as tabelas Meta
-- =============================================================================

-- meta_connections
DROP POLICY IF EXISTS "master_all_meta_connections" ON meta_connections;
CREATE POLICY "master_all_meta_connections"
ON public.meta_connections FOR ALL
USING (public.is_master_user());

-- meta_pages
DROP POLICY IF EXISTS "master_all_meta_pages" ON meta_pages;
CREATE POLICY "master_all_meta_pages"
ON public.meta_pages FOR ALL
USING (public.is_master_user());

-- meta_leadgen_configs
DROP POLICY IF EXISTS "master_all_meta_leadgen_configs" ON meta_leadgen_configs;
CREATE POLICY "master_all_meta_leadgen_configs"
ON public.meta_leadgen_configs FOR ALL
USING (public.is_master_user());

-- channel_messages
DROP POLICY IF EXISTS "master_all_channel_messages" ON channel_messages;
CREATE POLICY "master_all_channel_messages"
ON public.channel_messages FOR ALL
USING (public.is_master_user());
