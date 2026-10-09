-- 20271114000000_lead_phones_master_escreve.sql
--
-- Chamado 82c50502 — master não conseguia salvar contato no lead.
--
-- As policies de INSERT e UPDATE de `lead_phones` (20271112000000) só aceitavam
-- quem é membro da org (`get_my_organization_ids()`). Master vê o lead pela
-- `master_all_leads` e os telefones pela `lead_phones_select_master`, mas:
--   - contato novo → "new row violates row-level security policy";
--   - editar/apagar contato → UPDATE casava 0 linhas e a tela dizia "salvo".
-- Reproduzido em prod em 09/10 com um master na Café Jurerê (transação com
-- ROLLBACK); membro da org salvava normalmente.
--
-- Master ganha o mesmo ramo que já tem em `leads`. A org da linha continua
-- presa à do lead pelo gatilho `lead_phones_org_guard`, e as demais condições
-- (só `source='crm'`, sem `erp_phone_id`, lead visível) valem para todos.

ALTER POLICY lead_phones_insert ON public.lead_phones
  WITH CHECK (
    (organization_id IN (SELECT public.get_my_organization_ids())
       OR (SELECT public.is_master_user()))
    AND source = 'crm'
    AND erp_phone_id IS NULL
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_phones.lead_id)
  );

ALTER POLICY lead_phones_update ON public.lead_phones
  USING (
    (organization_id IN (SELECT public.get_my_organization_ids())
       OR (SELECT public.is_master_user()))
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_phones.lead_id)
  )
  WITH CHECK (
    (organization_id IN (SELECT public.get_my_organization_ids())
       OR (SELECT public.is_master_user()))
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_phones.lead_id)
  );
