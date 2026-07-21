-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260719203556  name: support_ticket_gestor_author
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- S5 #1141 — marcador de autor-gestor no Chamado (ADR-0021 §9). Aditiva.
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS author_gestor_id uuid
    REFERENCES public.gestores(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.support_tickets.author_gestor_id IS
  'Marcador de autor-gestor (ADR-0021 §9). NULL = autor normal (Team Member). Setado = o Chamado foi aberto por este Gestor de Portfólio, sempre ancorado a uma org vinculada. Staff da Torque exibe selo "Gestor".';

CREATE INDEX IF NOT EXISTS idx_support_tickets_author_gestor
  ON public.support_tickets (author_gestor_id)
  WHERE author_gestor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_support_ticket_gestor_author()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.author_gestor_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.gestores g
        JOIN public.gestor_organizations go ON go.gestor_id = g.id
        WHERE g.id = NEW.author_gestor_id
          AND g.user_id = auth.uid()
          AND g.is_active = true
          AND go.organization_id = NEW.organization_id
      ) THEN
        RAISE EXCEPTION 'author_gestor_id deve ser o gestor autenticado, vinculado a organization_id do chamado'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.author_gestor_id IS DISTINCT FROM OLD.author_gestor_id
     AND NEW.author_gestor_id IS NOT NULL THEN
    RAISE EXCEPTION 'o gestor autor de um chamado nao muda'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_tickets_gestor_author ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_gestor_author
  BEFORE INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_support_ticket_gestor_author();

REVOKE ALL ON FUNCTION public.enforce_support_ticket_gestor_author() FROM PUBLIC, anon, authenticated;
