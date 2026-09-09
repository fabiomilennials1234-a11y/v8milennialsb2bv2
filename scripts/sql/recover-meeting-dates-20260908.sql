-- Explicit data repair; run only after migration and approved target validation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Recovery is deliberately separate from touching meetings: no duplicate
-- outcome events, notifications or changes to meeting.updated_at.
-- Only one scheduled meeting for one entry, and only an absent date.
CREATE TEMP TABLE meeting_date_recovery ON COMMIT DROP AS
WITH candidates AS (
  SELECT m.*, public.fn_meeting_projection_entry(
    m.organization_id, m.deal_id, m.pipeline_id, m.lead_id) AS entry_id
  FROM public.meetings m WHERE m.event_type = 'meeting' AND m.status = 'scheduled'
), unique_meetings AS (
  SELECT *, count(*) OVER (PARTITION BY entry_id) AS competing FROM candidates
  WHERE entry_id IS NOT NULL
)
SELECT m.entry_id, m.id AS meeting_id, m.organization_id, m.start_at, m.meet_link,
  pe.metadata AS old_metadata
FROM unique_meetings m JOIN public.pipeline_entries pe ON pe.id = m.entry_id
WHERE m.competing = 1 AND NULLIF(pe.metadata->>'meeting_date', '') IS NULL;

CREATE SCHEMA IF NOT EXISTS backup;
CREATE TABLE IF NOT EXISTS backup.meeting_date_recovery_20271017 (
  entry_id uuid PRIMARY KEY, meeting_id uuid NOT NULL, organization_id uuid NOT NULL,
  old_metadata jsonb, projected_metadata jsonb NOT NULL
);
ALTER TABLE backup.meeting_date_recovery_20271017 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup.meeting_date_recovery_20271017 FROM PUBLIC, anon, authenticated;

INSERT INTO backup.meeting_date_recovery_20271017
SELECT entry_id, meeting_id, organization_id, old_metadata,
  COALESCE(old_metadata, '{}'::jsonb)
    || jsonb_build_object('meeting_date', start_at)
    || CASE WHEN meet_link IS NOT NULL THEN jsonb_build_object('meet_link', meet_link)
         ELSE '{}'::jsonb END
    || jsonb_build_object('agenda_espelho', jsonb_build_object(
      'meeting_id', meeting_id, 'rev', gen_random_uuid()::text, 'start_at', start_at))
FROM meeting_date_recovery ON CONFLICT (entry_id) DO NOTHING;

-- Preserve activity timestamps and avoid legacy mirror bounce during recovery.
-- Some installations have already retired the legacy trigger.
CREATE TEMP TABLE meeting_date_recovery_triggers ON COMMIT DROP AS
SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.pipeline_entries'::regclass
  AND tgenabled = 'O' AND tgname IN (
    'update_pipeline_entries_updated_at', 'trg_entry_touch_deal_activity',
    'trg_sync_whatsapp_stage_to_lead');
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tgname FROM meeting_date_recovery_triggers LOOP
    EXECUTE format('ALTER TABLE public.pipeline_entries DISABLE TRIGGER %I', t.tgname);
  END LOOP;
END $$;

UPDATE public.pipeline_entries pe SET metadata = b.projected_metadata
FROM backup.meeting_date_recovery_20271017 b
JOIN meeting_date_recovery r ON r.entry_id = b.entry_id
WHERE pe.id = b.entry_id AND pe.organization_id = b.organization_id
  AND pe.metadata IS NOT DISTINCT FROM b.old_metadata;
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tgname FROM meeting_date_recovery_triggers LOOP
    EXECUTE format('ALTER TABLE public.pipeline_entries ENABLE TRIGGER %I', t.tgname);
  END LOOP;
END $$;
COMMIT;
