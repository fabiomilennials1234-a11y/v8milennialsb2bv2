-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260715183122  name: omie_notas_fiscais
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

CREATE TABLE public.notas_fiscais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.upsell_clients(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.upsell_orders(id) ON DELETE SET NULL,
  external_source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_ref TEXT,
  chave_nfe TEXT,
  numero TEXT,
  valor NUMERIC,
  data_emissao TIMESTAMPTZ,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notas_fiscais_external UNIQUE (organization_id, external_source, external_id)
);

CREATE INDEX idx_notas_fiscais_organization_id ON public.notas_fiscais(organization_id);
CREATE INDEX idx_notas_fiscais_order_id ON public.notas_fiscais(order_id);
CREATE INDEX idx_notas_fiscais_client_id ON public.notas_fiscais(client_id);

ALTER TABLE public.notas_fiscais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notas_fiscais_member_select" ON public.notas_fiscais
  FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

GRANT SELECT ON public.notas_fiscais TO authenticated;

CREATE TRIGGER trg_notas_fiscais_updated_at
  BEFORE UPDATE ON public.notas_fiscais
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
