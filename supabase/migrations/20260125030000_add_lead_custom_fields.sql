-- Campos personalizados para leads por organização

CREATE TABLE IF NOT EXISTS public.lead_custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'date', 'select', 'boolean')),
  field_options JSONB DEFAULT NULL, -- Para campos select: ["opcao1", "opcao2"]
  is_required BOOLEAN DEFAULT FALSE,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, field_name)
);

CREATE TABLE IF NOT EXISTS public.lead_custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES public.lead_custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lead_id, field_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_lead_custom_fields_org ON public.lead_custom_fields(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_custom_field_values_lead ON public.lead_custom_field_values(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_custom_field_values_field ON public.lead_custom_field_values(field_id);

-- RLS
ALTER TABLE public.lead_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_custom_field_values ENABLE ROW LEVEL SECURITY;

-- Políticas
CREATE POLICY "Users can view their org custom fields" ON public.lead_custom_fields
  FOR SELECT USING (organization_id IN (SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage their org custom fields" ON public.lead_custom_fields
  FOR ALL USING (organization_id IN (SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can view values for their org leads" ON public.lead_custom_field_values
  FOR SELECT USING (lead_id IN (SELECT id FROM public.leads WHERE organization_id IN (SELECT organization_id FROM public.team_members WHERE user_id = auth.uid())));

CREATE POLICY "Users can manage values for their org leads" ON public.lead_custom_field_values
  FOR ALL USING (lead_id IN (SELECT id FROM public.leads WHERE organization_id IN (SELECT organization_id FROM public.team_members WHERE user_id = auth.uid())));

-- Comentários
COMMENT ON TABLE public.lead_custom_fields IS 'Campos personalizados definidos por organização para leads';
COMMENT ON TABLE public.lead_custom_field_values IS 'Valores dos campos personalizados para cada lead';
