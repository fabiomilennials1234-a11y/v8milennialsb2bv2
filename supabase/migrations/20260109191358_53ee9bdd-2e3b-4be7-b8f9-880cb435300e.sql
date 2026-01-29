-- Add meeting_date column to leads table for Calendly meeting times
ALTER TABLE public.leads ADD COLUMN meeting_date TIMESTAMP WITH TIME ZONE;