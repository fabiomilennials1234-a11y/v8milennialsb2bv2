-- ROLLBACK de 20271217000000_lista_fria_fundacao.sql
--
-- Desfaz a Lista Fria inteira. Os LEADS já importados ficam (viram leads comuns:
-- a coluna que os separava some), com origem 'lista_fria' e excluded_from_metrics
-- = true. Se for preciso tirá-los, faça antes, por origem:
--   SELECT count(*) FROM public.leads WHERE origin = 'lista_fria';

BEGIN;

-- Gatilhos e webhook de volta ao corpo anterior (produção em 27/10, sem a guarda).
CREATE OR REPLACE FUNCTION public.trigger_workflow_lead_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fire_workflow_trigger(
    NEW.organization_id,
    'lead_created',
    NEW.id,
    jsonb_build_object(
      'trigger', 'lead_created',
      'origin', COALESCE(NEW.origin::text, 'outro'),
      'pipe_type', 'pipe_whatsapp'
    )
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_lead_webhooks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ev TEXT;
  payload JSONB;
  w RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    ev := 'lead.created';
  ELSIF TG_OP = 'UPDATE' THEN
    ev := 'lead.updated';
  ELSE
    RETURN NEW;
  END IF;

  payload := jsonb_build_object(
    'event', ev,
    'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'data', jsonb_build_object(
      'id', NEW.id,
      'name', NEW.name,
      'email', NEW.email,
      'phone', NEW.phone,
      'company', NEW.company,
      'organization_id', NEW.organization_id,
      'origin', NEW.origin
    )
  );

  FOR w IN
    SELECT id FROM public.webhooks
    WHERE organization_id = NEW.organization_id
      AND is_active = true
      AND events @> ARRAY[ev]::text[]
  LOOP
    INSERT INTO public.webhook_deliveries (webhook_id, event, payload, next_retry_at)
    VALUES (w.id, ev, payload, now());
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS leads_lista_fria_guarda_ins ON public.leads;
DROP TRIGGER IF EXISTS leads_lista_fria_guarda_upd ON public.leads;
DROP INDEX IF EXISTS public.leads_lista_fria_idx;
ALTER TABLE public.leads DROP COLUMN IF EXISTS lista_fria_busca_id;

DROP FUNCTION IF EXISTS public.lista_fria_worker_recuperar_travadas();
DROP FUNCTION IF EXISTS public.lista_fria_worker_encerrar(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.lista_fria_worker_registrar(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.lista_fria_worker_progresso(uuid, text, text, integer, integer, integer, integer, integer);
DROP FUNCTION IF EXISTS public.lista_fria_worker_reivindicar(text);
DROP FUNCTION IF EXISTS public.lista_fria_creditos_conceder(uuid, integer, text);
DROP FUNCTION IF EXISTS public.lista_fria_importar(uuid, integer);
DROP FUNCTION IF EXISTS public.lista_fria_resultados_selecionar(uuid, uuid[], boolean);
DROP FUNCTION IF EXISTS public.lista_fria_busca_cancelar(uuid);
DROP FUNCTION IF EXISTS public.lista_fria_busca_criar(uuid, text, jsonb, integer);
DROP FUNCTION IF EXISTS public.lista_fria_saldo(uuid);

DROP TABLE IF EXISTS public.lista_fria_creditos;
DROP TABLE IF EXISTS public.lista_fria_resultados;
DROP TABLE IF EXISTS public.lista_fria_buscas;

DROP FUNCTION IF EXISTS private.lista_fria_encerrar(uuid, text, text);
DROP FUNCTION IF EXISTS private.lista_fria_so_digitos(text);
DROP FUNCTION IF EXISTS private.lista_fria_saldo_da_org(uuid);
DROP FUNCTION IF EXISTS private.lista_fria_exigir(uuid, text);
DROP FUNCTION IF EXISTS private.lista_fria_orgs_visiveis();
DROP FUNCTION IF EXISTS private.lista_fria_habilitada(uuid);
DROP FUNCTION IF EXISTS private.lista_fria_guarda_marca();

DELETE FROM public.feature_permissions WHERE key IN ('lista_fria.view', 'lista_fria.edit');
UPDATE public.organizations
   SET feature_flags = feature_flags - 'lista_fria'
 WHERE feature_flags ? 'lista_fria';
DELETE FROM public.lead_origins WHERE slug = 'lista_fria' AND organization_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.origin = 'lista_fria' AND l.organization_id = lead_origins.organization_id);

COMMIT;
