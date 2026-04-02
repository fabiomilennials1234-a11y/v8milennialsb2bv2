-- =============================================================================
-- Adiciona connection_type para separar conexões Facebook e Instagram
-- Permite que diferentes usuários conectem Facebook e Instagram separadamente
-- =============================================================================

-- 1. Adicionar coluna connection_type
ALTER TABLE meta_connections
  ADD COLUMN IF NOT EXISTS connection_type TEXT NOT NULL DEFAULT 'facebook';

-- 2. Constraint para valores válidos
DO $$ BEGIN
  ALTER TABLE meta_connections DROP CONSTRAINT IF EXISTS meta_connections_connection_type_check;
  ALTER TABLE meta_connections
    ADD CONSTRAINT meta_connections_connection_type_check
    CHECK (connection_type IN ('facebook', 'instagram'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Atualizar unique constraint para incluir connection_type
-- Isso permite o mesmo facebook_user_id ter duas conexões (uma facebook, uma instagram)
ALTER TABLE meta_connections
  DROP CONSTRAINT IF EXISTS meta_connections_organization_id_facebook_user_id_key;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_connections_org_fbuser_type_key'
  ) THEN
    ALTER TABLE meta_connections
      ADD CONSTRAINT meta_connections_org_fbuser_type_key
      UNIQUE (organization_id, facebook_user_id, connection_type);
  END IF;
END $$;

-- 4. Índice para filtrar por tipo
CREATE INDEX IF NOT EXISTS idx_meta_connections_type
  ON meta_connections(connection_type);
