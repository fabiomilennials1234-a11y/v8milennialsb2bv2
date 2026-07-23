-- Fix upsell module RLS policies: get_user_organization_id() → get_my_organization_ids()
-- get_user_organization_id() returns only FIRST org (by created_at ASC).
-- Multi-org users (master shadow mode) need get_my_organization_ids() which returns ALL orgs.
-- Affects: upsell_clients, upsell_client_products, upsell_campanhas, upsell_orders,
--          client_purchase_items, client_alerts, client_health_snapshots

BEGIN;

-- ============================================================
-- 1. upsell_clients (direct organization_id)
-- ============================================================

DROP POLICY IF EXISTS "upsell_clients_select_org" ON upsell_clients;
CREATE POLICY "upsell_clients_select_org" ON upsell_clients
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "upsell_clients_insert_org" ON upsell_clients;
CREATE POLICY "upsell_clients_insert_org" ON upsell_clients
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "upsell_clients_update_org" ON upsell_clients;
CREATE POLICY "upsell_clients_update_org" ON upsell_clients
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "upsell_clients_delete_org" ON upsell_clients;
CREATE POLICY "upsell_clients_delete_org" ON upsell_clients
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- ============================================================
-- 2. upsell_client_products (via join → upsell_clients)
-- ============================================================

DROP POLICY IF EXISTS "upsell_client_products_select" ON upsell_client_products;
CREATE POLICY "upsell_client_products_select" ON upsell_client_products
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM upsell_clients
    WHERE upsell_clients.id = upsell_client_products.client_id
    AND upsell_clients.organization_id IN (SELECT public.get_my_organization_ids())
  ));

DROP POLICY IF EXISTS "upsell_client_products_insert" ON upsell_client_products;
CREATE POLICY "upsell_client_products_insert" ON upsell_client_products
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM upsell_clients
    WHERE upsell_clients.id = upsell_client_products.client_id
    AND upsell_clients.organization_id IN (SELECT public.get_my_organization_ids())
  ));

DROP POLICY IF EXISTS "upsell_client_products_update" ON upsell_client_products;
CREATE POLICY "upsell_client_products_update" ON upsell_client_products
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM upsell_clients
    WHERE upsell_clients.id = upsell_client_products.client_id
    AND upsell_clients.organization_id IN (SELECT public.get_my_organization_ids())
  ));

DROP POLICY IF EXISTS "upsell_client_products_delete" ON upsell_client_products;
CREATE POLICY "upsell_client_products_delete" ON upsell_client_products
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM upsell_clients
    WHERE upsell_clients.id = upsell_client_products.client_id
    AND upsell_clients.organization_id IN (SELECT public.get_my_organization_ids())
  ));

-- ============================================================
-- 3. upsell_campanhas (direct organization_id)
-- ============================================================

DROP POLICY IF EXISTS "upsell_campanhas_select_org" ON upsell_campanhas;
CREATE POLICY "upsell_campanhas_select_org" ON upsell_campanhas
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "upsell_campanhas_insert_org" ON upsell_campanhas;
CREATE POLICY "upsell_campanhas_insert_org" ON upsell_campanhas
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "upsell_campanhas_update_org" ON upsell_campanhas;
CREATE POLICY "upsell_campanhas_update_org" ON upsell_campanhas
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "upsell_campanhas_delete_org" ON upsell_campanhas;
CREATE POLICY "upsell_campanhas_delete_org" ON upsell_campanhas
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- ============================================================
-- 4. upsell_orders (direct organization_id)
-- ============================================================

DROP POLICY IF EXISTS "upsell_orders_select_org" ON upsell_orders;
CREATE POLICY "upsell_orders_select_org" ON upsell_orders
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "upsell_orders_insert_org" ON upsell_orders;
CREATE POLICY "upsell_orders_insert_org" ON upsell_orders
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "upsell_orders_update_org" ON upsell_orders;
CREATE POLICY "upsell_orders_update_org" ON upsell_orders
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "upsell_orders_delete_org" ON upsell_orders;
CREATE POLICY "upsell_orders_delete_org" ON upsell_orders
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- ============================================================
-- 5. client_purchase_items (via join → upsell_orders → upsell_clients)
-- ============================================================

DROP POLICY IF EXISTS "purchase_items_select" ON client_purchase_items;
CREATE POLICY "purchase_items_select" ON client_purchase_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.id = client_purchase_items.order_id
    AND c.organization_id IN (SELECT public.get_my_organization_ids())
  ));

DROP POLICY IF EXISTS "purchase_items_insert" ON client_purchase_items;
CREATE POLICY "purchase_items_insert" ON client_purchase_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.id = client_purchase_items.order_id
    AND c.organization_id IN (SELECT public.get_my_organization_ids())
  ));

DROP POLICY IF EXISTS "purchase_items_update" ON client_purchase_items;
CREATE POLICY "purchase_items_update" ON client_purchase_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.id = client_purchase_items.order_id
    AND c.organization_id IN (SELECT public.get_my_organization_ids())
  ));

DROP POLICY IF EXISTS "purchase_items_delete" ON client_purchase_items;
CREATE POLICY "purchase_items_delete" ON client_purchase_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.id = client_purchase_items.order_id
    AND c.organization_id IN (SELECT public.get_my_organization_ids())
  ));

-- ============================================================
-- 6. client_alerts (direct organization_id)
-- ============================================================

DROP POLICY IF EXISTS "client_alerts_select_org" ON client_alerts;
CREATE POLICY "client_alerts_select_org" ON client_alerts
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "client_alerts_insert_org" ON client_alerts;
CREATE POLICY "client_alerts_insert_org" ON client_alerts
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "client_alerts_update_org" ON client_alerts;
CREATE POLICY "client_alerts_update_org" ON client_alerts
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));

DROP POLICY IF EXISTS "client_alerts_delete_org" ON client_alerts;
CREATE POLICY "client_alerts_delete_org" ON client_alerts
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- ============================================================
-- 7. client_health_snapshots (direct organization_id)
-- ============================================================

DROP POLICY IF EXISTS "health_snapshots_select_org" ON client_health_snapshots;
CREATE POLICY "health_snapshots_select_org" ON client_health_snapshots
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

COMMIT;
