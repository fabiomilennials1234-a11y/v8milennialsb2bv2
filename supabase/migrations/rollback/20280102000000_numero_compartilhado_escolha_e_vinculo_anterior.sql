-- Rollback de 20280102000000_numero_compartilhado_escolha_e_vinculo_anterior.sql
--
-- Volta resolve_message_lead_id à definição vigente em prod em 09/11/2026
-- (pg_get_functiondef; igual à da 20271128000000): número em 2+ leads vivos só
-- vincula com negócio aberto. Depois remove a RPC, as peças private e a tabela
-- de escolha (as escolhas gravadas se perdem; mensagens já vinculadas pela RPC
-- continuam vinculadas — rollback não desvincula).
-- A função do trigger volta ANTES do DROP das peças private que ela chama.

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.resolve_message_lead_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  digits text;
  normalized text;
  n_cand int;
  top_id uuid;
  has_deal boolean;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  digits := regexp_replace(COALESCE(NEW.phone_number, ''), '[^0-9]', '', 'g');
  IF digits = '' THEN
    RETURN NEW;
  END IF;

  -- Degrau 1: digitos exatos (leads.phone + lead_phones).
  WITH cand AS (
    SELECT l.id AS lead_id
      FROM leads l
     WHERE l.organization_id = NEW.organization_id
       AND l.deleted_at IS NULL
       AND l.phone_digits = digits
       AND l.phone_digits != ''
    UNION
    SELECT lp.lead_id
      FROM lead_phones lp
      JOIN leads l ON l.id = lp.lead_id AND l.deleted_at IS NULL
     WHERE lp.organization_id = NEW.organization_id
       AND lp.deleted_at IS NULL
       AND lp.phone_digits = digits
  ), ranked AS (
    SELECT c.lead_id, od.created_at AS deal_at, od.id AS deal_id
      FROM cand c
      LEFT JOIN LATERAL (
        SELECT d.id, d.created_at
          FROM deals d
         WHERE d.source_lead_id = c.lead_id
           AND d.closed_at IS NULL AND d.deleted_at IS NULL
         ORDER BY d.created_at DESC, d.id DESC
         LIMIT 1
      ) od ON true
  )
  SELECT count(*)::int,
         (array_agg(r.lead_id ORDER BY (r.deal_id IS NULL), r.deal_at DESC, r.deal_id DESC, r.lead_id))[1],
         COALESCE(bool_or(r.deal_id IS NOT NULL), false)
    INTO n_cand, top_id, has_deal
    FROM ranked r;

  IF n_cand = 1 OR (n_cand > 1 AND has_deal) THEN
    NEW.lead_id := top_id;
    RETURN NEW;
  ELSIF n_cand > 1 THEN
    RETURN NEW; -- numero compartilhado sem negocio aberto: nao vincula
  END IF;

  IF length(digits) >= 10 THEN
    -- Degrau 2: BR movel normalizado (9o digito), leads.phone + lead_phones.
    normalized := normalize_br_mobile(digits);

    WITH cand AS (
      SELECT l.id AS lead_id
        FROM leads l
       WHERE l.organization_id = NEW.organization_id
         AND l.deleted_at IS NULL
         AND l.phone_digits != ''
         AND length(l.phone_digits) >= 10
         AND normalize_br_mobile(l.phone_digits) = normalized
      UNION
      SELECT lp.lead_id
        FROM lead_phones lp
        JOIN leads l ON l.id = lp.lead_id AND l.deleted_at IS NULL
       WHERE lp.organization_id = NEW.organization_id
         AND lp.deleted_at IS NULL
         AND length(lp.phone_digits) >= 10
         AND normalize_br_mobile(lp.phone_digits) = normalized
    ), ranked AS (
      SELECT c.lead_id, od.created_at AS deal_at, od.id AS deal_id
        FROM cand c
        LEFT JOIN LATERAL (
          SELECT d.id, d.created_at
            FROM deals d
           WHERE d.source_lead_id = c.lead_id
             AND d.closed_at IS NULL AND d.deleted_at IS NULL
           ORDER BY d.created_at DESC, d.id DESC
           LIMIT 1
        ) od ON true
    )
    SELECT count(*)::int,
           (array_agg(r.lead_id ORDER BY (r.deal_id IS NULL), r.deal_at DESC, r.deal_id DESC, r.lead_id))[1],
           COALESCE(bool_or(r.deal_id IS NOT NULL), false)
      INTO n_cand, top_id, has_deal
      FROM ranked r;

    IF n_cand = 1 OR (n_cand > 1 AND has_deal) THEN
      NEW.lead_id := top_id;
      RETURN NEW;
    ELSIF n_cand > 1 THEN
      RETURN NEW;
    END IF;

    -- Degrau 3: sufixo de 11 digitos (internacional), so leads.phone como antes.
    WITH cand AS (
      SELECT l.id AS lead_id
        FROM leads l
       WHERE l.organization_id = NEW.organization_id
         AND l.deleted_at IS NULL
         AND l.phone_digits != ''
         AND length(l.phone_digits) >= 10
         AND right(l.phone_digits, 11) = right(digits, 11)
    ), ranked AS (
      SELECT c.lead_id, od.created_at AS deal_at, od.id AS deal_id
        FROM cand c
        LEFT JOIN LATERAL (
          SELECT d.id, d.created_at
            FROM deals d
           WHERE d.source_lead_id = c.lead_id
             AND d.closed_at IS NULL AND d.deleted_at IS NULL
           ORDER BY d.created_at DESC, d.id DESC
           LIMIT 1
        ) od ON true
    )
    SELECT count(*)::int,
           (array_agg(r.lead_id ORDER BY (r.deal_id IS NULL), r.deal_at DESC, r.deal_id DESC, r.lead_id))[1],
           COALESCE(bool_or(r.deal_id IS NOT NULL), false)
      INTO n_cand, top_id, has_deal
      FROM ranked r;

    IF n_cand = 1 OR (n_cand > 1 AND has_deal) THEN
      NEW.lead_id := top_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP FUNCTION IF EXISTS public.escolher_lead_do_numero(uuid, text, uuid);
DROP FUNCTION IF EXISTS private.lead_do_numero_ambiguo(uuid, text, uuid[]);
DROP FUNCTION IF EXISTS private.ultimo_lead_vinculado_ao_numero(uuid, text);
DROP FUNCTION IF EXISTS private.leads_vivos_do_numero(uuid, text);
DROP FUNCTION IF EXISTS private.vinculo_de_lead_tem_efeito_externo(uuid);
DROP TABLE IF EXISTS public.whatsapp_numero_lead_escolhido;

COMMIT;
