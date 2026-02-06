-- Automações de envio: quando lead chega em uma etapa da campanha, sai da campanha e entra em uma etapa de um pipe.
-- Uma regra por etapa da campanha (única por campanha_id + campanha_stage_id).

CREATE TABLE public.campanha_pipe_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  campanha_stage_id UUID NOT NULL REFERENCES public.campanha_stages(id) ON DELETE CASCADE,
  target_pipe TEXT NOT NULL CHECK (target_pipe IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas')),
  pipe_stage TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(campanha_id, campanha_stage_id)
);

CREATE INDEX idx_campanha_pipe_automations_campanha ON public.campanha_pipe_automations(campanha_id);
CREATE INDEX idx_campanha_pipe_automations_stage ON public.campanha_pipe_automations(campanha_stage_id);

ALTER TABLE public.campanha_pipe_automations ENABLE ROW LEVEL SECURITY;

-- SELECT: usuário vê automações de campanhas da sua organização
CREATE POLICY "campanha_pipe_automations_select_organization"
  ON public.campanha_pipe_automations FOR SELECT
  TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- INSERT: apenas admins, e só para campanhas da organização
CREATE POLICY "campanha_pipe_automations_insert_organization_admin"
  ON public.campanha_pipe_automations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_user_admin()
    AND campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- UPDATE: apenas admins, mesma organização
CREATE POLICY "campanha_pipe_automations_update_organization_admin"
  ON public.campanha_pipe_automations FOR UPDATE
  TO authenticated
  USING (
    public.is_user_admin()
    AND campanha_id IN (
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

-- DELETE: apenas admins, mesma organização
CREATE POLICY "campanha_pipe_automations_delete_organization_admin"
  ON public.campanha_pipe_automations FOR DELETE
  TO authenticated
  USING (
    public.is_user_admin()
    AND campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

COMMENT ON TABLE public.campanha_pipe_automations IS 'Regras: ao mover lead para esta etapa da campanha, enviar para o pipe na etapa indicada e remover da campanha.';
