-- Validar preservação de layouts na preview antes de usar. Prod requer autorização.
-- Retira apenas o comportamento de criação automática para organizações novas.
-- Todas as abas ficam: até um template intocado pode estar em uso pelo cliente.
DROP TRIGGER seed_metrics_studio_templates_after_org_insert ON public.organizations;
DROP FUNCTION public.seed_metrics_studio_templates_on_org_create();
DROP FUNCTION public._metrics_studio_factory_templates();
