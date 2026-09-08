-- Validar preservação de layouts na preview antes de usar. Prod requer autorização.
-- Só retira as linhas de fábrica intocadas; conserva toda aba autoral ou editada.
DELETE FROM public.metrics_studio_panels p
USING public._metrics_studio_factory_templates() f
WHERE p.id = md5('studio-templates-v1:' || p.organization_id::text || ':' || f.template_key)::uuid
  AND p.template_key = f.template_key AND p.nome = f.nome AND p.layout = f.layout
  AND p.updated_at = p.created_at;
DROP TRIGGER seed_metrics_studio_templates_after_org_insert ON public.organizations;
DROP FUNCTION public.seed_metrics_studio_templates_on_org_create();
DROP FUNCTION public._metrics_studio_factory_templates();
