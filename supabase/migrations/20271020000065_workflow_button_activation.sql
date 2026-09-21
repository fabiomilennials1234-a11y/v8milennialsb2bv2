-- Drafts may remain incomplete. Activation and edits of active definitions cannot bypass validation.
CREATE FUNCTION public.guard_workflow_button_activation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n jsonb; d jsonb; b jsonb; output text; asset jsonb; media_type text; extension text;
BEGIN
  IF NOT NEW.is_active THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.definition->'nodes') x
    WHERE x->>'type'='question_buttons' OR x#>>'{data,type}'='question_buttons') THEN RETURN NEW; END IF;
  IF NOT coalesce((SELECT feature_flags->'workflow_question_buttons'='true'::jsonb FROM public.organizations WHERE id=NEW.organization_id),false) THEN
    RAISE EXCEPTION 'Pergunta com botões não habilitada para organização' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.definition->'nodes') x WHERE jsonb_typeof(x->'id') IS DISTINCT FROM 'string' OR nullif(x->>'id','') IS NULL) OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.definition->'nodes') x GROUP BY x->>'id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Pergunta com botões: nodes precisam de identidades únicas' USING ERRCODE='23514';
  END IF;
  FOR n IN SELECT x FROM jsonb_array_elements(NEW.definition->'nodes') x WHERE x->>'type'='question_buttons' OR x#>>'{data,type}'='question_buttons' LOOP
    d:=n->'data';
    IF jsonb_typeof(d->'text') IS DISTINCT FROM 'string' OR nullif(btrim(d->>'text'),'') IS NULL OR jsonb_typeof(d->'buttons') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Pergunta com botões: preencha mensagem e opções' USING ERRCODE='23514';
    END IF;
    IF jsonb_array_length(d->'buttons') NOT BETWEEN 1 AND 3
      OR jsonb_typeof(coalesce(d->'timeoutHours','24'::jsonb)) IS DISTINCT FROM 'number'
      OR (coalesce(d->>'timeoutHours','24'))::numeric<=0 THEN
      RAISE EXCEPTION 'Pergunta com botões: use um a três botões e prazo positivo' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(d->'buttons') x GROUP BY x->>'id' HAVING count(*)>1)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(d->'buttons') x GROUP BY lower(btrim(x->>'label')) HAVING count(*)>1) THEN
      RAISE EXCEPTION 'Pergunta com botões: opções precisam de identidades e rótulos únicos' USING ERRCODE='23514';
    END IF;
    FOR b IN SELECT x FROM jsonb_array_elements(d->'buttons') x LOOP
      IF jsonb_typeof(b->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(b->'label') IS DISTINCT FROM 'string' OR coalesce(b->>'id','') !~ '^[A-Za-z0-9_-]+$' OR nullif(btrim(b->>'label'),'') IS NULL OR b->>'label' ~ '[|\r\n]' THEN
        RAISE EXCEPTION 'Pergunta com botões: opção inválida' USING ERRCODE='23514';
      END IF;
    END LOOP;
    FOR output IN SELECT 'button:'||(x->>'id') FROM jsonb_array_elements(d->'buttons') x
      UNION ALL SELECT unnest(ARRAY['other_response','timeout','send_failure']) LOOP
      IF (SELECT count(*) FROM jsonb_array_elements(NEW.definition->'edges') e WHERE e->>'source'=n->>'id' AND e->>'sourceHandle'=output)<>1
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.definition->'edges') e JOIN jsonb_array_elements(NEW.definition->'nodes') target ON target->>'id'=e->>'target'
          WHERE e->>'source'=n->>'id' AND e->>'sourceHandle'=output) THEN
        RAISE EXCEPTION 'Pergunta com botões: conecte uma saída válida para %',output USING ERRCODE='23514';
      END IF;
    END LOOP;
    IF d ? 'instanceId' AND (jsonb_typeof(d->'instanceId') IS DISTINCT FROM 'string' OR NOT EXISTS(
      SELECT 1 FROM public.whatsapp_instances i WHERE i.id::text=d->>'instanceId' AND i.organization_id=NEW.organization_id
        AND i.provider='uazapi' AND i.status IN ('open','connected'))) THEN
      RAISE EXCEPTION 'Pergunta com botões: selecione uma instância Uazapi disponível nesta organização' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM public.organizations WHERE id=NEW.organization_id AND whatsapp_provider_override='evolution') THEN
      RAISE EXCEPTION 'Pergunta com botões: provider efetivo precisa ser Uazapi' USING ERRCODE='23514';
    END IF;
    IF d ? 'image' THEN
      asset:=d->'image'; media_type:=asset->>'mimeType';
      extension:=CASE media_type WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/webp' THEN 'webp' END;
      IF asset->>'bucket' IS DISTINCT FROM 'workflow-question-images' OR extension IS NULL
        OR coalesce(asset->>'path','') !~ ('^'||NEW.organization_id::text||'/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.'||extension||'$')
        OR jsonb_typeof(asset->'sizeBytes') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Pergunta com botões: configure uma imagem privada desta organização' USING ERRCODE='23514';
      END IF;
      IF (asset->>'sizeBytes')::numeric NOT BETWEEN 1 AND 5242880 OR trunc((asset->>'sizeBytes')::numeric)<>(asset->>'sizeBytes')::numeric
        OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='workflow-question-images' AND o.name=asset->>'path'
          AND o.metadata->>'mimetype'=media_type AND o.metadata->'size'=asset->'sizeBytes') THEN
        RAISE EXCEPTION 'Pergunta com botões: imagem ausente ou incompatível; envie novamente' USING ERRCODE='23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_workflow_button_activation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_workflow_button_activation BEFORE INSERT OR UPDATE OF definition,is_active,organization_id ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.guard_workflow_button_activation();
