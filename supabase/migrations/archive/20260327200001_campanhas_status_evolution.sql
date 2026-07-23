-- Create campaign_status enum
DO $$ BEGIN
  CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'paused', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create campaign_template_type enum
DO $$ BEGIN
  CREATE TYPE campaign_template_type AS ENUM ('indicacao', 'prospeccao', 'reativacao', 'livre');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add new columns to campanhas (additive, no breaking changes)
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS status campaign_status NOT NULL DEFAULT 'draft';
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS template_type campaign_template_type NOT NULL DEFAULT 'livre';
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS end_action JSONB;

-- Migrate existing data: active campaigns → status='active', inactive → status='ended'
UPDATE campanhas SET status = 'active', started_at = created_at WHERE is_active = true AND status = 'draft';
UPDATE campanhas SET status = 'ended', ended_at = COALESCE(updated_at, now()) WHERE is_active = false AND status = 'draft';

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_campanhas_status ON campanhas(status);
CREATE INDEX IF NOT EXISTS idx_campanhas_org_status ON campanhas(organization_id, status);
