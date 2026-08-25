BEGIN;
-- ─────────────────────────────────────────────────────────────────────────────
-- CHECKLIST PASSA A SER DO NEGÓCIO (fatia 4)
--
-- Decisão do CTO, 2026-08-25: "DO NEGÓCIO."
--
-- ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
-- `checklists` tem `lead_id` e mais nada. O gatilho de etapa
-- (`apply_stage_checklist`) roda EM CIMA da entrada do funil — sabe qual card
-- mudou — e ainda assim gravava no lead, com
-- `ON CONFLICT (lead_id, source_template_id) DO NOTHING`.
--
-- Consequência, medida em prod (2026-08-25): 146 dos 759 checklists aplicados
-- por template (19%) estão em leads com 2+ Negócios. Nesses, o SEGUNDO negócio
-- a passar pela etapa não recebe checklist nenhum, e o item que o vendedor
-- marca num negócio aparece marcado no outro — é o mesmo registro.
--
-- ── A REGRA ─────────────────────────────────────────────────────────────────
-- Herança com origem: nasce DO NEGÓCIO quando o evento que o criou foi de
-- funil; nasce DA PESSOA quando o evento foi da pessoa (tag, cadastro) ou
-- quando alguém aplicou pela ficha do lead.
--
-- `pipeline_entry_id` NULO = é da pessoa, vale para todos os negócios dela. É
-- por isso que a coluna é nullable e não há backfill: os 1.338 checklists que
-- existem hoje foram aplicados sem negócio declarado, e dizer que pertencem a
-- um deles seria inventar um fato. Eles continuam valendo para todos.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS pipeline_entry_id uuid,
  ADD COLUMN IF NOT EXISTS deal_id uuid;

-- `ON DELETE CASCADE` aqui, e não SET NULL: um checklist de negócio que perde o
-- negócio não vira "checklist da pessoa" — isso o promoveria a valer para todos
-- os outros negócios do lead, que é justamente o defeito que esta migration
-- fecha. Sem o card, ele não tem mais assunto.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklists_pipeline_entry_id_fkey') THEN
    ALTER TABLE public.checklists
      ADD CONSTRAINT checklists_pipeline_entry_id_fkey
      FOREIGN KEY (pipeline_entry_id) REFERENCES public.pipeline_entries(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklists_deal_id_fkey') THEN
    ALTER TABLE public.checklists
      ADD CONSTRAINT checklists_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.checklists.pipeline_entry_id IS
  'O Negócio dono do checklist (ADR-0023 §1). NULO = checklist da PESSOA, vale para todos os negócios dela — é o caso dos 1.338 aplicados antes desta coluna.';
COMMENT ON COLUMN public.checklists.deal_id IS
  'Identidade do Negócio, quando a entrada tem linha em `deals`. Redundante com `pipeline_entry_id` de propósito: responde por dinheiro e procedência sem um join.';

CREATE INDEX IF NOT EXISTS idx_checklists_pipeline_entry
  ON public.checklists (pipeline_entry_id)
  WHERE pipeline_entry_id IS NOT NULL;

-- ── A IDEMPOTÊNCIA MUDA DE CHAVE JUNTO ──────────────────────────────────────
--
-- Sem isto o conserto não conserta: `uniq_checklists_lead_source` proíbe o
-- MESMO template duas vezes no mesmo lead, e é ele que faz o segundo negócio
-- sair sem checklist. As duas regras passam a conviver:
--
--   · escopo NEGÓCIO  → único por (negócio, template)
--   · escopo PESSOA   → único por (lead, template), SÓ entre os sem negócio
--
-- O `WHERE pipeline_entry_id IS NULL` no segundo é a parte que não pode faltar.

DROP INDEX IF EXISTS public.uniq_checklists_lead_source;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_checklists_lead_source
  ON public.checklists (lead_id, source_template_id)
  WHERE source_template_id IS NOT NULL
    AND lead_id IS NOT NULL
    AND pipeline_entry_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_checklists_entry_source
  ON public.checklists (pipeline_entry_id, source_template_id)
  WHERE source_template_id IS NOT NULL
    AND pipeline_entry_id IS NOT NULL;

-- ── O GATILHO DE ETAPA PASSA A CARIMBAR O NEGÓCIO ───────────────────────────

CREATE OR REPLACE FUNCTION "public"."apply_stage_checklist"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_template_id uuid;
  v_stage_org_id uuid;
  v_new_checklist_id uuid;
  v_entry_id uuid;
  v_deal_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'pipeline_entries' THEN
      IF NEW.stage_key IS NOT DISTINCT FROM OLD.stage_key THEN
        RETURN NEW;
      END IF;
    END IF;
    IF TG_TABLE_NAME = 'custom_pipe_entries' THEN
      IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'pipeline_entries' THEN
    SELECT ps.checklist_template_id, ps.organization_id
      INTO v_template_id, v_stage_org_id
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = NEW.pipeline_id
    WHERE ps.organization_id = NEW.organization_id
      AND ps.pipeline_type = p.slug
      AND ps.stage_key = NEW.stage_key
      AND ps.is_active = true
    LIMIT 1;

    -- O card é o próprio sujeito.
    v_entry_id := NEW.id;
    v_deal_id  := NEW.deal_id;

  ELSIF TG_TABLE_NAME = 'custom_pipe_entries' THEN
    SELECT cps.checklist_template_id, cps.organization_id
      INTO v_template_id, v_stage_org_id
    FROM public.custom_pipeline_stages cps
    WHERE cps.id = NEW.stage_id
    LIMIT 1;

    -- Funil custom guarda a posição num espelho por primary key; a entrada
    -- canônica é a de `pipeline_entries`, e é ela que a automação e o card do
    -- Negócio leem. A ordenação espelha `pickActiveEntry` (aberta > mais
    -- recente) para não criar uma terceira regra de "qual negócio".
    SELECT pe.id, pe.deal_id INTO v_entry_id, v_deal_id
    FROM public.pipeline_entries pe
    WHERE pe.pipeline_id = NEW.pipeline_id
      AND pe.lead_id = NEW.lead_id
    ORDER BY (pe.closed_at IS NULL) DESC, pe.stage_changed_at DESC NULLS LAST, pe.created_at DESC
    LIMIT 1;
  END IF;

  IF v_template_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_stage_org_id IS NULL OR v_stage_org_id <> NEW.organization_id THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- `lead_id` continua sendo gravado: o checklist é DO NEGÓCIO e DA PESSOA que
  -- está por trás dele. Sem o lead, a ficha do lead perderia de vista o que a
  -- automação aplicou, e as consultas por pessoa (métrica, card do Lead)
  -- precisariam de um join novo para responder o que já respondiam.
  -- ── DOIS INSERTs, E NÃO UM COM `ON CONFLICT` ESPERTO ─────────────────────
  -- O árbitro de um `ON CONFLICT` é um ÍNDICE, e os dois índices aqui são
  -- PARCIAIS com predicados opostos (`pipeline_entry_id IS NULL` contra
  -- `IS NOT NULL`). Uma linha proposta só é coberta por um deles, então não
  -- existe um alvo único que sirva aos dois casos: apontar o de negócio numa
  -- linha sem negócio não deduplica nada, e apontar o de lead numa linha COM
  -- negócio recusaria a segunda aplicação, que é justamente o que se quer
  -- permitir. O ramo explícito diz qual regra vale, em vez de deixar o
  -- planejador escolher.
  IF v_entry_id IS NOT NULL THEN
    INSERT INTO public.checklists (
      organization_id, lead_id, pipeline_entry_id, deal_id,
      source_template_id, title, description, created_by
    )
    SELECT t.organization_id, NEW.lead_id, v_entry_id, v_deal_id, t.id, t.title, t.description, NULL
    FROM public.checklists t
    WHERE t.id = v_template_id
      AND t.lead_id IS NULL
      AND t.organization_id = NEW.organization_id
    ON CONFLICT (pipeline_entry_id, source_template_id)
      WHERE source_template_id IS NOT NULL AND pipeline_entry_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_new_checklist_id;
  ELSE
    -- Funil custom sem entrada canônica: sem negócio a que prender, o checklist
    -- é da pessoa — e aí a regra antiga é a certa.
    INSERT INTO public.checklists (
      organization_id, lead_id, pipeline_entry_id, deal_id,
      source_template_id, title, description, created_by
    )
    SELECT t.organization_id, NEW.lead_id, NULL, NULL, t.id, t.title, t.description, NULL
    FROM public.checklists t
    WHERE t.id = v_template_id
      AND t.lead_id IS NULL
      AND t.organization_id = NEW.organization_id
    ON CONFLICT (lead_id, source_template_id)
      WHERE source_template_id IS NOT NULL AND lead_id IS NOT NULL AND pipeline_entry_id IS NULL
    DO NOTHING
    RETURNING id INTO v_new_checklist_id;
  END IF;

  IF v_new_checklist_id IS NOT NULL THEN
    INSERT INTO public.checklist_items (checklist_id, title, position, template_item_id)
    SELECT v_new_checklist_id, ci.title, ci.position, ci.id
    FROM public.checklist_items ci
    WHERE ci.checklist_id = v_template_id
    ORDER BY ci.position;
  END IF;

  RETURN NEW;
END;
$$;

-- ── ASSERÇÕES ───────────────────────────────────────────────────────────────
DO $ensaio$
DECLARE
  v_org uuid; v_lead uuid; v_pipe uuid; v_tpl uuid;
  v_e1 uuid; v_e2 uuid; v_stage text; v_n int;
BEGIN
  -- 1. colunas e índices
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='checklists' AND column_name='pipeline_entry_id') THEN
    RAISE EXCEPTION 'FALHOU: coluna pipeline_entry_id ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='uniq_checklists_entry_source') THEN
    RAISE EXCEPTION 'FALHOU: índice de idempotência por negócio ausente';
  END IF;
  IF (SELECT indexdef FROM pg_indexes WHERE indexname='uniq_checklists_lead_source')
       NOT LIKE '%pipeline_entry_id IS NULL%' THEN
    RAISE EXCEPTION 'FALHOU: o índice por lead nao foi restringido aos sem negocio';
  END IF;

  -- 2. cenário: um lead, DOIS negócios no MESMO funil, uma etapa com template
  -- Org que tem funil de sistema, etapas ativas E lead — as três, senão o
  -- ensaio esbarra num gatilho vizinho (`meeting_events.lead_id NOT NULL`) e
  -- falha por um motivo que não é o desta migration.
  SELECT p.organization_id, p.id INTO v_org, v_pipe
  FROM public.pipelines p
  WHERE p.type='system' AND p.slug='whatsapp'
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.organization_id = p.organization_id)
    AND EXISTS (SELECT 1 FROM public.pipeline_stages ps
                WHERE ps.organization_id = p.organization_id
                  AND ps.pipeline_type='whatsapp' AND ps.is_active)
  ORDER BY p.created_at LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'FALHOU: nenhuma org com funil, etapa e lead'; END IF;

  -- A PRIMEIRA etapa, não a última: as finais são `agendado`/`compareceu`, que
  -- disparam a captura de reunião e trazem gatilho alheio para dentro do ensaio.
  SELECT ps.stage_key INTO v_stage FROM public.pipeline_stages ps
  WHERE ps.organization_id=v_org AND ps.pipeline_type='whatsapp' AND ps.is_active
  ORDER BY ps.position ASC LIMIT 1;

  SELECT id INTO v_lead FROM public.leads WHERE organization_id=v_org LIMIT 1;
  IF v_lead IS NULL THEN RAISE EXCEPTION 'FALHOU: org sem lead'; END IF;

  INSERT INTO public.checklists (organization_id, lead_id, title)
  VALUES (v_org, NULL, 'ENSAIO — template') RETURNING id INTO v_tpl;
  INSERT INTO public.checklist_items (checklist_id, title, position)
  VALUES (v_tpl, 'item 1', 0), (v_tpl, 'item 2', 1);

  UPDATE public.pipeline_stages SET checklist_template_id = v_tpl
  WHERE organization_id=v_org AND pipeline_type='whatsapp' AND stage_key=v_stage;

  INSERT INTO public.pipeline_entries (organization_id, lead_id, pipeline_id, stage_key)
  VALUES (v_org, v_lead, v_pipe, 'ensaio_origem') RETURNING id INTO v_e1;
  INSERT INTO public.pipeline_entries (organization_id, lead_id, pipeline_id, stage_key)
  VALUES (v_org, v_lead, v_pipe, 'ensaio_origem') RETURNING id INTO v_e2;

  -- 3. os DOIS negócios passam pela etapa
  UPDATE public.pipeline_entries SET stage_key = v_stage WHERE id = v_e1;
  UPDATE public.pipeline_entries SET stage_key = v_stage WHERE id = v_e2;

  -- 4. cada um tem o SEU checklist — era aqui que o segundo saía sem nada
  SELECT count(*) INTO v_n FROM public.checklists
  WHERE source_template_id = v_tpl AND pipeline_entry_id IN (v_e1, v_e2);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FALHOU: esperava 1 checklist por negocio, achei % (o defeito era exatamente este)', v_n;
  END IF;

  -- 5. e os itens do template vieram junto, nos dois
  SELECT count(*) INTO v_n FROM public.checklist_items ci
  JOIN public.checklists c ON c.id = ci.checklist_id
  WHERE c.source_template_id = v_tpl AND c.pipeline_entry_id IN (v_e1, v_e2);
  IF v_n <> 4 THEN RAISE EXCEPTION 'FALHOU: itens nao copiados (n=%)', v_n; END IF;

  -- 6. idempotência DENTRO do negócio: sair e voltar não duplica
  UPDATE public.pipeline_entries SET stage_key = 'ensaio_origem' WHERE id = v_e1;
  UPDATE public.pipeline_entries SET stage_key = v_stage WHERE id = v_e1;
  SELECT count(*) INTO v_n FROM public.checklists
  WHERE source_template_id = v_tpl AND pipeline_entry_id = v_e1;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: reentrada duplicou o checklist (n=%)', v_n; END IF;

  -- 7. o índice por negócio recusa a duplicata na marra
  BEGIN
    INSERT INTO public.checklists (organization_id, lead_id, pipeline_entry_id, source_template_id, title)
    VALUES (v_org, v_lead, v_e1, v_tpl, 'duplicata');
    RAISE EXCEPTION 'FALHOU: o indice aceitou duplicata por negocio';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 8. o escopo PESSOA continua protegido entre si
  INSERT INTO public.checklists (organization_id, lead_id, source_template_id, title)
  VALUES (v_org, v_lead, v_tpl, 'da pessoa');
  BEGIN
    INSERT INTO public.checklists (organization_id, lead_id, source_template_id, title)
    VALUES (v_org, v_lead, v_tpl, 'da pessoa de novo');
    RAISE EXCEPTION 'FALHOU: dois checklists de pessoa com o mesmo template';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'ENSAIO F4 OK';
END
$ensaio$;

ROLLBACK;
