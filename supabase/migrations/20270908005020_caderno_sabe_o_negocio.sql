-- C1b — o caderno passa a saber de qual NEGÓCIO é cada venda, sem ser tocado.
--
-- Decisão do CTO: o desfecho do negócio vira a fonte da métrica e o funil sai
-- de cena. Ver .specs/agenda-fonte-unica/PLANO.md.
--
-- ── O plano original era um backfill, e ele é PROIBIDO ───────────────────
-- A primeira versão desta fatia fazia `UPDATE sale_events SET deal_id = ...`
-- nas 1.876 linhas. O ensaio contra prod devolveu:
--
--   P0001: sale_events é append-only (ADR-0017): UPDATE proibido
--          — corrija com evento novo (estorno + venda nova)
--
-- `trg_sale_events_immutable` bloqueia UPDATE e DELETE, linha a linha. Não é
-- obstáculo a contornar: é a garantia que faz o caderno valer como caderno.
-- Denormalizar dado derivável dentro de um livro imutável seria trocar a
-- propriedade mais forte da tabela por conveniência de consulta.
--
-- ── O vínculo é DERIVÁVEL, então deriva-se na leitura ────────────────────
-- O evento guarda o movimento de etapa que o gerou; o movimento guarda a
-- entrada; a entrada sabe o negócio:
--
--   sale_events.stage_event_id → pipeline_stage_events.entry_id
--                              → pipeline_entries.deal_id
--
-- Medido em 2026-09-02: **1.526 de 1.876 (81%)** resolvem por esse caminho.
-- Os 350 restantes não têm vínculo derivável — incluem as 41 da carteira, que
-- nascem de `upsell_orders` e não de negócio nenhum.
--
-- ⚠️ 49 eventos resolveriam por LEAD, mas 31 deles pertencem a leads com 2 ou
-- 3 negócios. Escolher "o primeiro" atribuiria a venda ao negócio ERRADO em
-- parte deles, e ninguém teria como detectar depois — coluna preenchida parece
-- autoridade. A vista NÃO faz esse chute; os 18 sem ambiguidade também ficam
-- de fora, porque uma regra que vale para 18 e mente para 31 não é uma regra.
--
-- ── Por que uma VISTA e não o join solto em quem precisar ────────────────
-- O consumidor imediato é o C3 (Comando lendo o caderno), mas não será o
-- único: quem quiser receita por produto vai precisar do mesmo caminho. Esta
-- série já mostrou o custo de repetir regra — "falta = perda" estava escrito
-- em QUATRO lugares e cada um precisou ser encontrado. Uma definição, um lugar.
--
-- `security_invoker = true` é obrigatório: sem isso a vista roda com os
-- privilégios de quem a criou e passa por cima da RLS de `sale_events`,
-- vazando receita entre organizações. Postgres 15+; o prod é 17.
--
-- Não cria, altera nem apaga NENHUMA linha. Reaplicar é no-op.

CREATE OR REPLACE VIEW public.v_sale_events_negocio
WITH (security_invoker = true) AS
SELECT
  se.*,
  -- `deal_id` nativo quando o evento nasceu do caminho novo (a partir da
  -- 20270908001010, toda venda por botão/automação/etapa já o traz); derivado
  -- pelo movimento de etapa para o histórico. NULO quando não há vínculo — e
  -- nulo aqui significa "não sei", nunca "não tem".
  COALESCE(se.deal_id, pe.deal_id) AS deal_id_resolvido,
  CASE
    WHEN se.deal_id IS NOT NULL THEN 'nativo'
    WHEN pe.deal_id IS NOT NULL THEN 'derivado:etapa'
    ELSE 'sem_vinculo'
  END AS origem_do_vinculo
FROM public.sale_events se
LEFT JOIN public.pipeline_stage_events pse
  ON pse.id = se.stage_event_id
LEFT JOIN public.pipeline_entries pe
  ON pe.id = pse.entry_id
 -- Guarda de tenant no próprio join: id repetido entre orgs cruzaria receita
 -- entre clientes, que é o pior desfecho possível num caderno de dinheiro.
 AND pe.organization_id = se.organization_id;

COMMENT ON VIEW public.v_sale_events_negocio IS
  'sale_events com o negócio resolvido (nativo ou derivado do movimento de etapa). O caderno é append-only (ADR-0017), então o vínculo histórico é DERIVADO na leitura, nunca gravado. Use deal_id_resolvido; origem_do_vinculo diz de onde veio.';

REVOKE ALL     ON public.v_sale_events_negocio FROM PUBLIC;
REVOKE ALL     ON public.v_sale_events_negocio FROM anon;
GRANT  SELECT  ON public.v_sale_events_negocio TO authenticated, service_role;

-- ── Guardas ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_eventos integer; v_vista integer; v_cross integer; v_invoker boolean;
BEGIN
  -- A vista não pode perder nem duplicar evento: o join é 1:1 por construção
  -- (`stage_event_id` é FK para a PK de `pipeline_stage_events`), e um LEFT
  -- JOIN que duplicasse inflaria receita silenciosamente.
  SELECT count(*) INTO v_eventos FROM public.sale_events;
  SELECT count(*) INTO v_vista   FROM public.v_sale_events_negocio;
  IF v_eventos <> v_vista THEN
    RAISE EXCEPTION 'a vista mudou a cardinalidade: % eventos, % linhas', v_eventos, v_vista;
  END IF;

  SELECT count(*) INTO v_cross
    FROM public.v_sale_events_negocio v
    JOIN public.deals d ON d.id = v.deal_id_resolvido
   WHERE d.organization_id <> v.organization_id;
  IF v_cross > 0 THEN
    RAISE EXCEPTION 'CROSS-TENANT: % linha(s) resolvem negocio de outra org', v_cross;
  END IF;

  -- Sem `security_invoker` a vista fura a RLS. Vale conferir em vez de confiar.
  SELECT COALESCE((reloptions::text[] @> ARRAY['security_invoker=true']), false)
    INTO v_invoker
    FROM pg_class WHERE oid = 'public.v_sale_events_negocio'::regclass;
  IF NOT v_invoker THEN
    RAISE EXCEPTION 'a vista nao esta com security_invoker: passaria por cima da RLS';
  END IF;
END $$;
