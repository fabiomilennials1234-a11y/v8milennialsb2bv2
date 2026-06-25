-- Trigger "Antes de uma data" (scheduled_date) — ledger de dedup.
--
-- O trigger dispara o workflow uma vez por (workflow, lead, data-da-reunião, item-da-lista).
-- Esta tabela registra cada disparo já feito para que o avaliador (pg_cron, ~1 min) nunca
-- repita. Remarcar a reunião muda `meeting_date` ⇒ chave inédita ⇒ re-arma todos os itens
-- (PRD #895). O log só grava o que JÁ disparou, então editar a automação afeta só pendentes.

CREATE TABLE IF NOT EXISTS public.scheduled_date_dispatch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  -- data da reunião alvo no momento do disparo (snapshot — re-arme observa a mudança deste valor)
  meeting_date timestamptz NOT NULL,
  -- identifica o item da lista `dispatches` de forma estável (índice) → "um disparo por item"
  item_key text NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now()
);

-- Dedup: nunca dispara duas vezes o mesmo item para a mesma reunião do mesmo lead.
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_date_dispatch_log_dedup
  ON public.scheduled_date_dispatch_log (workflow_id, lead_id, meeting_date, item_key);

-- Lookup do log por org/workflow na avaliação.
CREATE INDEX IF NOT EXISTS idx_scheduled_date_dispatch_log_org_workflow
  ON public.scheduled_date_dispatch_log (organization_id, workflow_id);

ALTER TABLE public.scheduled_date_dispatch_log ENABLE ROW LEVEL SECURITY;

-- Reads: org members only (SECURITY DEFINER helper evita recursão RLS — nunca inline team_members).
DROP POLICY IF EXISTS scheduled_date_dispatch_log_select ON public.scheduled_date_dispatch_log;
CREATE POLICY scheduled_date_dispatch_log_select ON public.scheduled_date_dispatch_log
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- Writes: só via service_role (o avaliador roda como service_role no edge fn). Sem acesso anon.
REVOKE ALL ON public.scheduled_date_dispatch_log FROM anon;
REVOKE ALL ON public.scheduled_date_dispatch_log FROM authenticated;
GRANT SELECT ON public.scheduled_date_dispatch_log TO authenticated;
GRANT ALL ON public.scheduled_date_dispatch_log TO service_role;
