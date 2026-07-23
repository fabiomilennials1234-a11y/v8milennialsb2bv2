-- 20270207000000_omie_titulos_receber.sql
-- S8 (#1108): Título / Conta a Receber — status de pagamento (ADR-0020). Entidade nova.
-- Um pedido/NF pode ter várias parcelas (títulos). Fonte-verdade é o ERP; membros
-- leem, escrita só por service_role (edge fn). status canônico: aberto|pago|atrasado.

CREATE TABLE public.titulos_receber (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.upsell_clients(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.upsell_orders(id) ON DELETE SET NULL,

  external_source TEXT NOT NULL,
  external_id TEXT NOT NULL,        -- codigo_lancamento_omie
  external_ref TEXT,
  valor NUMERIC,
  vencimento DATE,
  status TEXT NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'pago', 'atrasado')),
  pago_em TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_titulos_receber_external UNIQUE (organization_id, external_source, external_id)
);

CREATE INDEX idx_titulos_receber_organization_id ON public.titulos_receber(organization_id);
CREATE INDEX idx_titulos_receber_client_id ON public.titulos_receber(client_id);
CREATE INDEX idx_titulos_receber_order_id ON public.titulos_receber(order_id);
-- Consulta de inadimplência (S9): títulos atrasados por org.
CREATE INDEX idx_titulos_receber_atrasado
  ON public.titulos_receber(organization_id, client_id)
  WHERE status = 'atrasado';

ALTER TABLE public.titulos_receber ENABLE ROW LEVEL SECURITY;

CREATE POLICY "titulos_receber_member_select" ON public.titulos_receber
  FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

GRANT SELECT ON public.titulos_receber TO authenticated;

CREATE TRIGGER trg_titulos_receber_updated_at
  BEFORE UPDATE ON public.titulos_receber
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
