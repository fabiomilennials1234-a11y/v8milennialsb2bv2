-- Additive; runtime stays disabled until a valid template has been configured.
ALTER TABLE public.copilot_agents
 ADD COLUMN IF NOT EXISTS can_generate_order_request boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS order_request_config jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE public.copilot_quote_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 agent_id uuid NOT NULL REFERENCES public.copilot_agents(id),
 name text NOT NULL,
 file_path text NOT NULL UNIQUE,
 sha256 text NOT NULL CHECK (length(sha256)=64),
 fields jsonb NOT NULL CHECK (jsonb_typeof(fields)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (organization_id, agent_id, id)
);
CREATE TABLE public.copilot_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 agent_id uuid NOT NULL REFERENCES public.copilot_agents(id),
 lead_id uuid NOT NULL REFERENCES public.leads(id),
 conversation_id uuid NOT NULL REFERENCES public.conversations(id),
 template_id uuid NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_confirmation','generating','ready','sending','sent','failed','reconcile','canceled')),
 data jsonb NOT NULL DEFAULT '{}'::jsonb,
 required_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
 convert_to_pdf boolean NOT NULL DEFAULT false,
 confirmation_code text,
 confirmed_at timestamptz,
 file_path text,
 file_name text,
 provider_message_id text,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (organization_id,agent_id,template_id) REFERENCES public.copilot_quote_templates(organization_id,agent_id,id)
);
-- One in-flight order; completed orders remain immutable and a new one can follow.
CREATE UNIQUE INDEX copilot_quotes_one_open ON public.copilot_quotes(organization_id,agent_id,conversation_id)
 WHERE status NOT IN ('sent','canceled');
CREATE INDEX copilot_quote_templates_org ON public.copilot_quote_templates(organization_id,agent_id);
CREATE INDEX copilot_quotes_org ON public.copilot_quotes(organization_id,lead_id);
ALTER TABLE public.copilot_quote_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.copilot_quote_templates,public.copilot_quotes FROM anon,authenticated;
GRANT ALL ON public.copilot_quote_templates,public.copilot_quotes TO service_role;
-- Customer documents are never exposed via the general KB or tenant-wide SELECT.
-- Authenticated users access templates/previews via the permission-checked API.

CREATE FUNCTION public.validate_copilot_quote_scope() RETURNS trigger
 LANGUAGE plpgsql SET search_path = public,pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.copilot_agents a WHERE a.id=NEW.agent_id AND a.organization_id=NEW.organization_id) THEN
   RAISE EXCEPTION 'quote_agent_scope';
 END IF;
 IF TG_TABLE_NAME='copilot_quotes' THEN
   IF TG_OP='UPDATE' AND (NEW.lead_id<>OLD.lead_id OR NEW.conversation_id<>OLD.conversation_id OR OLD.status IN ('sent','canceled')) THEN
     RAISE EXCEPTION 'quote_revision_immutable';
   END IF;
   IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id=NEW.lead_id AND l.organization_id=NEW.organization_id)
     OR NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.id=NEW.conversation_id AND c.organization_id=NEW.organization_id AND c.lead_id=NEW.lead_id AND c.agent_id=NEW.agent_id) THEN
     RAISE EXCEPTION 'quote_conversation_scope';
   END IF;
   NEW.updated_at=now();
 END IF;
 IF TG_OP='UPDATE' AND (NEW.organization_id<>OLD.organization_id OR NEW.agent_id<>OLD.agent_id) THEN
   RAISE EXCEPTION 'quote_scope_immutable';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_copilot_quote_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_copilot_quote_scope() TO service_role;
CREATE TRIGGER copilot_quote_templates_scope BEFORE INSERT OR UPDATE ON public.copilot_quote_templates FOR EACH ROW EXECUTE FUNCTION public.validate_copilot_quote_scope();
CREATE TRIGGER copilot_quotes_scope BEFORE INSERT OR UPDATE ON public.copilot_quotes FOR EACH ROW EXECUTE FUNCTION public.validate_copilot_quote_scope();

-- Transactional audit: edits and delivery state changes never erase old revisions.
CREATE TABLE public.copilot_quote_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 quote_id uuid NOT NULL REFERENCES public.copilot_quotes(id),
 revision integer NOT NULL,
 status text NOT NULL,
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX copilot_quote_events_quote ON public.copilot_quote_events(organization_id,quote_id,created_at);
ALTER TABLE public.copilot_quote_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.copilot_quote_events FROM anon,authenticated;
GRANT SELECT,INSERT ON public.copilot_quote_events TO service_role;
CREATE FUNCTION public.audit_copilot_quote() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.copilot_quote_events(organization_id,quote_id,revision,status,snapshot)
 VALUES(NEW.organization_id,NEW.id,NEW.revision,NEW.status,to_jsonb(NEW));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_copilot_quote() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_copilot_quote() TO service_role;
CREATE TRIGGER copilot_quote_audit AFTER INSERT OR UPDATE ON public.copilot_quotes FOR EACH ROW EXECUTE FUNCTION public.audit_copilot_quote();

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('copilot-quotes','copilot-quotes',false,5242880,ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='copilot-quotes' AND public) THEN
  RAISE EXCEPTION 'quote_bucket_must_be_private';
 END IF;
END $$;
-- Restrictive defense against broad permissive policies installed by other features.
-- Does not change access to any existing bucket. service_role bypasses RLS.
CREATE POLICY copilot_quotes_api_only ON storage.objects AS RESTRICTIVE
 FOR ALL TO anon,authenticated
 USING (bucket_id <> 'copilot-quotes')
 WITH CHECK (bucket_id <> 'copilot-quotes');
