CREATE TABLE public.organizations(id uuid PRIMARY KEY, capture_groups boolean);
CREATE TABLE public.whatsapp_instances(id uuid PRIMARY KEY,organization_id uuid REFERENCES public.organizations(id),provider text);
INSERT INTO public.organizations VALUES('10000000-0000-0000-0000-000000000001',false),('10000000-0000-0000-0000-000000000002',false);
INSERT INTO public.whatsapp_instances VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','uazapi'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','uazapi');
