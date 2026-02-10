-- Migration: Campanhas - instância WhatsApp e regras de envio por etapa
-- 1. Adiciona whatsapp_instance_id em campanhas
-- 2. Cria campanha_dispatch_rules, campanha_dispatch_rule_steps, scheduled_campaign_messages
-- 3. RLS para as novas tabelas
-- Date: 2026-03-01

-- ============================================
-- 1. CAMPANHAS: vínculo com instância WhatsApp
-- ============================================

ALTER TABLE public.campanhas
ADD COLUMN IF NOT EXISTS whatsapp_instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.campanhas.whatsapp_instance_id IS 'Instância WhatsApp usada para disparos da campanha (semi-automática e automática). Se NULL, usa primeira instância ativa da organização.';

CREATE INDEX IF NOT EXISTS idx_campanhas_whatsapp_instance ON public.campanhas(whatsapp_instance_id) WHERE whatsapp_instance_id IS NOT NULL;

-- ============================================
-- 2. REGRAS DE ENVIO (trigger_type + stage)
-- ============================================

CREATE TABLE public.campanha_dispatch_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('lead_created', 'lead_moved_to_stage')),
  campanha_stage_id UUID REFERENCES public.campanha_stages(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_stage_required_for_moved CHECK (
    (trigger_type = 'lead_moved_to_stage' AND campanha_stage_id IS NOT NULL)
    OR (trigger_type = 'lead_created' AND campanha_stage_id IS NULL)
  )
);

COMMENT ON TABLE public.campanha_dispatch_rules IS 'Regras de envio: ao criar lead na campanha ou ao mover para etapa X, disparar sequência de mensagens.';
COMMENT ON COLUMN public.campanha_dispatch_rules.trigger_type IS 'lead_created = ao adicionar lead; lead_moved_to_stage = ao mover para etapa específica.';
COMMENT ON COLUMN public.campanha_dispatch_rules.campanha_stage_id IS 'Obrigatório quando trigger_type = lead_moved_to_stage.';

CREATE UNIQUE INDEX idx_campanha_dispatch_rules_unique
  ON public.campanha_dispatch_rules(campanha_id, trigger_type, COALESCE(campanha_stage_id::text, ''));

CREATE INDEX idx_campanha_dispatch_rules_campanha ON public.campanha_dispatch_rules(campanha_id);
CREATE INDEX idx_campanha_dispatch_rules_active ON public.campanha_dispatch_rules(campanha_id, is_active) WHERE is_active = true;

-- ============================================
-- 3. PASSOS DA SEQUÊNCIA (template + delay)
-- ============================================

CREATE TABLE public.campanha_dispatch_rule_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.campanha_dispatch_rules(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.campaign_templates(id) ON DELETE CASCADE,
  delay_minutes INTEGER NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  position INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.campanha_dispatch_rule_steps IS 'Cada passo da sequência: template a enviar e delay em minutos em relação ao passo anterior (0 = imediato).';
COMMENT ON COLUMN public.campanha_dispatch_rule_steps.delay_minutes IS 'Minutos de espera após o passo anterior antes de enviar este (0 = enviar junto com o primeiro).';

CREATE INDEX idx_campanha_dispatch_rule_steps_rule ON public.campanha_dispatch_rule_steps(rule_id);

-- ============================================
-- 4. FILA DE MENSAGENS AGENDADAS
-- ============================================

CREATE TABLE public.scheduled_campaign_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.campanha_dispatch_rules(id) ON DELETE CASCADE,
  campanha_lead_id UUID NOT NULL REFERENCES public.campanha_leads(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.campaign_templates(id) ON DELETE CASCADE,
  whatsapp_instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sent', 'failed', 'cancelled')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.scheduled_campaign_messages IS 'Fila de envios agendados pelas regras de campanha (lead criado ou movido para etapa).';

CREATE INDEX idx_scheduled_campaign_messages_worker
  ON public.scheduled_campaign_messages(status, scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX idx_scheduled_campaign_messages_campanha ON public.scheduled_campaign_messages(campanha_id);
CREATE INDEX idx_scheduled_campaign_messages_rule_lead ON public.scheduled_campaign_messages(rule_id, campanha_lead_id);

-- ============================================
-- 5. RLS
-- ============================================

ALTER TABLE public.campanha_dispatch_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanha_dispatch_rule_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_campaign_messages ENABLE ROW LEVEL SECURITY;

-- campanha_dispatch_rules: usuários veem/gerenciam por organização da campanha
CREATE POLICY "campanha_dispatch_rules_select"
  ON public.campanha_dispatch_rules FOR SELECT TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "campanha_dispatch_rules_insert"
  ON public.campanha_dispatch_rules FOR INSERT TO authenticated
  WITH CHECK (
    public.is_user_admin()
    AND campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "campanha_dispatch_rules_update"
  ON public.campanha_dispatch_rules FOR UPDATE TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "campanha_dispatch_rules_delete"
  ON public.campanha_dispatch_rules FOR DELETE TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- campanha_dispatch_rule_steps: via rule -> campanha
CREATE POLICY "campanha_dispatch_rule_steps_select"
  ON public.campanha_dispatch_rule_steps FOR SELECT TO authenticated
  USING (
    rule_id IN (
      SELECT id FROM public.campanha_dispatch_rules r
      JOIN public.campanhas c ON c.id = r.campanha_id
      WHERE c.organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "campanha_dispatch_rule_steps_insert"
  ON public.campanha_dispatch_rule_steps FOR INSERT TO authenticated
  WITH CHECK (
    public.is_user_admin()
    AND rule_id IN (
      SELECT id FROM public.campanha_dispatch_rules r
      JOIN public.campanhas c ON c.id = r.campanha_id
      WHERE c.organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "campanha_dispatch_rule_steps_update"
  ON public.campanha_dispatch_rule_steps FOR UPDATE TO authenticated
  USING (
    rule_id IN (
      SELECT id FROM public.campanha_dispatch_rules r
      JOIN public.campanhas c ON c.id = r.campanha_id
      WHERE c.organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "campanha_dispatch_rule_steps_delete"
  ON public.campanha_dispatch_rule_steps FOR DELETE TO authenticated
  USING (
    rule_id IN (
      SELECT id FROM public.campanha_dispatch_rules r
      JOIN public.campanhas c ON c.id = r.campanha_id
      WHERE c.organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- scheduled_campaign_messages: leitura para org; escrita apenas via service role (worker)
CREATE POLICY "scheduled_campaign_messages_select"
  ON public.scheduled_campaign_messages FOR SELECT TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "scheduled_campaign_messages_service_role"
  ON public.scheduled_campaign_messages FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger updated_at para campanha_dispatch_rules
CREATE OR REPLACE FUNCTION update_campanha_dispatch_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campanha_dispatch_rules_updated_at ON public.campanha_dispatch_rules;
CREATE TRIGGER trg_campanha_dispatch_rules_updated_at
  BEFORE UPDATE ON public.campanha_dispatch_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_campanha_dispatch_rules_updated_at();
