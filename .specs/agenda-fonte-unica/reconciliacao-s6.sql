-- Reconciliação do S6 — a invariante da fatia, CONGELADA EM DISCO.
--
-- Roda DUAS vezes contra prod, sem transação e sem escrever nada:
--   1. ANTES do apply  → salva em .specs/agenda-fonte-unica/baseline-s6.tsv
--   2. DEPOIS do apply → salva em .specs/agenda-fonte-unica/depois-s6.tsv
-- e o veredito é `diff` dos dois. Comparar de memória é o que já produziu
-- achado falso neste repo; por isso o baseline vai para arquivo.
--
--   psql "$PROD_URL" -v ON_ERROR_STOP=1 -A -F $'\t' --no-align --tuples-only \
--     -f .specs/agenda-fonte-unica/reconciliacao-s6.sql > baseline-s6.tsv
--   # …apply…
--   psql "$PROD_URL" … -f .specs/agenda-fonte-unica/reconciliacao-s6.sql > depois-s6.tsv
--   diff baseline-s6.tsv depois-s6.tsv && echo "S6 RECONCILIADO"
--
-- Qualquer divergência em reunioesMarcadas / reunioesComparecidas / noShow =
-- ROLLBACK da fatia, não investigação.
--
-- POR QUE MESES FECHADOS: `noShow` compara `meeting_date < NOW()` e
-- `reunioesComparecidas` ancora em `COALESCE(meeting_date, occurred_at)`. Num
-- mês ABERTO os dois andam sozinhos entre as duas execuções, sem que o S6
-- tenha nada a ver com isso — e um falso vermelho custa tanto quanto um falso
-- verde. A janela vai de 2026-01 até o último mês inteiramente fechado.
--
-- POR QUE TODAS AS ORGS: o espelho alcança hoje 642 entradas em 3 funis de
-- sistema espalhadas por dezenas de orgs. Reconciliar só a Milennials mediria
-- a org que menos corre risco.

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

WITH orgs AS (
  -- Só org com histórico de reunião: as demais devolvem 0/0/0 nos dois lados e
  -- só engordariam o diff.
  SELECT DISTINCT me.organization_id AS org_id
  FROM public.meeting_events me
),
meses AS (
  SELECT d AS inicio,
         d + interval '1 month' - interval '1 second' AS fim
  FROM generate_series(
         '2026-01-01'::timestamptz,
         date_trunc('month', now()) - interval '1 month',
         interval '1 month') d
)
SELECT
  o.org_id::text                                    AS org,
  to_char(m.inicio, 'YYYY-MM')                      AS mes,
  (x.j->>'reunioesMarcadas')                        AS reunioes_marcadas,
  (x.j->>'reunioesComparecidas')                    AS reunioes_comparecidas,
  (x.j->>'noShow')                                  AS no_show
FROM orgs o
CROSS JOIN meses m
CROSS JOIN LATERAL (
  SELECT (public.get_dashboard_metrics(o.org_id, m.inicio, m.fim, NULL))::jsonb AS j
) x
ORDER BY 1, 2;
