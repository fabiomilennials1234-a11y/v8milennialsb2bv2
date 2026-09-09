-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-622 — DEPOIS: sonda da armadilha "deals exige procedência" +
-- ENSAIO_OK com as contagens por org (Milennials primeiro). ABORTA.
-- As guardas de conteúdo (recorte zerado, espelho nos dois estados, caderno
-- mudo, workflow mudo, leads intacto, gatilhos religados) já rodaram DENTRO de
-- scripts/scrum622-backfill-negocios.sql — este bloco não as repete.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Sonda: INSERT igual ao real SEM source tem de morrer com a mensagem boa ─
-- Réplica do smoke que pegou a regra da outra vez (memória: "deals exige
-- procedência pegou só no smoke"). O EXCEPTION do bloco cria savepoint
-- implícito: a falha esperada não derruba a transação do ensaio.
DO $$
DECLARE v_org uuid := (SELECT org FROM _param WHERE ord = 1);
BEGIN
  BEGIN
    INSERT INTO public.deals (organization_id, title)
    VALUES (v_org, 'SONDA SCRUM-622 — esta linha não pode existir');
    RAISE EXCEPTION 'FAIL sonda: INSERT sem Procedência PASSOU — a_deals_exige_procedencia não segurou.';
  EXCEPTION
    WHEN not_null_violation THEN
      IF SQLERRM NOT LIKE '%Procedência é obrigatória%' THEN
        RAISE EXCEPTION 'FAIL sonda: recusou, mas com mensagem inesperada: %', SQLERRM;
      END IF;
      IF SQLERRM NOT LIKE '%backfill_funil_custom%' THEN
        RAISE EXCEPTION 'FAIL sonda: a mensagem do gatilho não fala o vocabulário novo: %', SQLERRM;
      END IF;
      RAISE NOTICE 'sonda OK: INSERT sem Procedência recusado com a mensagem boa (vocabulário estendido).';
  END;
END $$;

-- ─── ENSAIO_OK: aborta com o placar por org, Milennials primeiro ────────────
DO $$
DECLARE v_placar text; v_total bigint; v_kind "char";
BEGIN
  SELECT string_agg(o.name || '=' || c.criados, '; ' ORDER BY a.ord), sum(c.criados)
    INTO v_placar, v_total
  FROM _e622_criados c
  JOIN _e622_alvo a ON a.org = c.org
  JOIN public.organizations o ON o.id = c.org;
  SELECT cpe_relkind INTO v_kind FROM _e622_estado;

  RAISE EXCEPTION 'ENSAIO_OK SCRUM-622 — % Negócio(s) criados (espelho custom em estado %): %',
    v_total, CASE WHEN v_kind = 'r' THEN 'TABELA/pré-621' ELSE 'VIEW/pós-621' END, v_placar;
END $$;

ROLLBACK;
