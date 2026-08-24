-- ============================================================================
-- SCRUM-172 (`inv:H8-30`) — as provas. Roda DEPOIS de rls-deals-tres-papeis.sql.
--
-- Cada caso abre uma transação, assume o papel `authenticated` com o `sub` do
-- usuário em questão, mede, e desfaz. `set_config(..., true)` é local à
-- transação: sem isso o claim vaza para o caso seguinte e o teste passa por
-- motivo errado.
--
-- O que se está provando não é "a policy existe" — a migration já conta isso.
-- É que ela ISOLA: dois inquilinos, três sessões, e cada uma enxergando
-- exatamente o que deve.
-- ============================================================================

-- Tabela real, não TEMP: quem roda o arquivo (seed-branch.mjs) não imprime
-- linhas, então o resultado precisa sobreviver à conexão para ser lido depois.
-- Morre com a branch.
DROP TABLE IF EXISTS public.qa_resultado_172;
CREATE TABLE public.qa_resultado_172 (caso text, esperado text, obtido text, passou boolean);

-- ── ADMIN multi-org: pertence a A e B, tem que ver os DOIS ────────────────
DO $$
DECLARE v_n int; v_apagado int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"dee05255-199b-4cfb-bda3-89035f8473a5","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_n FROM public.deals
   WHERE organization_id IN ('aaaa0000-0000-0000-0000-00000000000a','bbbb0000-0000-0000-0000-00000000000b');
  SELECT count(*) INTO v_apagado FROM public.deals WHERE id = 'dea1dead-0000-0000-0000-00000000000a';

  RESET ROLE;
  INSERT INTO public.qa_resultado_172 VALUES
    ('admin multi-org vê os negócios das DUAS orgs', '2', v_n::text, v_n = 2),
    ('admin NÃO vê negócio na lixeira (guarda de soft-delete)', '0', v_apagado::text, v_apagado = 0);
END $$;

-- ── MEMBRO da org A: vê o de A, NÃO vê o de B ─────────────────────────────
DO $$
DECLARE v_a int; v_b int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"a989b6b7-87f3-4c92-b0dc-1dd1349980a3","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_a FROM public.deals WHERE organization_id = 'aaaa0000-0000-0000-0000-00000000000a' AND deleted_at IS NULL;
  SELECT count(*) INTO v_b FROM public.deals WHERE organization_id = 'bbbb0000-0000-0000-0000-00000000000b';

  RESET ROLE;
  INSERT INTO public.qa_resultado_172 VALUES
    ('membro vê o negócio da própria org', '1', v_a::text, v_a = 1),
    ('membro NÃO vê negócio da org vizinha', '0', v_b::text, v_b = 0);
END $$;

-- ── MASTER: nenhuma org em team_members, mas atravessa por is_master_user ──
DO $$
DECLARE v_n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"24b706b1-da09-4192-836e-81eed0105806","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_n FROM public.deals
   WHERE organization_id IN ('aaaa0000-0000-0000-0000-00000000000a','bbbb0000-0000-0000-0000-00000000000b');

  RESET ROLE;
  INSERT INTO public.qa_resultado_172 VALUES
    ('master vê as duas orgs sem pertencer a nenhuma', '2', v_n::text, v_n = 2);
END $$;

-- ── ESCRITA: membro tentando UPDATE cross-org tem que não pegar nada ──────
DO $$
DECLARE v_linhas int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"a989b6b7-87f3-4c92-b0dc-1dd1349980a3","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;

  UPDATE public.deals SET title = 'INVADIDO' WHERE id = 'dea10000-0000-0000-0000-00000000000b';
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  RESET ROLE;
  INSERT INTO public.qa_resultado_172 VALUES
    ('membro NÃO altera negócio de outra org (UPDATE não pega linha)', '0', v_linhas::text, v_linhas = 0);
END $$;

-- ── ESCRITA: INSERT com org alheia tem que ser RECUSADO pelo WITH CHECK ───
DO $$
DECLARE v_erro text := 'sem erro';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"a989b6b7-87f3-4c92-b0dc-1dd1349980a3","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.deals (id, organization_id, source_lead_id, title, source)
    VALUES ('dea1f00d-0000-0000-0000-00000000000b', 'bbbb0000-0000-0000-0000-00000000000b',
            '1ebb0000-0000-0000-0000-00000000000b', 'Plantado na org errada', 'human');
    v_erro := 'sem erro';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_erro := 'recusado';
  END;
  RESET ROLE;
  INSERT INTO public.qa_resultado_172 VALUES
    ('membro NÃO cria negócio em outra org (WITH CHECK)', 'recusado', v_erro, v_erro = 'recusado');
END $$;

-- ── DELETE cross-org: mesma regra ─────────────────────────────────────────
DO $$
DECLARE v_linhas int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"a989b6b7-87f3-4c92-b0dc-1dd1349980a3","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;

  DELETE FROM public.deals WHERE id = 'dea10000-0000-0000-0000-00000000000b';
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  RESET ROLE;
  INSERT INTO public.qa_resultado_172 VALUES
    ('membro NÃO apaga negócio de outra org', '0', v_linhas::text, v_linhas = 0);
END $$;

-- ── anon não enxerga nada ─────────────────────────────────────────────────
DO $$
DECLARE v_n int; v_erro text := 'leu';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_n FROM public.deals;
    v_erro := CASE WHEN v_n = 0 THEN 'zero linhas' ELSE 'VAZOU ' || v_n END;
  EXCEPTION WHEN insufficient_privilege THEN
    v_erro := 'sem grant';
  END;
  RESET ROLE;
  INSERT INTO public.qa_resultado_172 VALUES
    ('anon não lê negócio nenhum', 'zero linhas ou sem grant', v_erro, v_erro IN ('zero linhas','sem grant'));
END $$;

SELECT passou, caso, esperado, obtido FROM public.qa_resultado_172 ORDER BY passou, caso;
SELECT count(*) FILTER (WHERE passou) AS passaram,
       count(*) FILTER (WHERE NOT passou) AS falharam,
       count(*) AS total
FROM public.qa_resultado_172;
