-- Templates editáveis: apenas DDL. Backfill separado em scripts/seed-metrics-studio-templates.sql.
-- A versão de ensaio 20271005 foi revertida na preview, não aplicada em prod,
-- e arquivada sem alterações; 20271005 foi ocupado por outra entrega na main.
CREATE FUNCTION public._metrics_studio_factory_templates()
RETURNS TABLE(template_key text, nome text, ordem integer, layout jsonb)
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $factory$
  SELECT item->>'key', item->>'nome', (item->>'ordem')::integer, item->'layout'
  FROM jsonb_array_elements($templates$[{"key":"visao-geral","nome":"Visão Geral","ordem":1,"layout":[{"id":"visao-geral-indicadores-operacao","fixo":"indicadores-operacao","metricId":"","corte":"total","chart":"number","x":16,"y":16,"w":984,"h":280,"z":1},{"id":"visao-geral-meta-mensal","fixo":"meta-mensal","metricId":"","corte":"total","chart":"number","x":16,"y":312,"w":320,"h":488,"z":2},{"id":"visao-geral-receita-acumulada","fixo":"receita-acumulada","metricId":"","corte":"total","chart":"number","x":352,"y":312,"w":648,"h":488,"z":3},{"id":"visao-geral-funil-conversao","fixo":"funil-conversao","metricId":"","corte":"total","chart":"number","x":16,"y":816,"w":320,"h":400,"z":4},{"id":"visao-geral-briefing-oraculo","fixo":"briefing-oraculo","metricId":"","corte":"total","chart":"number","x":352,"y":816,"w":320,"h":400,"z":5},{"id":"visao-geral-operacao-ao-vivo","fixo":"operacao-ao-vivo","metricId":"","corte":"total","chart":"number","x":688,"y":816,"w":312,"h":400,"z":6}]},{"key":"performance","nome":"Performance","ordem":2,"layout":[{"id":"performance-ranking-vendedores","fixo":"ranking-vendedores","metricId":"","corte":"total","chart":"number","x":16,"y":16,"w":640,"h":400,"z":1},{"id":"performance-campeoes-produto","fixo":"campeoes-produto","metricId":"","corte":"total","chart":"number","x":672,"y":16,"w":328,"h":400,"z":2},{"id":"performance-atividade-equipe","fixo":"atividade-equipe","metricId":"","corte":"total","chart":"number","x":16,"y":432,"w":640,"h":400,"z":3},{"id":"performance-jornada-lead","fixo":"jornada-lead","metricId":"","corte":"total","chart":"number","x":672,"y":432,"w":328,"h":400,"z":4},{"id":"performance-metas-equipe","fixo":"metas-equipe","metricId":"","corte":"total","chart":"number","x":16,"y":848,"w":640,"h":400,"z":5},{"id":"performance-metas-individuais","fixo":"metas-individuais","metricId":"","corte":"total","chart":"number","x":672,"y":848,"w":328,"h":400,"z":6},{"id":"performance-motivos-perda","fixo":"motivos-perda","metricId":"","corte":"total","chart":"number","x":16,"y":1264,"w":328,"h":400,"z":7},{"id":"performance-real-esperado","fixo":"real-esperado","metricId":"","corte":"total","chart":"number","x":360,"y":1264,"w":640,"h":400,"z":8}]},{"key":"saude","nome":"Saúde","ordem":3,"layout":[{"id":"saude-saude-funil","fixo":"saude-funil","metricId":"","corte":"total","chart":"number","x":16,"y":16,"w":984,"h":980,"z":1}]},{"key":"mapa","nome":"Mapa","ordem":4,"layout":[{"id":"mapa-mapa-clientes","fixo":"mapa-clientes","metricId":"","corte":"total","chart":"number","x":16,"y":16,"w":984,"h":720,"z":1}]}]$templates$::jsonb) AS item;
$factory$;

REVOKE ALL ON FUNCTION public._metrics_studio_factory_templates() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.seed_metrics_studio_templates_on_org_create()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $trigger$
BEGIN
  INSERT INTO public.metrics_studio_panels (id, organization_id, nome, ordem, template_key, layout)
  SELECT md5('studio-templates-v1:' || NEW.id::text || ':' || f.template_key)::uuid,
         NEW.id, f.nome, f.ordem, f.template_key, f.layout
    FROM public._metrics_studio_factory_templates() f;
  RETURN NEW;
END;
$trigger$;

REVOKE ALL ON FUNCTION public.seed_metrics_studio_templates_on_org_create() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER seed_metrics_studio_templates_after_org_insert
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.seed_metrics_studio_templates_on_org_create();

COMMENT ON COLUMN public.metrics_studio_panels.template_key IS
  'Origem do template editável: visao-geral, performance, saude ou mapa. NULL indica aba autoral. A origem nunca autoriza sobrescrever o layout.';
