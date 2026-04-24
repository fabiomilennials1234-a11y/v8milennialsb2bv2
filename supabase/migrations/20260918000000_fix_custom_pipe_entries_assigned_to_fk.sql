-- ────────────────────────────────────────────────────────────
-- Fix: custom_pipe_entries.assigned_to FK alinha com resto do sistema
-- ────────────────────────────────────────────────────────────
-- Contexto:
--   custom_pipe_entries.assigned_to referenciava profiles(id), porém
--   todo o sistema (pipe_whatsapp/confirmacao/propostas/pipe_distribution/
--   campanhas/upsell) usa team_members(id). Frontend envia team_members.id
--   via useTeamMembers(), causando FK violation silenciosa no import de
--   leads em funis customizados (bug reportado: "importar não popula funil").
--
-- Ação:
--   1) Limpa rows órfãs (assigned_to não-null apontando pra FK quebrada)
--   2) DROP constraint antiga (profiles)
--   3) ADD nova constraint (team_members) com ON DELETE SET NULL
--   4) Idempotente via DO blocks — seguro em re-run
-- ────────────────────────────────────────────────────────────

-- 1) Nullify FKs que não são válidas em nenhuma das duas tabelas (segurança)
UPDATE public.custom_pipe_entries cpe
SET assigned_to = NULL
WHERE cpe.assigned_to IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.id = cpe.assigned_to)
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = cpe.assigned_to);

-- 2) Drop constraint antiga (nome pode variar — busca dinâmica)
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.custom_pipe_entries'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) ILIKE '%REFERENCES%profiles%'
    AND conkey = ARRAY[(
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.custom_pipe_entries'::regclass
        AND attname = 'assigned_to'
    )]::smallint[];

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.custom_pipe_entries DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE 'Dropped old FK: %', v_constraint_name;
  ELSE
    RAISE NOTICE 'No profiles FK on custom_pipe_entries.assigned_to — skipping drop';
  END IF;
END $$;

-- 3) Converter rows que apontam pra profiles(id) → team_members(id) correspondente
--    via profiles.id == team_members.user_id (quando houver match na mesma org)
--    Quando múltiplos team_members ativos por profile/org, escolhe o mais recente ativo.
DO $$
DECLARE
  v_converted_count INT;
BEGIN
  WITH candidates AS (
    SELECT DISTINCT ON (cpe.id)
      cpe.id AS entry_id,
      tm.id AS new_assigned_to
    FROM public.custom_pipe_entries cpe
    JOIN public.team_members tm
      ON tm.user_id = cpe.assigned_to
     AND tm.organization_id = cpe.organization_id
    WHERE cpe.assigned_to IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.team_members tm2 WHERE tm2.id = cpe.assigned_to
      )
    ORDER BY cpe.id, tm.is_active DESC, tm.updated_at DESC NULLS LAST
  ),
  converted AS (
    UPDATE public.custom_pipe_entries cpe
    SET assigned_to = c.new_assigned_to
    FROM candidates c
    WHERE cpe.id = c.entry_id
    RETURNING cpe.id
  )
  SELECT COUNT(*) INTO v_converted_count FROM converted;

  RAISE NOTICE 'custom_pipe_entries: convertidas % row(s) de profiles(id) → team_members(id)', v_converted_count;
END $$;

-- 4) Nullify rows que ainda não casam com team_members (resto órfão)
DO $$
DECLARE
  v_nullified_count INT;
BEGIN
  WITH nullified AS (
    UPDATE public.custom_pipe_entries
    SET assigned_to = NULL
    WHERE assigned_to IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.id = assigned_to)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_nullified_count FROM nullified;

  RAISE NOTICE 'custom_pipe_entries: nullificadas % row(s) órfãs sem match em team_members', v_nullified_count;
END $$;

-- 5) Add new FK → team_members(id) ON DELETE SET NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.custom_pipe_entries'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) ILIKE '%REFERENCES%team_members%'
      AND conkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.custom_pipe_entries'::regclass
          AND attname = 'assigned_to'
      )]::smallint[]
  ) THEN
    ALTER TABLE public.custom_pipe_entries
      ADD CONSTRAINT custom_pipe_entries_assigned_to_fkey
      FOREIGN KEY (assigned_to)
      REFERENCES public.team_members(id)
      ON DELETE SET NULL;
    RAISE NOTICE 'Added new FK: custom_pipe_entries_assigned_to_fkey → team_members(id)';
  END IF;
END $$;

COMMENT ON COLUMN public.custom_pipe_entries.assigned_to IS
  'Responsável pelo lead nesse funil customizado. FK → team_members(id). Alinhado com pipe_whatsapp/confirmacao/propostas.';
