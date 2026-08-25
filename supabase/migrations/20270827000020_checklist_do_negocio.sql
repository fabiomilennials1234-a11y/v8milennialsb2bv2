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
