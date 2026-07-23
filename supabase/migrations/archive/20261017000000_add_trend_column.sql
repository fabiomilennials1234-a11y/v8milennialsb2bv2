ALTER TABLE upsell_clients
  ADD COLUMN IF NOT EXISTS trend TEXT CHECK (trend IN ('up', 'stable', 'down'));
