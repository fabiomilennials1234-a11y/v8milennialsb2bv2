-- Rollback do Telefone N:N PR2 (20271128000000): volta as definicoes vigentes em prod em 19/10/2026
-- (resolve_message_lead_id da 20271127, adocao de orfas e find_duplicate_leads com private.leads)
-- e remove leads.phone_compartilhado. find_duplicate_leads volta ANTES do DROP COLUMN.
-- ATENCAO: find_duplicate_leads volta a referenciar private.leads (existe so em prod).

BEGIN;
SET LOCAL lock_timeout = '3s';


CREATE OR REPLACE FUNCTION public.resolve_message_lead_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  resolved_id uuid;
  digits text;
  normalized text;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  digits := regexp_replace(COALESCE(NEW.phone_number, ''), '[^0-9]', '', 'g');
  IF digits = '' THEN
    RETURN NEW;
  END IF;

  -- Exact match on full digits
  SELECT l.id INTO resolved_id
  FROM leads l
  WHERE l.organization_id = NEW.organization_id
    AND l.deleted_at IS NULL
    AND l.phone_digits = digits
    AND l.phone_digits != ''
  LIMIT 1;

  -- BR mobile normalization match (handles 9th digit differences)
  IF resolved_id IS NULL AND length(digits) >= 10 THEN
    normalized := normalize_br_mobile(digits);
    SELECT l.id INTO resolved_id
    FROM leads l
    WHERE l.organization_id = NEW.organization_id
      AND l.deleted_at IS NULL
      AND l.phone_digits != ''
      AND length(l.phone_digits) >= 10
      AND normalize_br_mobile(l.phone_digits) = normalized
    LIMIT 1;
  END IF;

  -- Suffix match: last 11 digits (fallback for international numbers)
  IF resolved_id IS NULL AND length(digits) >= 10 THEN
    SELECT l.id INTO resolved_id
    FROM leads l
    WHERE l.organization_id = NEW.organization_id
      AND l.deleted_at IS NULL
      AND l.phone_digits != ''
      AND length(l.phone_digits) >= 10
      AND right(l.phone_digits, 11) = right(digits, 11)
    LIMIT 1;
  END IF;

  -- 4ª passada (Chamado 82c50502): telefones secundários do lead.
  -- Mesmo número em mais de um lead: vence o que tem negócio aberto com ESTE
  -- telefone; depois o telefone atualizado por último; id desempata.
  IF resolved_id IS NULL THEN
    SELECT lp.lead_id INTO resolved_id
    FROM lead_phones lp
    JOIN leads l ON l.id = lp.lead_id AND l.deleted_at IS NULL
    WHERE lp.organization_id = NEW.organization_id
      AND lp.deleted_at IS NULL
      AND lp.phone_digits = digits
    ORDER BY EXISTS (SELECT 1 FROM deals d
                      WHERE d.lead_phone_id = lp.id
                        AND d.closed_at IS NULL AND d.deleted_at IS NULL) DESC,
             lp.updated_at DESC, lp.id
    LIMIT 1;

    IF resolved_id IS NULL AND length(digits) >= 10 THEN
      normalized := normalize_br_mobile(digits);
      SELECT lp.lead_id INTO resolved_id
      FROM lead_phones lp
      JOIN leads l ON l.id = lp.lead_id AND l.deleted_at IS NULL
      WHERE lp.organization_id = NEW.organization_id
        AND lp.deleted_at IS NULL
        AND length(lp.phone_digits) >= 10
        AND normalize_br_mobile(lp.phone_digits) = normalized
      ORDER BY EXISTS (SELECT 1 FROM deals d
                        WHERE d.lead_phone_id = lp.id
                          AND d.closed_at IS NULL AND d.deleted_at IS NULL) DESC,
               lp.updated_at DESC, lp.id
      LIMIT 1;
    END IF;
  END IF;

  IF resolved_id IS NOT NULL THEN
    NEW.lead_id := resolved_id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_lead_phones_adopt_orphan_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.normalized_phone IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads l
                  WHERE l.id = NEW.lead_id AND l.deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;
  UPDATE public.whatsapp_messages m SET lead_id = NEW.lead_id
   WHERE m.lead_id IS NULL AND m.organization_id = NEW.organization_id
     AND m.normalized_phone = NEW.normalized_phone;
  UPDATE public.whatsapp_conversation_summary s SET lead_id = NEW.lead_id, updated_at = now()
   WHERE s.lead_id IS NULL AND s.organization_id = NEW.organization_id
     AND s.normalized_phone = NEW.normalized_phone;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_leads_adopt_orphan_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.normalized_phone IS NULL OR NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  UPDATE public.whatsapp_messages m SET lead_id = NEW.id
    WHERE m.lead_id IS NULL AND m.organization_id = NEW.organization_id AND m.normalized_phone = NEW.normalized_phone;
  UPDATE public.whatsapp_conversation_summary s SET lead_id = NEW.id, updated_at = now()
    WHERE s.lead_id IS NULL AND s.organization_id = NEW.organization_id AND s.normalized_phone = NEW.normalized_phone;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.find_duplicate_leads(p_organization_id uuid)
 RETURNS TABLE(lead_a_id uuid, lead_a_name text, lead_a_phone text, lead_a_email text, lead_a_company text, lead_b_id uuid, lead_b_name text, lead_b_phone text, lead_b_email text, lead_b_company text, match_type text, similarity numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  PERFORM public.assert_org_access(p_organization_id);

  RETURN QUERY
  WITH pairs AS (
    SELECT
      a.id AS a_id, a.name AS a_name, a.phone AS a_phone, a.email AS a_email, a.company AS a_company,
      b.id AS b_id, b.name AS b_name, b.phone AS b_phone, b.email AS b_email, b.company AS b_company,
      'phone'::text AS match_type,
      1.0::numeric  AS sim,
      1 AS priority
    FROM private.leads a
    JOIN private.leads b
      ON b.organization_id = a.organization_id
     AND a.id < b.id
     AND a.normalized_phone IS NOT NULL
     AND a.normalized_phone <> ''
     AND a.normalized_phone = b.normalized_phone
     AND b.deleted_at IS NULL
    WHERE a.organization_id = p_organization_id
      AND a.deleted_at IS NULL

    UNION ALL

    SELECT
      a.id, a.name, a.phone, a.email, a.company,
      b.id, b.name, b.phone, b.email, b.company,
      'email'::text, 1.0::numeric, 2
    FROM private.leads a
    JOIN private.leads b
      ON b.organization_id = a.organization_id
     AND a.id < b.id
     AND a.email IS NOT NULL
     AND a.email <> ''
     AND lower(a.email) = lower(b.email)
     AND b.deleted_at IS NULL
    WHERE a.organization_id = p_organization_id
      AND a.deleted_at IS NULL

    UNION ALL

    SELECT
      a.id, a.name, a.phone, a.email, a.company,
      b.id, b.name, b.phone, b.email, b.company,
      'name'::text,
      round(similarity(a.name, b.name)::numeric, 2),
      3
    FROM private.leads a
    JOIN private.leads b
      ON b.organization_id = a.organization_id
     AND a.id < b.id
     AND a.name % b.name
     AND similarity(a.name, b.name) >= 0.6
     AND b.deleted_at IS NULL
     AND length(btrim(b.name)) >= 4
    WHERE a.organization_id = p_organization_id
      AND a.deleted_at IS NULL
      AND a.name IS NOT NULL
      AND length(btrim(a.name)) >= 4
  )
  SELECT DISTINCT ON (p.a_id, p.b_id)
    p.a_id, p.a_name, p.a_phone, p.a_email, p.a_company,
    p.b_id, p.b_name, p.b_phone, p.b_email, p.b_company,
    p.match_type, p.sim
  FROM pairs p
  ORDER BY p.a_id, p.b_id, p.priority ASC;
END;
$function$;

ALTER TABLE public.leads DROP COLUMN IF EXISTS phone_compartilhado;

COMMIT;
