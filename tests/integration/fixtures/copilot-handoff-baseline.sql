-- Skeleton copied from PROD (jsjsmuncfkbsbzqzqhfq) on 2026-10-13 for
-- tests/integration/copilot-handoff-sticky.test.mjs.
-- Tables: only the columns the migration, the trigger and the RPC read/write.
-- Functions: verbatim pg_get_functiondef bodies (md5 pinned in the test).
-- Triggers: same definitions as prod (trg_leads_sync_ai_to_preferences,
-- trg_sync_ai_state_from_preferences, update_phone_ai_preferences_updated_at).
-- ACL of transfer_lead_to_human as prod: {postgres=X, service_role=X}.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.organizations (id uuid PRIMARY KEY);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  normalized_phone text,
  ai_disabled boolean DEFAULT false,
  ai_disabled_at timestamptz,
  ai_disabled_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TYPE public.ai_takeover_state_enum AS ENUM ('AI_ACTIVE', 'AI_PAUSED_MANUAL', 'HANDOFF_BACK', 'WAITING_HUMAN');

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'QUALIFYING',
  ai_state public.ai_takeover_state_enum NOT NULL DEFAULT 'AI_ACTIVE',
  ai_state_updated_at timestamptz,
  ai_state_updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.phone_ai_preferences (
    "organization_id" "uuid" NOT NULL,
    "normalized_phone" "text" NOT NULL,
    "ai_disabled" boolean DEFAULT false NOT NULL,
    "set_by" "uuid",
    "set_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "human_paused_until" timestamp with time zone,
    CONSTRAINT "phone_ai_preferences_normalized_phone_nonempty" CHECK (("length"("normalized_phone") > 0)),
    PRIMARY KEY (organization_id, normalized_phone),
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (set_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_ai_state_from_preferences()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_state public.ai_takeover_state_enum;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ai_disabled IS NOT DISTINCT FROM NEW.ai_disabled THEN
      RETURN NEW;
    END IF;
  END IF;

  v_target_state := CASE
    WHEN NEW.ai_disabled THEN 'AI_PAUSED_MANUAL'::public.ai_takeover_state_enum
    ELSE 'AI_ACTIVE'::public.ai_takeover_state_enum
  END;

  -- Bypass enforce_ai_state_transition via custom GUC (não requer superuser).
  PERFORM set_config('app.bypass_ai_state_enforce', 'true', true);

  UPDATE public.conversations c
  SET ai_state = v_target_state,
      ai_state_updated_at = now(),
      ai_state_updated_by = NEW.set_by
  FROM public.leads l
  WHERE c.lead_id = l.id
    AND l.organization_id = NEW.organization_id
    AND l.normalized_phone = NEW.normalized_phone
    AND CASE
      WHEN NEW.ai_disabled THEN c.ai_state IN ('AI_ACTIVE', 'HANDOFF_BACK', 'WAITING_HUMAN')
      ELSE c.ai_state IN ('AI_PAUSED_MANUAL')
    END;

  -- Limpa GUC pra não vazar pro resto da transação
  PERFORM set_config('app.bypass_ai_state_enforce', 'false', true);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_lead_ai_to_preferences()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Apenas quando a flag realmente muda
  IF NEW.ai_disabled IS DISTINCT FROM OLD.ai_disabled THEN
    -- Exige normalized_phone para ter chave canônica
    IF NEW.normalized_phone IS NOT NULL AND length(NEW.normalized_phone) > 0 THEN
      INSERT INTO public.phone_ai_preferences (
        organization_id, normalized_phone, ai_disabled, set_by, set_at
      ) VALUES (
        NEW.organization_id,
        NEW.normalized_phone,
        NEW.ai_disabled,
        NEW.ai_disabled_by,  -- Pode ser NULL se o caller não preencheu
        COALESCE(NEW.ai_disabled_at, now())
      )
      ON CONFLICT (organization_id, normalized_phone) DO UPDATE
      SET ai_disabled = EXCLUDED.ai_disabled,
          set_by = COALESCE(EXCLUDED.set_by, public.phone_ai_preferences.set_by),
          set_at = EXCLUDED.set_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_lead_to_human(p_lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'p_lead_id cannot be null';
  END IF;

  UPDATE public.leads
  SET ai_disabled = true,
      ai_disabled_at = COALESCE(ai_disabled_at, NOW()),
      updated_at = NOW()
  WHERE id = p_lead_id;

  UPDATE public.conversations
  SET state = 'WAITING_HUMAN',
      updated_at = NOW()
  WHERE lead_id = p_lead_id
    AND state <> 'WAITING_HUMAN';
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_lead_to_human(uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.transfer_lead_to_human(uuid) TO service_role;

CREATE TRIGGER trg_leads_sync_ai_to_preferences AFTER UPDATE OF ai_disabled ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.sync_lead_ai_to_preferences();
CREATE TRIGGER trg_sync_ai_state_from_preferences AFTER INSERT OR UPDATE OF ai_disabled ON public.phone_ai_preferences
  FOR EACH ROW EXECUTE FUNCTION public.sync_ai_state_from_preferences();
CREATE TRIGGER update_phone_ai_preferences_updated_at BEFORE UPDATE ON public.phone_ai_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
