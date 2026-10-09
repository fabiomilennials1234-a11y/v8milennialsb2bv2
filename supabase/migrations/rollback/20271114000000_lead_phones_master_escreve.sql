-- Rollback de 20271114000000_lead_phones_master_escreve.sql:
-- volta as policies de INSERT/UPDATE de lead_phones ao texto de 20271112000000.

ALTER POLICY lead_phones_insert ON public.lead_phones
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND source = 'crm'
    AND erp_phone_id IS NULL
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_phones.lead_id)
  );

ALTER POLICY lead_phones_update ON public.lead_phones
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_phones.lead_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_phones.lead_id)
  );
