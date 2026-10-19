-- ROLLBACK de 20271127000001_avisos_varreduras_a_cada_2_min.sql
-- Devolve as agendas medidas em prod em 2026-10-19. Mesmo contrato de execução
-- (por jobname; só toca o job cuja agenda é exatamente a que a migration deixou).

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
      ('avisos-varredura-reuniao-proxima', '1-59/2 * * * *', '* * * * *'),
      ('avisos-varredura-followups', '*/2 * * * *', '* * * * *')
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
