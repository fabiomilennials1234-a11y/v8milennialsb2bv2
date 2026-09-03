-- B2b — o desfecho alinhado pelo B1 recebe a DATA REAL do fechamento.
--
-- Conserta um efeito da própria `20270914000010`, achado ao mapear quem
-- depende das etapas de ganho/perda.
--
-- ── O que o B1 deixou torto ──────────────────────────────────────────────
-- O B1 gravou `outcome = <papel da etapa>, outcome_at = now()` em 543
-- negócios. E `fn_deals_espelha_outcome` carimba `closed_at` junto, pelo mesmo
-- `now()`. Resultado: 543 negócios afirmam ter fechado no dia em que a
-- migration rodou.
--
-- As datas REAIS vão de 2026-05-08 a 2026-09-02, e **79 fecharam há mais de
-- 30 dias**. Ou seja: qualquer corte temporal — velocidade de funil, receita
-- do mês, coorte, ranking por período — enxergaria um pico artificial num dia
-- só, e um vazio nos meses em que as vendas realmente aconteceram.
--
-- Isso não é detalhe cosmético. `get_pipeline_velocity` mede tempo até o
-- fechamento; com `outcome_at` errado ele mediria a distância até a data da
-- migration. O B2c porta essa função para ler o desfecho — e portá-la sobre
-- uma data errada só trocaria o defeito de lugar.
--
-- ── A data real é recuperável, e integralmente ───────────────────────────
-- `pipeline_stage_events` guarda cada movimento com `occurred_at`. A data do
-- fechamento é o instante em que o card entrou na etapa cujo papel bate com o
-- desfecho gravado.
--
-- Medido antes de escrever: **543 de 543 resolvem**. Nenhum caso órfão.
--
-- O join passa pelo TIPO do funil (`pipelines.slug = pipeline_stages.pipeline_type`).
-- Sem isso ele casaria o movimento com a etapa homônima de outro funil — foi
-- exatamente o erro que inflou os números do B1 em ~3x, e ele não pode se
-- repetir numa migration que existe para consertar o B1.
--
-- `max(occurred_at)`: se o card entrou na etapa terminal mais de uma vez
-- (saiu e voltou), o fechamento que vale é o ÚLTIMO — é o que está de pé.
--
-- ── Por que isto NÃO gera evento no caderno ──────────────────────────────
-- `fn_deal_outcome_para_caderno` só dispara quando `outcome` MUDA
-- (`IF NEW.outcome IS NOT DISTINCT FROM OLD.outcome THEN RETURN NEW`). Aqui o
-- desfecho fica igual; só as datas mudam. Nenhum evento nasce, nenhuma receita
-- se move. Confirmado no ensaio, e é o motivo de esta fatia ser segura.
--
-- ── O que fica torto e não dá para consertar ─────────────────────────────
-- ⚠️ Os 5 eventos que o B1 criou pela rota 2 têm `sold_at` = 2026-09-02, e não
-- a data real. `fn_sale_events_force_sold_at` carimba `now()` em toda origem
-- viva, e `sale_events` é append-only (ADR-0017) — corrigir exigiria estorno
-- mais reemissão de cada um.
--
-- São CINCO perdas. Não movem receita; distorcem apenas "quando perdemos",
-- em cinco casos. O custo de cinco estornos num livro imutável é maior que o
-- da distorção. Fica registrado aqui em vez de escondido.
--
-- Reaplicar é no-op: o predicado exige que a data ainda seja a da migration.

UPDATE public.deals d
   SET outcome_at = real.quando,
       closed_at  = real.quando
  FROM (
    SELECT a.deal_id,
           MAX(pse.occurred_at) AS quando
      FROM public.alinhamento_desfecho_b1 a
      JOIN public.deals dd ON dd.id = a.deal_id
      JOIN public.pipeline_stage_events pse ON pse.entry_id = a.entry_id
      JOIN public.pipelines p  ON p.id = pse.pipeline_id
      JOIN public.pipeline_stages s
        ON s.organization_id = pse.organization_id
       AND s.pipeline_type   = p.slug
       AND s.stage_key       = pse.to_stage_key
       AND s.stage_role::text = dd.outcome
     WHERE a.rota IN ('caderno-ja-sabia','caderno-nao-sabia')
     GROUP BY a.deal_id
  ) real
 WHERE d.id = real.deal_id
   AND d.outcome_at IS DISTINCT FROM real.quando;

-- ── Guardas ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pendentes integer; v_futuro integer; v_divergentes integer; v_min date; v_max date;
BEGIN
  -- Nenhum dos alinhados pode ter ficado com data DIFERENTE da recuperável.
  --
  -- 🚨 A primeira versão desta guarda perguntava "a data é o dia da migration?"
  -- e acusou 1 negócio. Era falso positivo DELA: esse negócio fechou de fato em
  -- 2026-09-02, o mesmo dia em que o B1 rodou. Guarda que compara com o
  -- calendário não distingue "não foi corrigido" de "coincide" — a pergunta
  -- certa é se a data bate com a que dá para recuperar.
  SELECT count(*) INTO v_pendentes
    FROM public.alinhamento_desfecho_b1 a
    JOIN public.deals d ON d.id = a.deal_id
    JOIN LATERAL (
      SELECT MAX(pse.occurred_at) AS quando
        FROM public.pipeline_stage_events pse
        JOIN public.pipelines p ON p.id = pse.pipeline_id
        JOIN public.pipeline_stages s
          ON s.organization_id = pse.organization_id
         AND s.pipeline_type   = p.slug
         AND s.stage_key       = pse.to_stage_key
         AND s.stage_role::text = d.outcome
       WHERE pse.entry_id = a.entry_id
    ) real ON TRUE
   WHERE a.rota IN ('caderno-ja-sabia','caderno-nao-sabia')
     AND real.quando IS NOT NULL
     AND d.outcome_at IS DISTINCT FROM real.quando;
  IF v_pendentes > 0 THEN
    RAISE EXCEPTION '% negocio(s) com data diferente da recuperavel', v_pendentes;
  END IF;

  -- Data de fechamento no futuro seria sinal de join errado.
  SELECT count(*) INTO v_futuro
    FROM public.alinhamento_desfecho_b1 a
    JOIN public.deals d ON d.id = a.deal_id
   WHERE a.rota IN ('caderno-ja-sabia','caderno-nao-sabia')
     AND d.outcome_at > now();
  IF v_futuro > 0 THEN
    RAISE EXCEPTION '% negocio(s) com fechamento no FUTURO — join errado', v_futuro;
  END IF;

  -- `closed_at` e `outcome_at` descrevem o mesmo instante; divergir seria
  -- deixar duas respostas para a mesma pergunta.
  SELECT count(*) INTO v_divergentes
    FROM public.alinhamento_desfecho_b1 a
    JOIN public.deals d ON d.id = a.deal_id
   WHERE a.rota IN ('caderno-ja-sabia','caderno-nao-sabia')
     AND d.closed_at IS DISTINCT FROM d.outcome_at;
  IF v_divergentes > 0 THEN
    RAISE EXCEPTION '% negocio(s) com closed_at diferente de outcome_at', v_divergentes;
  END IF;

  SELECT min(d.outcome_at)::date, max(d.outcome_at)::date INTO v_min, v_max
    FROM public.alinhamento_desfecho_b1 a
    JOIN public.deals d ON d.id = a.deal_id
   WHERE a.rota IN ('caderno-ja-sabia','caderno-nao-sabia');
  RAISE NOTICE 'fechamentos redistribuidos de % a %', v_min, v_max;
END $$;
