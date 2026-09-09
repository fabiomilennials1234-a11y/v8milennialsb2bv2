BEGIN;
INSERT INTO public.organizations(id,name,slug) VALUES ('90000000-0000-4000-8000-000000000001','Oracle schema fixture','oracle-schema-fixture');
INSERT INTO public.leads(id,organization_id,name,rating) VALUES ('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','Synthetic fixture',5);
INSERT INTO public.pipelines(id,organization_id,name,slug) VALUES ('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001','Synthetic pipeline','synthetic');
INSERT INTO public.pipeline_stages(pipeline_id,stage_key,name) VALUES ('90000000-0000-4000-8000-000000000003','new','New');
INSERT INTO public.pipeline_entries(organization_id,pipeline_id,stage_key,lead_id,metadata) VALUES ('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000003','new','90000000-0000-4000-8000-000000000002','{"calor":5}');
COMMIT;
