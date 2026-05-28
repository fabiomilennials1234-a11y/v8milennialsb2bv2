-- Domain Events — pub/sub interno DB-backed (slice 19 event-bus piloto)
--
-- Tabela serve como fila de eventos publicados pelos módulos. Edge function
-- `event-dispatcher` (cron 1/min) consome rows pending, executa handler
-- registrado para o event_type e atualiza status.
--
-- Esta migration NÃO é aplicada em prod nesta slice (deploy coordenado).

CREATE TABLE IF NOT EXISTS public.domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  published_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_events_status_check CHECK (status IN ('pending', 'dispatched', 'failed'))
);

-- Partial index para o dispatcher escanear apenas pending eficientemente.
CREATE INDEX IF NOT EXISTS idx_domain_events_pending
  ON public.domain_events (organization_id, status, published_at)
  WHERE status = 'pending';

-- Index por event_type para queries de auditoria / replay por tipo.
CREATE INDEX IF NOT EXISTS idx_domain_events_type
  ON public.domain_events (event_type, published_at DESC);

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: usuário vê / insere apenas eventos da sua org.
-- Master bypass via is_master_user(). Service role bypassa RLS por padrão
-- (usado pelo dispatcher e pelo publish via service-role client).
DROP POLICY IF EXISTS domain_events_select ON public.domain_events;
CREATE POLICY domain_events_select ON public.domain_events
  FOR SELECT
  USING (
    (organization_id IN (SELECT public.get_my_organization_ids()))
    OR public.is_master_user()
  );

DROP POLICY IF EXISTS domain_events_insert ON public.domain_events;
CREATE POLICY domain_events_insert ON public.domain_events
  FOR INSERT
  WITH CHECK (
    (organization_id IN (SELECT public.get_my_organization_ids()))
    OR public.is_master_user()
  );

COMMENT ON TABLE public.domain_events IS
  'Pub/sub interno DB-backed para desacoplar módulos (slice 19). '
  'Edge function event-dispatcher consome pending rows via cron 1/min.';

COMMENT ON COLUMN public.domain_events.aggregate_type IS
  'Tipo do agregado de domínio (ex: lead, pipeline_entry, message).';

COMMENT ON COLUMN public.domain_events.aggregate_id IS
  'ID do agregado afetado (FK lógica — sem constraint para permitir replay '
  'após hard-delete do agregado).';

COMMENT ON COLUMN public.domain_events.payload IS
  'Snapshot tipado do evento (ver _shared/events/types.ts).';

COMMENT ON COLUMN public.domain_events.status IS
  'pending → dispatched | failed. failed permite replay manual via reset.';
