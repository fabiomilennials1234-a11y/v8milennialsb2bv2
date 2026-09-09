-- ============================================================================
-- SCRUM-622 — ROLLBACK DO DADO, seguro por construção.
--
-- A marca é a Procedência: `deals.source = 'backfill_funil_custom'` só foi
-- escrita pelo backfill desta fatia (CHECK criado em 20270908002000; 0 linhas
-- com esse valor antes da carga, medido em prod 2026-09-02). Reverter é:
--   1. desamarrar: pipeline_entries.deal_id := NULL onde aponta pra um Negócio
--      dessa procedência (na org de _param);
--   2. apagar esses Negócios (DELETE físico — nada mais referencia: nasceram
--      nesta carga, valor nulo, sem deal_items, sem sale_events emitidos).
--
-- Ordem 1→2 de propósito: apagar primeiro faria o ON DELETE SET NULL da FK
-- fazer o unlink por ação referencial — funciona, mas mascara a contagem
-- (não dá pra provar "desamarrados = apagados").
--
-- Contrato com o runner: idêntico ao do backfill (_param(org, ord), transação
-- do runner, RAISE EXCEPTION aborta tudo).
--
-- Gatilhos no caminho (conferidos em pg_trigger, prod 2026-09-02):
--   • UPDATE de deal_id: trg_entry_touch_deal_activity dá early-return com
--     NEW.deal_id NULL; trg_sync_deal_id_to_custom_pipe_entry propaga o NULL
--     pro espelho (estado tabela) — desejado; no estado view, morto.
--   • DELETE em deals: nenhum gatilho de usuário (só UPDATE/INSERT lá).
-- ============================================================================

DO $$
DECLARE
  r          record;
  v_alvo     bigint;
  v_unlink   bigint;
  v_del      bigint;
BEGIN
  FOR r IN SELECT p.org, p.ord, o.name FROM _param p
           LEFT JOIN public.organizations o ON o.id = p.org ORDER BY p.ord LOOP
    IF r.name IS NULL THEN
      RAISE EXCEPTION 'FAIL rollback: org % não existe.', r.org;
    END IF;

    SELECT count(*) INTO v_alvo FROM public.deals
     WHERE organization_id = r.org AND source = 'backfill_funil_custom';

    -- 1. Desamarrar.
    UPDATE public.pipeline_entries pe
       SET deal_id = NULL
      FROM public.deals d
     WHERE d.id = pe.deal_id
       AND d.organization_id = r.org
       AND d.source = 'backfill_funil_custom';
    GET DIAGNOSTICS v_unlink = ROW_COUNT;

    -- 2. Apagar.
    DELETE FROM public.deals
     WHERE organization_id = r.org AND source = 'backfill_funil_custom';
    GET DIAGNOSTICS v_del = ROW_COUNT;

    IF v_del <> v_alvo OR v_unlink > v_alvo THEN
      RAISE EXCEPTION
        'FAIL rollback (org %): alvo=% desamarrados=% apagados=% — contagens têm de fechar.',
        r.name, v_alvo, v_unlink, v_del;
    END IF;

    -- Nada da procedência sobra, nem card apontando pro vazio.
    IF EXISTS (SELECT 1 FROM public.deals
                WHERE organization_id = r.org AND source = 'backfill_funil_custom') THEN
      RAISE EXCEPTION 'FAIL rollback (org %): sobrou Negócio com a procedência.', r.name;
    END IF;
    IF EXISTS (SELECT 1 FROM public.pipeline_entries pe
                LEFT JOIN public.deals d ON d.id = pe.deal_id
               WHERE pe.organization_id = r.org AND pe.deal_id IS NOT NULL AND d.id IS NULL) THEN
      RAISE EXCEPTION 'FAIL rollback (org %): card apontando pra Negócio inexistente.', r.name;
    END IF;

    RAISE NOTICE 'ROLLBACK_OK % (%): % Negócio(s) apagados, % card(s) desamarrados.',
      r.name, r.org, v_del, v_unlink;
  END LOOP;

  RAISE NOTICE 'VALIDATION PASSED: rollback por procedência concluído para as orgs de _param.';
END$$;
