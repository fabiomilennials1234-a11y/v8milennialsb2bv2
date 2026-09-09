-- ============================================================================
-- A LEI DA DIVISÃO: lead é quem ainda não comprou; cliente é quem comprou.
--
-- Pedido do CTO em 2026-09-04, a partir da Chiquê: a lista de leads mostrava
-- gente com negócio fechado. Medido em prod naquele dia, na Chiquê
-- (38f3bea4-44c6-4732-bb20-065f547a7ed8), 4.194 leads vivos:
--
--   • 36 têm venda em `sale_events` (líquida de estorno)
--   • 14 têm `deals.outcome = 'won'`      ⊂ os 36
--   • 14 têm pedido no ERP (order_count) ⊂ os 36
--   •  0 têm card parado em etapa ganha
--
-- A união das três definições é exatamente 36 — `sale_events` CONTÉM as outras
-- duas, e ainda pega 22 leads que venderam e cujo negócio nunca foi marcado
-- como ganho. Por isso a lei se ancora no caderno canônico do ADR-0017, e não
-- em `deals.outcome` nem em `pipeline_stages.stage_role = 'won'`.
--
-- ⚠️ ISTO NÃO É A `leads.classificacao` (migration 20270922000000). Aquela
-- deriva de CADASTRO NO ERP (`erp_code` + `upsell_clients.erp_status`) e
-- responde outra pergunta. As duas discordam abertamente, e está medido: na
-- Café Jurerê, dos 5.442 leads com `classificacao = 'cliente'`, **exatamente 1**
-- tem venda. Decisão do CTO: as duas convivem com nomes distintos — a do ERP
-- vira "Cadastro no ERP" na tela e para de disputar a palavra "cliente".
--
-- POR QUE UMA COLUNA, e não um JOIN na hora da leitura: a lista de leads é
-- paginada no servidor (50 por página) e o filtro tem de ser server-side.
-- `sale_events!inner` no PostgREST multiplicaria a linha do lead por venda
-- (quebrando página e contagem), e não existe forma direta de pedir "quem NÃO
-- tem" por embedded resource.
--
-- Custo medido antes de escrever: 1.901 eventos e 1.774 leads com venda no
-- sistema INTEIRO (de 56.848 vivos). O trigger é barato porque `sale_events` é
-- de baixo volume — 1.901 linhas em toda a história do produto.
-- ============================================================================

-- ── A marca ─────────────────────────────────────────────────────────────────
-- Timestamp e não boolean: "desde quando é cliente" responde a pergunta que um
-- `true` não responde, e o filtro continua trivial (`IS NULL` / `IS NOT NULL`).
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS primeira_venda_at TIMESTAMPTZ;

COMMENT ON COLUMN public.leads.primeira_venda_at IS
  'Primeira venda LÍQUIDA do lead em sale_events (ADR-0017). NULL = ainda não '
  'comprou. Mantida pelo trigger trg_sale_events_marca_cliente; não escrever à '
  'mão. NÃO confundir com leads.classificacao, que deriva de cadastro no ERP.';

-- O índice serve à pergunta que a tela faz: "os leads desta org que (não)
-- compraram", já ordenados. Parcial não serve — as duas abas precisam dele.
CREATE INDEX IF NOT EXISTS leads_org_primeira_venda_idx
  ON public.leads (organization_id, primeira_venda_at);

-- ── O recálculo ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lead_recalcula_primeira_venda(p_lead UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_lead IS NULL THEN RETURN; END IF;

  UPDATE public.leads l
     SET primeira_venda_at = (
       SELECT min(s.sold_at)
         FROM public.sale_events s
        WHERE s.lead_id = p_lead
          -- A própria linha não pode ser um estorno...
          AND s.reversed_event_id IS NULL
          -- ...nem ter sido estornada por outra. Mesma semântica de "líquido de
          -- estorno" que `useLeadsSalesMetrics` já usa no front; duas leituras
          -- diferentes da mesma palavra produziriam uma lista que discorda da
          -- coluna "Relação" exibida na mesma tela.
          AND NOT EXISTS (
            SELECT 1 FROM public.sale_events r
             WHERE r.reversed_event_id = s.id
          )
     )
   WHERE l.id = p_lead
     -- Não escreve se o valor não muda: `leads` tem 21 triggers, dois deles
     -- gravando uma linha de auditoria por UPDATE. Um estorno de venda que não
     -- altera a primeira venda não deve gerar rastro nenhum.
     AND l.primeira_venda_at IS DISTINCT FROM (
       SELECT min(s.sold_at)
         FROM public.sale_events s
        WHERE s.lead_id = p_lead
          AND s.reversed_event_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.sale_events r WHERE r.reversed_event_id = s.id
          )
     );
END;
$$;

COMMENT ON FUNCTION public.fn_lead_recalcula_primeira_venda(UUID) IS
  'Recalcula leads.primeira_venda_at a partir de sale_events, líquido de '
  'estorno. Idempotente e silenciosa quando nada muda.';

-- ── O gatilho ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_sale_events_marca_cliente()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_estornado UUID;
BEGIN
  -- O lead do próprio evento.
  PERFORM public.fn_lead_recalcula_primeira_venda(
    COALESCE(NEW.lead_id, OLD.lead_id)
  );

  -- E o lead do evento ESTORNADO, que pode ser outro: o estorno é uma LINHA
  -- NOVA apontando para a venda cancelada. Sem esta segunda chamada, estornar
  -- a única venda de alguém deixaria a pessoa na aba Clientes para sempre.
  v_estornado := COALESCE(NEW.reversed_event_id, OLD.reversed_event_id);
  IF v_estornado IS NOT NULL THEN
    PERFORM public.fn_lead_recalcula_primeira_venda(
      (SELECT s.lead_id FROM public.sale_events s WHERE s.id = v_estornado)
    );
  END IF;

  RETURN NULL; -- AFTER trigger: o retorno é ignorado.
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_events_marca_cliente ON public.sale_events;
CREATE TRIGGER trg_sale_events_marca_cliente
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sale_events_marca_cliente();

-- ── Quem pode chamar ────────────────────────────────────────────────────────
-- 🔒 `fn_lead_recalcula_primeira_venda` é SECURITY DEFINER e faz UPDATE em
-- `leads` — ou seja, escreve BYPASSANDO a RLS. Sem os revokes abaixo ela nasce
-- executável por qualquer usuário logado, que poderia passar o uuid de um lead
-- de OUTRA organização e disparar escrita (e os 21 triggers de `leads`) fora do
-- seu tenant. Ela não precisa ser chamada pela aplicação: quem a chama é o
-- trigger, que roda como dono da função.
--
-- Os três revokes, e não um: neste projeto o EXECUTE chega por DOIS caminhos
-- independentes — o grant implícito de `PUBLIC` e o `ALTER DEFAULT PRIVILEGES`
-- que concede nominalmente a `anon` e `authenticated`. Revogar de um lado só
-- deixa a porta aberta pelo outro.
REVOKE ALL     ON FUNCTION public.fn_lead_recalcula_primeira_venda(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_lead_recalcula_primeira_venda(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_lead_recalcula_primeira_venda(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_lead_recalcula_primeira_venda(UUID) TO service_role;

REVOKE ALL     ON FUNCTION public.trg_sale_events_marca_cliente() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_sale_events_marca_cliente() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_sale_events_marca_cliente() FROM authenticated;

-- ⚠️ A CONFERÊNCIA NÃO É OPCIONAL, e não pode ser feita aqui: o grant é
-- concedido pelo banco no momento do CREATE, então migration verde não prova
-- nada. Rode contra o ALVO DO APPLY, logo depois de aplicar — esperado
-- `false, false, true`:
--
--   SELECT has_function_privilege('anon',
--            'public.fn_lead_recalcula_primeira_venda(uuid)', 'EXECUTE')  AS anon,
--          has_function_privilege('authenticated',
--            'public.fn_lead_recalcula_primeira_venda(uuid)', 'EXECUTE')  AS authenticated,
--          has_function_privilege('service_role',
--            'public.fn_lead_recalcula_primeira_venda(uuid)', 'EXECUTE')  AS service_role;

-- ⚠️ O BACKFILL NÃO ESTÁ AQUI, e é deliberado (guarda F4 do CLAUDE.md):
-- migration é só schema, para que um apply com alvo errado vire erro de schema
-- recuperável em vez de mudança de dado de cliente. O backfill das 1.774 linhas
-- vive em `scripts/backfill-primeira-venda.sql` e roda DEPOIS deste apply.
-- Sem ele, a coluna nasce NULL para todos e a aba Clientes nasce vazia.
