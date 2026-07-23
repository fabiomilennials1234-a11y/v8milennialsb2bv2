-- Deal Aging: adds max_days_per_stage to pipeline_stages for stagnation thresholds.
-- stage_entered_at already exists on pipe_whatsapp/confirmacao/propostas (set by triggers).

-- Add configurable stagnation threshold per stage
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_stages' AND column_name = 'max_days_in_stage'
  ) THEN
    ALTER TABLE pipeline_stages ADD COLUMN max_days_in_stage int;
  END IF;
END $$;

COMMENT ON COLUMN pipeline_stages.max_days_in_stage IS
  'Maximum days a card should stay in this stage before being flagged as stagnant. NULL = no limit.';
