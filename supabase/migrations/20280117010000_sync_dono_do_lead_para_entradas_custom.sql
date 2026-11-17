-- ════════════════════════════════════════════════════════════════════════════
-- Dono do lead → entradas de funil CUSTOM
-- ════════════════════════════════════════════════════════════════════════════
--
-- Incidente 2026-11-17: dois leads de uma org foram repassados de um
-- responsável para outro, mas continuaram na tela do responsável antigo.
--
-- Causa: a policy de leitura de `leads` (leads_select_by_responsibility_and_
-- permissions / strict_owner_leads_select) também libera o lead quando o
-- usuário aparece em `pipeline_entries.assigned_to` ou em
-- `pipeline_entries.metadata` (sdr_id, responsible_id, closer_id,
-- pre_sale_responsible_id, sale_responsible_id). A trigger
-- `sync_responsible_from_lead_to_pipes` só reescreve entradas de funil
-- `system` (whatsapp, confirmacao, propostas). Entrada em funil `custom` nunca
-- era atualizada; quando carregava o dono antigo, ele seguia vendo o lead.
-- O normal é a entrada custom nascer sem dono (assigned_to NULL, metadata
-- vazio), por isso só 2 leads da org foram afetados: vieram com metadata herdado
-- do funil de sistema.
--
-- Esta trigger espelha a troca de dono do lead nas entradas custom, e só onde
-- a entrada JÁ carrega o campo: entrada sem dono continua sem dono (não cria
-- visibilidade nova). Só dispara quando a coluna do lead mudou.
--
-- SECURITY DEFINER: a troca de dono já foi autorizada na própria UPDATE do
-- lead (zz_guard_strict_lead_assignment); a propagação não pode depender de o
-- ator enxergar a entrada por RLS. Função de trigger, EXECUTE revogado.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_owner_from_lead_to_custom_entries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.pipeline_entries pe
     SET assigned_to = CASE
           WHEN pe.assigned_to IS NOT NULL
            AND NEW.responsible_id IS DISTINCT FROM OLD.responsible_id
           THEN NEW.responsible_id
           ELSE pe.assigned_to END,
         metadata = COALESCE(pe.metadata, '{}'::jsonb) || COALESCE((
           SELECT jsonb_object_agg(k.chave, to_jsonb(k.novo))
             FROM (VALUES
                    ('sdr_id',                  NEW.sdr_id,                  OLD.sdr_id),
                    ('responsible_id',          NEW.responsible_id,          OLD.responsible_id),
                    ('closer_id',               NEW.closer_id,               OLD.closer_id),
                    ('pre_sale_responsible_id', NEW.pre_sale_responsible_id, OLD.pre_sale_responsible_id),
                    ('sale_responsible_id',     NEW.sale_responsible_id,     OLD.sale_responsible_id)
                  ) AS k(chave, novo, antigo)
            WHERE k.novo IS DISTINCT FROM k.antigo
              AND COALESCE(pe.metadata, '{}'::jsonb) ? k.chave
         ), '{}'::jsonb)
    FROM public.pipelines pip
   WHERE pip.id = pe.pipeline_id
     AND pip.type = 'custom'
     AND pe.lead_id = NEW.id
     AND pe.organization_id = NEW.organization_id;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_owner_from_lead_to_custom_entries() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_owner_from_lead_to_custom_entries ON public.leads;
CREATE TRIGGER trg_sync_owner_from_lead_to_custom_entries
  AFTER UPDATE OF responsible_id, sdr_id, closer_id, pre_sale_responsible_id, sale_responsible_id
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_owner_from_lead_to_custom_entries();
