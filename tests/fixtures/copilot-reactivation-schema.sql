-- Minimal PostgreSQL schema for executing the real Copilot RPCs in PGlite.
CREATE SCHEMA auth;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE team_members(id uuid PRIMARY KEY, organization_id uuid, user_id uuid, name text, is_active boolean DEFAULT true);
CREATE TABLE master_users(id uuid PRIMARY KEY, user_id uuid, is_active boolean DEFAULT true);
CREATE TABLE leads(id uuid PRIMARY KEY, organization_id uuid, normalized_phone text, ai_disabled boolean DEFAULT false, ai_disabled_at timestamptz, ai_disabled_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE phone_ai_preferences(organization_id uuid, normalized_phone text, ai_disabled boolean DEFAULT false, set_by uuid, set_at timestamptz, human_paused_until timestamptz, updated_at timestamptz DEFAULT now(), PRIMARY KEY(organization_id, normalized_phone));
CREATE TABLE conversations(id uuid PRIMARY KEY, organization_id uuid, lead_id uuid REFERENCES leads(id), state text, human_paused_until timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE lead_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, organization_id uuid, action text, description text, source text, metadata jsonb, created_by uuid);
CREATE TABLE master_audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), master_user_id uuid, user_id uuid, action text, target_type text, target_id uuid, target_name text, details jsonb);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION public.normalize_brazilian_phone(phone text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  cleaned TEXT;
BEGIN
  -- Se nulo ou vazio, retornar nulo
  IF phone IS NULL OR phone = '' THEN
    RETURN NULL;
  END IF;

  -- Remove tudo que não é dígito
  cleaned := regexp_replace(phone, '\D', '', 'g');

  -- Se vazio após limpeza, retornar nulo
  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  -- Remover prefixo internacional +55 ou 55 se presente (12+ dígitos)
  IF length(cleaned) >= 12 AND left(cleaned, 2) = '55' THEN
    cleaned := substring(cleaned from 3);
  END IF;

  -- Adicionar 9 se número celular de 8 dígitos (DDD + 8 dígitos = 10 dígitos)
  -- Celulares brasileiros: DDD(2) + 9(1) + número(8) = 11 dígitos
  IF length(cleaned) = 10 THEN
    -- Inserir 9 após o DDD
    cleaned := left(cleaned, 2) || '9' || substring(cleaned from 3);
  END IF;

  -- Formato final: 11 dígitos (DDD + 9 + 8 dígitos) para celular brasileiro
  -- Ou 10 dígitos para fixo (DDD + 8 dígitos)
  RETURN cleaned;
END;
$function$;
