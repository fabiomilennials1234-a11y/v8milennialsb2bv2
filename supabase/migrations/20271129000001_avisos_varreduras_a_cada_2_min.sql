-- 20271129000001_avisos_varreduras_a_cada_2_min.sql
--
-- ⛔ DECIDIDO NÃO APLICAR (20/10/2026): o corpo das duas varreduras foi reescrito
-- set-based (20271202000000, aplicada em prod), o que já cortou ~5× os blocos por
-- chamada. Espaçar para 2 min agora troca +1 min de atraso no aviso por ganho
-- marginal. Fica no repo só como registro; não entra em apply nem em db push.
--
-- ⚠️ VERSÃO PROVISÓRIA e NÃO APLICADA. Renumerar acima do topo real do ledger
-- de prod na hora de aplicar. Aplicação em prod é do CTO.
--
-- ⚠️ DECISÃO DE PRODUTO: o aviso "em até 15 minutos" / "começando agora" e o de
-- follow-up passam a sair com até +1 min de atraso (cadência 2 min em vez de 1).
-- Separado da 20271206000000 de propósito: aquela não tem efeito visível; esta
-- tem. Aplicar uma não obriga a outra.
--
-- Alavanca 6 do plano de RAM/pool (.specs/perf/fora-do-banco.md). Medido em prod
-- (pg_stat_statements, 05/10 15:55 → 19/10 15:30 UTC):
--
--   job                                 chamadas  média    blocos/chamada  total
--   avisos-varredura-reuniao-proxima    9.182     203 ms   6.266           1.868 s
--   avisos-varredura-followups          8.409     182 ms   8.097           1.532 s
--
-- São os dois jobs mais caros do pg_cron depois do cron-dispatch-minute (que
-- carrega 19 jobs). Juntos, ~23 s/h de banco — ~1,8% do SQL no pico — e dois
-- backends novos por minuto, 24/7.
--
-- Por que 2 min não perde aviso:
--   • reunião: a janela é [start_at − 5 min, start_at + 15 min] (20 min) e a chave
--     de dedupe é por (org, reunião, start_at, destinatário) — com passo de 2 min
--     toda reunião cai em ~10 varreduras da janela; o primeiro aviso sai entre
--     15 e 13 min antes, em vez de 15 e 14.
--   • follow-up: entra na varredura de due − 15 min até due + 1 h (e, depois das
--     07h BRT, enquanto estiver atrasado), chave por dia — mesma conta.
--   • as duas usam pg_try_advisory_xact_lock: execução sobreposta já é no-op.
-- Fases diferentes (ímpar × par) para as duas não dividirem minuto.
--
-- Ganho (estimativa, linear na cadência): ~−11,5 s/h de banco e −1.440
-- backends/dia. O ganho maior está no corpo, não na agenda — ver "Follow-ups"
-- em .specs/perf/fora-do-banco.md (varredura de ~500 follow-ups atrasados e de
-- ~1.300 pipeline_entries com meeting_date a cada execução).
--
-- Contrato: tests/unit/cron-fora-do-banco-contrato.test.ts.
-- REVERSÃO EXATA: supabase/migrations/rollback/20271129000001_avisos_varreduras_a_cada_2_min.sql

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
      ('avisos-varredura-reuniao-proxima', '* * * * *', '1-59/2 * * * *'),
      ('avisos-varredura-followups', '* * * * *', '*/2 * * * *')
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
