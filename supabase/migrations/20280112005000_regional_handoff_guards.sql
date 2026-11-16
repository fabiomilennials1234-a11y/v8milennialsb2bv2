-- Check every newly introduced owner path, not just the preferred owner slot.
CREATE FUNCTION private.regional_validate_handoff(p_org uuid,p_lead uuid,p_new uuid[],p_old uuid[],p_entry_scope boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.regional_sales_config%ROWTYPE; d jsonb; owner_id uuid;
BEGIN
 SELECT * INTO c FROM private.regional_sales_config WHERE organization_id=p_org AND routing_enabled;
 IF NOT FOUND OR (NOT p_entry_scope AND NOT EXISTS(SELECT 1 FROM public.pipeline_entries e WHERE e.organization_id=p_org AND e.lead_id=p_lead AND e.pipeline_id=ANY(c.pipeline_ids))) THEN RETURN; END IF;
 FOR owner_id IN SELECT DISTINCT x FROM unnest(p_new) x WHERE x IS NOT NULL AND x<>c.triage_member_id AND NOT EXISTS(SELECT 1 FROM unnest(p_old) old_id WHERE old_id=x) LOOP
   d:=private.regional_contact_data(p_lead);
   IF NOT private.regional_valid_cnpj(d->>'cnpj') OR NOT EXISTS(SELECT 1 FROM private.regional_sales_cities ci WHERE ci.uf=upper(btrim(d->>'uf')) AND ci.city_key=private.regional_normalize(d->>'city')) THEN
     RAISE EXCEPTION 'Informe CNPJ válido, cidade e UF antes de encaminhar ao representante' USING ERRCODE='23514';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.team_members WHERE id=owner_id AND organization_id=p_org AND is_active) THEN RAISE EXCEPTION 'Representante indisponível' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.regional_assignment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF ROW(NEW.pre_sale_responsible_id,NEW.sale_responsible_id,NEW.sdr_id,NEW.closer_id,NEW.responsible_id,NEW.responsible_user_id) IS NOT DISTINCT FROM ROW(OLD.pre_sale_responsible_id,OLD.sale_responsible_id,OLD.sdr_id,OLD.closer_id,OLD.responsible_id,OLD.responsible_user_id) THEN RETURN NEW; END IF;
 PERFORM private.regional_validate_handoff(NEW.organization_id,NEW.id,
 ARRAY[NEW.pre_sale_responsible_id,NEW.sale_responsible_id,NEW.sdr_id,NEW.closer_id,NEW.responsible_id,NEW.responsible_user_id],
 ARRAY[OLD.pre_sale_responsible_id,OLD.sale_responsible_id,OLD.sdr_id,OLD.closer_id,OLD.responsible_id,OLD.responsible_user_id]);
 RETURN NEW;
END $$;

CREATE FUNCTION private.regional_entry_assignment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_ids uuid[]; new_ids uuid[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.regional_sales_config c WHERE c.organization_id=NEW.organization_id AND c.routing_enabled AND NEW.pipeline_id=ANY(c.pipeline_ids)) THEN RETURN NEW; END IF;
 SELECT ARRAY[l.pre_sale_responsible_id,l.sale_responsible_id,l.sdr_id,l.closer_id,l.responsible_id,l.responsible_user_id] INTO old_ids FROM public.leads l WHERE l.id=NEW.lead_id AND l.organization_id=NEW.organization_id;
 IF TG_OP='UPDATE' AND OLD.lead_id=NEW.lead_id AND OLD.organization_id=NEW.organization_id THEN
   old_ids:=old_ids||ARRAY[OLD.assigned_to]||ARRAY(SELECT value::uuid FROM jsonb_each_text(coalesce(OLD.metadata,'{}')) WHERE key IN('pre_sale_responsible_id','sale_responsible_id','sdr_id','closer_id','responsible_id') AND value~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
 END IF;
 new_ids:=ARRAY[NEW.assigned_to]||ARRAY(SELECT value::uuid FROM jsonb_each_text(coalesce(NEW.metadata,'{}')) WHERE key IN('pre_sale_responsible_id','sale_responsible_id','sdr_id','closer_id','responsible_id') AND value~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
 PERFORM private.regional_validate_handoff(NEW.organization_id,NEW.lead_id,new_ids,coalesce(old_ids,'{}'),true);
 RETURN NEW;
END $$;
CREATE TRIGGER regional_entry_assignment_guard BEFORE INSERT OR UPDATE OF assigned_to,metadata,lead_id,pipeline_id ON public.pipeline_entries FOR EACH ROW EXECUTE FUNCTION private.regional_entry_assignment_guard();

CREATE FUNCTION private.regional_coowner_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.role='co' THEN
   PERFORM private.regional_validate_handoff(NEW.organization_id,NEW.lead_id,ARRAY[NEW.team_member_id],CASE WHEN TG_OP='UPDATE' AND OLD.role='co' AND OLD.lead_id=NEW.lead_id AND OLD.organization_id=NEW.organization_id THEN ARRAY[OLD.team_member_id] ELSE '{}'::uuid[] END);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER regional_coowner_guard BEFORE INSERT OR UPDATE ON public.lead_owners FOR EACH ROW EXECUTE FUNCTION private.regional_coowner_guard();

-- Manual handoffs and other trusted workflows must give the new representative
-- a fresh response window too, even before another inbound message arrives.
CREATE FUNCTION private.regional_owner_clock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_owner uuid:=coalesce(NEW.sale_responsible_id,NEW.closer_id,NEW.pre_sale_responsible_id,NEW.sdr_id,NEW.responsible_id);
 previous_owner uuid:=coalesce(OLD.sale_responsible_id,OLD.closer_id,OLD.pre_sale_responsible_id,OLD.sdr_id,OLD.responsible_id);
BEGIN
 IF current_owner IS NOT DISTINCT FROM previous_owner OR NOT EXISTS(SELECT 1 FROM private.regional_sales_config c WHERE c.organization_id=NEW.organization_id AND c.routing_enabled) THEN RETURN NEW; END IF;
 UPDATE private.regional_sales_state SET assigned_to=current_owner,assigned_at=now(),awaiting_since=CASE WHEN awaiting_since IS NOT NULL THEN greatest(awaiting_since,now()) END,updated_at=now() WHERE lead_id=NEW.id AND organization_id=NEW.organization_id;
 RETURN NEW;
END $$;
CREATE TRIGGER regional_owner_clock AFTER UPDATE OF sale_responsible_id,closer_id,pre_sale_responsible_id,sdr_id,responsible_id ON public.leads FOR EACH ROW EXECUTE FUNCTION private.regional_owner_clock();
REVOKE ALL ON FUNCTION private.regional_validate_handoff(uuid,uuid,uuid[],uuid[],boolean),private.regional_entry_assignment_guard(),private.regional_coowner_guard(),private.regional_owner_clock() FROM PUBLIC,anon,authenticated;
