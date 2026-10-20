-- 20271129000000_crons_purga_fora_do_expediente.sql
--
-- ⚠️ VERSÃO PROVISÓRIA e NÃO APLICADA. O ledger de prod colide com
-- frequência; renumerar acima do topo real de supabase_migrations.schema_migrations
-- na hora de aplicar. Aplicação em prod é do CTO. Transacional (sem
-- CONCURRENTLY): pode ir por apply_migration.
--
-- Alavanca 6 do plano de RAM/pool (.specs/perf/fora-do-banco.md): tirar do
-- expediente o trabalho de purga que não precisa estar lá. Muda FREQUÊNCIA,
-- não corpo — o DELETE e o LIMIT de cada job ficam como estão.
--
-- Medido em prod em 2026-10-19 (cron.job_run_details, ~1,5 dia de retenção, e
-- pg_stat_statements desde 05/10 15:55 UTC):
--
--   job                          agenda hoje   média   linhas/dia   depois
--   purge-runtime-logs           9-59/10       0,26 s  ~9,5 mil     9 6 * * *  (03:09 BRT, 1×/dia)
--   cleanup-wa-health-checks-7d  4-59/10       0,14 s  ~28 mil      4 * * * *  (1×/hora)
--   cleanup-audit-log-14d        6-59/10       0,06 s  ~3,6 mil     6 * * * *  (1×/hora)
--
-- Por que cabe:
--   • purge-runtime-logs: cada DELETE tem LIMIT 50.000; o volume diário de
--     runtime_logs é ~9,5 mil (após a amostragem do logger, ~5 mil). Um dia de
--     cron perdido ainda drena no seguinte com folga de 5×. 06:09 UTC não tem
--     purga pesada; divide o minuto só com os invocadores leves 4-59/5 (que já
--     dividiam o :09 com ela a cada 10 min hoje) e fica longe do 06:21
--     (calculate-portfolio-health) e do 05/06:x0/x5 (toth-sync-cobrancas-full).
--     Leitor que depende da retenção: master_org_finance lê 30 dias de tokens
--     (módulo ≠ webhook, mantido por 30 dias — inalterado).
--   • cleanup-wa-health-checks-7d: ~28 mil linhas/dia ≈ 1,2 mil/hora, contra
--     LIMIT 30.000 — 1×/hora drena com folga de 25×. Diário ficaria a 7% do LIMIT:
--     por isso hora, não madrugada.
--   • cleanup-audit-log-14d: ~3,6 mil linhas/dia (média de 7 dias; 1,6 mil nas
--     últimas 24 h) ≈ 150/hora contra LIMIT 20.000 — folga de >100×. O índice de
--     purga (idx_audit_log_occurred_at_purge, 02/09) serve qualquer cadência.
--
-- Ganho (estimativa sobre a média medida): −383 execuções/dia no total, −144 no
-- expediente (12–21 UTC). Tempo de banco (média × execuções a menos; cada
-- execução horária apaga 6× mais linhas, então o real é um pouco menor nas duas
-- horárias): ~−62 s/dia, ~−23 s/dia no expediente
-- (~2 s/h contra ~1.250 s/h de SQL no pico). É pequeno, e é honesto dizer: o
-- cron inteiro de purga já é ~3% do banco depois do incidente de 02/09. O
-- motivo de fazer é outro — cada disparo de pg_cron é um backend novo que monta
-- o catálogo do zero (1.092 policies, 1.327 funções); são −144 forks no
-- expediente, e nenhum DELETE de purga dividindo minuto com a carga do usuário.
--
-- Contrato: tests/unit/cron-fora-do-banco-contrato.test.ts (snapshot de prod
-- scripts/cron/prod-snapshot-2026-10-19.json): só frequência cai, purga pesada
-- não divide minuto entre si, pico de disparos não-por-minuto ≤ 8.
--
-- Execução por job (mesmo contrato do 20271103000900):
--   • casa por jobname, nunca por jobid;
--   • ausente → NOTICE e segue; agenda = depois → no-op (reaplicável);
--   • agenda = antes → cron.alter_job só com schedule;
--   • qualquer outra agenda → NOTICE e NÃO toca; jobname duplicado → NÃO toca.
--
-- REVERSÃO EXATA: supabase/migrations/rollback/20271129000000_crons_purga_fora_do_expediente.sql

DO $$
DECLARE
  alvo   record;
  achado record;
  n      int;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron ausente — reagendamento ignorado';
    RETURN;
  END IF;

  FOR alvo IN
    SELECT * FROM (VALUES
      -- reescalonamento:inicio
      ('purge-runtime-logs', '9-59/10 * * * *', '9 6 * * *'),
      ('cleanup-wa-health-checks-7d', '4-59/10 * * * *', '4 * * * *'),
      ('cleanup-audit-log-14d', '6-59/10 * * * *', '6 * * * *')
      -- reescalonamento:fim
    ) AS t(nome, antes, depois)
  LOOP
    SELECT count(*) INTO n FROM cron.job WHERE jobname = alvo.nome;

    IF n = 0 THEN
      RAISE NOTICE 'cron % ausente — ignorado', alvo.nome;
      CONTINUE;
    ELSIF n > 1 THEN
      RAISE NOTICE 'cron % aparece % vezes (usuários distintos) — não tocado', alvo.nome, n;
      CONTINUE;
    END IF;

    SELECT jobid, schedule INTO achado FROM cron.job WHERE jobname = alvo.nome;

    IF achado.schedule = alvo.depois THEN
      CONTINUE;
    ELSIF achado.schedule = alvo.antes THEN
      PERFORM cron.alter_job(job_id := achado.jobid, schedule := alvo.depois);
    ELSE
      RAISE NOTICE 'cron % com agenda inesperada "%" (esperada "%") — não tocado',
        alvo.nome, achado.schedule, alvo.antes;
    END IF;
  END LOOP;
END $$;
