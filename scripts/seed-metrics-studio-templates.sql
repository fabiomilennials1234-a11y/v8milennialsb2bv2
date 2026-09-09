-- Operação única de rollout, APÓS a migration 20271017113742 e ANTES do frontend.
-- Produção requer autorização CTO e captura prévia dos painéis existentes.
-- Não executar como cron nem no caminho de leitura: abas excluídas não renascem.
-- Não sobrescreve layout, nome ou ordem de qualquer painel existente.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
-- Mesma ordem de locks do trigger de org nova; manutenção breve de escrita.
LOCK TABLE public.organizations IN SHARE MODE;
LOCK TABLE public.metrics_studio_panels IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE studio_before_rollout ON COMMIT DROP AS
  SELECT id, to_jsonb(p) AS snapshot FROM public.metrics_studio_panels p;

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

DO $preserve$
BEGIN
  IF EXISTS (
    SELECT 1 FROM studio_before_rollout b
    LEFT JOIN public.metrics_studio_panels p ON p.id = b.id
    WHERE p.id IS NULL OR to_jsonb(p) IS DISTINCT FROM b.snapshot
  ) THEN
    RAISE EXCEPTION 'Rollout abortado: uma aba existente foi alterada ou removida';
  END IF;
END;
$preserve$;
SELECT (SELECT count(*) FROM studio_before_rollout) AS abas_anteriores_preservadas,
       count(*) AS abas_apos_rollout
  FROM public.metrics_studio_panels;
COMMIT;
