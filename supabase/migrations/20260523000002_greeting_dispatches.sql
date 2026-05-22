-- greeting_dispatches — UMA fonte vence por janela.
--
-- Origem: investigação Bertin 2026-05-08/09. Phone 5515935004596 recebeu
-- 3× mesma greeting "fora de horário" em paralelo (copilot + 2 disparos
-- manuais). Sem coordenação, múltiplos caminhos disparam o mesmo greeting
-- pro mesmo lead na mesma janela.
--
-- Reserva atômica via unique (org_id, lead_id, window_id). Quem vence
-- dispara; demais recebem skip silencioso. Usado por
-- supabase/functions/_shared/greeting-orchestrator.ts.

CREATE TABLE public.greeting_dispatches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  phone           text NOT NULL,
  window_id       text NOT NULL,
  source          text NOT NULL CHECK (source IN ('copilot','workflow')),
  greeting_type   text NOT NULL,
  dispatched_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_greeting_dispatches_org_id ON public.greeting_dispatches(org_id);
CREATE INDEX idx_greeting_dispatches_lead_id ON public.greeting_dispatches(lead_id);

-- Core dedup constraint: one dispatch per (org, lead, window).
CREATE UNIQUE INDEX idx_greeting_dispatches_unique
  ON public.greeting_dispatches (org_id, lead_id, window_id);

ALTER TABLE public.greeting_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON public.greeting_dispatches
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "tenant_isolation_all" ON public.greeting_dispatches
  FOR ALL
  USING (org_id = auth.org_id())
  WITH CHECK (org_id = auth.org_id());

GRANT SELECT, INSERT ON public.greeting_dispatches TO authenticated;
GRANT ALL ON public.greeting_dispatches TO service_role;

COMMENT ON TABLE public.greeting_dispatches IS
  'Reserva atômica de greeting dispatch por (org, lead, window). Caller usa resolveGreetingDispatch (supabase/functions/_shared/greeting-orchestrator.ts) — quem vence o unique constraint dispara, outros recebem skip silencioso.';
