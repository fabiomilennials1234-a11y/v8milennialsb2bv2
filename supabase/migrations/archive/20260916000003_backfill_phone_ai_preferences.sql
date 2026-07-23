-- ============================================================================
-- Backfill phone_ai_preferences a partir de leads.ai_disabled existentes.
--
-- Motivação (QA review 2026-04-22): 173 leads em produção têm ai_disabled=true
-- e não há entrada correspondente em phone_ai_preferences (tabela recém-criada).
-- Sem este backfill, uma nova duplicata de lead criada via webhook após a
-- migração nasceria com ai_disabled=false, divergindo do lead antigo — o
-- mesmo bug que FR-04 (duplicatas consistentes) prometia eliminar.
--
-- Estratégia:
--   - UPSERT em phone_ai_preferences para cada (org, normalized_phone)
--     onde existe algum lead com ai_disabled=true.
--   - Preferência "ganha" se QUALQUER lead no grupo tiver ai_disabled=true
--     (política conservadora: se o usuário desligou para um dos duplicados,
--     a intenção era desligar para o telefone).
--   - set_by = o ai_disabled_by do lead mais recente com flag true.
--   - set_at = o ai_disabled_at do lead mais recente com flag true (ou now()
--     como fallback).
--   - ON CONFLICT DO NOTHING: se já houver preferência (caso migration 3 já
--     tenha sincronizado via trigger), não sobrescreve.
--
-- Idempotente: pode ser re-rodada sem efeitos adicionais.
-- ============================================================================

INSERT INTO public.phone_ai_preferences (
  organization_id, normalized_phone, ai_disabled, set_by, set_at, created_at
)
SELECT
  l.organization_id,
  l.normalized_phone,
  true AS ai_disabled,
  -- Pega ai_disabled_by do lead mais recente com flag true (deterministic via LIMIT 1)
  (
    SELECT l2.ai_disabled_by
    FROM public.leads l2
    WHERE l2.organization_id = l.organization_id
      AND l2.normalized_phone = l.normalized_phone
      AND l2.ai_disabled = true
    ORDER BY COALESCE(l2.ai_disabled_at, l2.updated_at) DESC NULLS LAST
    LIMIT 1
  ) AS set_by,
  COALESCE(
    (
      SELECT COALESCE(l2.ai_disabled_at, l2.updated_at, l2.created_at)
      FROM public.leads l2
      WHERE l2.organization_id = l.organization_id
        AND l2.normalized_phone = l.normalized_phone
        AND l2.ai_disabled = true
      ORDER BY COALESCE(l2.ai_disabled_at, l2.updated_at) DESC NULLS LAST
      LIMIT 1
    ),
    now()
  ) AS set_at,
  now() AS created_at
FROM public.leads l
WHERE l.ai_disabled = true
  AND l.normalized_phone IS NOT NULL
  AND length(l.normalized_phone) > 0
GROUP BY l.organization_id, l.normalized_phone
ON CONFLICT (organization_id, normalized_phone) DO NOTHING;

-- Sync reverso: garante que se houver duplicatas no mesmo (org, phone) onde
-- alguns têm ai_disabled=true e outros false, todos ficam true (política
-- conservadora — um toggle off afetava todos; queremos manter isso).
UPDATE public.leads l
SET ai_disabled = true,
    ai_disabled_at = COALESCE(l.ai_disabled_at, now()),
    ai_disabled_by = COALESCE(l.ai_disabled_by, (
      SELECT set_by FROM public.phone_ai_preferences p
      WHERE p.organization_id = l.organization_id
        AND p.normalized_phone = l.normalized_phone
    ))
WHERE l.ai_disabled = false
  AND l.normalized_phone IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.phone_ai_preferences p
    WHERE p.organization_id = l.organization_id
      AND p.normalized_phone = l.normalized_phone
      AND p.ai_disabled = true
  );
