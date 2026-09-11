-- Stop guided admission before rollback. Keep last published metadata and all
-- versions/pins; do not reconstruct a former workflow from guessed history.
BEGIN;
DROP TRIGGER IF EXISTS sync_guided_publication_discovery ON public.workflow_guided_publications;
DROP FUNCTION IF EXISTS public.sync_guided_publication_discovery();
NOTIFY pgrst, 'reload schema';
COMMIT;
