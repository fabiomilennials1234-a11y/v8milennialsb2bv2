-- =============================================================================
-- Migration: Adicionar novas origens ao enum lead_origin
-- Novas: tiktok, indicacao, evento, prospeccao_ativa, landing_page
-- (instagram já existe desde 20260717000002)
-- =============================================================================

ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'tiktok';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'indicacao';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'evento';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'prospeccao_ativa';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'landing_page';
