SELECT 'wa_stage' AS k, (SELECT pe.stage_key FROM public.pipeline_entries pe JOIN public.pipelines p ON p.id=pe.pipeline_id WHERE pe.lead_id='dddddddd-dead-beef-cafe-000000000001' AND p.slug='whatsapp') AS v
UNION ALL
SELECT 'lead_denorm', (SELECT pipe_whatsapp FROM public.leads WHERE id='dddddddd-dead-beef-cafe-000000000001')
UNION ALL
SELECT 'exec: '||w.name, e.status FROM public.workflow_executions e JOIN public.workflows w ON w.id=e.workflow_id WHERE e.lead_id='dddddddd-dead-beef-cafe-000000000001';
