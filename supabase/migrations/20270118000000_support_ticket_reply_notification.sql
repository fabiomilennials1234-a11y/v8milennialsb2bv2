-- ============================================================
-- Chamado: o loop de volta para o cliente (ADR-0018).
--
-- Toda feature de suporte constrói a caixa de entrada e esquece que ninguém
-- volta para olhar. O cliente abre o chamado, o staff responde três horas
-- depois, o cliente nunca mais entra no painel, e o thread morre. Todo vendor
-- estudado resolve isso com email — e nós não temos email.
--
-- Resolvemos in-app, porque nosso usuário é um time de vendas que vive dentro
-- do CRM o dia inteiro (ADR-0018, decisão 7). Um badge é visto em horas, não em
-- dias. O ping por WhatsApp é fallback de 24h, não canal primário — fatia
-- separada.
--
-- (1) `notifications.entity_id`
--
-- A tabela já tinha `lead_id`: um ponteiro para UMA entidade específica, que não
-- serve para um Chamado. Em vez de acrescentar `support_ticket_id` e depois
-- `workflow_id` e depois `order_id`, generaliza-se com `entity_id`. `type` já
-- diz de que entidade se trata. `lead_id` fica onde está — reescrevê-lo agora
-- seria uma migração de dados sem necessidade.
--
-- (2) O trigger
--
-- A notificação nasce no banco, não no console. Um `insert` feito pelo cliente
-- pode ser esquecido; um trigger não. E ele sabe distinguir os três casos que a
-- feature exige:
--
--   nota interna do staff  → não notifica (o cliente não deve nem saber que ela existe)
--   comentário do próprio autor → não notifica (ninguém se notifica)
--   comentário público de um master → notifica o autor do Chamado
--
-- (3) Realtime
--
-- `notifications` não estava na publicação — o `AlertsDropdown` fazia polling de
-- 60 segundos. Com a tabela publicada, o badge acende no instante em que a
-- resposta entra, e o polling vira rede de segurança em vez de mecanismo.
-- ============================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS entity_id UUID;

COMMENT ON COLUMN public.notifications.entity_id IS
  'Ponteiro generico para a entidade do `type` (ex.: support_tickets.id quando type = support_ticket_reply). Generaliza `lead_id` sem migra-lo.';

CREATE INDEX IF NOT EXISTS idx_notifications_user_type_entity
  ON public.notifications (user_id, type, entity_id)
  WHERE read_at IS NULL;

-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_support_ticket_reply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
BEGIN
  -- Nota interna: o cliente não deve nem saber que ela existe.
  IF NEW.is_internal THEN
    RETURN NEW;
  END IF;

  -- Só resposta do suporte notifica. Um comentário público de um admin da
  -- Organização é conversa dela consigo mesma.
  IF NOT public.is_master_user(NEW.author_user_id) THEN
    RETURN NEW;
  END IF;

  SELECT id, organization_id, author_user_id, title
    INTO t
    FROM public.support_tickets
   WHERE id = NEW.ticket_id;

  -- O autor pode ter deixado a empresa: o Chamado sobrevive a ele, mas não há
  -- quem notificar.
  IF t.author_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Ninguém se notifica.
  IF t.author_user_id = NEW.author_user_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (organization_id, user_id, type, title, description, entity_id)
  VALUES (
    t.organization_id,
    t.author_user_id,
    'support_ticket_reply',
    'O suporte respondeu seu chamado',
    left(t.title, 120),
    t.id
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_support_ticket_reply() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_support_ticket_reply_notification ON public.support_ticket_comments;
CREATE TRIGGER trg_support_ticket_reply_notification
  AFTER INSERT ON public.support_ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_support_ticket_reply();

-- ------------------------------------------------------------
-- Realtime. `ALTER PUBLICATION ... ADD TABLE` falha se a tabela já estiver
-- publicada; o DO block torna a migration re-executável.
-- ------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
