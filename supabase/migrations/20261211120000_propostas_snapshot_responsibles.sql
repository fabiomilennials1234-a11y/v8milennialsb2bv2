-- Snapshot de responsáveis lead → entry de Orçamentos (diagnóstico 2026-06-11).
--
-- A bridge Compareceu→Orçamentos (PipeWhatsapp.handleStatusChange) criava a
-- entry só com closer_id do lead — campo legado que orgs no modelo dual
-- (pre_sale/sale_responsible_id, #756) não preenchem. Resultado: vendas
-- "vendido" sem vendedor em nenhum dos 4 campos → invisíveis no ranking,
-- metas individuais e comissões (Milennials jun/2026: 3 de 6 vendas, R$ 10k).
--
-- pipe_propostas é VIEW sobre pipeline_entries (responsáveis no metadata
-- jsonb), então o trigger vai na tabela base, escopado ao pipe 'propostas'.
-- Backfill corrige entries órfãs existentes (só quando os 4 estão vazios).

CREATE OR REPLACE FUNCTION pipeline_entries_snapshot_responsibles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lead leads%ROWTYPE;
  v_slug text;
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  SELECT p.slug INTO v_slug FROM pipelines p WHERE p.id = NEW.pipeline_id;
  IF v_slug IS DISTINCT FROM 'propostas' THEN RETURN NEW; END IF;

  -- já veio com algum responsável → respeitar
  IF COALESCE(
       NULLIF(NEW.metadata->>'sale_responsible_id', ''),
       NULLIF(NEW.metadata->>'pre_sale_responsible_id', ''),
       NULLIF(NEW.metadata->>'closer_id', ''),
       NULLIF(NEW.metadata->>'responsible_id', '')
     ) IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_lead FROM leads WHERE id = NEW.lead_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'sale_responsible_id',     COALESCE(v_lead.sale_responsible_id, v_lead.closer_id, v_lead.responsible_id),
    'pre_sale_responsible_id', COALESCE(v_lead.pre_sale_responsible_id, v_lead.sdr_id, v_lead.responsible_id),
    'closer_id',               v_lead.closer_id,
    'responsible_id',          v_lead.responsible_id
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pe_snapshot_responsibles ON pipeline_entries;
CREATE TRIGGER trg_pe_snapshot_responsibles
  BEFORE INSERT ON pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION pipeline_entries_snapshot_responsibles();

-- Backfill das entries órfãs do pipe propostas
UPDATE pipeline_entries pe
SET metadata = COALESCE(pe.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
  'sale_responsible_id',     COALESCE(l.sale_responsible_id, l.closer_id, l.responsible_id),
  'pre_sale_responsible_id', COALESCE(l.pre_sale_responsible_id, l.sdr_id, l.responsible_id),
  'closer_id',               l.closer_id,
  'responsible_id',          l.responsible_id
))
FROM leads l, pipelines p
WHERE l.id = pe.lead_id
  AND p.id = pe.pipeline_id
  AND p.slug = 'propostas'
  AND p.type = 'system'
  AND COALESCE(
        NULLIF(pe.metadata->>'sale_responsible_id', ''),
        NULLIF(pe.metadata->>'pre_sale_responsible_id', ''),
        NULLIF(pe.metadata->>'closer_id', ''),
        NULLIF(pe.metadata->>'responsible_id', '')
      ) IS NULL
  AND COALESCE(l.sale_responsible_id, l.closer_id, l.responsible_id,
               l.pre_sale_responsible_id, l.sdr_id) IS NOT NULL;
