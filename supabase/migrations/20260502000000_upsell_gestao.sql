-- =============================================================
-- Migration: Gestão de Clientes (lifecycle categories)
-- =============================================================

-- 1. Add gestao_stage column to upsell_clients
ALTER TABLE upsell_clients
  ADD COLUMN IF NOT EXISTS gestao_stage TEXT DEFAULT 'primeira_compra';

-- 2. Backfill: set all existing active clients to 'primeira_compra'
UPDATE upsell_clients
SET gestao_stage = 'primeira_compra'
WHERE gestao_stage IS NULL;
