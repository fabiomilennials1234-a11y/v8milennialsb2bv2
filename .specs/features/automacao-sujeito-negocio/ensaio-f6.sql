BEGIN;
SET LOCAL lock_timeout = '3s';
-- ─────────────────────────────────────────────────────────────────────────────
-- FOLLOW-UP E AÇÃO DO DIA PASSAM A SER DO NEGÓCIO
--
-- Decisão do CTO, 2026-08-25: "follow-up e ação do dia seguem o checklist, do
-- negócio." Mesma regra da migration `20270827000020` (ADR-0031): nasce DO
-- NEGÓCIO quando o evento que o criou foi de funil; nasce DA PESSOA quando o
-- evento foi da pessoa. Nulo = da pessoa, vale para todos os negócios dela.
--
-- ── ESTA NÃO É UMA COLUNA DO ZERO ───────────────────────────────────────────
-- `follow_ups` já carregava meia-ponte: `source_pipe` (text) + `source_pipe_id`
-- (uuid, sem FK). Medido em prod (2026-08-25):
--
--   source_pipe   total   com id   casa com pipeline_entries
--   (nulo)          749        0     —
--   whatsapp        270      270   229
--   propostas       109      109    93
--   confirmacao      57       57    51
--
-- Ou seja: **373 follow-ups já dizem de qual card vieram**, e 63 apontam para
-- card que não existe mais. O mesmo vale para `acoes_do_dia.proposta_id`: 10 de
-- 10 casam com uma entrada real.
--
-- Por isso aqui HÁ backfill, e no checklist não havia: lá eu inventaria um
-- fato; aqui o fato está gravado, só estava numa coluna sem FK, com nome de
-- "pipe" e não de negócio. `source_pipe`/`source_pipe_id` ficam como estão —
-- aposentá-las é outra fatia, e nada quebra por elas continuarem lá.
--
-- ── POR QUE `SET NULL` E NÃO `CASCADE` ──────────────────────────────────────
-- O checklist do negócio usa CASCADE: sem card, ele não tem assunto. Follow-up
-- e ação do dia são TAREFAS DE ALGUÉM, com dono e prazo, e aparecem na agenda
-- de um Team Member. Apagar o card e sumir com o compromisso da agenda de uma
-- pessoa é pior do que a tarefa sobreviver como tarefa da pessoa — que é o que
-- ela continua sendo: "ligar para o fulano" não deixa de fazer sentido porque o
-- card sumiu.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. As colunas ───────────────────────────────────────────────────────────

ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS pipeline_entry_id uuid,
  ADD COLUMN IF NOT EXISTS deal_id uuid;

ALTER TABLE public.acoes_do_dia
  ADD COLUMN IF NOT EXISTS pipeline_entry_id uuid,
  ADD COLUMN IF NOT EXISTS deal_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_pipeline_entry_id_fkey') THEN
    ALTER TABLE public.follow_ups
      ADD CONSTRAINT follow_ups_pipeline_entry_id_fkey
      FOREIGN KEY (pipeline_entry_id) REFERENCES public.pipeline_entries(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_deal_id_fkey') THEN
    ALTER TABLE public.follow_ups
      ADD CONSTRAINT follow_ups_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acoes_do_dia_pipeline_entry_id_fkey') THEN
    ALTER TABLE public.acoes_do_dia
      ADD CONSTRAINT acoes_do_dia_pipeline_entry_id_fkey
      FOREIGN KEY (pipeline_entry_id) REFERENCES public.pipeline_entries(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acoes_do_dia_deal_id_fkey') THEN
    ALTER TABLE public.acoes_do_dia
      ADD CONSTRAINT acoes_do_dia_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.follow_ups.pipeline_entry_id IS
  'O Negócio dono da tarefa (ADR-0031). NULO = tarefa da PESSOA, vale para todos os negócios dela.';
COMMENT ON COLUMN public.acoes_do_dia.pipeline_entry_id IS
  'O Negócio dono da ação (ADR-0031). NULO = ação da PESSOA.';

CREATE INDEX IF NOT EXISTS idx_follow_ups_pipeline_entry
  ON public.follow_ups (pipeline_entry_id)
  WHERE pipeline_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_acoes_do_dia_pipeline_entry
  ON public.acoes_do_dia (pipeline_entry_id)
  WHERE pipeline_entry_id IS NOT NULL;

-- ── 2. Backfill do que já estava gravado ────────────────────────────────────
--
-- Só onde o ponteiro antigo casa com uma ENTRADA QUE EXISTE. Os 63 órfãos de
-- `follow_ups` ficam nulos: o card que os gerou já não está lá, e apontar para
-- o "mais parecido" seria inventar de qual negócio a tarefa é.

-- A guarda é o LEAD, não a org. `source_pipe_id` nunca teve FK, então nada
-- garantia que o card fosse da mesma pessoa; e `acoes_do_dia.organization_id`
-- é nulo em parte das linhas (backfill de 25/08), o que faria uma guarda por
-- org descartar em silêncio justamente as linhas antigas. Se a tarefa é do lead
-- X e o card é do lead X, o vínculo é coerente — e cruzar org fica impossível
-- de tabela, porque um lead pertence a uma organização só.

UPDATE public.follow_ups f
   SET pipeline_entry_id = pe.id,
       deal_id           = pe.deal_id
  FROM public.pipeline_entries pe
 WHERE f.pipeline_entry_id IS NULL
   AND f.source_pipe_id = pe.id
   AND f.lead_id = pe.lead_id;

-- `acoes_do_dia` NÃO aceita a mesma guarda: medido em prod, as 10 linhas com
-- `proposta_id` têm `lead_id` NULO — a ação sabe de qual card veio e não sabe
-- de qual pessoa. Exigir `a.lead_id = pe.lead_id` descartaria as 10 em silêncio
-- (foi o que o ensaio pegou). Aqui a guarda vira "não CONTRADIZ": lead e org só
-- precisam bater quando existem dos dois lados.
--
-- E o `lead_id` que falta é preenchido no mesmo passo, do card. Ação do dia
-- presa a um negócio e sem dono de pessoa é órfã na tela — o dado existe, só
-- estava a um join de distância.
UPDATE public.acoes_do_dia a
   SET pipeline_entry_id = pe.id,
       deal_id           = pe.deal_id,
       lead_id           = COALESCE(a.lead_id, pe.lead_id),
       organization_id   = COALESCE(a.organization_id, pe.organization_id)
  FROM public.pipeline_entries pe
 WHERE a.pipeline_entry_id IS NULL
   AND a.proposta_id = pe.id
   AND (a.lead_id IS NULL OR a.lead_id = pe.lead_id)
   AND (a.organization_id IS NULL OR a.organization_id = pe.organization_id);

DO $ensaio$
DECLARE v_fu int; v_ad int; v_orf int; v_lead uuid; v_e1 uuid; v_e2 uuid; v_org uuid; v_pipe uuid; v_n int;
BEGIN
  -- 1. estrutura
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='follow_ups' AND column_name='pipeline_entry_id') THEN
    RAISE EXCEPTION 'FALHOU: follow_ups.pipeline_entry_id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='acoes_do_dia' AND column_name='pipeline_entry_id') THEN
    RAISE EXCEPTION 'FALHOU: acoes_do_dia.pipeline_entry_id';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint WHERE conname IN (
    'follow_ups_pipeline_entry_id_fkey','follow_ups_deal_id_fkey',
    'acoes_do_dia_pipeline_entry_id_fkey','acoes_do_dia_deal_id_fkey');
  IF v_n <> 4 THEN RAISE EXCEPTION 'FALHOU: esperava 4 FKs, achei %', v_n; END IF;

  -- 2. o backfill pegou o que já estava gravado
  SELECT count(*) INTO v_fu FROM public.follow_ups WHERE pipeline_entry_id IS NOT NULL;
  SELECT count(*) INTO v_ad FROM public.acoes_do_dia WHERE pipeline_entry_id IS NOT NULL;
  RAISE NOTICE 'backfill: follow_ups=% acoes=%', v_fu, v_ad;
  IF v_fu < 300 THEN RAISE EXCEPTION 'FALHOU: backfill de follow_ups pegou so % (esperava ~373)', v_fu; END IF;
  IF v_ad <> 10 THEN RAISE EXCEPTION 'FALHOU: backfill de acoes pegou % (esperava 10)', v_ad; END IF;

  -- 3. o órfão continua nulo — nao inventamos de qual negocio a tarefa e
  SELECT count(*) INTO v_orf FROM public.follow_ups
   WHERE source_pipe_id IS NOT NULL AND pipeline_entry_id IS NULL;
  IF v_orf = 0 THEN RAISE EXCEPTION 'FALHOU: nenhum orfao sobrou — o backfill foi longe demais'; END IF;
  RAISE NOTICE 'orfaos preservados: %', v_orf;

  -- 4. nenhum vinculo cruzou de lead
  SELECT count(*) INTO v_n FROM public.follow_ups f
   JOIN public.pipeline_entries pe ON pe.id = f.pipeline_entry_id
   WHERE f.lead_id <> pe.lead_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: % follow-ups presos ao negocio de OUTRO lead', v_n; END IF;

  -- 5. dois negocios do mesmo lead sustentam tarefas separadas
  SELECT p.organization_id, p.id INTO v_org, v_pipe
  FROM public.pipelines p
  WHERE p.type='system' AND p.slug='whatsapp'
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.organization_id = p.organization_id)
  ORDER BY p.created_at LIMIT 1;
  SELECT id INTO v_lead FROM public.leads WHERE organization_id = v_org LIMIT 1;

  INSERT INTO public.pipeline_entries (organization_id, lead_id, pipeline_id, stage_key)
  VALUES (v_org, v_lead, v_pipe, 'ensaio_a') RETURNING id INTO v_e1;
  INSERT INTO public.pipeline_entries (organization_id, lead_id, pipeline_id, stage_key)
  VALUES (v_org, v_lead, v_pipe, 'ensaio_b') RETURNING id INTO v_e2;

  INSERT INTO public.follow_ups (lead_id, organization_id, title, due_date, priority, pipeline_entry_id)
  VALUES (v_lead, v_org, 'tarefa do negocio A', now(), 'normal', v_e1),
         (v_lead, v_org, 'tarefa do negocio B', now(), 'normal', v_e2);

  SELECT count(DISTINCT pipeline_entry_id) INTO v_n FROM public.follow_ups
   WHERE lead_id = v_lead AND pipeline_entry_id IN (v_e1, v_e2);
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHOU: os dois negocios nao sustentam tarefas separadas (n=%)', v_n; END IF;

  -- 6. apagar o card NAO apaga a tarefa — ela volta a ser da pessoa
  DELETE FROM public.pipeline_entries WHERE id = v_e1;
  SELECT count(*) INTO v_n FROM public.follow_ups
   WHERE lead_id = v_lead AND title = 'tarefa do negocio A' AND pipeline_entry_id IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: a tarefa sumiu com o card em vez de virar da pessoa (n=%)', v_n; END IF;

  RAISE NOTICE 'ENSAIO F6 OK';
END
$ensaio$;

ROLLBACK;
