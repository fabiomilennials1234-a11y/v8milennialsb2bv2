-- 20270908002000_procedencia_backfill_funil_custom.sql — SCRUM-622 (W2 · Funil é Funil)
--
-- Estende o vocabulário de Procedência (ADR-0030 §4 + Emenda 1) com
-- `backfill_funil_custom`: a porta do backfill um-Negócio-por-card-custom da W2
-- (spec D2, decisão CTO 2026-09-01). Sem isto o INSERT do backfill morre no
-- `deals_source_check` — medido em prod 2026-09-02:
--   CHECK ((source IS NULL) OR (source = ANY ('{human,workflow,api,import,backfill}')))
--
-- SÓ SCHEMA (guarda F4): o dado roda por scripts/scrum622-backfill-negocios.mjs,
-- org a org, fora do ledger de migrations.
--
-- `webhook` (também no vocabulário da Emenda 1) NÃO entra aqui de propósito:
-- valor de CHECK sem escritor é promessa, não porta. Entra na fatia que ligar o
-- ingest à Procedência.
--
-- Sem BEGIN/COMMIT de topo: o CLI embrulha em transação, e o ensaio
-- (scripts/ensaio-scrum622.sh) concatena este arquivo numa transação maior.

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_source_check;

-- Mesma forma do CHECK vigente (o braço IS NULL é morto desde o NOT NULL de
-- 20270824000090; mantido para não mudar duas coisas numa migration só).
ALTER TABLE public.deals
  ADD CONSTRAINT deals_source_check
  CHECK (source IS NULL OR source IN
         ('human', 'workflow', 'api', 'import', 'backfill', 'backfill_funil_custom'));

COMMENT ON COLUMN public.deals.source IS
  'Procedência: a porta por onde este Negócio nasceu (ADR-0030 §4 + Emenda 1). '
  'human | workflow | api | import | backfill | backfill_funil_custom. '
  'OBRIGATÓRIA desde 20270824000090. Escrita uma vez no nascimento e nunca '
  'reescrita: é trilha, não estado. NÃO deduzir origem de created_by. '
  'backfill_funil_custom = o backfill 1-Negócio-por-card-custom da W2 (SCRUM-622).';

-- A mensagem que quem integra lê tem de falar o vocabulário inteiro do CHECK.
CREATE OR REPLACE FUNCTION public.fn_deals_exige_procedencia()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.source IS NULL THEN
    RAISE EXCEPTION
      'Procedência é obrigatória ao abrir um Negócio. Informe uma de: human, workflow, api, import, backfill, backfill_funil_custom.'
      USING ERRCODE = 'not_null_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Verificação ────────────────────────────────────────────────────────────
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.deals'::regclass AND conname = 'deals_source_check';
  IF v_def IS NULL OR v_def NOT LIKE '%backfill_funil_custom%' THEN
    RAISE EXCEPTION 'FAIL: deals_source_check não aceita backfill_funil_custom (def: %).', coalesce(v_def, 'AUSENTE');
  END IF;
  IF EXISTS (SELECT 1 FROM public.deals
              WHERE source NOT IN ('human','workflow','api','import','backfill','backfill_funil_custom')) THEN
    RAISE EXCEPTION 'FAIL: existe Negócio com Procedência fora do vocabulário estendido.';
  END IF;
  RAISE NOTICE 'VALIDATION PASSED: deals_source_check estendido com backfill_funil_custom.';
END$$;
