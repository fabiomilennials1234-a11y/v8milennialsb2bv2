-- Reduzir enum lead_origin aos valores: whatsapp, meta_ads, outro, site, remarketing, google_ads, cal.
-- Valores antigos migrados: calendly→cal; base_clientes, parceiro, indicacao, quiz, organico, ambos, zydon→outro.

CREATE TYPE public.lead_origin_new AS ENUM (
  'whatsapp',
  'meta_ads',
  'outro',
  'site',
  'remarketing',
  'google_ads',
  'cal'
);

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS origin_new public.lead_origin_new;

UPDATE public.leads
SET origin_new = CASE origin::text
  WHEN 'cal' THEN 'cal'::public.lead_origin_new
  WHEN 'whatsapp' THEN 'whatsapp'::public.lead_origin_new
  WHEN 'meta_ads' THEN 'meta_ads'::public.lead_origin_new
  WHEN 'outro' THEN 'outro'::public.lead_origin_new
  WHEN 'site' THEN 'site'::public.lead_origin_new
  WHEN 'remarketing' THEN 'remarketing'::public.lead_origin_new
  WHEN 'calendly' THEN 'cal'::public.lead_origin_new
  ELSE 'outro'::public.lead_origin_new
END;

ALTER TABLE public.leads DROP COLUMN origin;
ALTER TABLE public.leads RENAME COLUMN origin_new TO origin;
ALTER TABLE public.leads ALTER COLUMN origin SET NOT NULL;
ALTER TABLE public.leads ALTER COLUMN origin SET DEFAULT 'outro'::public.lead_origin_new;

DROP TYPE public.lead_origin;
ALTER TYPE public.lead_origin_new RENAME TO lead_origin;

COMMENT ON COLUMN public.leads.origin IS 'Origem do lead: whatsapp, meta_ads, outro, site, remarketing, google_ads, cal (Cal.com).';
