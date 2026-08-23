-- ROLLBACK de 20270731000010_assert_member_same_org.sql (M6 — trava cross-org)
--
-- SCRUM-248. A migration acende a trava que RECUSA linha cujo responsável
-- pertença a outra organização: 3 gatilhos BEFORE INSERT/UPDATE (leads,
-- pipeline_entries, custom_pipe_entries) sobre `fn_assert_member_same_org()`.
--
-- 🟠 ESTE É O ROLLBACK DE UMA TRAVA DE SEGURANÇA. Derrubá-lo REABRE a atribuição
-- cross-org. Só existe por um motivo legítimo: a trava é BLOQUEANTE por desenho,
-- e se ela for acesa com sujeira ainda no banco, ela recusa UPDATE nas linhas
-- sujas — os 1.091 cards do inventário ficam IMÓVEIS e ninguém consegue nem
-- corrigi-los pela UI. Nesse cenário a saída é: derrubar (este arquivo) → rodar
-- `scripts/m6-limpeza-cross-org.sql` → acender de novo (reaplicar a migration).
--
-- ⚠️ A ORDEM CERTA NUNCA É "acender e depois limpar". A própria limpeza é um
-- UPDATE em `leads`, e com a trava no ar ela é recusada. A migration original tem
-- uma guarda de ordem justamente para isso, e o script de limpeza aborta se achar
-- os gatilhos vivos. Este arquivo é a saída de emergência de quem inverteu a
-- ordem, não um passo do roteiro normal.
--
-- ORDEM OBRIGATÓRIA: gatilhos ANTES da função.
-- `DROP FUNCTION` com gatilho vivo apontando para ela falha (dependência), e um
-- `CASCADE` para "resolver" derrubaria os gatilhos em silêncio — que é
-- exatamente o efeito que se quer explícito e nomeado.
--
-- NÃO HÁ PERDA DE DADO: a migration é 100% schema (1 função + 3 gatilhos).
-- Nenhuma linha é lida, escrita ou movida por ela nem por este rollback.

BEGIN;

-- ── 1. Os três gatilhos ─────────────────────────────────────────────────────
-- `IF EXISTS` porque o rollback tem que ser re-executável e porque a migration
-- pode ter sido aplicada parcialmente num apply interrompido.
DROP TRIGGER IF EXISTS trg_assert_member_same_org_leads              ON public.leads;
DROP TRIGGER IF EXISTS trg_assert_member_same_org_pipeline_entries   ON public.pipeline_entries;
DROP TRIGGER IF EXISTS trg_assert_member_same_org_custom_pipe_entries ON public.custom_pipe_entries;

-- ── 2. A função ─────────────────────────────────────────────────────────────
-- Sem CASCADE de propósito: se sobrou algum gatilho não listado acima (alguém
-- anexou a função a uma quarta tabela depois), este DROP FALHA e diz qual. Falhar
-- aqui é melhor que derrubar um gatilho que ninguém sabia que existia.
DROP FUNCTION IF EXISTS public.fn_assert_member_same_org();

-- ── 3. Verificação (aborta) ─────────────────────────────────────────────────
DO $$
DECLARE v_trg int; v_fn int; v_sujo bigint;
BEGIN
  SELECT count(*) INTO v_trg
    FROM pg_trigger
   WHERE tgname LIKE 'trg_assert_member_same_org%' AND NOT tgisinternal;
  IF v_trg <> 0 THEN
    RAISE EXCEPTION 'FAIL: % gatilho(s) da trava M6 sobreviveram.', v_trg;
  END IF;

  SELECT count(*) INTO v_fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_assert_member_same_org';
  IF v_fn <> 0 THEN
    RAISE EXCEPTION 'FAIL: fn_assert_member_same_org ainda existe.';
  END IF;

  -- Diagnóstico, não gate: quanta sujeira cross-org está no banco AGORA. É o
  -- número que diz se reacender a trava vai travar cliente. Só `leads`, que é a
  -- perna com volume; o inventário completo é `scripts/m6-inventario.sql`.
  SELECT count(*) INTO v_sujo
    FROM public.leads x
    JOIN public.team_members m ON m.id IN (x.responsible_id, x.sdr_id, x.closer_id)
   WHERE m.organization_id <> x.organization_id;

  RAISE NOTICE
    'ROLLBACK OK: trava M6 fora (0 gatilhos, 0 função). ⚠️ Atribuição cross-org está REABERTA. Sujeira em `leads` agora: % linha(s) — rode scripts/m6-limpeza-cross-org.sql ANTES de reacender, senão a trava recusa UPDATE nessas linhas e elas ficam imóveis.',
    v_sujo;
END$$;

COMMIT;
