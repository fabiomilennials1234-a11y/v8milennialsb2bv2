-- Diferenciar, no thread do cliente, uma resposta do suporte de uma mensagem da
-- Organização. Antes o frontend deduzia isso por identidade ("não é você nem o
-- dono → suporte"), o que etiquetava um admin da org como Torque e, pior, não
-- distinguia um master que escreve ora como suporte (console), ora como org
-- (painel do cliente, shadow mode). O mesmo autor pode fazer os dois — só a
-- ORIGEM do comentário resolve.
--
-- `from_staff` carimba essa origem no insert: console master = true, painel do
-- cliente = false. A policy impede um não-master de se passar por staff. Uma
-- nota interna é sempre do staff (invariante via CHECK).

ALTER TABLE public.support_ticket_comments
  ADD COLUMN IF NOT EXISTS from_staff boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.support_ticket_comments.from_staff IS
  'True = escrito pelo suporte da Torque (console master). False = mensagem da Organização (painel do cliente). Carimba a ORIGEM, não a identidade do autor — um master escreve dos dois lados.';

-- Backfill: sem uma coluna de origem no histórico, a única evidência confiável
-- de staff numa linha antiga é ela ser nota interna (o cliente nunca escreve
-- uma). Respostas públicas antigas ficam como da Organização — não dá para saber
-- se saíram do console ou do painel, e tratá-las como staff etiquetaria como
-- Torque a mensagem que o cliente mandou pelo próprio painel.
UPDATE public.support_ticket_comments
  SET from_staff = is_internal
  WHERE from_staff <> is_internal;

-- Nota interna é, por definição, do staff.
ALTER TABLE public.support_ticket_comments
  DROP CONSTRAINT IF EXISTS support_ticket_comments_internal_implies_staff;
ALTER TABLE public.support_ticket_comments
  ADD CONSTRAINT support_ticket_comments_internal_implies_staff
  CHECK (NOT is_internal OR from_staff);

-- Non-master não pode carimbar from_staff=true (nem is_internal, como já era).
DROP POLICY IF EXISTS support_ticket_comments_insert ON public.support_ticket_comments;
CREATE POLICY support_ticket_comments_insert ON public.support_ticket_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND public.can_read_support_ticket(ticket_id)
    AND (is_internal = false OR public.is_master_user())
    AND (from_staff = false OR public.is_master_user())
  );
