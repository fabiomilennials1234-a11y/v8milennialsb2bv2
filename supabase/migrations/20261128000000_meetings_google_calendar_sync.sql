-- ============================================================
-- Trigger: meetings → Google Calendar (sync Torque → Google)
--
-- Quando um meeting é criado/editado/excluído, dispara a edge function
-- `meeting-calendar-sync` via pg_net, que cria/edita/apaga o evento no
-- Google Calendar do criador (created_by) — se ele tiver Google conectado.
--
-- O sentido reverso (Google → Torque) já funciona via overlay em Agenda.tsx;
-- a dedup por google_event_id evita evento duplicado.
--
-- Auth: x-cron-secret (cron_config.cron_secret). URL em
-- cron_config.meeting_calendar_sync_url.
--
-- ⚠️ ANTI-LOOP: a edge function escreve google_event_id/meet_link de volta no
-- meeting. O trigger SÓ reage a mudança de colunas relevantes
-- (title/description/location/start_at/end_at/all_day/color), então o
-- write-back não re-dispara o Google.
-- ============================================================

-- Extensão p/ HTTP assíncrono (no-op se já existir)
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Garante cron_config (criada em 20260211000002_webhooks_cron)
CREATE TABLE IF NOT EXISTS public.cron_config (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ──────────────────────────────────────────────────────────────
-- Função do trigger
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_meeting_google_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url        text;
  v_secret     text;
  v_op         text;
  v_meeting_id uuid;
  v_created_by uuid;
  v_geid       text;
  v_user_id    uuid;
  v_relevant   boolean;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    v_op := 'insert';
    v_meeting_id := NEW.id;
    v_created_by := NEW.created_by;
    v_geid := NEW.google_event_id;

  ELSIF (TG_OP = 'UPDATE') THEN
    v_op := 'update';
    v_meeting_id := NEW.id;
    v_created_by := NEW.created_by;
    v_geid := NEW.google_event_id;

    -- Guard anti-loop: só sincroniza se mudou algo que o Google "vê".
    -- Ignora write-back de google_event_id/meet_link.
    v_relevant := (NEW.title       IS DISTINCT FROM OLD.title)
               OR (NEW.description IS DISTINCT FROM OLD.description)
               OR (NEW.location    IS DISTINCT FROM OLD.location)
               OR (NEW.start_at    IS DISTINCT FROM OLD.start_at)
               OR (NEW.end_at      IS DISTINCT FROM OLD.end_at)
               OR (NEW.all_day     IS DISTINCT FROM OLD.all_day)
               OR (NEW.color       IS DISTINCT FROM OLD.color);
    IF NOT v_relevant THEN
      RETURN NEW;
    END IF;

  ELSIF (TG_OP = 'DELETE') THEN
    v_op := 'delete';
    v_meeting_id := OLD.id;
    v_created_by := OLD.created_by;
    v_geid := OLD.google_event_id;

    -- Nada a apagar no Google se nunca foi sincronizado
    IF v_geid IS NULL THEN
      RETURN OLD;
    END IF;
  END IF;

  -- Resolve created_by (team_member) → auth user id (dono do calendário)
  SELECT user_id INTO v_user_id FROM team_members WHERE id = v_created_by;
  IF v_user_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Só prossegue se esse usuário tem Google conectado (evita invocação à toa)
  PERFORM 1 FROM google_calendar_tokens
   WHERE user_id = v_user_id AND is_active = true
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT value INTO v_url    FROM cron_config WHERE key = 'meeting_calendar_sync_url';
  SELECT value INTO v_secret FROM cron_config WHERE key = 'cron_secret';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE WARNING '[meeting_google_sync] meeting_calendar_sync_url não configurado em cron_config, pulando';
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM net.http_post(
    url     => v_url,
    headers => jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body    => jsonb_build_object(
      'meeting_id',      v_meeting_id::text,
      'op',              v_op,
      'google_event_id', v_geid,
      'created_by',      v_created_by::text,
      'user_id',         v_user_id::text
    )
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN others THEN
    -- Nunca bloqueia a transação do usuário por causa do sync
    RAISE WARNING '[meeting_google_sync] erro ao disparar sync: %', sqlerrm;
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- Triggers na tabela meetings
-- ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_meetings_google_sync_ins ON public.meetings;
CREATE TRIGGER trg_meetings_google_sync_ins
  AFTER INSERT ON public.meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_meeting_google_sync();

DROP TRIGGER IF EXISTS trg_meetings_google_sync_upd ON public.meetings;
CREATE TRIGGER trg_meetings_google_sync_upd
  AFTER UPDATE ON public.meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_meeting_google_sync();

DROP TRIGGER IF EXISTS trg_meetings_google_sync_del ON public.meetings;
CREATE TRIGGER trg_meetings_google_sync_del
  AFTER DELETE ON public.meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_meeting_google_sync();

-- ──────────────────────────────────────────────────────────────
-- ATIVAÇÃO (manual, por ambiente) — após deploy da edge function:
--   INSERT INTO public.cron_config (key, value) VALUES
--     ('meeting_calendar_sync_url',
--      'https://<PROJECT_REF>.supabase.co/functions/v1/meeting-calendar-sync'),
--     ('cron_secret', '<CRON_SECRET>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- Sem a URL configurada, o trigger apenas loga um warning e não sincroniza.
-- ──────────────────────────────────────────────────────────────

COMMENT ON FUNCTION public.trigger_meeting_google_sync IS
  'Dispara meeting-calendar-sync (pg_net) p/ refletir meetings no Google Calendar do created_by. Anti-loop: ignora write-back de google_event_id/meet_link.';
