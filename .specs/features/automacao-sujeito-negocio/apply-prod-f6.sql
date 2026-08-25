-- APPLY EM PRODUÇÃO — follow-up e ação do dia do Negócio.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='follow_ups' AND column_name='pipeline_entry_id') THEN
    RAISE EXCEPTION 'ABORTA: follow_ups.pipeline_entry_id já existe';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='acoes_do_dia' AND column_name='pipeline_entry_id') THEN
    RAISE EXCEPTION 'ABORTA: acoes_do_dia.pipeline_entry_id já existe';
  END IF;
END
$pre$;

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

DO $pos$
DECLARE v_n int; v_fu int; v_ad int; v_orf int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_constraint WHERE conname IN (
    'follow_ups_pipeline_entry_id_fkey','follow_ups_deal_id_fkey',
    'acoes_do_dia_pipeline_entry_id_fkey','acoes_do_dia_deal_id_fkey');
  IF v_n <> 4 THEN RAISE EXCEPTION 'FALHOU: esperava 4 FKs, achei %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_indexes WHERE indexname IN (
    'idx_follow_ups_pipeline_entry','idx_acoes_do_dia_pipeline_entry');
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHOU: esperava 2 indices, achei %', v_n; END IF;

  SELECT count(*) INTO v_fu FROM public.follow_ups WHERE pipeline_entry_id IS NOT NULL;
  SELECT count(*) INTO v_ad FROM public.acoes_do_dia WHERE pipeline_entry_id IS NOT NULL;
  IF v_fu < 300 THEN RAISE EXCEPTION 'FALHOU: backfill de follow_ups pegou so %', v_fu; END IF;
  IF v_ad <> 10 THEN RAISE EXCEPTION 'FALHOU: backfill de acoes pegou %', v_ad; END IF;

  -- Nenhum vinculo cruzou de lead.
  SELECT count(*) INTO v_n FROM public.follow_ups f
   JOIN public.pipeline_entries pe ON pe.id = f.pipeline_entry_id
   WHERE f.lead_id <> pe.lead_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: % tarefas presas ao negocio de OUTRO lead', v_n; END IF;

  -- Os orfaos continuam nulos: nao inventamos de qual negocio a tarefa e.
  SELECT count(*) INTO v_orf FROM public.follow_ups
   WHERE source_pipe_id IS NOT NULL AND pipeline_entry_id IS NULL;
  IF v_orf = 0 THEN RAISE EXCEPTION 'FALHOU: nenhum orfao sobrou'; END IF;

  RAISE NOTICE 'apply OK — follow_ups=% acoes=% orfaos=%', v_fu, v_ad, v_orf;
END
$pos$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20270828000030', 'followup_acao_do_negocio')
ON CONFLICT (version) DO NOTHING;

COMMIT;
