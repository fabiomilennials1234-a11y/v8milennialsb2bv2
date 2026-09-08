UPDATE public.metrics_studio_panels
SET layout = jsonb_set(layout, '{0,id}', '"edicao-que-deve-sobreviver"'::jsonb)
WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND template_key = 'visao-geral';
