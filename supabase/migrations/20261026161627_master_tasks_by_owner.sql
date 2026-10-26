-- Tarefas internas: um responsável por cartão, leitura compartilhada entre masters plenos.
BEGIN;

CREATE TABLE public.master_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_master_user_id uuid NOT NULL REFERENCES public.master_users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  due_date date NOT NULL CHECK (due_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  estimated_minutes integer NOT NULL CHECK (estimated_minutes > 0),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 10000),
  status text NOT NULL DEFAULT 'a_fazer' CHECK (status IN ('a_fazer', 'fazendo', 'feito')),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX master_tasks_owner_updated_idx ON public.master_tasks (owner_master_user_id, updated_at DESC, id);
CREATE INDEX master_tasks_created_by_idx ON public.master_tasks (created_by);
ALTER TABLE public.master_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_tasks FROM anon, authenticated;
GRANT SELECT, DELETE ON public.master_tasks TO authenticated;
GRANT INSERT (owner_master_user_id, title, due_date, estimated_minutes, description, status),
  UPDATE (owner_master_user_id, title, due_date, estimated_minutes, description, status) ON public.master_tasks TO authenticated;
GRANT ALL ON public.master_tasks TO service_role;

-- O responsável organiza o quadro, não limita a leitura entre masters.
-- Outbounders e demais perfis restritos não recebem acesso ao trabalho interno.
CREATE POLICY master_tasks_full_master ON public.master_tasks FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.master_users m
    WHERE m.user_id = (SELECT auth.uid()) AND m.is_active = true
      AND m.permissions @> '{"all":true}'::jsonb
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.master_users m
    WHERE m.user_id = (SELECT auth.uid()) AND m.is_active = true
      AND m.permissions @> '{"all":true}'::jsonb
  ));

CREATE FUNCTION public.prepare_master_task()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.owner_master_user_id IS DISTINCT FROM OLD.owner_master_user_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.master_users m WHERE m.id = NEW.owner_master_user_id
        AND m.is_active = true AND m.permissions @> '{"all":true}'::jsonb
    ) THEN
      RAISE EXCEPTION 'O responsável deve ser um master ativo.' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.title := btrim(NEW.title);
  NEW.updated_at := clock_timestamp();
  IF TG_OP = 'INSERT' THEN
    NEW.completed_at := CASE WHEN NEW.status = 'feito' THEN NEW.updated_at ELSE NULL END;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.completed_at := CASE WHEN NEW.status = 'feito' THEN NEW.updated_at ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_master_task BEFORE INSERT OR UPDATE ON public.master_tasks
  FOR EACH ROW EXECUTE FUNCTION public.prepare_master_task();

CREATE FUNCTION public.audit_master_task()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  task public.master_tasks;
  actor uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN task := OLD; ELSE task := NEW; END IF;
  SELECT id INTO actor FROM public.master_users
    WHERE user_id = auth.uid() AND is_active = true;
  IF actor IS NOT NULL THEN
    INSERT INTO public.master_audit_logs
      (master_user_id, user_id, action, target_type, target_id, target_name, details)
    VALUES (actor, auth.uid(), 'master_task_' || lower(TG_OP), 'master_task', task.id, task.title,
      jsonb_build_object(
        'before', CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
        'after', CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END
      ));
  END IF;
  RETURN task;
END;
$$;

CREATE TRIGGER audit_master_task AFTER INSERT OR UPDATE OR DELETE ON public.master_tasks
  FOR EACH ROW EXECUTE FUNCTION public.audit_master_task();
REVOKE ALL ON FUNCTION public.prepare_master_task() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_master_task() FROM PUBLIC, anon, authenticated;
COMMIT;
