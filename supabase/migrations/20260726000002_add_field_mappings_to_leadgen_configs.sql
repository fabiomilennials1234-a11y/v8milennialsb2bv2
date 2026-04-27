-- =============================================================================
-- Adiciona coluna field_mappings (JSONB) na meta_leadgen_configs
-- Permite mapear campos do formulario Meta para campos do lead no CRM
-- Formato: [{ "meta_field": "full_name", "lead_field": "name" }, ...]
-- =============================================================================

ALTER TABLE meta_leadgen_configs
  ADD COLUMN IF NOT EXISTS field_mappings JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN meta_leadgen_configs.field_mappings IS
  'Mapeamento de campos do formulario Meta para campos do lead. Array de {meta_field, lead_field}.';
