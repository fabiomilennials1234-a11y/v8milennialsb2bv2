-- Catalogue identities are tenant-owned. Never fabricate UUIDs in the picker.
-- Operator-only helper, also called by the organization creation trigger.
CREATE OR REPLACE FUNCTION public.seed_organization_lead_origins(p_organization_id uuid)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  WITH inserted AS (
    INSERT INTO public.lead_origins(organization_id,slug,name,color,sort_order)
    SELECT p_organization_id,v.slug,v.name,v.color,v.sort_order FROM (VALUES
      ('whatsapp','WhatsApp','#25D366',1),
      ('meta_ads','Meta Ads','#1877F2',2),
      ('instagram','Instagram','#E1306C',3),
      ('tiktok','Tiktok','#010101',4),
      ('google_ads','Google Ads','#EA4335',5),
      ('site','Site','#6366F1',6),
      ('landing_page','Landing Page','#0EA5E9',7),
      ('remarketing','Remarketing','#F59E0B',8),
      ('indicacao','Indicação','#10B981',9),
      ('evento','Evento','#8B5CF6',10),
      ('prospeccao_ativa','Prospecção Ativa','#F97316',11),
      ('cal','Cal.com','#292929',12),
      ('outro','Outro','#64748B',99)
    ) AS v(slug,name,color,sort_order)
    ON CONFLICT (organization_id,slug) DO NOTHING RETURNING id
  ) SELECT count(*)::integer FROM inserted;
$$;
REVOKE ALL ON FUNCTION public.seed_organization_lead_origins(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.seed_lead_origins_on_org_create()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.seed_organization_lead_origins(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_lead_origins_on_org_create() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER seed_lead_origins_after_org_insert
AFTER INSERT ON public.organizations FOR EACH ROW
EXECUTE FUNCTION public.seed_lead_origins_on_org_create();
