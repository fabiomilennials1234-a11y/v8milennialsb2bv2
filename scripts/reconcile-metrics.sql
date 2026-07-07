-- scripts/reconcile-metrics.sql
--
-- MOTOR GENÉRICO de reconciliação (ADR-0017 §8) — reutilizável por qualquer
-- par NOVO×ANTIGO da fatia de leitura SP-3 (#995 vendas, #996, #997 ...).
-- Generaliza a estrutura de scripts/reconcile-commissions-994.sql (par único)
-- num comparador que NÃO conhece coluna de domínio nenhuma: fala só em
-- células (`dims jsonb`), valores e vínculo com finding.
--
-- ─────────────────────────────────────────────────────────────────────────
-- COMO UM PAR SE "PLUGA" (contrato):
--   O arquivo de INSTÂNCIA (ex.: reconcile-sales-995.sql) roda ANTES deste e
--   deve deixar montado, na MESMA sessão psql, o temp table OBRIGATÓRIO:
--
--     recon_cells(
--       dims            jsonb    NOT NULL,  -- coordenada da célula (org, membro,
--                                           --   stream, campo, período... o que o
--                                           --   par definir). É a CHAVE do grão.
--       new_value       numeric,           -- motor NOVO (RPC nova / leitura do caderno)
--       old_value       numeric,           -- motor ANTIGO (réplica SQL fiel, bug-a-bug)
--       suggested_cause text,              -- heurística do par (verificar à mão!)
--       finding_ref     text               -- 'R4'|'R5'|'R6'|'ADR-0017 §N'|NULL.
--                                           --   NULL numa célula divergente = PORTÃO FALHA.
--     )
--
--   E PODE deixar montado o temp table OPCIONAL de invariantes internas
--   (per-member sums == total, rates ∈ [0,100], funil monotônico, ...):
--
--     recon_invariants(name text, ok boolean, detail text)
--
--   Nenhuma outra suposição. O motor não referencia sale_events, commissions,
--   pipeline nem coluna alguma — só as duas temp tables acima.
--
-- ─────────────────────────────────────────────────────────────────────────
-- SEMÂNTICA DO PORTÃO (ADR-0017 §8):
--   · célula divergente = abs(new-old) > :tolerance (default 0,01).
--   · toda célula divergente PRECISA de finding_ref apontando um finding
--     numerado da auditoria (RELATORIO-AUDITORIA-METRICAS-2026-07-02.md) ou
--     uma decisão do ADR-0017. Célula divergente com finding_ref NULL =
--     delta INEXPLICADO → o motor RAISE → psql sai != 0 (com ON_ERROR_STOP).
--   · qualquer invariante com ok=false também derruba o portão.
--   Equality estrita rejeitaria os próprios fixes; tolerância sem explicação
--   esconderia bug novo — por isso "delta explicado", não "delta pequeno".
--
-- READ-ONLY: o motor só LÊ as temp tables. Nunca escreve em tabela de dados.
--
-- USO (via wrapper, que garante ordem instância→motor na mesma sessão):
--   scripts/reconcile-metrics.sh scripts/reconcile-sales-995.sql \
--     -v org_id="'...'" -v since="'2027-01-01'"
-- ou direto (a instância precisa ter rodado nesta sessão):
--   psql "$URL" -v tolerance=0.01 -f reconcile-<instance>.sql -f reconcile-metrics.sql

\set ON_ERROR_STOP on
\pset expanded off

-- default de tolerância se o par não informar
\if :{?tolerance} \else \set tolerance 0.01 \endif

-- Publica a tolerância como GUC de sessão: :tolerance NÃO é interpolado dentro
-- de blocos DO (string SQL dollar-quoted), então os DO abaixo a leem via
-- current_setting('recon.tolerance').
SELECT set_config('recon.tolerance', :'tolerance', false);

-- Guard de contrato: recon_cells tem de existir (a instância rodou?).
DO $guard$
BEGIN
  IF to_regclass('pg_temp.recon_cells') IS NULL THEN
    RAISE EXCEPTION 'reconcile-metrics: temp table recon_cells ausente — '
      'rode o arquivo de instância (ex.: reconcile-sales-995.sql) ANTES do motor '
      '(use scripts/reconcile-metrics.sh)';
  END IF;
END
$guard$;

-- ── Relatório: 1 linha por célula divergente ───────────────────────────────
\echo ''
\echo '==> Células divergentes (abs(new-old) > tolerance):'
SELECT
  c.dims,
  c.new_value,
  c.old_value,
  round(COALESCE(c.new_value, 0) - COALESCE(c.old_value, 0), 2) AS delta,
  c.suggested_cause,
  c.finding_ref
FROM recon_cells c
WHERE abs(COALESCE(c.new_value, 0) - COALESCE(c.old_value, 0)) > :tolerance
ORDER BY abs(COALESCE(c.new_value, 0) - COALESCE(c.old_value, 0)) DESC;

-- ── Invariantes internas (opcional) ────────────────────────────────────────
\echo ''
\echo '==> Invariantes internas:'
SELECT
  CASE WHEN to_regclass('pg_temp.recon_invariants') IS NULL
       THEN '(nenhuma declarada pela instância)'
       ELSE NULL END AS note
WHERE to_regclass('pg_temp.recon_invariants') IS NULL;

DO $inv$
DECLARE r record; v_bad int := 0;
BEGIN
  IF to_regclass('pg_temp.recon_invariants') IS NULL THEN RETURN; END IF;
  FOR r IN SELECT name, ok, detail FROM recon_invariants ORDER BY ok, name LOOP
    RAISE NOTICE '   [%] % — %', CASE WHEN r.ok THEN 'ok ' ELSE 'FAIL' END, r.name, COALESCE(r.detail,'');
    IF NOT r.ok THEN v_bad := v_bad + 1; END IF;
  END LOOP;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'reconcile-metrics: % invariante(s) violada(s) — portão FALHA (ADR-0017 §8)', v_bad;
  END IF;
END
$inv$;

-- ── PORTÃO: célula divergente sem finding_ref = delta inexplicado ──────────
DO $gate$
DECLARE
  v_tol       numeric := current_setting('recon.tolerance')::numeric;
  v_diverging int;
  v_unexplained int;
  r record;
BEGIN
  SELECT count(*) INTO v_diverging
  FROM recon_cells c
  WHERE abs(COALESCE(c.new_value,0) - COALESCE(c.old_value,0)) > v_tol;

  SELECT count(*) INTO v_unexplained
  FROM recon_cells c
  WHERE abs(COALESCE(c.new_value,0) - COALESCE(c.old_value,0)) > v_tol
    AND c.finding_ref IS NULL;

  RAISE NOTICE '';
  RAISE NOTICE '==> Portão: % célula(s) divergente(s), % inexplicada(s).', v_diverging, v_unexplained;

  IF v_unexplained > 0 THEN
    FOR r IN
      SELECT dims, round(COALESCE(new_value,0)-COALESCE(old_value,0),2) AS delta, suggested_cause
      FROM recon_cells c
      WHERE abs(COALESCE(c.new_value,0)-COALESCE(c.old_value,0)) > v_tol
        AND c.finding_ref IS NULL
      ORDER BY abs(COALESCE(c.new_value,0)-COALESCE(c.old_value,0)) DESC
    LOOP
      RAISE NOTICE '   INEXPLICADA % delta=% causa=%', r.dims, r.delta, COALESCE(r.suggested_cause,'?');
    END LOOP;
    RAISE EXCEPTION 'reconcile-metrics: % delta(s) inexplicado(s) — portão FALHA (ADR-0017 §8). '
      'Explique cada célula ligando-a a um finding numerado no arquivo de deltas justificados '
      '(ex.: reconcile-sales-995.deltas.md) e preencha finding_ref.', v_unexplained;
  END IF;

  RAISE NOTICE '==> PORTÃO PASSA: todo delta tem finding_ref (ou não há divergência).';
END
$gate$;
