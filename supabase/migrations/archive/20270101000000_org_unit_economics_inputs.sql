-- 20270101000000_org_unit_economics_inputs.sql
--
-- Master-only unit-economics inputs por organização.
--
-- A ferramenta master de unit economics deixa o OPERADOR DA PLATAFORMA (master,
-- sem team_member) selecionar uma org arbitrária e calcular CAC / Payback. Estes
-- são os PRESSUPOSTOS editáveis que o master digita (custos, % imposto/admin,
-- recompras) — NÃO são dados do tenant. Por isso a RLS é gateada em
-- `is_master_user()`, e NÃO em pertencimento à org: master não tem team_members,
-- então policies de isolamento por org (auth.org_id()) o bloqueariam.
--
-- Deny-all para qualquer não-master (membros/admins comuns não leem nem forjam).
--
-- Dois cenários por org (PK composta org+scenario):
--   'dados'    — números reais (num_vendas/ticket vêm ao vivo das vendas via RPC
--                master_get_org_sales_summary; aqui só guardamos os custos).
--   'projecao' — what-if: o master sobrescreve meta_num_vendas / meta_ticket_medio.

CREATE TABLE public.org_unit_economics_inputs (
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scenario          text NOT NULL DEFAULT 'dados'
                      CHECK (scenario IN ('dados', 'projecao')),
  anuncios          numeric(14, 2) NOT NULL DEFAULT 0,
  embalagem         numeric(14, 2) NOT NULL DEFAULT 0,
  frete             numeric(14, 2) NOT NULL DEFAULT 0,
  imposto_pct       numeric(6, 3)  NOT NULL DEFAULT 0,
  admin_pct         numeric(6, 3)  NOT NULL DEFAULT 0,
  recompras         integer        NOT NULL DEFAULT 0,
  -- Só usados no cenário 'projecao' (nullable).
  meta_num_vendas   integer,
  meta_ticket_medio numeric(14, 2),
  updated_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, scenario)
);

COMMENT ON TABLE public.org_unit_economics_inputs IS
  'Master-only: pressupostos de unit economics por org+cenário. RLS gateada em is_master_user(). Não legível pelo tenant.';

-- A PK (organization_id, scenario) já cobre lookups por organization_id
-- (coluna líder do índice da PK) — sem índice redundante.

-- updated_at via função compartilhada do repo.
CREATE TRIGGER trg_org_unit_economics_inputs_updated_at
  BEFORE UPDATE ON public.org_unit_economics_inputs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS: MASTER-ONLY (deny-all para o resto) ─────────────────────────────────
ALTER TABLE public.org_unit_economics_inputs ENABLE ROW LEVEL SECURITY;

-- SELECT — só master (padrão master_select_all_* do repo).
CREATE POLICY "master_select_all_org_unit_economics_inputs"
  ON public.org_unit_economics_inputs
  FOR SELECT
  USING (public.is_master_user());

-- INSERT/UPDATE/DELETE — só master. WITH CHECK impede escalada de privilégio
-- (regra inviolável: toda policy de escrita carrega WITH CHECK).
CREATE POLICY "master_all_org_unit_economics_inputs"
  ON public.org_unit_economics_inputs
  FOR ALL
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- A RLS é a fronteira de segurança; o GRANT só habilita o role. Sem policy
-- para não-master = deny-all efetivo.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_unit_economics_inputs TO authenticated;
