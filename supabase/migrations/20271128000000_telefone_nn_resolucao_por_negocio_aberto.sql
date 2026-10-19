-- Telefone N:N, PR2 (Chamados 99067f13 + 33c5fd52 - Cafe Jurere).
--
-- REGRA UNICA DE ENTRADA (decisao do CTO, 19/10/2026): a mensagem chega pelo
-- NUMERO do contato, sem vincular lead. Entre os leads VIVOS que tem o numero:
--   * 1 lead              -> ele (como hoje);
--   * 2+ e algum com NEGOCIO ABERTO (deals.closed_at IS NULL AND deleted_at IS
--     NULL, ligado por deals.source_lead_id) -> o lead cujo negocio aberto e o
--     mais recente (created_at DESC, id DESC); empate de lead por id;
--   * 2+ e NENHUM com negocio aberto -> lead_id fica NULL (nao vincula).
--
-- NAO muda indice unico (idx_leads_org_phone_unique segue valendo; e o PR3).
--
-- (1) resolve_message_lead_id: as 4 passadas viram 3 degraus de casamento
--     (exato -> BR movel normalizado -> sufixo-11), cada um sobre leads +
--     lead_phones VIVOS, com UM ranking so. O primeiro degrau que tem candidato
--     decide; se tem 2+ sem negocio aberto, decide NULL (nao cai pro degrau de
--     baixo). Mudanca de ordem consciente: lead_phones exato agora vem antes do
--     sufixo de leads (antes vinha depois). Sufixo-11 segue so em leads (como
--     antes). Indices usados: idx_leads_org_phone_digits,
--     lead_phones_org_digits_idx, lead_phones_org_br_mobile_idx,
--     idx_deals_source_lead.
-- (2) leads.phone_compartilhado: so preparacao, nada le ainda.
-- (3) adocao de mensagem/summary orfaos: nao adota se o numero ja tem OUTRO lead
--     vivo (senao um lead compartilhado novo rouba o historico).
-- (4) find_duplicate_leads: ignora par em que os DOIS tem phone_compartilhado
--     SO no criterio telefone (email e nome continuam listando o par). Em prod o corpo referencia a view
--     private.leads (fora do repo); aqui segue a forma do repo (public.leads,
--     tabela base; DEFINER le como owner), igual a 20271125000000. A view
--     private.leads pode nao enxergar a coluna nova.
--
-- Bases: definicoes vigentes em prod em 19/10/2026 (pg_get_functiondef).
-- Rollback: supabase/migrations/rollback/ com o mesmo nome.

BEGIN;
SET LOCAL lock_timeout = '3s';

-- (2) metadado puro: DEFAULT constante, sem rewrite.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone_compartilhado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.leads.phone_compartilhado IS
  'Telefone N:N: o lead divide o numero com outro lead de proposito. Hoje so find_duplicate_leads le.';

-- (1) resolucao de lead da mensagem
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

-- (3) adocao de orfas: nao rouba historico de numero que ja tem outro lead vivo
CREATE OR REPLACE FUNCTION public.tg_leads_adopt_orphan_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.normalized_phone IS NULL OR NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  -- Numero ja pertence a outro lead vivo: o historico orfao nao e deste lead.
  IF EXISTS (SELECT 1 FROM public.leads o
              WHERE o.organization_id = NEW.organization_id AND o.id <> NEW.id
                AND o.deleted_at IS NULL AND o.normalized_phone = NEW.normalized_phone)
     OR EXISTS (SELECT 1 FROM public.lead_phones p
                  JOIN public.leads o ON o.id = p.lead_id AND o.deleted_at IS NULL
                 WHERE p.organization_id = NEW.organization_id AND p.deleted_at IS NULL
                   AND p.lead_id <> NEW.id AND p.normalized_phone = NEW.normalized_phone) THEN
    RETURN NEW;
  END IF;
  UPDATE public.whatsapp_messages m SET lead_id = NEW.id
    WHERE m.lead_id IS NULL AND m.organization_id = NEW.organization_id AND m.normalized_phone = NEW.normalized_phone;
  UPDATE public.whatsapp_conversation_summary s SET lead_id = NEW.id, updated_at = now()
    WHERE s.lead_id IS NULL AND s.organization_id = NEW.organization_id AND s.normalized_phone = NEW.normalized_phone;
  RETURN NEW;
END $function$;

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
  -- Numero ja pertence a outro lead vivo: o historico orfao nao e deste lead.
  IF EXISTS (SELECT 1 FROM public.leads o
              WHERE o.organization_id = NEW.organization_id AND o.id <> NEW.lead_id
                AND o.deleted_at IS NULL AND o.normalized_phone = NEW.normalized_phone)
     OR EXISTS (SELECT 1 FROM public.lead_phones p
                  JOIN public.leads o ON o.id = p.lead_id AND o.deleted_at IS NULL
                 WHERE p.organization_id = NEW.organization_id AND p.deleted_at IS NULL
                   AND p.lead_id <> NEW.lead_id AND p.normalized_phone = NEW.normalized_phone) THEN
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

-- (4) find_duplicate_leads: par com os dois phone_compartilhado e ignorado
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
    FROM public.leads a
    JOIN public.leads b
      ON b.organization_id = a.organization_id
     AND a.id < b.id
     AND a.normalized_phone IS NOT NULL
     AND a.normalized_phone <> ''
     AND a.normalized_phone = b.normalized_phone
     AND b.deleted_at IS NULL
     AND NOT (a.phone_compartilhado AND b.phone_compartilhado)
    WHERE a.organization_id = p_organization_id
      AND a.deleted_at IS NULL

    UNION ALL

    SELECT
      a.id, a.name, a.phone, a.email, a.company,
      b.id, b.name, b.phone, b.email, b.company,
      'email'::text, 1.0::numeric, 2
    FROM public.leads a
    JOIN public.leads b
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
    FROM public.leads a
    JOIN public.leads b
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

COMMIT;
