-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260709193017  name: create_support_tickets
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

CREATE TYPE public.support_ticket_tipo       AS ENUM ('bug', 'duvida', 'solicitacao');
CREATE TYPE public.support_ticket_impacto    AS ENUM ('parado', 'contorno', 'incomodo');
CREATE TYPE public.support_ticket_severidade AS ENUM ('baixa', 'media', 'alta', 'critica');
CREATE TYPE public.support_ticket_status     AS ENUM ('aberto', 'em_andamento', 'aguardando_cliente', 'resolvido', 'fechado');

CREATE TABLE public.support_tickets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title                   TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  description             TEXT,
  tipo                    public.support_ticket_tipo    NOT NULL,
  impacto                 public.support_ticket_impacto NOT NULL,
  severidade              public.support_ticket_severidade,
  status                  public.support_ticket_status  NOT NULL DEFAULT 'aberto',
  assigned_master_user_id UUID REFERENCES public.master_users(id) ON DELETE SET NULL,
  defect_url              TEXT,
  support_context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_response_at       TIMESTAMPTZ,
  resolved_at             TIMESTAMPTZ,
  awaiting_since          TIMESTAMPTZ,
  awaiting_customer_ms    BIGINT NOT NULL DEFAULT 0 CHECK (awaiting_customer_ms >= 0),
  reopen_count            INTEGER NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.support_tickets IS 'Chamado: pedido de ajuda de uma Organizacao para o suporte da Torque. Ver ADR-0018.';
COMMENT ON COLUMN public.support_tickets.tipo IS 'Mutavel: e a saida da triagem, nao um fato da abertura.';
COMMENT ON COLUMN public.support_tickets.impacto IS 'Declarado pelo usuario. Ele sabe se esta parado; nao sabe se e critico.';
COMMENT ON COLUMN public.support_tickets.severidade IS 'Veredito do staff. Nulo ate a triagem. Cliente nunca escreve.';
COMMENT ON COLUMN public.support_tickets.support_context IS 'Snapshot imutavel: rota, versao, browser, erros de cliente, session_id.';
COMMENT ON COLUMN public.support_tickets.defect_url IS 'Issue do GitHub. Contar chamados por esta URL torna severidade uma medida.';
COMMENT ON COLUMN public.support_tickets.author_user_id IS 'Nullable: o Chamado pertence a Organizacao e sobrevive ao autor.';

CREATE TABLE public.support_ticket_comments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body           TEXT NOT NULL CHECK (length(btrim(body)) > 0),
  is_internal    BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.support_ticket_comments IS 'Comentario de um Chamado. NAO e Message: Message e unidade de WhatsApp/Meta dentro de uma Conversation.';
COMMENT ON COLUMN public.support_ticket_comments.is_internal IS 'Nota do staff, invisivel para a Organizacao. Filtrada na policy, nunca no frontend.';

CREATE INDEX idx_support_tickets_org_created    ON public.support_tickets (organization_id, created_at DESC);
CREATE INDEX idx_support_tickets_author         ON public.support_tickets (author_user_id) WHERE author_user_id IS NOT NULL;
CREATE INDEX idx_support_tickets_status_created ON public.support_tickets (status, created_at DESC);
CREATE INDEX idx_support_tickets_defect         ON public.support_tickets (defect_url) WHERE defect_url IS NOT NULL;
CREATE INDEX idx_support_tickets_assigned       ON public.support_tickets (assigned_master_user_id) WHERE assigned_master_user_id IS NOT NULL;
CREATE INDEX idx_support_ticket_comments_ticket ON public.support_ticket_comments (ticket_id, created_at);

CREATE OR REPLACE FUNCTION public.enforce_support_ticket_write_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_staff BOOLEAN := public.is_master_user();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.severidade IS NOT NULL AND NOT is_staff THEN
      RAISE EXCEPTION 'severidade e definida pelo suporte, nao pelo cliente' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.defect_url IS NOT NULL AND NOT is_staff THEN
      RAISE EXCEPTION 'defect_url e definida pelo suporte' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.support_context IS DISTINCT FROM OLD.support_context THEN
    RAISE EXCEPTION 'support_context e imutavel' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT is_staff THEN
    IF NEW.severidade IS DISTINCT FROM OLD.severidade THEN
      RAISE EXCEPTION 'severidade e definida pelo suporte, nao pelo cliente' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tipo IS DISTINCT FROM OLD.tipo THEN
      RAISE EXCEPTION 'a triagem do tipo e do suporte' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.defect_url IS DISTINCT FROM OLD.defect_url THEN
      RAISE EXCEPTION 'defect_url e definida pelo suporte' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.assigned_master_user_id IS DISTINCT FROM OLD.assigned_master_user_id THEN
      RAISE EXCEPTION 'atribuicao e do suporte' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id THEN
      RAISE EXCEPTION 'dono e autor de um chamado nao mudam' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_tickets_write_rules
  BEFORE INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_support_ticket_write_rules();

CREATE OR REPLACE FUNCTION public.can_read_support_ticket(_ticket_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.support_tickets t
    WHERE t.id = _ticket_id
      AND (
        t.author_user_id = auth.uid()
        OR t.organization_id IN (SELECT public.get_my_admin_organization_ids())
        OR public.is_master_user()
      )
  );
$$;

COMMENT ON FUNCTION public.can_read_support_ticket(UUID) IS
  'SECURITY DEFINER: evita recursao de apply_rls quando a policy de support_ticket_comments precisa saber se o chamado e visivel.';

REVOKE ALL ON FUNCTION public.can_read_support_ticket(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_support_ticket(UUID) TO authenticated;

ALTER TABLE public.support_tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY support_tickets_select ON public.support_tickets
  FOR SELECT TO authenticated
  USING (
    author_user_id = auth.uid()
    OR organization_id IN (SELECT public.get_my_admin_organization_ids())
    OR public.is_master_user()
  );

CREATE POLICY support_tickets_insert ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND organization_id IN (SELECT public.get_my_organization_ids())
  );

CREATE POLICY support_tickets_update_client ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (
    author_user_id = auth.uid()
    OR organization_id IN (SELECT public.get_my_admin_organization_ids())
  )
  WITH CHECK (
    author_user_id = auth.uid()
    OR organization_id IN (SELECT public.get_my_admin_organization_ids())
  );

CREATE POLICY support_tickets_update_master ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

CREATE POLICY support_tickets_delete_master ON public.support_tickets
  FOR DELETE TO authenticated
  USING (public.is_master_user());

CREATE POLICY support_ticket_comments_select ON public.support_ticket_comments
  FOR SELECT TO authenticated
  USING (
    public.is_master_user()
    OR (is_internal = false AND public.can_read_support_ticket(ticket_id))
  );

CREATE POLICY support_ticket_comments_insert ON public.support_ticket_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND public.can_read_support_ticket(ticket_id)
    AND (is_internal = false OR public.is_master_user())
  );

CREATE POLICY support_ticket_comments_update_master ON public.support_ticket_comments
  FOR UPDATE TO authenticated
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

CREATE POLICY support_ticket_comments_delete_master ON public.support_ticket_comments
  FOR DELETE TO authenticated
  USING (public.is_master_user());
