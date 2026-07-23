-- Add new values to lead_origin enum
ALTER TYPE public.lead_origin ADD VALUE IF NOT EXISTS 'cal';
ALTER TYPE public.lead_origin ADD VALUE IF NOT EXISTS 'ambos';