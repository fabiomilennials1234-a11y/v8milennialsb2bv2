-- B1 — o NEGÓCIO passa a saber o desfecho que só a etapa sabia.
--
-- Decisão do CTO: as etapas de ganho/perda são aposentadas e o desfecho vira
-- propriedade do negócio. Ver .specs/agenda-fonte-unica/PLANO.md.
--
-- Esta fatia NÃO aposenta etapa nenhuma. Ela move a informação para o lugar
-- certo primeiro. Apagar a coluna antes de mover o dado seria perder o dado.
--
--
-- ── 🚨 O JOIN PRECISA PASSAR PELO TIPO DO FUNIL ──────────────────────────
-- `pipeline_stages` é chaveada por (organization_id, pipeline_type, stage_key).
-- Juntar só por org + stage_key casa o card com a etapa de OUTRO funil sempre
-- que a chave se repete — e ela se repete: 110 pares (org, stage_key) existem
-- em mais de um tipo de funil.
--
-- A primeira versão desta migration cometia esse erro e ele inflava tudo ~3x:
--   5.015 cards em vez de 1.567; 800 sem negócio em vez de 234; e NOVE
--   "contradições" que não existem — eram o card casado com a etapa alheia.
--
-- O erro só apareceu porque o `ON CONFLICT DO UPDATE` estourou com
-- "cannot affect row a second time". Sem essa restrição, a migration teria
-- rodado, e o número inflado teria virado a verdade documentada.
--
-- ── O estado, medido em 2026-09-02 (join CORRETO) ───────────────────────
-- 1.567 cards vivem em etapas de ganho/perda ativas:
--
--   lost → negócio diz lost ............ 723   já alinhado
--   lost → negócio diz open ............ 270   a etapa sabe, o negócio não
--   lost → SEM negócio ................. 192   não há onde guardar
--   won  → negócio diz won ............. 301   já alinhado
--   won  → negócio diz open ............. 39
--   won  → SEM negócio .................. 42
--   contradições ......................... 0   (as 9 eram artefato do join)
--
-- ── 🔴 O QUE QUASE DEU MUITO ERRADO ──────────────────────────────────────
-- Gravar `deals.outcome` dispara `fn_deal_outcome_para_caderno`, que INSERE
-- em `sale_events`. O plano ingênuo — "alinhar todos os desalinhados" — criaria
-- um evento para cada.
--
-- Medido antes de escrever uma linha (join correto):
--
--                cards   já tem evento no caderno   sem evento
--   perdidos        462             457                   5
--   ganhos           81              81                   0
--
-- 538 desses cards JÁ TÊM o evento — foram registrados quando entraram na
-- etapa, pelo caminho antigo. Gravar o desfecho neles criaria um SEGUNDO
-- evento para a mesma venda, inflando receita e contagem de perda. E seria
-- irreversível na prática: o caderno é append-only (ADR-0017), então desfazer
-- exigiria estornar 538 eventos.
--
-- Por isso o alinhamento tem DUAS ROTAS, e a diferença entre elas é o trigger
-- do caderno ligado ou desligado.
--
-- ── Rota 1 — 538 cards que o caderno já conhece ─────────────────────────
-- Só alinhar o negócio à realidade. `trg_deal_outcome_para_caderno` fica
-- DESLIGADO: o fato já está registrado, e registrá-lo de novo é duplicá-lo.
--
-- ── Rota 2 — 5 cards que o caderno NÃO conhece ──────────────────────────
-- CINCO perdas que a operação decidiu e que nunca chegaram ao livro. Nenhuma
-- venda. Aqui o trigger fica LIGADO, de propósito: são fatos reais que
-- faltavam. Decisão do CTO: registrar.
--
-- A receita NÃO se move — são todas perdas. A contagem de perdidos sobe 5.
--
-- ── Contradições: ZERO ──────────────────────────────────────────────────
-- A primeira medição apontou 9 cards em etapa de ganho cujo negócio dizia
-- perda. Eram artefato do join errado — o card casado com a etapa de outro
-- funil. O passo que as registraria continua no corpo, e é inofensivo: se um
-- dia surgir uma contradição de verdade, ela é ANOTADA e não corrigida, porque
-- o negócio é a fonte da verdade e a etapa está sendo aposentada.
--
-- ── Os 234 sem negócio ───────────────────────────────────────────────────
-- `garantir_negocio_da_entrada` — idempotente, grava
-- `source='entrada_materializada'` (procedência de verdade), e só passou a
-- funcionar na `20270908005010`, que ampliou `deals_source_check`.
--
-- ⚠️ `trg_workflow_deal_created` dispara em INSERT de `deals` e lançaria uma
-- automação por negócio criado — 234 delas. Fica desligado dentro da
-- transação. Medido: zero workflows ativos com `deal_created` hoje, mas um
-- pode nascer entre escrever isto e aplicar.
--
-- ✅ Atualizar só `deal_id` em `pipeline_entries` é seguro, e isto foi
-- verificado trigger a trigger: os perigosos são escopados a
-- `UPDATE OF stage_key/stage_id` e NÃO disparam — inclusive
-- `trg_workflow_pipeline_stage_changed` (automação),
-- `trg_pipeline_entries_dispatch` e `trg_exige_valor_na_venda`.
--
-- ── Reversível ───────────────────────────────────────────────────────────
-- Tudo que esta migration toca fica registrado em
-- `alinhamento_desfecho_b1`, com o valor ANTERIOR de cada campo.
--
-- Reaplicar é no-op: os predicados exigem `outcome = 'open'` ou negócio ausente.

-- ── 0. Caderno de procedência ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alinhamento_desfecho_b1 (
  entry_id        uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  deal_id         uuid,
  deal_criado     boolean     NOT NULL DEFAULT false,
  outcome_antes   text,
  outcome_depois  text,
  rota            text        NOT NULL,
  alinhado_em     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.alinhamento_desfecho_b1 IS
  'Procedência do alinhamento B1: o que cada card tinha antes, para onde foi e por qual rota (caderno-ja-sabia | caderno-nao-sabia | contradicao-preservada). Base do rollback.';

ALTER TABLE public.alinhamento_desfecho_b1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alinhamento_desfecho_b1 FROM PUBLIC, anon;
GRANT SELECT ON public.alinhamento_desfecho_b1 TO authenticated;
GRANT ALL    ON public.alinhamento_desfecho_b1 TO service_role;
DROP POLICY IF EXISTS alinhamento_b1_master ON public.alinhamento_desfecho_b1;
CREATE POLICY alinhamento_b1_master ON public.alinhamento_desfecho_b1
  FOR SELECT TO authenticated USING (public.is_master_user());

-- ── 1. Os 234 cards sem negócio ganham um ────────────────────────────────
ALTER TABLE public.deals DISABLE TRIGGER trg_workflow_deal_created;

DO $$
DECLARE r record; v_deal uuid;
BEGIN
  FOR r IN
    SELECT pe.id AS entry_id, pe.organization_id
      FROM public.pipeline_entries pe
      JOIN public.pipelines p ON p.id = pe.pipeline_id
      JOIN public.pipeline_stages s
        ON s.organization_id = pe.organization_id
       AND s.pipeline_type = p.slug
       AND s.stage_key = pe.stage_key
       AND s.stage_role IN ('won','lost') AND s.is_active
     WHERE pe.deal_id IS NULL
  LOOP
    v_deal := public.garantir_negocio_da_entrada(r.entry_id);
    INSERT INTO public.alinhamento_desfecho_b1
      (entry_id, organization_id, deal_id, deal_criado, outcome_antes, rota)
    VALUES (r.entry_id, r.organization_id, v_deal, true, NULL, 'negocio-criado')
    ON CONFLICT (entry_id) DO NOTHING;
  END LOOP;
END $$;

ALTER TABLE public.deals ENABLE TRIGGER trg_workflow_deal_created;

-- ── 2. Quem é quem: as duas rotas ────────────────────────────────────────
CREATE TEMP TABLE _rotas ON COMMIT DROP AS
SELECT pe.id AS entry_id, pe.organization_id, pe.deal_id, pe.lead_id,
       s.stage_role::text AS papel,
       d.outcome AS outcome_antes,
       EXISTS (
         SELECT 1 FROM public.sale_events se
          WHERE se.lead_id = pe.lead_id
            AND se.organization_id = pe.organization_id
            AND se.event_type = CASE WHEN s.stage_role = 'won' THEN 'sale' ELSE 'sale_lost' END
       ) AS caderno_ja_sabe
  FROM public.pipeline_entries pe
  JOIN public.pipelines p ON p.id = pe.pipeline_id
  JOIN public.pipeline_stages s
    ON s.organization_id = pe.organization_id
   AND s.pipeline_type = p.slug
   AND s.stage_key = pe.stage_key
   AND s.stage_role IN ('won','lost') AND s.is_active
  JOIN public.deals d ON d.id = pe.deal_id
 WHERE d.outcome = 'open';   -- os já alinhados e os 9 contraditórios ficam de fora

-- ── 3. Rota 1: o caderno já sabe → alinhar SEM gerar evento ──────────────
ALTER TABLE public.deals DISABLE TRIGGER trg_deal_outcome_para_caderno;

UPDATE public.deals d
   SET outcome = r.papel, outcome_source = 'stage', outcome_at = now()
  FROM _rotas r
 WHERE d.id = r.deal_id AND r.caderno_ja_sabe;

INSERT INTO public.alinhamento_desfecho_b1
  (entry_id, organization_id, deal_id, deal_criado, outcome_antes, outcome_depois, rota)
SELECT r.entry_id, r.organization_id, r.deal_id, false, r.outcome_antes, r.papel, 'caderno-ja-sabia'
  FROM _rotas r WHERE r.caderno_ja_sabe
ON CONFLICT (entry_id) DO UPDATE
   SET outcome_depois = EXCLUDED.outcome_depois, rota = EXCLUDED.rota;

ALTER TABLE public.deals ENABLE TRIGGER trg_deal_outcome_para_caderno;

-- ── 4. Rota 2: o caderno NÃO sabe → alinhar E registrar ──────────────────
-- Trigger LIGADO de propósito: são 132 fatos que faltavam no livro.
UPDATE public.deals d
   SET outcome = r.papel, outcome_source = 'stage', outcome_at = now()
  FROM _rotas r
 WHERE d.id = r.deal_id AND NOT r.caderno_ja_sabe;

INSERT INTO public.alinhamento_desfecho_b1
  (entry_id, organization_id, deal_id, deal_criado, outcome_antes, outcome_depois, rota)
SELECT r.entry_id, r.organization_id, r.deal_id, false, r.outcome_antes, r.papel, 'caderno-nao-sabia'
  FROM _rotas r WHERE NOT r.caderno_ja_sabe
ON CONFLICT (entry_id) DO UPDATE
   SET outcome_depois = EXCLUDED.outcome_depois, rota = EXCLUDED.rota;

-- ── 5. Os contraditórios ficam registrados, não corrigidos ───────────────
INSERT INTO public.alinhamento_desfecho_b1
  (entry_id, organization_id, deal_id, deal_criado, outcome_antes, outcome_depois, rota)
SELECT pe.id, pe.organization_id, pe.deal_id, false, d.outcome, d.outcome, 'contradicao-preservada'
  FROM public.pipeline_entries pe
  JOIN public.pipelines p ON p.id = pe.pipeline_id
  JOIN public.pipeline_stages s
    ON s.organization_id = pe.organization_id
   AND s.pipeline_type = p.slug
   AND s.stage_key = pe.stage_key
   AND s.stage_role IN ('won','lost') AND s.is_active
  JOIN public.deals d ON d.id = pe.deal_id
 WHERE d.outcome <> 'open' AND d.outcome <> s.stage_role::text
ON CONFLICT (entry_id) DO NOTHING;

-- ── 6. Guardas ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_abertos integer; v_sem_negocio integer; v_novos_eventos integer; v_esperado integer;
BEGIN
  -- Nenhum card de etapa terminal pode ter ficado sem negócio.
  SELECT count(*) INTO v_sem_negocio
    FROM public.pipeline_entries pe
    JOIN public.pipelines p ON p.id = pe.pipeline_id
    JOIN public.pipeline_stages s
      ON s.organization_id = pe.organization_id
     AND s.pipeline_type = p.slug
     AND s.stage_key = pe.stage_key
     AND s.stage_role IN ('won','lost') AND s.is_active
   WHERE pe.deal_id IS NULL;
  IF v_sem_negocio > 0 THEN
    RAISE EXCEPTION '% card(s) em etapa terminal seguem sem negocio', v_sem_negocio;
  END IF;

  -- Nenhum pode ter ficado com desfecho em aberto.
  SELECT count(*) INTO v_abertos
    FROM public.pipeline_entries pe
    JOIN public.pipelines p ON p.id = pe.pipeline_id
    JOIN public.pipeline_stages s
      ON s.organization_id = pe.organization_id
     AND s.pipeline_type = p.slug
     AND s.stage_key = pe.stage_key
     AND s.stage_role IN ('won','lost') AND s.is_active
    JOIN public.deals d ON d.id = pe.deal_id
   WHERE d.outcome = 'open';
  IF v_abertos > 0 THEN
    RAISE EXCEPTION '% card(s) em etapa terminal seguem com desfecho em aberto', v_abertos;
  END IF;

  -- 🚨 A guarda que importa: o caderno só pode ter crescido pela ROTA 2.
  SELECT count(*) INTO v_esperado FROM public.alinhamento_desfecho_b1 WHERE rota = 'caderno-nao-sabia';
  SELECT count(*) INTO v_novos_eventos FROM public.sale_events
   WHERE created_at > now() - interval '5 minutes';
  IF v_novos_eventos > v_esperado THEN
    RAISE EXCEPTION
      'DUPLICACAO: caderno ganhou % evento(s) e a rota 2 previa no maximo %',
      v_novos_eventos, v_esperado;
  END IF;
END $$;
