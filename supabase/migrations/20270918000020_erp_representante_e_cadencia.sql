-- ============================================================
-- Representante do ERP vira responsável, e a cadência de compra do cliente
-- ============================================================
--
-- Duas necessidades do CTO (02/09), medidas antes de desenhadas.
--
-- ── 1. Por que o representante precisa de um DE-PARA ────────────────────────
--
-- O `/clientes` do Toth traz `atendimentos[].nomeRepresentante` e
-- `codigoRepresentante`, e a sincronização já os grava em `erp_owner_name` e
-- `erp_owner_external_id`: **11.228 dos 12.657 clientes** da Café Jurerê têm
-- representante preenchido. O que não existe é a ponte para `responsible_id`.
--
-- Casar por NOME foi testado e falha de três jeitos distintos:
--
--   a) **Ambiguidade.** O team member "Fernanda" casa com `FERNANDA C.PRIOTTO`
--      E com `FERNANDA LESSIR MACHADO`. Escolher um dos dois é sorteio.
--   b) **Grafia.** "Isabelli" no Torque, `ISABELLE FERRERA RAMOS` no ERP —
--      1.186 clientes que nenhum `LIKE` pega.
--   c) **Nem todo representante é gente.** `TORREFAÇÃO`, `TORREFACAO-CAROLINI`,
--      `TORREFAÇÃO-FRANCIELLE` e mais três são CANAIS, e cobrem 3.525 clientes
--      (31%). O maior "vendedor" da base é um departamento.
--
-- Somando: 216 representantes distintos no ERP contra 8 team members na org.
-- Não existe correspondência a ser descoberta — existe uma decisão humana a ser
-- registrada. Daí a tabela: a chave é o `codigoRepresentante`, que é estável e
-- não ambíguo, e o preenchimento é manual.
--
-- 🔴 **Não mapeado NÃO vira palpite.** `team_member_id` é NULLABLE de propósito:
-- a linha existe para dizer "este código eu conheço e decidi não atribuir a
-- ninguém" — que é o caso dos seis canais. Ausência de linha e linha com NULL
-- levam ao mesmo lugar (sem dono), mas a segunda registra que alguém olhou.
--
-- ⚠️ **Consequência de VISIBILIDADE, e é por isso que nada aqui roda sozinho.**
-- Hoje 11 dos 12.669 leads da org têm `responsible_id`. Atribuir dono a milhares
-- de leads muda quem enxerga o quê no Torque, cuja regra de visibilidade lê
-- justamente o responsável. Preencher esta tabela é o ato deliberado que libera
-- a atribuição; enquanto ela estiver vazia, a sincronização não escreve
-- `responsible_id` em nada.
--
-- ── 2. Por que a cadência é COLUNA, e não conta na leitura ──────────────────
--
-- "Tempo entre compras" nasce da série de pedidos (`upsell_orders`). Calcular na
-- leitura significaria varrer os pedidos de 12 mil clientes a cada pintura da
-- Carteira — que lista, filtra e ordena por esses números. Guardar agregado é o
-- que torna "quem está fora da cadência" uma consulta, e não um relatório.

-- ── De-para de representante ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.erp_owner_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Qual ERP. A org pode ter Toth e Omie, e o código 126 de um não é o do outro.
  provider TEXT NOT NULL,
  -- `codigoRepresentante`. TEXT porque código de ERP é identificador, não número:
  -- zero à esquerda importa e ninguém vai somar isso.
  erp_owner_external_id TEXT NOT NULL,
  -- Nome como o ERP mandou, para a tela mostrar o que a pessoa vai mapear sem
  -- precisar caçar em `upsell_clients`. É retrato, não fonte da verdade.
  erp_owner_name TEXT,
  -- NULL = conhecido e deliberadamente sem dono (o caso dos canais).
  team_member_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um código do ERP tem um destino só dentro da org. Sem isto, duas linhas
-- concorrentes fariam o responsável do cliente depender da ordem de leitura.
CREATE UNIQUE INDEX IF NOT EXISTS erp_owner_map_org_provider_codigo_uk
  ON public.erp_owner_map (organization_id, provider, erp_owner_external_id);

-- A sincronização resolve por (org, provider, código) a cada cliente; o índice
-- acima já serve. Este cobre a pergunta inversa da tela: "quem está mapeado
-- para este vendedor?".
CREATE INDEX IF NOT EXISTS erp_owner_map_team_member_idx
  ON public.erp_owner_map (organization_id, team_member_id)
  WHERE team_member_id IS NOT NULL;

COMMENT ON TABLE public.erp_owner_map IS
  'De-para entre o representante do ERP (codigoRepresentante) e o team member do '
  'Torque. Preenchimento MANUAL: 216 representantes contra 8 team members, com '
  'nomes ambíguos, grafias divergentes e 6 canais que não são pessoas — casar por '
  'nome erra. Linha com team_member_id NULL significa "olhei e decidi que não tem '
  'dono", que é diferente de ausência de linha.';

COMMENT ON COLUMN public.erp_owner_map.team_member_id IS
  'NULL = conhecido e sem dono por decisão (canais como TORREFAÇÃO). A '
  'sincronização nunca chuta: sem linha mapeada, responsible_id não é tocado.';

ALTER TABLE public.erp_owner_map ENABLE ROW LEVEL SECURITY;

-- Ler é de todo mundo da org: a ficha do cliente mostra o representante, e o
-- filtro por vendedor precisa resolver o nome.
DROP POLICY IF EXISTS erp_owner_map_member_select ON public.erp_owner_map;
CREATE POLICY erp_owner_map_member_select ON public.erp_owner_map
  FOR SELECT USING (organization_id IN (SELECT get_my_organization_ids()));

-- Escrever é de admin: isto redistribui carteira e muda visibilidade.
DROP POLICY IF EXISTS erp_owner_map_admin_all ON public.erp_owner_map;
CREATE POLICY erp_owner_map_admin_all ON public.erp_owner_map
  FOR ALL USING (organization_id IN (SELECT get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT get_my_admin_organization_ids()));

DROP TRIGGER IF EXISTS erp_owner_map_touch_updated_at ON public.erp_owner_map;
CREATE TRIGGER erp_owner_map_touch_updated_at
  BEFORE UPDATE ON public.erp_owner_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Cadência de compra do cliente ────────────────────────────────────────────
--
-- `erp_last_order_at` já existe (vem de `dataEmissaoUltimoPedidoFaturado`, sem
-- custo de chamada). O que falta é o que só a série de pedidos responde.

ALTER TABLE public.upsell_clients
  ADD COLUMN IF NOT EXISTS erp_order_count INTEGER,
  ADD COLUMN IF NOT EXISTS erp_first_order_at DATE,
  ADD COLUMN IF NOT EXISTS erp_avg_days_between_orders NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS erp_orders_computed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.upsell_clients.erp_order_count IS
  'Pedidos FATURADOS conhecidos. Só faturado: cancelado é 22% do volume da Café '
  'Jurerê e contá-lo inventaria uma cadência que não existe. NULL = nunca '
  'calculado; 0 = calculado e o cliente não tem pedido faturado na janela.';

COMMENT ON COLUMN public.upsell_clients.erp_avg_days_between_orders IS
  'Dias médios entre pedidos faturados consecutivos. Exige 2+ pedidos — com um '
  'só não há intervalo, e a coluna fica NULL em vez de zero (zero leria como '
  '"compra todo dia"). É a régua de "“este cliente está atrasado?”.';

COMMENT ON COLUMN public.upsell_clients.erp_orders_computed_at IS
  'Quando os agregados foram recalculados pela última vez. Existe porque a '
  'janela de pedidos RELÊ o passado (NORMAL vira FATURADO), então os números '
  'são recalculados e nunca incrementados — sem este carimbo não dá para '
  'distinguir "sem pedido" de "ainda não processado".';

-- Ordenar a Carteira por quem está fora da cadência é a consulta que justifica
-- as colunas; sem índice ela vira varredura em 12 mil linhas por pintura.
CREATE INDEX IF NOT EXISTS upsell_clients_cadencia_idx
  ON public.upsell_clients (organization_id, erp_last_order_at DESC NULLS LAST)
  WHERE erp_order_count IS NOT NULL;

-- ── Recálculo dos agregados ──────────────────────────────────────────────────
--
-- Em SQL, e não no TypeScript da edge function, porque é uma agregação sobre
-- linhas que já estão no banco: trazer os pedidos para o isolate só para somá-los
-- gastaria memória (o worker já morreu por `WORKER_RESOURCE_LIMIT` uma vez) e
-- ainda passaria por PostgREST duas vezes.
--
-- `p_client_ids` NULL recalcula a org inteira — é o caminho do backfill. Com
-- lista, recalcula só quem a volta tocou, que é o regime permanente.

CREATE OR REPLACE FUNCTION public.recompute_erp_order_cadence(
  p_organization_id UUID,
  p_client_ids UUID[] DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_afetados INTEGER;
BEGIN
  WITH alvo AS (
    SELECT id
      FROM public.upsell_clients
     WHERE organization_id = p_organization_id
       AND (p_client_ids IS NULL OR id = ANY (p_client_ids))
  ),
  faturados AS (
    -- `approval_status = 'approved'` é o filtro de "virou receita": é para lá que
    -- FATURADO vai, e é de lá que CANCELADO e DEVOLVIDO ficam de fora.
    SELECT o.client_id,
           o.sold_at,
           LAG(o.sold_at) OVER (PARTITION BY o.client_id ORDER BY o.sold_at) AS anterior
      FROM public.upsell_orders o
      JOIN alvo a ON a.id = o.client_id
     WHERE o.organization_id = p_organization_id
       AND o.source = 'erp'
       AND o.approval_status = 'approved'
       AND o.sold_at IS NOT NULL
  ),
  resumo AS (
    SELECT client_id,
           count(*)::INTEGER AS qtd,
           min(sold_at)::DATE AS primeiro,
           max(sold_at)::DATE AS ultimo,
           -- Média dos intervalos, não (último - primeiro) / n: um cliente com
           -- duas compras coladas e uma antiga tem cadência diferente de um que
           -- comprou espaçado, e a divisão simples não distingue os dois.
           avg(EXTRACT(EPOCH FROM (sold_at - anterior)) / 86400.0)
             FILTER (WHERE anterior IS NOT NULL) AS media_dias
      FROM faturados
     GROUP BY client_id
  )
  UPDATE public.upsell_clients c
     SET erp_order_count = COALESCE(r.qtd, 0),
         erp_first_order_at = r.primeiro,
         -- Só sobe a última compra: `erp_last_order_at` também é semeado pelo
         -- `/clientes`, que enxerga pedidos fora da janela sincronizada.
         -- Rebaixá-lo aqui apagaria histórico que o ERP conhece e nós não.
         erp_last_order_at = GREATEST(c.erp_last_order_at, r.ultimo),
         erp_avg_days_between_orders = round(r.media_dias::NUMERIC, 2),
         erp_orders_computed_at = now()
    FROM alvo a
    LEFT JOIN resumo r ON r.client_id = a.id
   WHERE c.id = a.id;

  GET DIAGNOSTICS v_afetados = ROW_COUNT;
  RETURN v_afetados;
END;
$$;

COMMENT ON FUNCTION public.recompute_erp_order_cadence(UUID, UUID[]) IS
  'Recalcula erp_order_count/first/avg a partir de upsell_orders APROVADOS de '
  'origem erp. Recalcula, nunca incrementa: a janela de pedidos relê o passado '
  'porque NORMAL vira FATURADO. p_client_ids NULL = org inteira (backfill).';

REVOKE ALL     ON FUNCTION public.recompute_erp_order_cadence(UUID, UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_erp_order_cadence(UUID, UUID[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_erp_order_cadence(UUID, UUID[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_erp_order_cadence(UUID, UUID[]) TO service_role;

-- ── Propagar o dono do cliente para o lead ───────────────────────────────────
--
-- O CTO pediu o representante como responsável "do lead/cliente" — são as duas
-- pontas da mesma pessoa no Torque, e a Carteira liga uma à outra por
-- `upsell_clients.lead_id`.
--
-- Por que em SQL e não no TypeScript: `upsertCanonicalClient` só cria lead para
-- cliente NOVO; os 11 mil que já existem nunca passariam por lá. Atualizar um a
-- um seriam 11 mil idas ao PostgREST por execução, para escrever uma coluna.
-- Aqui é uma sentença.
--
-- ⚠️ Só desce dono, nunca apaga: `WHERE c.responsible_id IS NOT NULL`. Cliente
-- sem mapeamento não zera o responsável que alguém pôs na mão no lead — o ERP
-- não é dono da verdade sobre trabalho feito dentro do CRM.

CREATE OR REPLACE FUNCTION public.propagate_erp_owner_to_leads(
  p_organization_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_afetados INTEGER;
BEGIN
  UPDATE public.leads l
     SET responsible_id = c.responsible_id
    FROM public.upsell_clients c
   WHERE c.organization_id = p_organization_id
     AND l.organization_id = p_organization_id
     AND l.id = c.lead_id
     AND c.responsible_id IS NOT NULL
     -- Sem isto, toda volta reescreveria 11 mil linhas idênticas e acordaria o
     -- Realtime de graça — o mesmo erro que matou a primeira carga de clientes.
     AND l.responsible_id IS DISTINCT FROM c.responsible_id;

  GET DIAGNOSTICS v_afetados = ROW_COUNT;
  RETURN v_afetados;
END;
$$;

COMMENT ON FUNCTION public.propagate_erp_owner_to_leads(UUID) IS
  'Desce upsell_clients.responsible_id para o lead ligado. Só desce dono, nunca '
  'apaga: cliente sem mapeamento preserva o responsável posto à mão. Escreve só '
  'o que difere, para não acordar o Realtime com 11 mil UPDATEs idênticos.';

REVOKE ALL     ON FUNCTION public.propagate_erp_owner_to_leads(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.propagate_erp_owner_to_leads(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.propagate_erp_owner_to_leads(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.propagate_erp_owner_to_leads(UUID) TO service_role;

-- ── Grants: o default do schema NÃO é o que você escreveu ───────────────────
--
-- `ALTER DEFAULT PRIVILEGES` age sobre toda tabela nova em `public` e já
-- entregou SELECT a `anon` numa tabela cuja migration nunca mencionou `anon`
-- (medido em 27/08, `erp_order_items`). Revogar é barato; a conferência abaixo é
-- o que prova o estado, não o SQL acima.

REVOKE ALL ON public.erp_owner_map FROM anon;
GRANT SELECT ON public.erp_owner_map TO authenticated;
GRANT ALL    ON public.erp_owner_map TO service_role;

-- Conferência (rodar DEPOIS do apply, lendo pg_class.relacl — NÃO
-- information_schema.role_table_grants, que só mostra o papel corrente):
--   SELECT relname, array_to_string(relacl, E'\n') FROM pg_class
--    WHERE relname = 'erp_owner_map';
--   -- esperado: sem anon.
