-- UF (Estado) — terceira pergunta padrão do lead + aba Mapa do Comando.
-- Decisões (grill 2026-06-11): leads.uf char(2) com check das 27 UFs;
-- uf_source registra proveniência (manual/webhook/ai vencem 'ddd' e nunca são
-- sobrescritos por ele); DDD do telefone deriva UF automaticamente (trigger +
-- backfill); mapa lê a base inteira via get_uf_heatmap.

-- ── Colunas ──────────────────────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS uf char(2),
  ADD COLUMN IF NOT EXISTS uf_source text;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_uf_check;
ALTER TABLE leads ADD CONSTRAINT leads_uf_check CHECK (uf IS NULL OR uf IN (
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SE','SP','TO'
));
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_uf_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_uf_source_check CHECK (
  uf_source IS NULL OR uf_source IN ('manual','webhook','ddd','ai')
);

CREATE INDEX IF NOT EXISTS idx_leads_org_uf ON leads (organization_id, uf) WHERE uf IS NOT NULL;

-- ── DDD → UF ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION uf_from_ddd(p_digits text)
RETURNS char(2)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
  ddd int;
BEGIN
  IF p_digits IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(p_digits, '\D', '', 'g');
  -- remove código do país (55) quando presente
  IF length(d) >= 12 AND d LIKE '55%' THEN d := substring(d from 3); END IF;
  IF length(d) < 10 THEN RETURN NULL; END IF;
  ddd := substring(d from 1 for 2)::int;
  RETURN CASE
    WHEN ddd BETWEEN 11 AND 19 THEN 'SP'
    WHEN ddd IN (21,22,24) THEN 'RJ'
    WHEN ddd IN (27,28) THEN 'ES'
    WHEN ddd IN (31,32,33,34,35,37,38) THEN 'MG'
    WHEN ddd BETWEEN 41 AND 46 THEN 'PR'
    WHEN ddd IN (47,48,49) THEN 'SC'
    WHEN ddd IN (51,53,54,55) THEN 'RS'
    WHEN ddd = 61 THEN 'DF'
    WHEN ddd IN (62,64) THEN 'GO'
    WHEN ddd = 63 THEN 'TO'
    WHEN ddd IN (65,66) THEN 'MT'
    WHEN ddd = 67 THEN 'MS'
    WHEN ddd = 68 THEN 'AC'
    WHEN ddd = 69 THEN 'RO'
    WHEN ddd IN (71,73,74,75,77) THEN 'BA'
    WHEN ddd = 79 THEN 'SE'
    WHEN ddd IN (81,87) THEN 'PE'
    WHEN ddd = 82 THEN 'AL'
    WHEN ddd = 83 THEN 'PB'
    WHEN ddd = 84 THEN 'RN'
    WHEN ddd IN (85,88) THEN 'CE'
    WHEN ddd IN (86,89) THEN 'PI'
    WHEN ddd IN (91,93,94) THEN 'PA'
    WHEN ddd IN (92,97) THEN 'AM'
    WHEN ddd = 95 THEN 'RR'
    WHEN ddd = 96 THEN 'AP'
    WHEN ddd IN (98,99) THEN 'MA'
    ELSE NULL
  END;
END;
$$;

-- ── Trigger: deriva UF do DDD sem nunca sobrescrever resposta explícita ─────
CREATE OR REPLACE FUNCTION leads_derive_uf_from_ddd()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  derived char(2);
BEGIN
  IF (NEW.uf IS NULL OR NEW.uf_source = 'ddd') THEN
    derived := uf_from_ddd(COALESCE(NEW.phone_digits, NEW.phone));
    IF derived IS NOT NULL THEN
      NEW.uf := derived;
      NEW.uf_source := 'ddd';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_derive_uf ON leads;
CREATE TRIGGER trg_leads_derive_uf
  BEFORE INSERT OR UPDATE OF phone, phone_digits, uf ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_derive_uf_from_ddd();

-- ── Backfill da base inteira ─────────────────────────────────────────────────
UPDATE leads
SET uf = uf_from_ddd(COALESCE(phone_digits, phone)), uf_source = 'ddd'
WHERE uf IS NULL
  AND uf_from_ddd(COALESCE(phone_digits, phone)) IS NOT NULL;

-- ── RPC: agregado do mapa (base inteira da org) ──────────────────────────────
CREATE OR REPLACE FUNCTION get_uf_heatmap()
RETURNS TABLE(
  uf char(2),
  leads_count bigint,
  clients_count bigint,
  total_sold numeric,
  unmapped_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_org_id uuid;
  v_unmapped bigint;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_unmapped
  FROM leads l
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf IS NULL;

  RETURN QUERY
  SELECT
    l.uf,
    count(*)::bigint AS leads_count,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM pipe_propostas pp
      WHERE pp.lead_id = l.id AND pp.status = 'vendido'
    ))::bigint AS clients_count,
    COALESCE(SUM((
      SELECT SUM(pp.sale_value) FROM pipe_propostas pp
      WHERE pp.lead_id = l.id AND pp.status = 'vendido'
    )), 0)::numeric AS total_sold,
    v_unmapped AS unmapped_count
  FROM leads l
  WHERE l.organization_id = v_org_id
    AND l.deleted_at IS NULL
    AND l.uf IS NOT NULL
  GROUP BY l.uf;
END;
$$;

-- ── RPC: relatório de um estado ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_leads_by_uf(p_uf char(2), p_limit int DEFAULT 60)
RETURNS TABLE(
  id uuid,
  name text,
  company text,
  phone text,
  uf_source text,
  is_client boolean,
  sold_value numeric,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_org_id uuid;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    l.id, l.name, l.company, l.phone, l.uf_source,
    EXISTS (
      SELECT 1 FROM pipe_propostas pp
      WHERE pp.lead_id = l.id AND pp.status = 'vendido'
    ) AS is_client,
    COALESCE((
      SELECT SUM(pp.sale_value) FROM pipe_propostas pp
      WHERE pp.lead_id = l.id AND pp.status = 'vendido'
    ), 0)::numeric AS sold_value,
    l.created_at
  FROM leads l
  WHERE l.organization_id = v_org_id
    AND l.deleted_at IS NULL
    AND l.uf = p_uf
  ORDER BY sold_value DESC, l.created_at DESC
  LIMIT p_limit;
END;
$$;
