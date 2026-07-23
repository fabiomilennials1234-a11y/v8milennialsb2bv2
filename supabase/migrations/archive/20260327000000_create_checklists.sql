-- Checklists: standalone task-list system (does NOT touch follow_ups or acoes_do_dia)
CREATE TABLE public.checklists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.checklist_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Checklists visible to org members"
ON public.checklists FOR SELECT
USING (
  organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Org members can insert checklists"
ON public.checklists FOR INSERT
WITH CHECK (
  organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Org members can update checklists"
ON public.checklists FOR UPDATE
USING (
  organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Org members can delete checklists"
ON public.checklists FOR DELETE
USING (
  organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Checklist items visible via parent checklist"
ON public.checklist_items FOR SELECT
USING (
  checklist_id IN (
    SELECT c.id FROM public.checklists c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Org members can insert checklist items"
ON public.checklist_items FOR INSERT
WITH CHECK (
  checklist_id IN (
    SELECT c.id FROM public.checklists c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Org members can update checklist items"
ON public.checklist_items FOR UPDATE
USING (
  checklist_id IN (
    SELECT c.id FROM public.checklists c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Org members can delete checklist items"
ON public.checklist_items FOR DELETE
USING (
  checklist_id IN (
    SELECT c.id FROM public.checklists c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid()
  )
);

-- Indexes
CREATE INDEX idx_checklists_organization_id ON public.checklists(organization_id);
CREATE INDEX idx_checklist_items_checklist_position ON public.checklist_items(checklist_id, position);

-- Triggers for updated_at
CREATE TRIGGER update_checklists_updated_at
BEFORE UPDATE ON public.checklists
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_checklist_items_updated_at
BEFORE UPDATE ON public.checklist_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
