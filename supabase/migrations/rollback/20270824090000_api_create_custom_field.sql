-- Rollback de 20270824090000_api_create_custom_field.sql
DROP FUNCTION IF EXISTS public.api_create_custom_field(uuid, text, text, jsonb, boolean);
DROP FUNCTION IF EXISTS public.api_set_custom_fields_creating(uuid, uuid, jsonb);
