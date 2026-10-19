-- Chamado b9ccde65 (Café Jurerê): "Não consigo vincular no meu chat".
--
-- Causa: as 3 primeiras passadas de `resolve_message_lead_id` consultavam `leads`
-- SEM `deleted_at IS NULL`. Mensagem nova de um número cujo lead foi apagado
-- grudava no lead apagado, e o chat não oferecia vincular/criar lead (medido em
-- 19/10: 62 telefones, 59 leads apagados, 7.229 mensagens da CJ presas).
-- O 4º passo (lead_phones) já filtrava `l.deleted_at IS NULL`.
--
-- Muda apenas: `AND l.deleted_at IS NULL` nas passadas 1, 2 e 3. Corpo restante
-- copiado da definição vigente em prod (pg_get_functiondef, 19/10/2026).
-- Sem DDL em tabela. Rollback: supabase/migrations/rollback/ com o mesmo nome.

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

COMMIT;
