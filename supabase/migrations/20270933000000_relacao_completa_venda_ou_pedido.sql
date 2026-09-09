-- ============================================================================
-- A LEI DA RELAÇÃO, INTEIRA — e não metade dela.
--
-- Correção do que a `20270932000000` fez pela metade. A lista de leads já tinha
-- uma lei de relação, em `lead-relacao-situacao.ts`, e ela tem DUAS pernas:
--
--     cliente  ⟺  saleCount > 0  OU  orderCount > 0
--                 (venda em sale_events)  (pedido em upsell_clients)
--
-- A migration anterior materializou só a primeira. Medido em prod 2026-09-04,
-- sobre 56.859 leads vivos:
--
--     cliente só pelo funil (venda) ....... 1.558
--     cliente só pelo ERP (pedido) ........   178   ← a metade que faltava
--     lei da Relação (união) .............. 1.935
--     o que a coluna anterior cobria ...... 1.757
--
-- Esses 178 são leads que a coluna "Relação" da lista imprime como **Cliente**
-- e que o filtro mandava para **Leads** — a mesma linha da mesma tela dizendo
-- duas coisas. É o defeito que esta migration fecha.
--
-- Existir linha em `upsell_clients` NÃO basta, e isso é deliberado: das 735
-- linhas ligadas a lead vivo, 554 têm `order_count = 0` — cadastro de
-- integração que nunca comprou. A prova é `order_count > 0`, igual à do front.
-- ============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS primeiro_pedido_erp_at TIMESTAMPTZ;

COMMENT ON COLUMN public.leads.primeiro_pedido_erp_at IS
  'Primeiro pedido do lead no ERP (upsell_clients.order_count > 0). NULL = sem '
  'pedido. Segunda perna da lei da Relação; a primeira é primeira_venda_at. '
  'Mantida por trigger; não escrever à mão.';

-- O índice serve à pergunta real da tela, que é a UNIÃO das duas pernas — por
-- isso as duas colunas entram, e nesta ordem: `organization_id` primeiro
-- porque todo acesso é escopado por tenant.
CREATE INDEX IF NOT EXISTS leads_org_relacao_idx
  ON public.leads (organization_id, primeira_venda_at, primeiro_pedido_erp_at);

-- ── O recálculo da segunda perna ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lead_recalcula_pedido_erp(p_lead UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_lead IS NULL THEN RETURN; END IF;

  UPDATE public.leads l
     -- A data do primeiro pedido tem tres fontes possiveis e nenhuma e
     -- garantida: `first_sale_at` (a mais precisa), `erp_first_order_at`
     -- (date, vinda do ERP) e, em ultimo caso, `created_at` da linha. O que
     -- decide o filtro e ser NAO-NULO; a data serve para ordenar e explicar.
     SET primeiro_pedido_erp_at = (
       SELECT min(COALESCE(c.first_sale_at,
                    c.erp_first_order_at::timestamptz,
                    c.created_at))
         FROM public.upsell_clients c
        WHERE c.lead_id = p_lead
          AND COALESCE(c.order_count, 0) > 0
     )
   WHERE l.id = p_lead
     -- Não escreve se nada muda: `leads` tem 21 triggers, dois deles gravando
     -- auditoria por UPDATE.
     AND l.primeiro_pedido_erp_at IS DISTINCT FROM (
       SELECT min(COALESCE(c.first_sale_at,
                    c.erp_first_order_at::timestamptz,
                    c.created_at))
         FROM public.upsell_clients c
        WHERE c.lead_id = p_lead
          AND COALESCE(c.order_count, 0) > 0
     );
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_upsell_clients_marca_pedido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.fn_lead_recalcula_pedido_erp(COALESCE(NEW.lead_id, OLD.lead_id));
  -- Repontuação: se a linha mudou de lead, o lead ANTIGO também precisa
  -- recalcular, senão fica cliente para sempre por um pedido que não é dele.
  IF TG_OP = 'UPDATE' AND NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN
    PERFORM public.fn_lead_recalcula_pedido_erp(OLD.lead_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_upsell_clients_marca_pedido ON public.upsell_clients;
CREATE TRIGGER trg_upsell_clients_marca_pedido
  AFTER INSERT OR UPDATE OR DELETE ON public.upsell_clients
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_upsell_clients_marca_pedido();

-- ── Quem pode chamar ────────────────────────────────────────────────────────
-- 🔒 Mesma razão da migration anterior: SECURITY DEFINER que escreve em `leads`
-- bypassando RLS. Sem os três revokes, qualquer usuário logado passaria o uuid
-- de um lead de outra organização. Os três, porque neste projeto o EXECUTE
-- chega por dois caminhos independentes (grant implícito de PUBLIC e
-- ALTER DEFAULT PRIVILEGES nominal para anon/authenticated).
REVOKE ALL     ON FUNCTION public.fn_lead_recalcula_pedido_erp(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_lead_recalcula_pedido_erp(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_lead_recalcula_pedido_erp(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_lead_recalcula_pedido_erp(UUID) TO service_role;

REVOKE ALL     ON FUNCTION public.trg_upsell_clients_marca_pedido() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_upsell_clients_marca_pedido() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_upsell_clients_marca_pedido() FROM authenticated;

-- ⚠️ Conferir DEPOIS do apply, contra o alvo — o grant é dado pelo banco no
-- CREATE, então migration verde não prova nada. Esperado false, false, true:
--
--   SELECT has_function_privilege('anon',
--            'public.fn_lead_recalcula_pedido_erp(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated',
--            'public.fn_lead_recalcula_pedido_erp(uuid)', 'EXECUTE'),
--          has_function_privilege('service_role',
--            'public.fn_lead_recalcula_pedido_erp(uuid)', 'EXECUTE');
--
-- Backfill fora daqui (guarda F4): `scripts/backfill-pedido-erp.sql`.
