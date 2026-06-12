-- 20261213000000_backfill_lead_id_whatsapp_messages.sql
--
-- Fix C do incidente "Sem lead" no chat (lead existe no pipe mas a conversa
-- WhatsApp aparece sem vínculo). O vínculo conversa↔lead é o `lead_id` gravado
-- em `whatsapp_messages` no ingest. Quando um lead é criado/migrado DEPOIS das
-- suas mensagens, essas mensagens ficam com `lead_id = NULL` para sempre — o
-- trigger de summary só herda `lead_id` de INSERT novo, nunca re-resolve.
--
-- Resultado: a lista V3 (get_whatsapp_conversation_list lê lead_id da última
-- mensagem) e o summary servem lead_id NULL → badge "Sem lead".
--
-- Este migration conserta o DADO (o Fix A no frontend conserta só o display):
--   1. Backfill one-time: adota mensagens órfãs cujo telefone casa um lead.
--   2. Backfill do summary correspondente.
--   3. Trigger forward em `leads`: ao criar lead / editar telefone, adota
--      automaticamente as mensagens órfãs daquele número — auto-heal de futuras
--      migrações em massa.
--
-- Match SEMPRE escopado por organization_id (isolamento multi-tenant) +
-- normalized_phone (chave canônica, já mantida por leads_normalize_phone_trigger
-- e pelo ingest de whatsapp_messages).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Backfill one-time — mensagens órfãs → lead por telefone
-- ─────────────────────────────────────────────────────────────────────────────
-- Só toca linhas com lead_id NULL. Se um telefone casa >1 lead (duplicata não
-- resolvida), pega o lead mais antigo (determinístico, estável). Duplicatas são
-- um problema à parte (ver _lead_duplicates_audit).
WITH lead_for_phone AS (
  SELECT DISTINCT ON (l.organization_id, l.normalized_phone)
         l.organization_id, l.normalized_phone, l.id AS lead_id
  FROM public.leads l
  WHERE l.normalized_phone IS NOT NULL
    AND l.deleted_at IS NULL
  ORDER BY l.organization_id, l.normalized_phone, l.created_at ASC
)
UPDATE public.whatsapp_messages m
SET lead_id = lp.lead_id
FROM lead_for_phone lp
WHERE m.lead_id IS NULL
  AND m.organization_id = lp.organization_id
  AND m.normalized_phone = lp.normalized_phone;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Backfill do summary (lead_id NULL → match por telefone)
-- ─────────────────────────────────────────────────────────────────────────────
WITH lead_for_phone AS (
  SELECT DISTINCT ON (l.organization_id, l.normalized_phone)
         l.organization_id, l.normalized_phone, l.id AS lead_id
  FROM public.leads l
  WHERE l.normalized_phone IS NOT NULL
    AND l.deleted_at IS NULL
  ORDER BY l.organization_id, l.normalized_phone, l.created_at ASC
)
UPDATE public.whatsapp_conversation_summary s
SET lead_id = lp.lead_id, updated_at = now()
FROM lead_for_phone lp
WHERE s.lead_id IS NULL
  AND s.organization_id = lp.organization_id
  AND s.normalized_phone = lp.normalized_phone;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Trigger forward — lead criado / telefone editado adota mensagens órfãs
-- ─────────────────────────────────────────────────────────────────────────────
-- Dispara AFTER INSERT OR UPDATE OF phone. O trigger BEFORE de normalização
-- (leads_normalize_phone_trigger) já populou NEW.normalized_phone neste ponto.
-- SECURITY DEFINER: precisa escrever em whatsapp_messages/summary (RLS strict);
-- segurança garantida pelo filtro explícito em NEW.organization_id.
CREATE OR REPLACE FUNCTION public.tg_leads_adopt_orphan_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.normalized_phone IS NULL OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Lead em lixeira não deve adotar conversas.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.whatsapp_messages m
  SET lead_id = NEW.id
  WHERE m.lead_id IS NULL
    AND m.organization_id = NEW.organization_id
    AND m.normalized_phone = NEW.normalized_phone;

  UPDATE public.whatsapp_conversation_summary s
  SET lead_id = NEW.id, updated_at = now()
  WHERE s.lead_id IS NULL
    AND s.organization_id = NEW.organization_id
    AND s.normalized_phone = NEW.normalized_phone;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_leads_adopt_orphan_messages ON public.leads;
CREATE TRIGGER trg_leads_adopt_orphan_messages
  AFTER INSERT OR UPDATE OF phone ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_leads_adopt_orphan_messages();
