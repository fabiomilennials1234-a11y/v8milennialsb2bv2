-- Fundação do Aviso — a notificação deixa de ser evento imutável e vira linha viva.
-- ADR-0035. Issue #1884.
--
-- Um Aviso nasce de um evento e absorve os seguintes que carregam a mesma chave
-- de agrupamento, enquanto não for lido. Lido, ele fecha: o próximo evento da
-- mesma chave nasce como Aviso novo.
--
-- A unicidade vale APENAS enquanto não lido — daí o índice parcial. O upsert
-- precisa repetir o predicado do índice no ON CONFLICT, ou o Postgres não casa
-- o árbitro e devolve 42P10.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS group_key     text,
  ADD COLUMN IF NOT EXISTS event_count   integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

COMMENT ON COLUMN public.notifications.group_key IS
  'Identidade sobre a qual o Aviso coalesce: msg:<lead_id>, wf:<workflow_id>, fup:<id>:<data>. Não é a entidade que o Aviso abre — essa é entity_id.';
COMMENT ON COLUMN public.notifications.event_count IS
  'Quantos eventos este Aviso absorveu desde que nasceu.';
COMMENT ON COLUMN public.notifications.last_event_at IS
  'Horário do último evento absorvido. É por aqui que a lista ordena, não por created_at.';

UPDATE public.notifications
   SET last_event_at = created_at
 WHERE last_event_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_unread_group_key_uniq
  ON public.notifications (user_id, group_key)
  WHERE read_at IS NULL AND group_key IS NOT NULL;

-- Emissão — o único lugar do sistema que escreve Aviso. Triggers e crons passam
-- por aqui para que o upsert (e o predicado do árbitro) exista uma vez só.
CREATE OR REPLACE FUNCTION public.fn_emit_aviso(
  p_organization_id uuid,
  p_user_id         uuid,
  p_type            text,
  p_group_key       text,
  p_title           text,
  p_description     text        DEFAULT NULL,
  p_link            text        DEFAULT NULL,
  p_lead_id         uuid        DEFAULT NULL,
  p_entity_id       uuid        DEFAULT NULL,
  p_occurred_at     timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_user_id IS NULL OR p_group_key IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications AS n (
    organization_id, user_id, type, title, description, link,
    lead_id, entity_id, group_key, event_count, last_event_at
  )
  VALUES (
    p_organization_id, p_user_id, p_type, p_title, p_description, p_link,
    p_lead_id, p_entity_id, p_group_key, 1, COALESCE(p_occurred_at, now())
  )
  ON CONFLICT (user_id, group_key) WHERE read_at IS NULL AND group_key IS NOT NULL
  DO UPDATE SET
    event_count   = n.event_count + 1,
    last_event_at = GREATEST(n.last_event_at, EXCLUDED.last_event_at),
    title         = EXCLUDED.title,
    description   = COALESCE(EXCLUDED.description, n.description),
    link          = COALESCE(EXCLUDED.link, n.link),
    entity_id     = COALESCE(EXCLUDED.entity_id, n.entity_id)
  RETURNING n.id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.fn_emit_aviso IS
  'Emite um Aviso (ADR-0035). Cria a linha ou absorve o evento na linha viva de mesma chave. Só service_role executa.';

-- Função DEFINER que escreve: fechada para anon/authenticated/PUBLIC (INV-2).
REVOKE ALL ON FUNCTION public.fn_emit_aviso(uuid, uuid, text, text, text, text, text, uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_emit_aviso(uuid, uuid, text, text, text, text, text, uuid, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.fn_emit_aviso(uuid, uuid, text, text, text, text, text, uuid, uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_emit_aviso(uuid, uuid, text, text, text, text, text, uuid, uuid, timestamptz) TO service_role;

-- Leitura do sino: destinatário + organização ativa + estado de leitura,
-- ordenada pelo último evento (não por created_at — ADR-0035).
CREATE INDEX IF NOT EXISTS notifications_recipient_org_unread_idx
  ON public.notifications (user_id, organization_id, read_at, last_event_at DESC);
