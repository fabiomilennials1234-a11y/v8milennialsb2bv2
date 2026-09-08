-- Operação única de rollout, APÓS a migration 20271017113742 e ANTES do frontend.
-- Produção requer autorização CTO e captura prévia dos painéis existentes.
-- Não executar como cron nem no caminho de leitura: abas excluídas não renascem.
-- Não sobrescreve layout, nome ou ordem de qualquer painel existente.
INSERT INTO public.metrics_studio_panels (id, organization_id, nome, ordem, template_key, layout)
SELECT md5('studio-templates-v1:' || org.id::text || ':' || f.template_key)::uuid,
       org.id, f.nome,
       COALESCE((SELECT max(p.ordem) FROM public.metrics_studio_panels p WHERE p.organization_id = org.id), 0) + f.ordem,
       f.template_key, f.layout
  FROM public.organizations org
 CROSS JOIN public._metrics_studio_factory_templates() f
 WHERE NOT EXISTS (
   SELECT 1 FROM public.metrics_studio_panels existing
   WHERE existing.organization_id = org.id AND existing.template_key = f.template_key
 );
