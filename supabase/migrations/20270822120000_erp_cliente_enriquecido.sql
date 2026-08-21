-- 20270822120000_erp_cliente_enriquecido.sql
--
-- Campos de enriquecimento do cliente vindos do ERP, e o filtro de empresa do
-- grupo na conexão do Toth.
--
-- Por que existe: `GET /clientes` do Toth devolve **56 campos** e a carteira
-- guardava 6 (nome, empresa, cnpj, telefone, e-mail, id externo). O que ficava
-- de fora não é acessório — é o que decide atendimento:
--
--   • `atendimentos[].nomeRepresentante` — o vendedor dono da conta. 93% dos
--     clientes têm; no CRM os 12,6 mil entraram com responsável VAZIO.
--   • `atendimentos[].nomeFantasiaEmpresa` — a base do Toth atende QUATRO
--     empresas do grupo (CAFE JURERE 11.182, CAMIPLACE 524, COSTA ESMERALDA
--     107, ALIMENTA MAIS 36). Sem esse campo, a carteira de uma organização
--     recebe cliente que é de outra empresa.
--   • `descricaoTipoMercado` — segmentação real (TELEVENDAS-VAREJO, ENVASE,
--     E-COMMERCE, LICITAÇÃO, MERCADO LIVRE...).
--   • `situacaoParceiro` — situação no ERP. Guardado CRU de propósito: os
--     valores observados são 0/1/2/3 e **ninguém sabe o que significam**.
--     Traduzir para "ativo/inativo" agora seria inventar semântica; quando o
--     fornecedor responder, o mapeamento é uma migration de leitura, não uma
--     recarga.
--
-- As colunas são `erp_*` e não `toth_*`: são genéricas da capacidade ERP do
-- ADR-0020. Omie e Tiny podem preenchê-las sem migration nova.
--
-- Só schema (guarda F4): nenhum backfill de dado de cliente aqui.

-- ─────────────────────────────────────────────────────────────────────────────
-- Cliente da carteira
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.upsell_clients
  ADD COLUMN IF NOT EXISTS erp_company            TEXT,
  ADD COLUMN IF NOT EXISTS erp_owner_name         TEXT,
  ADD COLUMN IF NOT EXISTS erp_owner_external_id  TEXT,
  ADD COLUMN IF NOT EXISTS erp_status             TEXT,
  ADD COLUMN IF NOT EXISTS erp_segment            TEXT,
  ADD COLUMN IF NOT EXISTS erp_registered_at      DATE,
  ADD COLUMN IF NOT EXISTS erp_city               TEXT,
  ADD COLUMN IF NOT EXISTS erp_uf                 TEXT,
  ADD COLUMN IF NOT EXISTS erp_metadata           JSONB;

COMMENT ON COLUMN public.upsell_clients.erp_company IS
  'Empresa do grupo que atende o cliente no ERP (Toth: atendimentos[].nomeFantasiaEmpresa). Cliente atendido por mais de uma guarda a que a conexão filtrou.';
COMMENT ON COLUMN public.upsell_clients.erp_owner_name IS
  'Nome do representante/vendedor dono da conta no ERP. É rótulo, NÃO vínculo: não referencia team_members.';
COMMENT ON COLUMN public.upsell_clients.erp_owner_external_id IS
  'Id do representante no ERP. Chave para, no futuro, casar com um team_member de verdade.';
COMMENT ON COLUMN public.upsell_clients.erp_status IS
  'Situação do parceiro no ERP, CRUA. Toth devolve 0/1/2/3 sem legenda — não traduzir sem confirmação do fornecedor.';
COMMENT ON COLUMN public.upsell_clients.erp_segment IS
  'Segmento/tipo de mercado do cliente no ERP (Toth: descricaoTipoMercado).';
COMMENT ON COLUMN public.upsell_clients.erp_registered_at IS
  'Data de cadastro do cliente NO ERP. Não confundir com first_sale_at: cadastro não é venda.';
COMMENT ON COLUMN public.upsell_clients.erp_metadata IS
  'Campos do ERP sem coluna dedicada (endereço completo, inscrição estadual, tipo de pessoa, grupo de parceiro). Guardar aqui evita uma migration por campo novo.';

-- Filtrar a carteira por empresa do grupo e listar por vendedor são as duas
-- leituras que a UI faz; ambas já chegam com organization_id.
CREATE INDEX IF NOT EXISTS idx_upsell_clients_org_erp_company
  ON public.upsell_clients (organization_id, erp_company)
  WHERE erp_company IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_upsell_clients_org_erp_owner
  ON public.upsell_clients (organization_id, erp_owner_name)
  WHERE erp_owner_name IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Conexão do Toth: qual empresa do grupo sincronizar
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.toth_connections
  ADD COLUMN IF NOT EXISTS clientes_empresa TEXT,
  ADD COLUMN IF NOT EXISTS clientes_incluir_sem_empresa BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.toth_connections.clientes_empresa IS
  'Nome fantasia da empresa do grupo a sincronizar (compara com atendimentos[].nomeFantasiaEmpresa, sem acento e sem caixa). NULL = trazer todas.';
COMMENT ON COLUMN public.toth_connections.clientes_incluir_sem_empresa IS
  'Quando o filtro de empresa está ligado, decide o que fazer com quem não tem atendimento nenhum (878 na base da Café Jurerê). FALSE = deixar de fora, que é o significado literal de "somente a empresa X".';
