-- smoke_pago_create.sql — E2E ao vivo: prova roteamento sys:cliente → pago → drip F (2026-06-29)
-- Lead descartável sentinela. Instância=0 → não envia. Cleanup em smoke_pago_cleanup.sql.
INSERT INTO public.leads (id, organization_id, name, phone, email, origin)
VALUES ('dddddddd-dead-beef-cafe-000000000001','d67ae17a-815d-476d-b3a9-287c7b267997','ZZZ SMOKE TEST DNA (apagar)','5500000000099','smoke-dna-test@example.invalid','outro')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_entries (organization_id, pipeline_id, lead_id, stage_key)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997', p.id, 'dddddddd-dead-beef-cafe-000000000001', 'novo_lead'
FROM public.pipelines p
WHERE p.organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND p.slug='whatsapp'
ON CONFLICT DO NOTHING;

INSERT INTO public.lead_tags (lead_id, tag_id)
SELECT 'dddddddd-dead-beef-cafe-000000000001', t.id
FROM public.tags t
WHERE t.organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND t.name='sys:cliente'
ON CONFLICT DO NOTHING;

SELECT 'created' AS status,
 (SELECT pe.stage_key FROM public.pipeline_entries pe JOIN public.pipelines p ON p.id=pe.pipeline_id
   WHERE pe.lead_id='dddddddd-dead-beef-cafe-000000000001' AND p.slug='whatsapp') AS wa_stage,
 (SELECT count(*) FROM public.lead_tags WHERE lead_id='dddddddd-dead-beef-cafe-000000000001') AS tags;
