-- Remove meeting_date column since it's no longer needed
ALTER TABLE public.leads DROP COLUMN IF EXISTS meeting_date;

-- Add compromisso_date column for scheduling commitments (optional)
ALTER TABLE public.leads ADD COLUMN compromisso_date TIMESTAMP WITH TIME ZONE;

-- Add new values to lead_origin enum
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'remarketing';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'base_clientes';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'parceiro';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'indicacao';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'quiz';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'site';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'organico';