-- ============================================================================
-- Procedência do Negócio — a porta por onde ele nasceu. (#1763, ADR-0030 §4)
--
-- Passo *expand* do expand–contract: a coluna nasce ANULÁVEL, ao lado do que
-- existe, para que nenhum caminho de criação quebre. A obrigatoriedade é o
-- ticket #1765, e só entra depois que todos os caminhos gravarem — invertida, a
-- ordem derrubaria a criação de Negócio em produção no instante do apply.
--
-- ── POR QUE COLUNA, E NÃO CHAVE NO metadata ────────────────────────────────
-- Procedência é TRILHA, não estado: escrita uma vez no nascimento e nunca
-- reescrita. Chave em jsonb, sem CHECK e sem obrigatoriedade, deriva — daqui a
-- um ano metade das linhas tem `source`, outra tem `origem`, e a pergunta "esse
-- Negócio veio de gente ou de automação?" deixa de ter resposta exatamente onde
-- ela importa.
--
-- ── POR QUE NÃO DEDUZIR DE created_by ──────────────────────────────────────
-- `created_by` nomeia uma PESSOA. É nulo para toda porta que não é uma — está
-- vazio em 100% das 34.966 linhas criadas pelo backfill de 2026-08-23. Deduzir
-- origem de "created_by IS NULL" é coluna de estado fingindo ser trilha.
--
-- ── O VOCABULÁRIO, E O QUE FICOU DE FORA ───────────────────────────────────
--   human    clique na interface — a porta original da decisão 3 do ADR-0023
--   workflow node de automação que alguém desenhou e ligou
--   api      POST /deals com chave escopada — n8n, Make, integração própria
--   import   planilha
--   backfill as 34.966 linhas da virada de 2026-08-23
--
-- `ingest` NÃO entra. Com o auto-seed morto e as edge functions de ingest sem
-- abrir Negócio, seria valor sem nenhum caso. Entra quando tiver um.
--
-- Só schema e um UPDATE em `deals` restrito às linhas que o próprio backfill
-- marcou. Nenhuma outra tabela de dado de cliente é lida ou escrita.
-- ============================================================================
BEGIN;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_source_check;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_source_check
  CHECK (source IS NULL OR source IN ('human', 'workflow', 'api', 'import', 'backfill'));

COMMENT ON COLUMN public.deals.source IS
  'Procedência: a porta por onde este Negócio nasceu (ADR-0030 §4). '
  'human | workflow | api | import | backfill. Escrita UMA VEZ no nascimento e '
  'nunca reescrita — é trilha, não estado. NÃO deduzir origem de created_by: '
  'aquele nomeia uma pessoa e é nulo para toda porta que não é uma. '
  'Anulável neste passo (expand); vira NOT NULL em #1765 (contract), depois que '
  'todos os caminhos de criação gravarem.';

-- ── Backfill: as linhas da virada ──────────────────────────────────────────
-- O backfill de 2026-08-23 deixou rastro próprio em metadata. É por ele que as
-- linhas são identificadas — não por data, que pegaria Negócio aberto por gente
-- no mesmo dia.
UPDATE public.deals
   SET source = 'backfill'
 WHERE source IS NULL
   AND metadata ? 'backfilled_from_entry';

-- ── Verificação ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_sem_marca bigint;
  v_fora_vocab bigint;
BEGIN
  SELECT count(*) INTO v_sem_marca
    FROM public.deals
   WHERE metadata ? 'backfilled_from_entry' AND source IS DISTINCT FROM 'backfill';
  IF v_sem_marca > 0 THEN
    RAISE EXCEPTION
      'FAIL: % linha(s) com rastro da virada ficaram sem Procedência. Cobertura tem de ser total.', v_sem_marca;
  END IF;

  SELECT count(*) INTO v_fora_vocab
    FROM public.deals
   WHERE source IS NOT NULL
     AND source NOT IN ('human','workflow','api','import','backfill');
  IF v_fora_vocab > 0 THEN
    RAISE EXCEPTION 'FAIL: % linha(s) com Procedência fora do vocabulário.', v_fora_vocab;
  END IF;

  RAISE NOTICE
    'VALIDATION PASSED: deals.source criada (anulável, CHECK fechado); % linha(s) da virada marcadas como backfill.',
    (SELECT count(*) FROM public.deals WHERE source = 'backfill');
END$$;

COMMIT;
