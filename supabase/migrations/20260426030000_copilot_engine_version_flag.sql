-- Trilha 3.B Fase B3 / B3.1 — Feature flag agent_engine v1/v2
--
-- Adiciona coluna `copilot_engine_version` em organizations pra rotear
-- agent-message entre engine v1 (atual) e v2 (refatorada via módulos
-- _shared/copilot/*). Default v1 — opt-in master toggle por org.
--
-- v2 = mesma lógica funcional via módulos extraídos. Comparação A/B futura
-- via dashboard /master/copilot-engine-comparison (não implementado ainda).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS copilot_engine_version text NOT NULL DEFAULT 'v1'
    CHECK (copilot_engine_version IN ('v1', 'v2'));

CREATE INDEX IF NOT EXISTS idx_organizations_copilot_engine_version
  ON public.organizations (copilot_engine_version)
  WHERE copilot_engine_version <> 'v1';

COMMENT ON COLUMN public.organizations.copilot_engine_version IS
  'Trilha 3.B B3: roteia agent-message entre engine v1 (orchestrator atual) e v2 (módulos refatorados). Default v1.';
