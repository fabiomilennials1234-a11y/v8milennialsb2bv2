-- ============================================
-- MODULO UPSELL
-- ============================================
-- Data: 2026-02-21
-- Descricao: Cria tabelas, enums, RLS, indices, trigger e pipeline stages
--            para o modulo de Upsell (Base de Clientes + Campanhas).
-- Referencia: docs/design-upsell-module.md
-- IMPACTO: Apenas cria objetos NOVOS. Nenhuma tabela existente e alterada.
--          O trigger handle_proposta_vendida apenas LE tabelas existentes.
-- ============================================

-- ============================================
-- 1. ENUMS
-- ============================================

DO $$ BEGIN
  CREATE TYPE upsell_campanha_status AS ENUM (
    'cliente',
    'planejado',
    'abordado',
    'interesse',
    'proposta',
    'vendido',
    'futuro',
    'perdido'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE upsell_potencial AS ENUM (
    'baixo',
    'medio',
    'alto',
    'estrategico'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 2. TABELAS
-- ============================================

-- 2.1 upsell_clients - clientes na base
CREATE TABLE IF NOT EXISTS upsell_clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  -- dados herdados do lead (snapshot)
  name            TEXT NOT NULL,
  company         TEXT,
  email           TEXT,
  phone           TEXT,
  -- classificacao
  potencial       upsell_potencial NOT NULL DEFAULT 'medio',
  tipo_cliente_tempo TEXT NOT NULL DEFAULT 'novo',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  -- closer responsavel pela conta
  closer_id       UUID REFERENCES team_members(id) ON DELETE SET NULL,
  -- datas
  first_sale_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  churned_at      TIMESTAMPTZ,
  reactivated_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- constraints
  UNIQUE(organization_id, lead_id)
);

-- 2.2 upsell_client_products - produtos ativos do cliente
CREATE TABLE IF NOT EXISTS upsell_client_products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES upsell_clients(id) ON DELETE CASCADE,
  product_id       UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name     TEXT NOT NULL,
  product_type     TEXT NOT NULL CHECK (product_type IN ('mrr', 'projeto', 'unitario')),
  sale_value       NUMERIC(12,2) NOT NULL CHECK (sale_value >= 0),
  contract_duration INTEGER,
  status           TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'cancelado')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.3 upsell_campanhas - campanhas de abordagem
CREATE TABLE IF NOT EXISTS upsell_campanhas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES upsell_clients(id) ON DELETE CASCADE,
  closer_id         UUID REFERENCES team_members(id) ON DELETE SET NULL,
  status            upsell_campanha_status NOT NULL DEFAULT 'cliente',
  -- valores planejados
  mrr_planejado     NUMERIC(12,2) DEFAULT 0,
  projeto_planejado NUMERIC(12,2) DEFAULT 0,
  -- tracking
  data_abordagem    TIMESTAMPTZ,
  data_venda        TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.4 upsell_orders - registro de cada venda (fonte de verdade financeira)
CREATE TABLE IF NOT EXISTS upsell_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES upsell_clients(id) ON DELETE CASCADE,
  closer_id        UUID REFERENCES team_members(id) ON DELETE SET NULL,
  product_id       UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name     TEXT NOT NULL,
  product_type     TEXT NOT NULL CHECK (product_type IN ('mrr', 'projeto', 'unitario')),
  sale_value       NUMERIC(12,2) NOT NULL CHECK (sale_value > 0),
  origin           TEXT NOT NULL DEFAULT 'upsell' CHECK (origin IN ('new_business', 'upsell')),
  -- referencia opcional a campanha e proposta
  campanha_id      UUID REFERENCES upsell_campanhas(id) ON DELETE SET NULL,
  pipe_proposta_id UUID REFERENCES pipe_propostas(id) ON DELETE SET NULL,
  sold_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- 3. INDICES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_upsell_clients_org ON upsell_clients(organization_id);
CREATE INDEX IF NOT EXISTS idx_upsell_clients_lead ON upsell_clients(lead_id);
CREATE INDEX IF NOT EXISTS idx_upsell_clients_closer ON upsell_clients(closer_id);
CREATE INDEX IF NOT EXISTS idx_upsell_clients_active ON upsell_clients(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_upsell_client_products_client ON upsell_client_products(client_id);
CREATE INDEX IF NOT EXISTS idx_upsell_client_products_status ON upsell_client_products(client_id, status);

CREATE INDEX IF NOT EXISTS idx_upsell_campanhas_org_status ON upsell_campanhas(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_upsell_campanhas_client ON upsell_campanhas(client_id);
CREATE INDEX IF NOT EXISTS idx_upsell_campanhas_closer ON upsell_campanhas(closer_id);

CREATE INDEX IF NOT EXISTS idx_upsell_orders_org_sold ON upsell_orders(organization_id, sold_at);
CREATE INDEX IF NOT EXISTS idx_upsell_orders_client ON upsell_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_upsell_orders_closer_sold ON upsell_orders(closer_id, sold_at);
CREATE INDEX IF NOT EXISTS idx_upsell_orders_proposta ON upsell_orders(pipe_proposta_id);
CREATE INDEX IF NOT EXISTS idx_upsell_orders_campanha ON upsell_orders(campanha_id);

-- ============================================
-- 4. ROW LEVEL SECURITY
-- ============================================

ALTER TABLE upsell_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE upsell_client_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE upsell_campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE upsell_orders ENABLE ROW LEVEL SECURITY;

-- 4.1 upsell_clients
DROP POLICY IF EXISTS "upsell_clients_select_org" ON upsell_clients;
CREATE POLICY "upsell_clients_select_org" ON upsell_clients
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "upsell_clients_insert_org" ON upsell_clients;
CREATE POLICY "upsell_clients_insert_org" ON upsell_clients
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "upsell_clients_update_org" ON upsell_clients;
CREATE POLICY "upsell_clients_update_org" ON upsell_clients
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "upsell_clients_delete_org" ON upsell_clients;
CREATE POLICY "upsell_clients_delete_org" ON upsell_clients
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- 4.2 upsell_client_products (via join com upsell_clients)
DROP POLICY IF EXISTS "upsell_client_products_select" ON upsell_client_products;
CREATE POLICY "upsell_client_products_select" ON upsell_client_products
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM upsell_clients
      WHERE upsell_clients.id = upsell_client_products.client_id
      AND upsell_clients.organization_id = public.get_user_organization_id()
    )
  );

DROP POLICY IF EXISTS "upsell_client_products_insert" ON upsell_client_products;
CREATE POLICY "upsell_client_products_insert" ON upsell_client_products
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM upsell_clients
      WHERE upsell_clients.id = upsell_client_products.client_id
      AND upsell_clients.organization_id = public.get_user_organization_id()
    )
  );

DROP POLICY IF EXISTS "upsell_client_products_update" ON upsell_client_products;
CREATE POLICY "upsell_client_products_update" ON upsell_client_products
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM upsell_clients
      WHERE upsell_clients.id = upsell_client_products.client_id
      AND upsell_clients.organization_id = public.get_user_organization_id()
    )
  );

DROP POLICY IF EXISTS "upsell_client_products_delete" ON upsell_client_products;
CREATE POLICY "upsell_client_products_delete" ON upsell_client_products
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM upsell_clients
      WHERE upsell_clients.id = upsell_client_products.client_id
      AND upsell_clients.organization_id = public.get_user_organization_id()
    )
  );

-- 4.3 upsell_campanhas
DROP POLICY IF EXISTS "upsell_campanhas_select_org" ON upsell_campanhas;
CREATE POLICY "upsell_campanhas_select_org" ON upsell_campanhas
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "upsell_campanhas_insert_org" ON upsell_campanhas;
CREATE POLICY "upsell_campanhas_insert_org" ON upsell_campanhas
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "upsell_campanhas_update_org" ON upsell_campanhas;
CREATE POLICY "upsell_campanhas_update_org" ON upsell_campanhas
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "upsell_campanhas_delete_org" ON upsell_campanhas;
CREATE POLICY "upsell_campanhas_delete_org" ON upsell_campanhas
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- 4.4 upsell_orders
DROP POLICY IF EXISTS "upsell_orders_select_org" ON upsell_orders;
CREATE POLICY "upsell_orders_select_org" ON upsell_orders
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "upsell_orders_insert_org" ON upsell_orders;
CREATE POLICY "upsell_orders_insert_org" ON upsell_orders
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "upsell_orders_update_org" ON upsell_orders;
CREATE POLICY "upsell_orders_update_org" ON upsell_orders
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "upsell_orders_delete_org" ON upsell_orders;
CREATE POLICY "upsell_orders_delete_org" ON upsell_orders
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- ============================================
-- 5. PIPELINE STAGES - Kanban customizavel
-- ============================================

-- 5.1 Adicionar 'upsell_base' ao CHECK constraint de pipeline_stages
ALTER TABLE pipeline_stages DROP CONSTRAINT IF EXISTS pipeline_stages_pipeline_type_check;
ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_pipeline_type_check
  CHECK (pipeline_type IN ('whatsapp', 'confirmacao', 'propostas', 'upsell_base', 'upsell_gestao'));

-- 5.2 Atualizar funcao para incluir stages default de upsell_base
CREATE OR REPLACE FUNCTION create_default_pipeline_stages(org_id UUID)
RETURNS void AS $$
BEGIN
  -- Etapas do Pipeline WhatsApp/Qualificacao
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive) VALUES
    (org_id, 'whatsapp', 'novo', 'Novo', '#6366f1', 0, false),
    (org_id, 'whatsapp', 'abordado', 'Abordado', '#f59e0b', 1, false),
    (org_id, 'whatsapp', 'respondeu', 'Respondeu', '#3b82f6', 2, false),
    (org_id, 'whatsapp', 'esfriou', 'Esfriou', '#ef4444', 3, false),
    (org_id, 'whatsapp', 'agendado', 'Agendado', '#22c55e', 4, true)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Pipeline Confirmacao
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
    (org_id, 'confirmacao', 'reuniao_marcada', 'Reuniao Marcada', '#6366f1', 0, false, false),
    (org_id, 'confirmacao', 'confirmar_d5', 'Confirmar D-5', '#8b5cf6', 1, false, false),
    (org_id, 'confirmacao', 'confirmar_d3', 'Confirmar D-3', '#a855f7', 2, false, false),
    (org_id, 'confirmacao', 'confirmar_d2', 'Confirmar D-2', '#f59e0b', 3, false, false),
    (org_id, 'confirmacao', 'confirmar_d1', 'Confirmar D-1', '#f97316', 4, false, false),
    (org_id, 'confirmacao', 'confirmacao_no_dia', 'Confirmacao no Dia', '#ef4444', 5, false, false),
    (org_id, 'confirmacao', 'remarcar', 'Remarcar', '#f97316', 6, false, false),
    (org_id, 'confirmacao', 'compareceu', 'Compareceu', '#22c55e', 7, true, false),
    (org_id, 'confirmacao', 'perdido', 'Perdido', '#ef4444', 8, false, true)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Pipeline Propostas
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
    (org_id, 'propostas', 'marcar_compromisso', 'Marcar Compromisso', '#F5C518', 0, false, false),
    (org_id, 'propostas', 'reativar', 'Reativar', '#F97316', 1, false, false),
    (org_id, 'propostas', 'compromisso_marcado', 'Compromisso Marcado', '#3B82F6', 2, false, false),
    (org_id, 'propostas', 'esfriou', 'Esfriou', '#64748B', 3, false, false),
    (org_id, 'propostas', 'futuro', 'Futuro', '#8B5CF6', 4, false, false),
    (org_id, 'propostas', 'vendido', 'Vendido', '#22C55E', 5, true, false),
    (org_id, 'propostas', 'perdido', 'Perdido', '#EF4444', 6, false, true)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Upsell Base (colunas por tempo de contrato)
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
    (org_id, 'upsell_base', '0-3m',   '0-3 meses',   '#3B82F6', 0, false, false),
    (org_id, 'upsell_base', '3-6m',   '3-6 meses',   '#22C55E', 1, false, false),
    (org_id, 'upsell_base', '6-9m',   '6-9 meses',   '#F59E0B', 2, false, false),
    (org_id, 'upsell_base', '9-12m',  '9-12 meses',  '#EF4444', 3, false, false),
    (org_id, 'upsell_base', '12-18m', '12-18 meses',  '#8B5CF6', 4, false, false),
    (org_id, 'upsell_base', '18m+',   '18+ meses',    '#EC4899', 5, false, false)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- 5.3 Inserir stages upsell_base para organizacoes existentes
DO $$
DECLARE
  org RECORD;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
      (org.id, 'upsell_base', '0-3m',   '0-3 meses',   '#3B82F6', 0, false, false),
      (org.id, 'upsell_base', '3-6m',   '3-6 meses',   '#22C55E', 1, false, false),
      (org.id, 'upsell_base', '6-9m',   '6-9 meses',   '#F59E0B', 2, false, false),
      (org.id, 'upsell_base', '9-12m',  '9-12 meses',  '#EF4444', 3, false, false),
      (org.id, 'upsell_base', '12-18m', '12-18 meses',  '#8B5CF6', 4, false, false),
      (org.id, 'upsell_base', '18m+',   '18+ meses',    '#EC4899', 5, false, false)
    ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;
  END LOOP;
END $$;

-- ============================================
-- 6. TRIGGER: Propostas vendido -> Upsell
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_proposta_vendida()
RETURNS TRIGGER AS $$
DECLARE
  v_lead RECORD;
  v_client_id UUID;
  v_org_id UUID;
  v_item RECORD;
  v_has_items BOOLEAN := false;
BEGIN
  -- So dispara quando status muda para 'vendido'
  IF NEW.status <> 'vendido' OR (OLD.status IS NOT NULL AND OLD.status = 'vendido') THEN
    RETURN NEW;
  END IF;

  -- Verificar se ja existem orders para esta proposta (idempotencia)
  IF EXISTS (SELECT 1 FROM upsell_orders WHERE pipe_proposta_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Buscar lead e org
  SELECT * INTO v_lead FROM leads WHERE id = NEW.lead_id;
  IF v_lead IS NULL THEN
    RETURN NEW;
  END IF;
  v_org_id := v_lead.organization_id;
  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1. Criar ou buscar upsell_client
  INSERT INTO upsell_clients (
    organization_id, lead_id, name, company, email, phone,
    closer_id, first_sale_at
  ) VALUES (
    v_org_id, NEW.lead_id, v_lead.name, v_lead.company,
    v_lead.email, v_lead.phone, NEW.closer_id,
    COALESCE(NEW.closed_at, now())
  )
  ON CONFLICT (organization_id, lead_id) DO UPDATE
    SET updated_at = now()
  RETURNING id INTO v_client_id;

  -- 2. Para cada item da proposta, criar produto ativo + order
  FOR v_item IN
    SELECT ppi.*, p.name AS prod_name, p.type AS prod_type
    FROM pipe_proposta_items ppi
    LEFT JOIN products p ON p.id = ppi.product_id
    WHERE ppi.pipe_proposta_id = NEW.id
  LOOP
    v_has_items := true;

    -- Produto ativo no cliente
    INSERT INTO upsell_client_products (
      client_id, product_id, product_name, product_type,
      sale_value, contract_duration
    ) VALUES (
      v_client_id, v_item.product_id,
      COALESCE(v_item.prod_name, 'Produto'),
      COALESCE(v_item.prod_type, 'projeto'),
      COALESCE(v_item.sale_value, 0),
      NEW.contract_duration
    );

    -- Order (registro financeiro) - somente se valor > 0
    IF COALESCE(v_item.sale_value, 0) > 0 THEN
      INSERT INTO upsell_orders (
        organization_id, client_id, closer_id,
        product_id, product_name, product_type,
        sale_value, origin, pipe_proposta_id, sold_at
      ) VALUES (
        v_org_id, v_client_id, NEW.closer_id,
        v_item.product_id,
        COALESCE(v_item.prod_name, 'Produto'),
        COALESCE(v_item.prod_type, 'projeto'),
        v_item.sale_value,
        'new_business',
        NEW.id,
        COALESCE(NEW.closed_at, now())
      );
    END IF;
  END LOOP;

  -- 3. Fallback: proposta sem items (usa sale_value do nivel da proposta)
  IF NOT v_has_items AND COALESCE(NEW.sale_value, 0) > 0 THEN
    INSERT INTO upsell_client_products (
      client_id, product_id, product_name, product_type,
      sale_value, contract_duration
    ) VALUES (
      v_client_id, NEW.product_id,
      COALESCE((SELECT name FROM products WHERE id = NEW.product_id), 'Produto'),
      COALESCE(NEW.product_type::TEXT, 'projeto'),
      NEW.sale_value,
      NEW.contract_duration
    );

    INSERT INTO upsell_orders (
      organization_id, client_id, closer_id,
      product_id, product_name, product_type,
      sale_value, origin, pipe_proposta_id, sold_at
    ) VALUES (
      v_org_id, v_client_id, NEW.closer_id,
      NEW.product_id,
      COALESCE((SELECT name FROM products WHERE id = NEW.product_id), 'Produto'),
      COALESCE(NEW.product_type::TEXT, 'projeto'),
      NEW.sale_value,
      'new_business',
      NEW.id,
      COALESCE(NEW.closed_at, now())
    );
  END IF;

  -- 4. Criar campanha automatica ja como "vendido"
  INSERT INTO upsell_campanhas (
    organization_id, client_id, closer_id,
    status, data_venda
  ) VALUES (
    v_org_id, v_client_id, NEW.closer_id,
    'vendido', COALESCE(NEW.closed_at, now())
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger no UPDATE de pipe_propostas
DROP TRIGGER IF EXISTS trg_proposta_vendida ON pipe_propostas;
CREATE TRIGGER trg_proposta_vendida
  AFTER UPDATE ON pipe_propostas
  FOR EACH ROW
  EXECUTE FUNCTION handle_proposta_vendida();

-- ============================================
-- 7. FUNCAO updated_at automatico
-- ============================================

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_upsell_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_upsell_clients_updated_at ON upsell_clients;
CREATE TRIGGER trg_upsell_clients_updated_at
  BEFORE UPDATE ON upsell_clients
  FOR EACH ROW EXECUTE FUNCTION update_upsell_updated_at();

DROP TRIGGER IF EXISTS trg_upsell_campanhas_updated_at ON upsell_campanhas;
CREATE TRIGGER trg_upsell_campanhas_updated_at
  BEFORE UPDATE ON upsell_campanhas
  FOR EACH ROW EXECUTE FUNCTION update_upsell_updated_at();

-- ============================================
-- 8. REALTIME
-- ============================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE upsell_clients; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE upsell_client_products; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE upsell_campanhas; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE upsell_orders; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================
-- 9. LOG
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Upsell module migration completed successfully';
  RAISE NOTICE 'Tables created: upsell_clients, upsell_client_products, upsell_campanhas, upsell_orders';
  RAISE NOTICE 'Trigger created: trg_proposta_vendida on pipe_propostas';
  RAISE NOTICE 'Pipeline stages added: upsell_base (6 default columns)';
END $$;
