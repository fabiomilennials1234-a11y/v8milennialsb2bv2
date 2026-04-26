-- Onda 1 / T1.0.3 + T1.1.2 — Garantir outbound_dispatch_log + UNIQUE
--
-- Telemetria 30d (2026-04-26): 11.775 erros do cron process-outbound-dispatches
-- com mensagem "Could not find the table 'public.outbound_dispatch_log'".
--
-- Tabela existe em 20260128100000_add_copilot_outbound_bdr.sql (rodou em dev),
-- mas reporting do prod indica drift de migration. Esta migration é
-- IDEMPOTENTE — IF NOT EXISTS em tudo. Caso já exista, não altera schema.
--
-- Também adiciona UNIQUE INDEX (REQ-P1.2) que previne race condition em
-- outbound-trigger:200-214 (SELECT existing + INSERT separados).

CREATE TABLE IF NOT EXISTS public.outbound_dispatch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')),
  message_content text,
  message_id text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  error_message text,
  attempts smallint NOT NULL DEFAULT 0,
  campanha_id uuid,
  batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_dispatch_org
  ON public.outbound_dispatch_log(organization_id);

CREATE INDEX IF NOT EXISTS idx_outbound_dispatch_agent
  ON public.outbound_dispatch_log(agent_id);

CREATE INDEX IF NOT EXISTS idx_outbound_dispatch_lead
  ON public.outbound_dispatch_log(lead_id);

CREATE INDEX IF NOT EXISTS idx_outbound_dispatch_status
  ON public.outbound_dispatch_log(status);

CREATE INDEX IF NOT EXISTS idx_outbound_dispatch_scheduled
  ON public.outbound_dispatch_log(scheduled_at)
  WHERE status = 'pending';

-- T1.1.2 / REQ-P1.2: previne duplicate dispatch quando outbound-trigger é
-- chamado 2x simultaneamente (race entre SELECT existing + INSERT).
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_dispatch_unique_active
  ON public.outbound_dispatch_log (lead_id, agent_id)
  WHERE status IN ('pending','sent');

ALTER TABLE public.outbound_dispatch_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their org outbound logs" ON public.outbound_dispatch_log;
CREATE POLICY "Users can view their org outbound logs" ON public.outbound_dispatch_log
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can manage their org outbound logs" ON public.outbound_dispatch_log;
CREATE POLICY "Users can manage their org outbound logs" ON public.outbound_dispatch_log
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_role_all" ON public.outbound_dispatch_log;
CREATE POLICY "service_role_all" ON public.outbound_dispatch_log
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.outbound_dispatch_log IS
  'Onda 1 T1.0.3: garantia idempotente da tabela. UNIQUE INDEX adicionado para prevenir race em outbound-trigger.';

-- Refresh PostgREST schema cache (resolve "table not found" pós-deploy)
NOTIFY pgrst, 'reload schema';
