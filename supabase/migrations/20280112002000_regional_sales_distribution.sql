-- Regional routing is transactional. No frontend filter grants chat access.
ALTER TABLE private.regional_sales_config ADD COLUMN routing_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE private.regional_sales_cities (
  uf text NOT NULL, city_key text NOT NULL, name text NOT NULL, ibge_id integer,
  PRIMARY KEY(uf,city_key)
);
CREATE TABLE private.regional_sales_routes (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  uf text NOT NULL, member_ids uuid[] NOT NULL, last_member_id uuid,
  remote_cities text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY(organization_id,uf)
);
CREATE TABLE private.regional_sales_state (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id),
  assigned_to uuid REFERENCES public.team_members(id), assigned_at timestamptz,
  awaiting_since timestamptz, last_inbound_at timestamptz, last_human_reply_at timestamptz,
  status text NOT NULL DEFAULT 'pending', reason text, qualified_at timestamptz,
  keep_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.regional_sales_assignment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  lead_id uuid NOT NULL, previous_member_id uuid, assigned_to uuid, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.regional_sales_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.regional_sales_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.regional_sales_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.regional_sales_assignment_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.regional_sales_cities,private.regional_sales_routes,private.regional_sales_state,private.regional_sales_assignment_log FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.regional_sales_cities,private.regional_sales_routes,private.regional_sales_state,private.regional_sales_assignment_log TO service_role;

CREATE FUNCTION private.regional_normalize(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT btrim(regexp_replace(translate(lower(coalesce(p,'')),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[^a-z0-9]+',' ','g'))
$$;
-- Receita Federal's ASCII-48 algorithm supports numeric and alphanumeric CNPJ.
-- This checks format/check digits, not registration status at Receita Federal.
CREATE FUNCTION private.regional_valid_cnpj(p text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE d text:=regexp_replace(upper(coalesce(p,'')),'[./[:space:]-]','','g'); n integer; i integer; w integer; s integer; dv integer;
BEGIN
 IF d !~ '^[A-Z0-9]{12}[0-9]{2}$' OR d ~ '^([0-9])\1{13}$' THEN RETURN false; END IF;
 FOR n IN 12..13 LOOP
   s:=0; w:=n-7;
   FOR i IN 1..n LOOP s:=s+(ascii(substr(d,i,1))-48)*w; w:=CASE WHEN w=2 THEN 9 ELSE w-1 END; END LOOP;
   dv:=CASE WHEN s%11<2 THEN 0 ELSE 11-s%11 END;
   IF dv<>substr(d,n+1,1)::integer THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION private.regional_work_minutes(p_from timestamptz,p_to timestamptz,p_org uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH cfg AS (SELECT * FROM private.regional_sales_config WHERE organization_id=p_org),
 days AS (SELECT d::date d,c.* FROM cfg c CROSS JOIN LATERAL generate_series((p_from AT TIME ZONE c.timezone)::date,(p_to AT TIME ZONE c.timezone)::date,interval '1 day') d),
 windows AS (
   SELECT (d+work_start) AT TIME ZONE timezone a,(d+coalesce(break_start,work_end)) AT TIME ZONE timezone b FROM days WHERE extract(isodow FROM d)::int=ANY(work_days)
   UNION ALL SELECT (d+break_end) AT TIME ZONE timezone,(d+work_end) AT TIME ZONE timezone FROM days WHERE break_end IS NOT NULL AND extract(isodow FROM d)::int=ANY(work_days)
 ) SELECT coalesce(sum(greatest(0,extract(epoch FROM least(p_to,b)-greatest(p_from,a))/60)),0) FROM windows WHERE p_to>p_from
$$;

CREATE FUNCTION private.regional_pending_task(p_org uuid,p_lead uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.regional_sales_config%ROWTYPE;
BEGIN
 SELECT * INTO c FROM private.regional_sales_config WHERE organization_id=p_org;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('regional-task:'||p_lead::text,0));
 IF NOT EXISTS (SELECT 1 FROM public.follow_ups WHERE organization_id=p_org AND lead_id=p_lead AND title='JRTex: recuperar ou revisar atendimento' AND completed_at IS NULL AND archived_at IS NULL) THEN
   INSERT INTO public.follow_ups(organization_id,lead_id,assigned_to,title,description,due_date,is_automated,priority)
   VALUES(p_org,p_lead,c.triage_member_id,'JRTex: recuperar ou revisar atendimento',p_reason,now(),true,'high');
 END IF;
END $$;

CREATE FUNCTION private.regional_contact_data(p_lead uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('city',coalesce(max(v.value) FILTER(WHERE f.field_name='cidade'),max(v.value) FILTER(WHERE f.field_name='Cidade.')),
   'uf',coalesce(max(nullif(btrim(v.value),'')) FILTER(WHERE f.field_name='jrtex_estado'),CASE WHEN l.uf_source IS DISTINCT FROM 'ddd' THEN btrim(l.uf) END),
   'cnpj',max(v.value) FILTER(WHERE f.field_name='cnpj'))
 FROM public.leads l LEFT JOIN public.lead_custom_fields f ON f.organization_id=l.organization_id AND f.field_name IN ('cidade','Cidade.','jrtex_estado','cnpj')
 LEFT JOIN public.lead_custom_field_values v ON v.field_id=f.id AND v.lead_id=l.id WHERE l.id=p_lead GROUP BY l.uf,l.uf_source
$$;

CREATE FUNCTION private.regional_set_owner(p_org uuid,p_lead uuid,p_member uuid,p_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.leads SET pre_sale_responsible_id=p_member,sale_responsible_id=p_member,sdr_id=p_member,closer_id=p_member,responsible_id=p_member,responsible_user_id=p_member,updated_at=p_at WHERE id=p_lead AND organization_id=p_org;
 UPDATE public.pipeline_entries SET assigned_to=p_member,metadata=(coalesce(metadata,'{}'::jsonb)-ARRAY['pre_sale_responsible_id','sale_responsible_id','sdr_id','closer_id','responsible_id'])||jsonb_build_object('pre_sale_responsible_id',p_member,'sale_responsible_id',p_member,'sdr_id',p_member,'closer_id',p_member,'responsible_id',p_member),updated_at=p_at WHERE lead_id=p_lead AND organization_id=p_org;
 DELETE FROM public.lead_owners WHERE lead_id=p_lead AND organization_id=p_org AND team_member_id<>p_member;
 UPDATE public.deals SET owner_id=p_member WHERE source_lead_id=p_lead AND organization_id=p_org AND deleted_at IS NULL AND outcome IS NULL;
END $$;

CREATE FUNCTION private.regional_status(p_org uuid,p_lead uuid,p_status text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.lead_custom_field_values(lead_id,field_id,value)
 SELECT p_lead,id,p_status FROM public.lead_custom_fields WHERE organization_id=p_org AND field_name='jrtex_status'
 ON CONFLICT(lead_id,field_id) DO UPDATE SET value=EXCLUDED.value,updated_at=now()
$$;

CREATE FUNCTION private.regional_assign(p_lead uuid,p_redistribute boolean DEFAULT false,p_at timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.leads%ROWTYPE; c private.regional_sales_config%ROWTYPE; s private.regional_sales_state%ROWTYPE;
 d jsonb; v_uf text; members uuid[]; chosen uuid; previous uuid; last_id uuid; pos integer; why text;
BEGIN
 SELECT * INTO l FROM public.leads WHERE id=p_lead FOR UPDATE;
 IF NOT FOUND OR l.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('status','ignored'); END IF;
 SELECT * INTO c FROM private.regional_sales_config WHERE organization_id=l.organization_id AND routing_enabled;
 IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.pipeline_entries e WHERE e.organization_id=l.organization_id AND e.lead_id=l.id AND e.pipeline_id=ANY(c.pipeline_ids)) THEN RETURN jsonb_build_object('status','ignored'); END IF;
 INSERT INTO private.regional_sales_state(organization_id,lead_id) VALUES(l.organization_id,l.id) ON CONFLICT(lead_id) DO NOTHING;
 SELECT * INTO s FROM private.regional_sales_state WHERE lead_id=l.id FOR UPDATE;
 previous:=coalesce(l.sale_responsible_id,l.closer_id,l.pre_sale_responsible_id,l.sdr_id,l.responsible_id);
 -- A representative may supply missing data but cannot grant ownership. The
 -- trusted worker processes that queued qualification under the existing guard.
 IF auth.uid() IS NOT NULL AND coalesce(auth.role(),'')<>'service_role' AND NOT EXISTS(SELECT 1 FROM public.team_members t WHERE t.organization_id=l.organization_id AND t.user_id=auth.uid() AND t.is_active AND t.role='admin') THEN
   RETURN jsonb_build_object('status','queued');
 END IF;
 -- A return or new qualification must not silently take an existing portfolio.
 IF previous IS NOT NULL AND previous<>c.triage_member_id AND NOT p_redistribute AND (s.qualified_at IS NOT NULL OR l.created_at<c.enabled_at) THEN
   UPDATE private.regional_sales_state SET assigned_to=previous,assigned_at=coalesce(assigned_at,p_at),status='assigned',updated_at=p_at WHERE lead_id=l.id;
   RETURN jsonb_build_object('status','preserved','assigned_to',previous);
 END IF;
 IF p_redistribute THEN
   IF s.awaiting_since IS NULL OR previous IS NULL OR s.assigned_to IS DISTINCT FROM previous OR private.regional_work_minutes(s.awaiting_since,p_at,l.organization_id)<c.response_minutes THEN RETURN jsonb_build_object('status','not_due'); END IF;
   IF s.keep_owner OR EXISTS(SELECT 1 FROM public.sale_events e WHERE e.organization_id=l.organization_id AND e.lead_id=l.id AND e.event_type='sale' AND NOT EXISTS(SELECT 1 FROM public.sale_events r WHERE r.reversed_event_id=e.id AND r.event_type='sale_reversed'))
      OR EXISTS(SELECT 1 FROM public.deals de JOIN public.pipeline_entries pe ON pe.deal_id=de.id AND pe.organization_id=l.organization_id JOIN public.pipeline_stages st ON st.id=pe.stage_id
        WHERE de.organization_id=l.organization_id AND de.source_lead_id=l.id AND de.deleted_at IS NULL AND de.outcome IS NULL AND pe.pipeline_id=ANY(c.pipeline_ids) AND (st.stage_role IN ('proposal','negotiation') OR private.regional_normalize(st.name) ~ '(proposta|orcamento|negocia)')) THEN
     PERFORM private.regional_pending_task(l.organization_id,l.id,'Cliente com pedido ou negociação ativa: revisar demora sem trocar o representante.');
     UPDATE private.regional_sales_state SET awaiting_since=NULL,updated_at=p_at WHERE lead_id=l.id;
     RETURN jsonb_build_object('status','protected');
   END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.pipeline_entries e WHERE e.lead_id=l.id AND e.organization_id=l.organization_id AND NOT(e.pipeline_id=ANY(c.pipeline_ids))) THEN
   PERFORM private.regional_pending_task(l.organization_id,l.id,'Contato participa de outros funis: revisar responsável antes de redistribuir.');
   UPDATE private.regional_sales_state SET status='review',awaiting_since=NULL,updated_at=p_at WHERE lead_id=l.id;
   RETURN jsonb_build_object('status','shared_portfolio');
 END IF;
 d:=private.regional_contact_data(l.id); v_uf:=upper(btrim(d->>'uf'));
 IF NOT private.regional_valid_cnpj(d->>'cnpj') THEN why:='Informe um CNPJ válido antes do encaminhamento.';
 ELSIF nullif(btrim(d->>'city'),'') IS NULL OR nullif(v_uf,'') IS NULL THEN why:='Aguardando cidade e UF confirmadas.';
 ELSIF NOT EXISTS(SELECT 1 FROM private.regional_sales_cities ci WHERE ci.uf=v_uf AND ci.city_key=private.regional_normalize(d->>'city')) THEN why:='Cidade e UF não reconhecidas: revisar cobertura.'; END IF;
 IF why IS NOT NULL THEN
   -- Karine needs explicit ownership to see recovery tasks and the pending chat.
   -- Qualification is mandatory for a representative, not for the factory's triage.
   IF previous IS DISTINCT FROM c.triage_member_id THEN
     PERFORM private.regional_set_owner(l.organization_id,l.id,c.triage_member_id,p_at);
     INSERT INTO private.regional_sales_assignment_log(organization_id,lead_id,previous_member_id,assigned_to,reason) VALUES(l.organization_id,l.id,previous,c.triage_member_id,why);
   END IF;
   UPDATE private.regional_sales_state SET assigned_to=c.triage_member_id,status='pending',reason=why,updated_at=p_at WHERE lead_id=l.id;
   PERFORM private.regional_status(l.organization_id,l.id,why);
   IF p_redistribute OR why LIKE 'Cidade e UF%' THEN PERFORM private.regional_pending_task(l.organization_id,l.id,why); END IF;
   RETURN jsonb_build_object('status','pending','reason',why);
 END IF;
 UPDATE public.leads SET uf=v_uf,uf_source='manual' WHERE id=l.id AND (uf IS DISTINCT FROM v_uf OR uf_source='ddd');
 IF EXISTS(SELECT 1 FROM private.regional_sales_routes r WHERE r.organization_id=l.organization_id AND r.uf=v_uf AND private.regional_normalize(d->>'city')=ANY(r.remote_cities)) THEN
   INSERT INTO public.lead_tags(lead_id,tag_id) SELECT l.id,t.id FROM public.tags t WHERE t.organization_id=l.organization_id AND t.name='Atendimento remoto'
     AND NOT EXISTS(SELECT 1 FROM public.lead_tags lt WHERE lt.lead_id=l.id AND lt.tag_id=t.id);
 END IF;
 IF previous IS NOT NULL AND previous<>c.triage_member_id AND NOT p_redistribute THEN
   UPDATE private.regional_sales_state SET assigned_to=previous,assigned_at=coalesce(assigned_at,p_at),status='assigned',qualified_at=p_at,updated_at=p_at WHERE lead_id=l.id;
   RETURN jsonb_build_object('status','preserved','assigned_to',previous);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('regional-route:'||l.organization_id::text||':'||v_uf,0));
 SELECT array_agg(t.id ORDER BY x.ordinality),r.last_member_id INTO members,last_id
 FROM private.regional_sales_routes r CROSS JOIN LATERAL unnest(r.member_ids) WITH ORDINALITY x(id,ordinality)
 JOIN public.team_members t ON t.id=x.id AND t.organization_id=r.organization_id AND t.is_active AND t.role<>'admin'
 WHERE r.organization_id=l.organization_id AND r.uf=v_uf GROUP BY r.last_member_id;
 IF coalesce(cardinality(members),0)=0 THEN chosen:=c.triage_member_id; why:='Região sem representante ativo: atendimento da fábrica.';
 ELSE
   pos:=coalesce(array_position(members,last_id),0);
   chosen:=members[(pos%cardinality(members))+1];
   IF p_redistribute AND chosen=previous THEN chosen:=members[((pos+1)%cardinality(members))+1]; END IF;
   IF p_redistribute AND chosen=previous THEN chosen:=c.triage_member_id; END IF;
   why:=CASE WHEN chosen=c.triage_member_id THEN 'Sem outro representante elegível: triagem da fábrica.' WHEN p_redistribute THEN 'Representante sem resposta por 3 horas úteis.' ELSE 'Distribuição regional sequencial.' END;
   IF chosen<>c.triage_member_id THEN UPDATE private.regional_sales_routes SET last_member_id=chosen WHERE organization_id=l.organization_id AND uf=v_uf; END IF;
 END IF;
 -- Clear EVERY old ownership path used by restrictive RLS, atomically.
 PERFORM private.regional_set_owner(l.organization_id,l.id,chosen,p_at);
 UPDATE private.regional_sales_state SET assigned_to=chosen,assigned_at=p_at,awaiting_since=CASE WHEN awaiting_since IS NOT NULL AND previous IS DISTINCT FROM chosen THEN greatest(awaiting_since,p_at) ELSE awaiting_since END,status=CASE WHEN chosen=c.triage_member_id THEN 'triage' ELSE 'assigned' END,reason=why,qualified_at=coalesce(qualified_at,p_at),updated_at=p_at WHERE lead_id=l.id;
 PERFORM private.regional_status(l.organization_id,l.id,CASE WHEN chosen=c.triage_member_id THEN 'Atendimento da fábrica' ELSE 'Encaminhado ao representante' END);
 INSERT INTO private.regional_sales_assignment_log(organization_id,lead_id,previous_member_id,assigned_to,reason) VALUES(l.organization_id,l.id,previous,chosen,why);
 IF chosen=c.triage_member_id THEN PERFORM private.regional_pending_task(l.organization_id,l.id,why); END IF;
 RETURN jsonb_build_object('status',CASE WHEN chosen=c.triage_member_id THEN 'triage' ELSE 'assigned' END,'assigned_to',chosen);
END $$;

-- Enforce qualification for every future handoff, including legacy workflows.
CREATE FUNCTION private.regional_assignment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.regional_sales_config%ROWTYPE; d jsonb; owner_id uuid;
BEGIN
 IF ROW(NEW.pre_sale_responsible_id,NEW.sale_responsible_id,NEW.sdr_id,NEW.closer_id,NEW.responsible_id) IS NOT DISTINCT FROM ROW(OLD.pre_sale_responsible_id,OLD.sale_responsible_id,OLD.sdr_id,OLD.closer_id,OLD.responsible_id) THEN RETURN NEW; END IF;
 SELECT * INTO c FROM private.regional_sales_config WHERE organization_id=NEW.organization_id AND routing_enabled;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.pipeline_entries e WHERE e.lead_id=NEW.id AND e.organization_id=NEW.organization_id AND e.pipeline_id=ANY(c.pipeline_ids)) THEN RETURN NEW; END IF;
 owner_id:=coalesce(NEW.sale_responsible_id,NEW.closer_id,NEW.pre_sale_responsible_id,NEW.sdr_id,NEW.responsible_id);
 IF owner_id IS NULL OR owner_id=c.triage_member_id THEN RETURN NEW; END IF;
 d:=private.regional_contact_data(NEW.id);
 IF NOT private.regional_valid_cnpj(d->>'cnpj') OR NOT EXISTS(SELECT 1 FROM private.regional_sales_cities ci WHERE ci.uf=upper(btrim(d->>'uf')) AND ci.city_key=private.regional_normalize(d->>'city')) THEN
   RAISE EXCEPTION 'Informe CNPJ válido, cidade e UF antes de encaminhar ao representante' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.team_members WHERE id=owner_id AND organization_id=NEW.organization_id AND is_active) THEN RAISE EXCEPTION 'Representante indisponível' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER regional_assignment_guard BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION private.regional_assignment_guard();

CREATE FUNCTION private.regional_message_sla() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.regional_sales_config%ROWTYPE; owner_id uuid; at_time timestamptz;
BEGIN
 IF NEW.lead_id IS NULL OR coalesce(NEW.is_group,false) OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 SELECT * INTO c FROM private.regional_sales_config WHERE organization_id=NEW.organization_id AND instance_id=NEW.instance_id AND routing_enabled;
 IF NOT FOUND THEN RETURN NEW; END IF;
 at_time:=coalesce(NEW.timestamp,NEW.created_at);
 -- History imports and old webhook replays do not start a fresh SLA.
 IF at_time<c.enabled_at OR (NEW.direction='incoming' AND at_time<now()-interval '10 minutes') OR at_time>now()+interval '5 minutes' THEN RETURN NEW; END IF;
 SELECT coalesce(sale_responsible_id,closer_id,pre_sale_responsible_id,sdr_id,responsible_id) INTO owner_id FROM public.leads WHERE id=NEW.lead_id AND organization_id=NEW.organization_id AND deleted_at IS NULL;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.pipeline_entries e WHERE e.lead_id=NEW.lead_id AND e.organization_id=NEW.organization_id AND e.pipeline_id=ANY(c.pipeline_ids)) THEN RETURN NEW; END IF;
 INSERT INTO private.regional_sales_state(organization_id,lead_id,assigned_to,assigned_at) VALUES(NEW.organization_id,NEW.lead_id,owner_id,at_time) ON CONFLICT(lead_id) DO NOTHING;
 IF NEW.direction='incoming' THEN
   UPDATE private.regional_sales_state SET awaiting_since=CASE WHEN last_human_reply_at IS NULL OR at_time>last_human_reply_at THEN coalesce(awaiting_since,at_time) ELSE awaiting_since END,last_inbound_at=greatest(last_inbound_at,at_time),assigned_to=owner_id,updated_at=now() WHERE lead_id=NEW.lead_id;
 ELSIF NEW.direction='outgoing' AND NOT coalesce(NEW.sent_by_ai,false) AND (NEW.sent_by_team_member_id IS NULL OR NEW.sent_by_team_member_id=owner_id) AND NEW.sent_source='manual' AND coalesce(NEW.status,'') IN ('sent','delivered','read') THEN
   UPDATE private.regional_sales_state SET last_human_reply_at=greatest(last_human_reply_at,at_time),awaiting_since=CASE WHEN last_inbound_at IS NULL OR at_time>=last_inbound_at THEN NULL ELSE awaiting_since END,updated_at=now() WHERE lead_id=NEW.lead_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER regional_message_sla AFTER INSERT OR UPDATE OF status,sent_by_team_member_id,sent_source ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION private.regional_message_sla();

CREATE FUNCTION private.regional_custom_field_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.lead_custom_fields f JOIN private.regional_sales_config c ON c.organization_id=f.organization_id WHERE f.id=NEW.field_id AND f.field_name IN ('cidade','Cidade.','cnpj','jrtex_estado')) THEN
   PERFORM private.regional_assign(NEW.lead_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER regional_custom_field_changed AFTER INSERT OR UPDATE OF value ON public.lead_custom_field_values FOR EACH ROW EXECUTE FUNCTION private.regional_custom_field_changed();

CREATE FUNCTION private.regional_entry_created() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.lead_id IS NOT NULL AND EXISTS(SELECT 1 FROM private.regional_sales_config c WHERE c.organization_id=NEW.organization_id AND NEW.pipeline_id=ANY(c.pipeline_ids)) THEN
   PERFORM private.regional_assign(NEW.lead_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER regional_entry_created AFTER INSERT ON public.pipeline_entries FOR EACH ROW EXECUTE FUNCTION private.regional_entry_created();

-- Capture only explicit UF and a single matching city in that UF. DDD never qualifies.
CREATE FUNCTION private.regional_capture_contact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.regional_sales_config%ROWTYPE; normalized text; state_codes text[]; city text; cities text[]; taxes text[]; tax text; f record; val text;
BEGIN
 IF NEW.direction<>'incoming' OR NEW.lead_id IS NULL OR coalesce(NEW.is_group,false) OR nullif(NEW.content,'') IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO c FROM private.regional_sales_config WHERE organization_id=NEW.organization_id AND instance_id=NEW.instance_id AND routing_enabled;
 IF NOT FOUND OR coalesce(NEW.timestamp,NEW.created_at)<c.enabled_at OR coalesce(NEW.timestamp,NEW.created_at)<now()-interval '10 minutes' THEN RETURN NEW; END IF;
 normalized:=private.regional_normalize(NEW.content);
 SELECT array_agg(DISTINCT upper(m[1])) INTO state_codes FROM regexp_matches(normalized,'\m(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)\M','g') m;
 IF cardinality(state_codes)=1 THEN
   SELECT array_agg(ci.name) INTO cities FROM private.regional_sales_cities ci WHERE ci.uf=state_codes[1] AND strpos(' '||normalized||' ',' '||ci.city_key||' ')>0
     AND NOT EXISTS(SELECT 1 FROM private.regional_sales_cities longer WHERE longer.uf=ci.uf AND length(longer.city_key)>length(ci.city_key) AND strpos(' '||longer.city_key||' ',' '||ci.city_key||' ')>0 AND strpos(' '||normalized||' ',' '||longer.city_key||' ')>0);
   IF cardinality(cities)=1 THEN city:=cities[1]; END IF;
 END IF;
 SELECT array_agg(DISTINCT m[1]) INTO taxes FROM regexp_matches(upper(NEW.content),'\m([A-Z0-9]{2}[.]?[A-Z0-9]{3}[.]?[A-Z0-9]{3}[/]?[A-Z0-9]{4}[-]?[0-9]{2})\M','g') m WHERE private.regional_valid_cnpj(m[1]);
 IF cardinality(taxes)=1 THEN tax:=taxes[1]; END IF;
 FOR f IN SELECT id,field_name FROM public.lead_custom_fields WHERE organization_id=NEW.organization_id AND field_name IN ('cidade','jrtex_estado','cnpj') LOOP
   val:=CASE f.field_name WHEN 'cidade' THEN city WHEN 'jrtex_estado' THEN CASE WHEN cardinality(state_codes)=1 THEN state_codes[1] END WHEN 'cnpj' THEN tax END;
   IF val IS NOT NULL THEN
     INSERT INTO public.lead_custom_field_values(lead_id,field_id,value) VALUES(NEW.lead_id,f.id,val)
     ON CONFLICT(lead_id,field_id) DO UPDATE SET value=EXCLUDED.value,updated_at=now();
   END IF;
 END LOOP;
 PERFORM private.regional_assign(NEW.lead_id);
 RETURN NEW;
END $$;
CREATE TRIGGER regional_capture_contact AFTER INSERT ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION private.regional_capture_contact();

CREATE FUNCTION private.process_regional_sales() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x record; n integer:=0;
BEGIN
 FOR x IN SELECT s.lead_id FROM private.regional_sales_state s JOIN private.regional_sales_config c USING(organization_id) WHERE c.routing_enabled AND s.status='pending' ORDER BY s.updated_at LIMIT 100
 LOOP PERFORM private.regional_assign(x.lead_id); END LOOP;
 FOR x IN SELECT s.lead_id FROM private.regional_sales_state s JOIN private.regional_sales_config c USING(organization_id)
   WHERE c.routing_enabled AND s.awaiting_since IS NOT NULL AND s.assigned_to IS NOT NULL AND s.assigned_to<>c.triage_member_id
     AND private.regional_work_minutes(s.awaiting_since,now(),s.organization_id)>=c.response_minutes ORDER BY s.awaiting_since LIMIT 100
 LOOP PERFORM private.regional_assign(x.lead_id,true); n:=n+1; END LOOP;
 FOR x IN SELECT s.* FROM private.regional_sales_state s JOIN private.regional_sales_config c USING(organization_id) WHERE c.routing_enabled AND s.status='pending' AND s.created_at<now()-interval '24 hours'
   AND NOT EXISTS(SELECT 1 FROM public.follow_ups f WHERE f.organization_id=s.organization_id AND f.lead_id=s.lead_id AND f.title='JRTex: recuperar ou revisar atendimento' AND f.completed_at IS NULL AND f.archived_at IS NULL) ORDER BY s.created_at LIMIT 100
 LOOP PERFORM private.regional_pending_task(x.organization_id,x.lead_id,coalesce(x.reason,'Qualificação sem resposta por 24 horas.')); END LOOP;
 RETURN jsonb_build_object('reviewed',n);
END $$;

REVOKE ALL ON FUNCTION private.regional_normalize(text),private.regional_valid_cnpj(text),private.regional_work_minutes(timestamptz,timestamptz,uuid),private.regional_pending_task(uuid,uuid,text),private.regional_contact_data(uuid),private.regional_set_owner(uuid,uuid,uuid,timestamptz),private.regional_status(uuid,uuid,text),private.regional_assign(uuid,boolean,timestamptz),private.regional_assignment_guard(),private.regional_message_sla(),private.regional_custom_field_changed(),private.regional_entry_created(),private.regional_capture_contact(),private.process_regional_sales() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.regional_assign(uuid,boolean,timestamptz),private.process_regional_sales() TO service_role;
