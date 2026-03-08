-- =============================================================================
-- Migration: Adicionar 'instagram' e 'messenger' ao enum lead_origin
-- =============================================================================

ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'instagram';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'messenger';
