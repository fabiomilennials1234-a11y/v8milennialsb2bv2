-- Operational configuration. Resolve existing records, never create accounts or
-- promote a representative to administrator. Run after both schema migrations.
DO $$
DECLARE org uuid; karine public.team_members%ROWTYPE; inbox uuid; pipes uuid[]; widgets jsonb;
BEGIN
 SELECT id INTO STRICT org FROM public.organizations WHERE slug='jrtex';
 SELECT * INTO STRICT karine FROM public.team_members WHERE organization_id=org AND name='Karine Chaves' AND is_active;
 SELECT id INTO STRICT inbox FROM public.whatsapp_instances WHERE organization_id=org AND instance_name='WhatsApp Principal';
 SELECT array_agg(id ORDER BY id) INTO pipes FROM public.pipelines WHERE organization_id=org AND btrim(name) ~* 'jrtex$'
   AND (name ILIKE '%vendas%' OR name ILIKE '%carteira%' OR name ILIKE '%charger%');
 IF coalesce(cardinality(pipes),0)=0 THEN RAISE EXCEPTION 'No commercial pipelines found'; END IF;
 INSERT INTO private.regional_sales_config(organization_id,pipeline_ids,report_user_ids,triage_member_id,instance_id,work_start,work_end,break_start,break_end,work_days,response_minutes)
 VALUES(org,pipes,ARRAY[karine.user_id],karine.id,inbox,'08:00','18:00','12:00','13:00','{1,2,3,4,5}',180)
 ON CONFLICT(organization_id) DO UPDATE SET pipeline_ids=EXCLUDED.pipeline_ids,report_user_ids=EXCLUDED.report_user_ids,
   triage_member_id=EXCLUDED.triage_member_id,instance_id=EXCLUDED.instance_id,
   work_start=EXCLUDED.work_start,work_end=EXCLUDED.work_end,break_start=EXCLUDED.break_start,break_end=EXCLUDED.break_end,work_days=EXCLUDED.work_days,response_minutes=EXCLUDED.response_minutes;
 -- Standard engine cards keep the current XLSX exporter on the scoped RPC.
 SELECT jsonb_agg(jsonb_build_object('id','jrtex-report-'||n,'metricId',metric,'corte',cut,'chart',chart,
   'x',((n-1)%2)*440,'y',((n-1)/2)*280,'w',420,'h',260,'z',n) ORDER BY n) INTO widgets
 FROM (VALUES(1,'receita','total','number'),(2,'num_vendas','total','number'),(3,'receita','closer','pie'),(4,'num_vendas','closer','pie'),
   (5,'leads_criados','origem','pie'),(6,'receita','origem','pie'),(7,'num_vendas','tempo','pie'),(8,'negocios_perdidos','closer','pie')) v(n,metric,cut,chart);
 IF NOT EXISTS(SELECT 1 FROM public.metrics_studio_panels WHERE organization_id=org AND template_key='regional-sales') THEN
   INSERT INTO public.metrics_studio_panels(organization_id,team_member_id,nome,ordem,template_key,layout)
   VALUES(org,karine.id,'Relatórios Jrtex',-1,'regional-sales',widgets);
 END IF;
END $$;
