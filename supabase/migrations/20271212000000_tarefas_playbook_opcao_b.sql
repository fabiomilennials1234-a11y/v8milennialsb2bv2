-- Opção B (decisão de 04/10, migração aprovada em 21/10/2026).
-- Schema somente. A conversão dos modelos é executada pelo script de rollout
-- ou na primeira abertura da nova fila. Nunca cria tarefas para entradas antigas.
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE public.task_workspaces (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  activated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.task_playbook_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) >= 1),
  kind text NOT NULL DEFAULT 'task' CHECK (kind IN ('task','call','message','meeting')),
  instructions text NOT NULL DEFAULT '',
  message_template text NOT NULL DEFAULT '',
  due_days integer NOT NULL DEFAULT 0 CHECK (due_days BETWEEN 0 AND 365),
  required boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  enabled boolean NOT NULL DEFAULT true,
  source_checklist_item_id uuid,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  audience text NOT NULL DEFAULT 'owner' CHECK (audience IN ('owner','team','members')),
  member_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_id, source_checklist_item_id)
);
CREATE INDEX task_playbook_stage_idx ON public.task_playbook_activities(organization_id, stage_id) WHERE enabled;

CREATE TABLE public.task_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES public.team_members(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 10000),
  weekdays smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[]
    CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  due_time time NOT NULL DEFAULT '18:00',
  enabled boolean NOT NULL DEFAULT true,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  audience text NOT NULL DEFAULT 'team' CHECK (audience IN ('team','members')),
  member_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_routines_org_idx ON public.task_routines(organization_id) WHERE enabled;

CREATE TABLE public.task_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin text NOT NULL DEFAULT 'admin' CHECK (origin IN ('member','admin')),
  created_by uuid,
  assignment_id uuid,
  recipient_key text,
  follows_deal_owner boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  activity_id uuid REFERENCES public.task_playbook_activities(id) ON DELETE SET NULL,
  routine_id uuid REFERENCES public.task_routines(id) ON DELETE SET NULL,
  pipeline_entry_id uuid REFERENCES public.pipeline_entries(id) ON DELETE SET NULL,
  stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  assignee_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('task','call','message','meeting')),
  instructions text NOT NULL DEFAULT '',
  message_template text NOT NULL DEFAULT '',
  required boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  work_date date NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','missed')),
  result text CHECK (length(result) <= 10000),
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_entry_id, activity_id, recipient_key),
  UNIQUE (routine_id, assignee_id, work_date)
);
CREATE INDEX task_queue_assignee_idx ON public.task_work_items(organization_id, assignee_id, due_at, id)
  WHERE status IN ('pending','in_progress');
CREATE INDEX task_queue_history_idx ON public.task_work_items(organization_id, work_date DESC, id);
CREATE INDEX task_done_day_idx ON public.task_work_items(organization_id,completed_at) WHERE status='completed';
CREATE INDEX task_items_activity_idx ON public.task_work_items(activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX task_items_stage_idx ON public.task_work_items(stage_id) WHERE stage_id IS NOT NULL;
CREATE INDEX task_items_assignee_idx ON public.task_work_items(assignee_id) WHERE assignee_id IS NOT NULL;
CREATE UNIQUE INDEX task_one_in_progress_idx ON public.task_work_items(organization_id,assignee_id) WHERE status='in_progress';
CREATE INDEX task_queue_required_idx ON public.task_work_items(pipeline_entry_id, stage_id)
  WHERE required AND status IN ('pending','in_progress');

CREATE TABLE public.task_stage_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_entry_id uuid REFERENCES public.pipeline_entries(id) ON DELETE SET NULL,
  source_stage_id uuid,
  target_stage_id uuid,
  pending_task_ids uuid[] NOT NULL,
  reason text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_exceptions_entry_idx ON public.task_stage_exceptions(pipeline_entry_id, source_stage_id);

CREATE TABLE private.task_move_authorizations (
  entry_id uuid NOT NULL REFERENCES public.pipeline_entries(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  source_stage_id uuid,
  source_pipeline_id uuid NOT NULL,
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (entry_id, actor_id)
);
ALTER TABLE private.task_move_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.task_move_authorizations FROM PUBLIC, anon, authenticated;

ALTER TABLE public.checklists ADD COLUMN IF NOT EXISTS playbook_archived_at timestamptz;
COMMENT ON COLUMN public.checklists.playbook_archived_at IS
  'Modelo absorvido pelo playbook ou aplicação anterior preservada como histórico. Não alimenta a nova fila.';

CREATE FUNCTION private.task_enabled(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.task_workspaces w JOIN public.organizations o ON o.id=w.organization_id
    WHERE w.organization_id=p_org AND w.enabled AND o.ui_v5_enabled);
$$;
CREATE FUNCTION private.task_my_members() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) FROM public.team_members
    WHERE user_id=(SELECT auth.uid()) AND is_active;
$$;
REVOKE ALL ON FUNCTION private.task_enabled(uuid), private.task_my_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.task_my_members() TO authenticated;
GRANT EXECUTE ON FUNCTION private.task_enabled(uuid) TO authenticated,service_role;

ALTER TABLE public.task_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_playbook_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_stage_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_workspaces_read ON public.task_workspaces FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));
CREATE POLICY task_activities_read ON public.task_playbook_activities FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()) AND public.is_org_admin(organization_id));
CREATE POLICY task_routines_read ON public.task_routines FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()) AND
    public.has_feature_permission('followups.view',organization_id) AND
    public.is_org_admin(organization_id));
CREATE POLICY task_items_read ON public.task_work_items FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()) AND
    public.has_feature_permission('followups.view',organization_id) AND
    (public.is_org_admin(organization_id) OR assignee_id=ANY((SELECT private.task_my_members())::uuid[])));
CREATE POLICY task_exceptions_read ON public.task_stage_exceptions FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()) AND public.is_org_admin(organization_id));
REVOKE ALL ON public.task_workspaces, public.task_playbook_activities, public.task_routines,
  public.task_work_items, public.task_stage_exceptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_workspaces, public.task_playbook_activities, public.task_routines,
  public.task_work_items, public.task_stage_exceptions TO authenticated;
GRANT ALL ON public.task_workspaces, public.task_playbook_activities, public.task_routines,
  public.task_work_items, public.task_stage_exceptions TO service_role;

-- Data migration: bindings + template items, never the existing deal items.
-- Snapshots keep the original titles/positions/lineage and do not alter completion.
CREATE FUNCTION private.task_import_templates(p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=p_org AND ui_v5_enabled) THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('task-workspace:'||p_org::text,0));
  IF EXISTS (SELECT 1 FROM public.task_workspaces WHERE organization_id=p_org) THEN RETURN; END IF;
  INSERT INTO public.task_playbook_activities(organization_id,stage_id,title,instructions,position,source_checklist_item_id)
    SELECT p_org,s.id,coalesce(nullif(btrim(i.title),''),'Atividade do checklist'),coalesce(c.description,''),
      (row_number() OVER(PARTITION BY s.id ORDER BY i.position,i.id)-1)::integer,i.id
    FROM public.pipeline_stages s JOIN public.checklists c ON c.id=s.checklist_template_id AND c.organization_id=p_org
    JOIN public.checklist_items i ON i.checklist_id=c.id
    WHERE s.organization_id=p_org AND c.lead_id IS NULL
    ON CONFLICT(stage_id,source_checklist_item_id) DO NOTHING;
  UPDATE public.checklists c SET playbook_archived_at=now()
    WHERE c.organization_id=p_org AND c.playbook_archived_at IS NULL AND
      (c.lead_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.pipeline_stages s WHERE s.organization_id=p_org AND s.checklist_template_id=c.id));
  INSERT INTO public.task_workspaces(organization_id) VALUES(p_org);
END;
$$;

CREATE FUNCTION public.task_activate(p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.assert_org_access(p_org);
  IF NOT public.is_org_admin(p_org) AND coalesce(auth.role(),'')<>'service_role'
    AND NOT (auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM private.task_import_templates(p_org);
  UPDATE public.task_workspaces SET enabled=true WHERE organization_id=p_org;
END;
$$;

CREATE FUNCTION private.task_uuid(p_value text) RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p_value::uuid END;
$$;
CREATE FUNCTION private.task_entry_owner(p_entry public.pipeline_entries) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id FROM unnest(ARRAY[p_entry.assigned_to,
    private.task_uuid(p_entry.metadata->>'responsible_id'),
    private.task_uuid(p_entry.metadata->>'sale_responsible_id'),
    private.task_uuid(p_entry.metadata->>'pre_sale_responsible_id'),
    private.task_uuid(p_entry.metadata->>'sdr_id'),private.task_uuid(p_entry.metadata->>'closer_id')])
    WITH ORDINALITY candidate(id,n)
  JOIN public.team_members t ON t.id=candidate.id AND t.organization_id=p_entry.organization_id AND t.is_active
  ORDER BY candidate.n LIMIT 1;
$$;

CREATE FUNCTION private.task_roll_day(p_org uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.task_work_items t SET status='missed'
    FROM public.organizations o WHERE o.id=t.organization_id AND o.ui_v5_enabled
      AND (p_org IS NULL OR t.organization_id=p_org) AND t.routine_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.task_workspaces w WHERE w.organization_id=t.organization_id AND w.enabled)
      AND t.status IN ('pending','in_progress') AND t.work_date<(now() AT TIME ZONE coalesce(o.timezone,'America/Sao_Paulo'))::date;
  INSERT INTO public.task_work_items(organization_id,routine_id,assignee_id,title,kind,instructions,priority,work_date,due_at)
    SELECT r.organization_id,r.id,m.id,r.title,'task',r.instructions,r.priority,d.local_day,
      (d.local_day+r.due_time) AT TIME ZONE coalesce(o.timezone,'America/Sao_Paulo')
    FROM public.task_routines r JOIN public.organizations o ON o.id=r.organization_id AND o.ui_v5_enabled
    JOIN public.task_workspaces w ON w.organization_id=r.organization_id AND w.enabled
    JOIN public.team_members m ON m.organization_id=r.organization_id AND m.is_active
      AND (r.audience='team' OR m.id=ANY(r.member_ids))
    CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE coalesce(o.timezone,'America/Sao_Paulo'))::date local_day) d
    WHERE r.enabled AND (p_org IS NULL OR r.organization_id=p_org)
      AND extract(isodow FROM d.local_day)::smallint=ANY(r.weekdays)
    ON CONFLICT(routine_id,assignee_id,work_date) DO NOTHING;
  DELETE FROM private.task_move_authorizations WHERE expires_at<now();
END;
$$;

CREATE FUNCTION public.task_sync_day(p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.assert_org_access(p_org);
  IF NOT public.has_feature_permission('followups.view',p_org) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM private.task_import_templates(p_org);
  PERFORM private.task_roll_day(p_org);
END;
$$;

CREATE FUNCTION private.task_after_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tz text; v_owner uuid;
BEGIN
  IF NOT private.task_enabled(NEW.organization_id) THEN RETURN NEW; END IF;
  v_owner:=private.task_entry_owner(NEW);
  IF TG_OP='UPDATE' THEN
    UPDATE public.task_work_items SET assignee_id=v_owner,status=CASE WHEN status='in_progress' THEN 'pending' ELSE status END
      WHERE pipeline_entry_id=NEW.id AND follows_deal_owner AND status IN ('pending','in_progress') AND assignee_id IS DISTINCT FROM v_owner;
    IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id AND NEW.pipeline_id IS NOT DISTINCT FROM OLD.pipeline_id THEN RETURN NEW; END IF;
  END IF;
  IF TG_OP='INSERT' AND NEW.closed_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT coalesce(timezone,'America/Sao_Paulo') INTO v_tz FROM public.organizations WHERE id=NEW.organization_id;
  INSERT INTO public.task_work_items(organization_id,activity_id,pipeline_entry_id,stage_id,assignee_id,
    title,kind,instructions,message_template,required,position,priority,recipient_key,follows_deal_owner,work_date,due_at)
    SELECT NEW.organization_id,a.id,NEW.id,a.stage_id,recipient.id,a.title,a.kind,a.instructions,a.message_template,a.required,a.position,a.priority,
      CASE WHEN a.audience='owner' THEN 'owner' ELSE recipient.id::text END,a.audience='owner',
      (now() AT TIME ZONE v_tz)::date,
      (((now() AT TIME ZONE v_tz)::date+a.due_days)+time '23:59:59') AT TIME ZONE v_tz
    FROM public.task_playbook_activities a
    CROSS JOIN LATERAL (
      SELECT v_owner id WHERE a.audience='owner'
      UNION ALL SELECT m.id FROM public.team_members m WHERE a.audience<>'owner'
        AND m.organization_id=NEW.organization_id AND m.is_active
        AND (a.audience='team' OR m.id=ANY(a.member_ids))
    ) recipient
    WHERE a.organization_id=NEW.organization_id AND a.stage_id=NEW.stage_id AND a.enabled
      AND NOT EXISTS(SELECT 1 FROM public.task_work_items existing WHERE existing.pipeline_entry_id=NEW.id AND existing.activity_id=a.id)
    ON CONFLICT(pipeline_entry_id,activity_id,recipient_key) DO NOTHING;
  RETURN NEW;
END;
$$;

-- One-use authorization, bound to actor + entry + source stage. It cannot be
-- replayed on the next stage. Failed moves roll back its consumption too.
CREATE FUNCTION public.task_pending_for_move(p_entry uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_entry public.pipeline_entries; v_result jsonb;
BEGIN
  SELECT * INTO v_entry FROM public.pipeline_entries WHERE id=p_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  PERFORM public.assert_org_access(v_entry.organization_id);
  IF NOT private.task_enabled(v_entry.organization_id) THEN RETURN '[]'::jsonb; END IF;
  IF EXISTS(SELECT 1 FROM private.task_move_authorizations WHERE entry_id=p_entry AND actor_id=auth.uid()
    AND source_stage_id IS NOT DISTINCT FROM v_entry.stage_id AND source_pipeline_id=v_entry.pipeline_id AND expires_at>now()) THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title) ORDER BY due_at,id),'[]'::jsonb) INTO v_result
    FROM public.task_work_items WHERE pipeline_entry_id=p_entry AND stage_id=v_entry.stage_id AND required AND status IN ('pending','in_progress');
  RETURN v_result;
END;
$$;
CREATE FUNCTION public.task_authorize_move(p_entry uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_entry public.pipeline_entries;
BEGIN
  IF auth.uid() IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Informe o motivo para avançar (3 a 2000 caracteres).'; END IF;
  SELECT * INTO v_entry FROM public.pipeline_entries WHERE id=p_entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  PERFORM public.assert_org_access(v_entry.organization_id);
  INSERT INTO private.task_move_authorizations(entry_id,actor_id,source_stage_id,source_pipeline_id,reason,expires_at)
    VALUES(p_entry,auth.uid(),v_entry.stage_id,v_entry.pipeline_id,btrim(p_reason),now()+interval '10 minutes')
    ON CONFLICT(entry_id,actor_id) DO UPDATE SET source_stage_id=excluded.source_stage_id,
      source_pipeline_id=excluded.source_pipeline_id,reason=excluded.reason,expires_at=excluded.expires_at;
END;
$$;
CREATE FUNCTION private.task_before_move() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pending uuid[]; v_reason text;
BEGIN
  IF (NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id AND NEW.pipeline_id IS NOT DISTINCT FROM OLD.pipeline_id
      AND NOT (OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL))
    OR NOT private.task_enabled(OLD.organization_id) THEN RETURN NEW; END IF;
  SELECT array_agg(id ORDER BY id) INTO v_pending FROM public.task_work_items
    WHERE pipeline_entry_id=OLD.id AND stage_id=OLD.stage_id AND required AND status IN ('pending','in_progress');
  IF v_pending IS NULL THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN
    -- Internal automations keep working, with explicit origin in the audit.
    v_reason:='Movimentação automática do sistema';
  ELSE
    DELETE FROM private.task_move_authorizations WHERE entry_id=OLD.id AND actor_id=auth.uid()
      AND source_stage_id IS NOT DISTINCT FROM OLD.stage_id AND source_pipeline_id=OLD.pipeline_id AND expires_at>now()
      RETURNING reason INTO v_reason;
    IF v_reason IS NULL THEN RAISE EXCEPTION 'task_reason_required' USING ERRCODE='P0001',
      DETAIL='Há atividades obrigatórias pendentes. Informe o motivo antes de avançar.'; END IF;
  END IF;
  INSERT INTO public.task_stage_exceptions(organization_id,pipeline_entry_id,source_stage_id,target_stage_id,pending_task_ids,reason,actor_id)
    VALUES(OLD.organization_id,OLD.id,OLD.stage_id,NEW.stage_id,v_pending,v_reason,auth.uid());
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.task_check_entries(p_entries uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid;
BEGIN
  IF p_entries IS NULL OR cardinality(p_entries) NOT BETWEEN 1 AND 10000 OR array_position(p_entries,NULL) IS NOT NULL THEN RAISE EXCEPTION 'invalid_entries'; END IF;
  IF (SELECT count(*) FROM public.pipeline_entries WHERE id=ANY(p_entries))<>(SELECT count(DISTINCT x) FROM unnest(p_entries) x) THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  FOR v_org IN SELECT DISTINCT organization_id FROM public.pipeline_entries WHERE id=ANY(p_entries)
    LOOP PERFORM public.assert_org_access(v_org); END LOOP;
END;
$$;
CREATE FUNCTION public.task_pending_for_moves(p_entries uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.task_check_entries(p_entries);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'entry_id',pe.id,'lead_name',l.name) ORDER BY t.due_at,t.id),'[]'::jsonb)
    INTO v_result FROM public.pipeline_entries pe JOIN public.task_work_items t ON t.pipeline_entry_id=pe.id AND t.stage_id=pe.stage_id
      LEFT JOIN public.leads l ON l.id=pe.lead_id
    WHERE pe.id=ANY(p_entries) AND private.task_enabled(pe.organization_id) AND t.required AND t.status IN ('pending','in_progress')
      AND NOT EXISTS(SELECT 1 FROM private.task_move_authorizations a WHERE a.entry_id=pe.id AND a.actor_id=auth.uid()
        AND a.source_stage_id IS NOT DISTINCT FROM pe.stage_id AND a.source_pipeline_id=pe.pipeline_id AND a.expires_at>now());
  RETURN v_result;
END;
$$;
CREATE FUNCTION public.task_open_entries_for_leads(p_pipeline uuid,p_leads uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid; v_result jsonb;
BEGIN
  SELECT organization_id INTO v_org FROM public.pipelines WHERE id=p_pipeline;
  IF NOT FOUND THEN RAISE EXCEPTION 'pipeline_not_found'; END IF;
  PERFORM public.assert_org_access(v_org);
  IF p_leads IS NULL OR cardinality(p_leads)>10000 THEN RAISE EXCEPTION 'invalid_leads'; END IF;
  SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO v_result FROM public.pipeline_entries
    WHERE organization_id=v_org AND pipeline_id=p_pipeline AND lead_id=ANY(p_leads) AND closed_at IS NULL;
  RETURN v_result;
END;
$$;
CREATE FUNCTION public.task_authorize_moves(p_entries uuid[],p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Informe o motivo para avançar (3 a 2000 caracteres).'; END IF;
  PERFORM private.task_check_entries(p_entries);
  PERFORM id FROM public.pipeline_entries WHERE id=ANY(p_entries) ORDER BY id FOR UPDATE;
  INSERT INTO private.task_move_authorizations(entry_id,actor_id,source_stage_id,source_pipeline_id,reason,expires_at)
    SELECT id,auth.uid(),stage_id,pipeline_id,btrim(p_reason),now()+interval '10 minutes' FROM public.pipeline_entries WHERE id=ANY(p_entries)
    ON CONFLICT(entry_id,actor_id) DO UPDATE SET source_stage_id=excluded.source_stage_id,
      source_pipeline_id=excluded.source_pipeline_id,reason=excluded.reason,expires_at=excluded.expires_at;
END;
$$;
CREATE TRIGGER zzz_task_stage_guard BEFORE UPDATE OF stage_id,stage_key,pipeline_id,closed_at ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION private.task_before_move();
CREATE TRIGGER trg_task_after_entry AFTER INSERT OR UPDATE OF stage_id,stage_key,pipeline_id,assigned_to,metadata ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION private.task_after_entry();

-- The old engine remains intact for Classic organizations.
DROP TRIGGER IF EXISTS trg_apply_stage_checklist_pipeline ON public.pipeline_entries;
CREATE TRIGGER trg_apply_stage_checklist_pipeline AFTER INSERT OR UPDATE OF stage_id,stage_key ON public.pipeline_entries
  FOR EACH ROW WHEN (NOT private.task_enabled(NEW.organization_id)) EXECUTE FUNCTION public.apply_stage_checklist();

CREATE FUNCTION private.task_validate_audience(p_org uuid,p_audience text,p_members uuid[],p_allow_owner boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_audience IS NULL OR NOT (p_audience IN ('team','members') OR (p_allow_owner AND p_audience='owner')) THEN RAISE EXCEPTION 'Selecione os destinatários.'; END IF;
  IF p_audience='members' THEN
    IF coalesce(cardinality(p_members),0)=0 OR
      (SELECT count(DISTINCT m.id) FROM unnest(p_members) selected(id)
       JOIN public.team_members m ON m.id=selected.id AND m.organization_id=p_org AND m.is_active)<>cardinality(p_members)
    THEN RAISE EXCEPTION 'invalid_assignee' USING ERRCODE='42501'; END IF;
  ELSIF coalesce(cardinality(p_members),0)<>0 THEN RAISE EXCEPTION 'invalid_audience'; END IF;
END;
$$;

CREATE FUNCTION public.task_save_activity(p_org uuid,p_id uuid,p_stage uuid,p_title text,p_kind text,
  p_due_days integer,p_required boolean,p_instructions text,p_message text,p_position integer,p_enabled boolean,
  p_priority text DEFAULT 'medium',p_audience text DEFAULT 'owner',p_members uuid[] DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.assert_org_access(p_org);
  IF NOT public.is_org_admin(p_org) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM private.task_validate_audience(p_org,p_audience,p_members,true);
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 300 OR length(p_instructions)>10000 OR length(p_message)>10000 THEN RAISE EXCEPTION 'invalid_activity'; END IF;
  PERFORM private.task_import_templates(p_org);
  IF NOT private.task_enabled(p_org) THEN RAISE EXCEPTION 'A organização precisa usar a interface nova.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pipeline_stages WHERE id=p_stage AND organization_id=p_org AND is_active) THEN RAISE EXCEPTION 'invalid_stage'; END IF;
  IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.task_playbook_activities WHERE id=p_id AND organization_id=p_org) THEN RAISE EXCEPTION 'activity_not_found'; END IF;
  INSERT INTO public.task_playbook_activities(id,organization_id,stage_id,title,kind,due_days,required,instructions,message_template,position,enabled,priority,audience,member_ids)
    VALUES(coalesce(p_id,gen_random_uuid()),p_org,p_stage,btrim(p_title),p_kind,p_due_days,p_required,coalesce(p_instructions,''),coalesce(p_message,''),p_position,p_enabled,p_priority,p_audience,coalesce(p_members,'{}'))
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,kind=excluded.kind,due_days=excluded.due_days,required=excluded.required,
      instructions=excluded.instructions,message_template=excluded.message_template,position=excluded.position,enabled=excluded.enabled,
      priority=excluded.priority,audience=excluded.audience,member_ids=excluded.member_ids
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
CREATE FUNCTION public.task_save_routine(p_org uuid,p_id uuid,p_assignee uuid,p_title text,p_instructions text,
  p_weekdays smallint[],p_due_time time,p_enabled boolean,p_priority text DEFAULT 'medium',p_audience text DEFAULT NULL,p_members uuid[] DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_audience text; v_members uuid[];
BEGIN
  PERFORM public.assert_org_access(p_org);
  IF NOT (public.is_master_user() OR public.is_org_admin(p_org)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  v_audience:=coalesce(p_audience,CASE WHEN p_assignee IS NULL THEN 'team' ELSE 'members' END);
  v_members:=coalesce(p_members,CASE WHEN p_assignee IS NULL THEN '{}'::uuid[] ELSE ARRAY[p_assignee] END);
  PERFORM private.task_validate_audience(p_org,v_audience,v_members);
  PERFORM private.task_import_templates(p_org);
  IF NOT private.task_enabled(p_org) THEN RAISE EXCEPTION 'A organização precisa usar a interface nova.'; END IF;
  IF p_assignee IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_members WHERE id=p_assignee AND organization_id=p_org AND is_active) THEN RAISE EXCEPTION 'invalid_assignee'; END IF;
  IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.task_routines WHERE id=p_id AND organization_id=p_org) THEN RAISE EXCEPTION 'routine_not_found'; END IF;
  INSERT INTO public.task_routines(id,organization_id,assignee_id,title,instructions,weekdays,due_time,enabled,priority,audience,member_ids)
    VALUES(coalesce(p_id,gen_random_uuid()),p_org,p_assignee,btrim(p_title),coalesce(p_instructions,''),p_weekdays,p_due_time,p_enabled,p_priority,v_audience,v_members)
    ON CONFLICT(id) DO UPDATE SET assignee_id=excluded.assignee_id,title=excluded.title,instructions=excluded.instructions,
      weekdays=excluded.weekdays,due_time=excluded.due_time,enabled=excluded.enabled,
      priority=excluded.priority,audience=excluded.audience,member_ids=excluded.member_ids RETURNING id INTO v_id;
  PERFORM private.task_roll_day(p_org);
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.task_transition(p_id uuid,p_action text,p_result text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_task public.task_work_items;
BEGIN
  SELECT * INTO v_task FROM public.task_work_items WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'task_not_found'; END IF;
  PERFORM public.assert_org_access(v_task.organization_id);
  IF NOT public.has_feature_permission('followups.view',v_task.organization_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM private.task_roll_day(v_task.organization_id);
  SELECT * INTO v_task FROM public.task_work_items WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task_not_found'; END IF;
  IF auth.uid() IS NULL OR v_task.assignee_id IS NULL OR v_task.assignee_id IS DISTINCT FROM public.my_team_member_id(v_task.organization_id) THEN RAISE EXCEPTION 'Somente o responsável pode executar esta tarefa.' USING ERRCODE='42501'; END IF;
  IF v_task.status NOT IN ('pending','in_progress') OR p_action IS NULL OR p_action NOT IN ('start','complete') THEN RAISE EXCEPTION 'Esta tarefa já foi encerrada.'; END IF;
  IF p_action='start' THEN
    IF EXISTS(SELECT 1 FROM public.task_work_items WHERE organization_id=v_task.organization_id AND assignee_id=v_task.assignee_id AND id<>p_id AND status='in_progress') THEN RAISE EXCEPTION 'Conclua a tarefa em andamento antes de começar outra.'; END IF;
    UPDATE public.task_work_items SET status='in_progress' WHERE id=p_id;
  ELSE
    UPDATE public.task_work_items SET status='completed',completed_at=now(),completed_by=auth.uid(),result=nullif(btrim(p_result),'') WHERE id=p_id;
  END IF;
END;
$$;

CREATE FUNCTION public.task_configuration(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.assert_org_access(p_org);
  IF NOT (public.is_master_user() OR public.is_org_admin(p_org)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'activities',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.stage_id,a.position,a.id) FROM public.task_playbook_activities a WHERE a.organization_id=p_org),'[]'::jsonb),
    'routines',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at,r.id) FROM public.task_routines r WHERE r.organization_id=p_org),'[]'::jsonb),
    'stages',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'pipeline_id',p.id,'pipeline_name',p.name) ORDER BY p.display_order,s.position)
      FROM public.pipeline_stages s JOIN public.pipelines p ON p.id=s.pipeline_id
      WHERE s.organization_id=p_org AND s.is_active AND p.is_active),'[]'::jsonb),
    'members',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id) FROM public.team_members WHERE organization_id=p_org AND is_active),'[]'::jsonb)
  );
END;
$$;
CREATE FUNCTION public.task_create_manual(p_org uuid,p_title text,p_due_date date,p_instructions text DEFAULT '') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid; v_id uuid; v_tz text;
BEGIN
  PERFORM public.assert_org_access(p_org);
  IF NOT public.has_feature_permission('followups.view',p_org) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  v_member:=public.my_team_member_id(p_org);
  IF v_member IS NULL THEN RAISE EXCEPTION 'active_member_required' USING ERRCODE='42501'; END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 300 OR p_due_date IS NULL OR length(p_instructions)>10000 THEN RAISE EXCEPTION 'invalid_task'; END IF;
  SELECT coalesce(timezone,'America/Sao_Paulo') INTO v_tz FROM public.organizations WHERE id=p_org;
  INSERT INTO public.task_work_items(organization_id,assignee_id,origin,created_by,title,kind,instructions,work_date,due_at)
    VALUES(p_org,v_member,'member',auth.uid(),btrim(p_title),'task',coalesce(p_instructions,''),(now() AT TIME ZONE v_tz)::date,
      (p_due_date+time '23:59:59') AT TIME ZONE v_tz) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.task_assign(p_org uuid,p_title text,p_due_date date,p_audience text,p_members uuid[],p_priority text,p_instructions text DEFAULT '') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid:=gen_random_uuid(); v_tz text; v_count integer;
BEGIN
  PERFORM public.assert_org_access(p_org);
  IF NOT (public.is_master_user() OR public.is_org_admin(p_org)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM private.task_validate_audience(p_org,p_audience,p_members);
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 300 OR p_due_date IS NULL OR length(p_instructions)>10000 THEN RAISE EXCEPTION 'invalid_task'; END IF;
  PERFORM private.task_import_templates(p_org);
  IF NOT private.task_enabled(p_org) THEN RAISE EXCEPTION 'A organização precisa usar a interface nova.'; END IF;
  SELECT coalesce(timezone,'America/Sao_Paulo') INTO v_tz FROM public.organizations WHERE id=p_org;
  INSERT INTO public.task_work_items(organization_id,created_by,assignment_id,assignee_id,origin,title,kind,instructions,priority,work_date,due_at)
    SELECT p_org,auth.uid(),v_id,m.id,'admin',btrim(p_title),'task',coalesce(p_instructions,''),p_priority,
      (now() AT TIME ZONE v_tz)::date,(p_due_date+time '23:59:59') AT TIME ZONE v_tz
    FROM public.team_members m WHERE m.organization_id=p_org AND m.is_active
      AND (p_audience='team' OR m.id=ANY(p_members));
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count=0 THEN RAISE EXCEPTION 'Nenhum destinatário ativo na organização.'; END IF;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.task_queue(p_org uuid,p_assignee uuid DEFAULT NULL,p_history boolean DEFAULT false,p_offset integer DEFAULT 0,p_entry uuid DEFAULT NULL,p_future boolean DEFAULT false,p_team boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_mine uuid; v_admin boolean; v_result jsonb; v_tz text; v_today date;
BEGIN
  PERFORM public.assert_org_access(p_org);
  IF NOT public.has_feature_permission('followups.view',p_org) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  v_mine:=public.my_team_member_id(p_org); v_admin:=public.is_org_admin(p_org);
  IF p_team AND NOT v_admin THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT coalesce(timezone,'America/Sao_Paulo') INTO v_tz FROM public.organizations WHERE id=p_org;
  v_today:=(now() AT TIME ZONE v_tz)::date;
  IF NOT v_admin AND v_mine IS NULL THEN RAISE EXCEPTION 'active_member_required' USING ERRCODE='42501'; END IF;
  WITH scoped AS (
    SELECT t.*,m.name AS assignee_name,pe.lead_id,l.name AS lead_name,s.name AS stage_name,p.name AS pipeline_name,
      EXISTS(SELECT 1 FROM public.task_stage_exceptions e WHERE e.pipeline_entry_id=t.pipeline_entry_id AND e.source_stage_id=t.stage_id) AS advanced_with_pending,
      (t.due_at<now() AND t.status IN ('pending','in_progress')) AS overdue
    FROM public.task_work_items t LEFT JOIN public.team_members m ON m.id=t.assignee_id
      LEFT JOIN public.pipeline_entries pe ON pe.id=t.pipeline_entry_id
      LEFT JOIN public.leads l ON l.id=pe.lead_id LEFT JOIN public.pipeline_stages s ON s.id=t.stage_id
      LEFT JOIN public.pipelines p ON p.id=s.pipeline_id
    WHERE t.organization_id=p_org AND (CASE WHEN p_team THEN t.origin='admin' ELSE t.assignee_id=v_mine END)
      AND (p_assignee IS NULL OR t.assignee_id=p_assignee)
      AND (p_entry IS NULL OR t.pipeline_entry_id=p_entry)
      AND CASE WHEN p_history THEN t.status IN ('completed','missed') ELSE t.status IN ('pending','in_progress') END
      AND (p_history OR p_team OR p_entry IS NOT NULL OR CASE WHEN p_future
        THEN (t.due_at AT TIME ZONE v_tz)::date>v_today AND t.status<>'in_progress'
        ELSE (t.due_at AT TIME ZONE v_tz)::date<=v_today OR t.status='in_progress' END)
  ), page AS (
    SELECT * FROM scoped ORDER BY CASE WHEN status='in_progress' THEN 0 ELSE 1 END,
      CASE WHEN p_history THEN due_at END DESC,
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,due_at,position,id
      LIMIT 100 OFFSET greatest(0,p_offset)
  ) SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),
    'total',(SELECT count(*) FROM scoped),
    'overdue',(SELECT count(*) FROM scoped WHERE overdue),
    'overview',coalesce((SELECT jsonb_agg(to_jsonb(team) ORDER BY team.name) FROM (
      SELECT m.id,m.name,
        count(*) FILTER(WHERE t.status IN ('pending','in_progress') AND (t.due_at AT TIME ZONE v_tz)::date<=v_today) AS open_count,
        count(*) FILTER(WHERE t.status='completed' AND (t.completed_at AT TIME ZONE v_tz)::date=v_today) AS completed_today,
        count(*) FILTER(WHERE t.status IN ('pending','in_progress') AND t.due_at<now()) AS overdue
      FROM public.task_work_items t JOIN public.team_members m ON m.id=t.assignee_id
      WHERE t.organization_id=p_org AND (CASE WHEN p_team THEN t.origin='admin' ELSE t.assignee_id=v_mine END)
        AND (p_assignee IS NULL OR t.assignee_id=p_assignee) AND (p_entry IS NULL OR t.pipeline_entry_id=p_entry)
        AND (t.status IN ('pending','in_progress') OR
          (t.status='completed' AND t.completed_at>=v_today::timestamp AT TIME ZONE v_tz AND t.completed_at<(v_today+1)::timestamp AT TIME ZONE v_tz))
      GROUP BY m.id,m.name
    ) team),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.task_entry_history(p_entry uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid; v_owner uuid; v_result jsonb;
BEGIN
  SELECT organization_id,private.task_entry_owner(pe) INTO v_org,v_owner FROM public.pipeline_entries pe WHERE id=p_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  PERFORM public.assert_org_access(v_org);
  SELECT coalesce(jsonb_agg(to_jsonb(events)),'[]'::jsonb) INTO v_result FROM (
    SELECT e.id,e.reason,e.created_at,coalesce(m.name,CASE WHEN e.actor_id IS NULL THEN 'Automação' ELSE 'Membro' END) actor_name,
      s.name source_stage,t.name target_stage,
      (SELECT jsonb_agg(w.title ORDER BY w.title) FROM public.task_work_items w WHERE w.id=ANY(e.pending_task_ids)) pending_titles
    FROM public.task_stage_exceptions e LEFT JOIN public.team_members m ON m.user_id=e.actor_id AND m.organization_id=v_org
      LEFT JOIN public.pipeline_stages s ON s.id=e.source_stage_id LEFT JOIN public.pipeline_stages t ON t.id=e.target_stage_id
    WHERE e.pipeline_entry_id=p_entry AND (public.is_org_admin(v_org) OR v_owner=public.my_team_member_id(v_org) OR e.actor_id=auth.uid())
    ORDER BY e.created_at DESC,e.id LIMIT 50
  ) events;
  RETURN v_result;
END;
$$;

-- Tight grants for the public RPC surface; internal functions are not API endpoints.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname=ANY(ARRAY['task_activate','task_sync_day','task_pending_for_move','task_authorize_move','task_pending_for_moves','task_authorize_moves','task_open_entries_for_leads','task_save_activity','task_save_routine','task_transition','task_queue','task_configuration','task_create_manual','task_assign','task_entry_history'])
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',f.signature); END LOOP;
  FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='private'::regnamespace AND proname LIKE 'task_%' AND proname NOT IN ('task_my_members','task_enabled')
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature); END LOOP;
END $$;

-- Future Classic -> V5 switches import bindings in the same transaction.
CREATE FUNCTION private.task_on_interface_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.ui_v5_enabled THEN PERFORM private.task_import_templates(NEW.id); END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.task_on_interface_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER task_interface_change AFTER INSERT OR UPDATE OF ui_v5_enabled ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.task_on_interface_change();

CREATE FUNCTION private.task_preserve_checklist_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_archived boolean;
BEGIN
  IF TG_TABLE_NAME='checklists' THEN
    IF TG_OP='DELETE' THEN
      -- Parent deletion is an authorized CRM operation, not an edit to history.
      IF (OLD.lead_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.leads WHERE id=OLD.lead_id))
        OR (OLD.pipeline_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.pipeline_entries WHERE id=OLD.pipeline_entry_id)) THEN RETURN OLD; END IF;
    ELSIF NEW.deal_id IS NULL AND OLD.deal_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.deals WHERE id=OLD.deal_id)
      AND to_jsonb(NEW)-ARRAY['deal_id','updated_at']=to_jsonb(OLD)-ARRAY['deal_id','updated_at'] THEN
      RETURN NEW; -- ON DELETE SET NULL keeps the historical content intact.
    END IF;
    v_archived:=OLD.playbook_archived_at IS NOT NULL AND private.task_enabled(OLD.organization_id);
  ELSE
    SELECT bool_or(c.playbook_archived_at IS NOT NULL AND private.task_enabled(c.organization_id)) INTO v_archived
      FROM public.checklists c WHERE c.id=CASE WHEN TG_OP='INSERT' THEN NEW.checklist_id ELSE OLD.checklist_id END
        OR (TG_OP='UPDATE' AND c.id=NEW.checklist_id);
  END IF;
  IF v_archived THEN
    RAISE EXCEPTION 'Este checklist foi preservado como histórico e não pode ser alterado.';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION private.task_preserve_checklist_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER task_preserve_checklist BEFORE UPDATE OR DELETE ON public.checklists
  FOR EACH ROW EXECUTE FUNCTION private.task_preserve_checklist_history();
CREATE TRIGGER task_preserve_checklist_items BEFORE INSERT OR UPDATE OR DELETE ON public.checklist_items
  FOR EACH ROW EXECUTE FUNCTION private.task_preserve_checklist_history();

-- Personal actions keep their existing storage. Validate the explicit active
-- organization too, instead of trusting a client-supplied organization_id.
CREATE FUNCTION private.task_validate_daily_action_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.role()='authenticated' THEN
    PERFORM public.assert_org_access(NEW.organization_id);
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
    IF NEW.lead_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.leads WHERE id=NEW.lead_id AND organization_id=NEW.organization_id)
      THEN RAISE EXCEPTION 'invalid_lead_organization' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.task_validate_daily_action_org() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zzz_task_daily_org_guard BEFORE INSERT OR UPDATE OF organization_id,user_id,lead_id ON public.acoes_do_dia
  FOR EACH ROW EXECUTE FUNCTION private.task_validate_daily_action_org();

-- A single set-based job, timezone-aware; the queue also syncs on opening.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('task-routines-roll-day','*/15 * * * *','SELECT private.task_roll_day()');
  END IF;
END $$;
COMMIT;
