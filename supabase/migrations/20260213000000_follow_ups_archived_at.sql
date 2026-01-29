-- Add archived_at to follow_ups for archiving overdue and completed tasks
ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.follow_ups.archived_at IS 'When set, task is archived (hidden from main list); used for overdue/completed cleanup';
