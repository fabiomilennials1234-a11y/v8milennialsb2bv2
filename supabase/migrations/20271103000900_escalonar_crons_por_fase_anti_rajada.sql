-- 20271103000900_escalonar_crons_por_fase_anti_rajada.sql
--
-- ⚠️ VERSÃO PROVISÓRIA. O ledger de prod colide com frequência; renumerar
-- acima do topo real de supabase_migrations.schema_migrations na hora de
-- aplicar. Aplicação em prod é do CTO.
--
-- Incidente 2026-10-02: às 12:40:00 UTC ~30 jobs de pg_cron dispararam no
-- mesmo segundo; às 12:40:01 o banco (2 vCPU, max_connections=90) devolveu 7
-- FATAL `too many clients`. A partir de 12:41 os jobs iniciavam e não
-- completavam; crash às 12:46. `too many clients` voltou às 13:15 e 14:30.
--
-- Causa da rajada: 25 jobs com */2, */5, */10, */15 e `0 * * * *` coincidem
-- em :00 (e 23 em :30, 19 em :10/:20/:40/:50). A maioria é `invoke_*`, que faz
-- net.http_post para uma edge function — e a edge function abre conexão de
-- volta via PostgREST/pooler. O custo real de cada disparo é uma conexão; 25
-- de uma vez, somados aos 15 `* * * * *`, são 40 conexões no mesmo segundo.
--
-- O que muda: SÓ a fase (o minuto de início). Nenhuma frequência, nenhum
-- corpo. `*/5` vira `k-59/5` e continua disparando 12 vezes por hora.
--
-- Pico de disparos não-por-minuto num mesmo minuto da semana (medido por
-- scripts/cron/carga-por-minuto.mjs sobre o snapshot de prod de 2026-10-02):
--   antes 28 (03:00: 25 recorrentes + 3 diários)  →  depois 8.
--   Com os 15 `* * * * *` somados: 43 → 23.
--   Hora comum (sem diários): :00 cai de 25 para 5; o perfil fica entre 5 e 8
--   em todos os 60 minutos. O piso teórico é 7 (≈400 disparos/h ÷ 60); 8 é o
--   melhor que a busca achou mantendo as purgas fixas e os diários intocados.
-- O teste tests/unit/cron-escalonamento-contrato.test.ts trava esse teto.
--
-- Escalonamento das purgas (migration 20270915000010) preservado: 39, 82, 83,
-- 84, 90, 99, 106, 141, 155, 160, 65 e 144 NÃO são tocados. Os dois jobs
-- recorrentes mais caros que se movem também desviam delas:
--   avisos-varredura-reuniao-proxima (2,35 s médio) → 3,18,33,48. Nesses
--     minutos as únicas recorrentes fixas são history-sync-budget-cleanup
--     (0,04 s) e torquecalls-recording-maintenance (0,08 s). Os outros
--     candidatos caem em purga pesada: :x2/:x7 cron-health-monitor, :x4
--     wa-health-checks, :x9 purge-runtime-logs, :x6 audit-log, :08/:23/:38/:53
--     copilot-midia, :13/:28/:43/:58 wa-media-jobs. Encosta em
--     raw-payload-retention só às 03:33, 1×/dia.
--   oraculo-admin-briefing (1,30 s) fica em :00 — todo outro resíduo de 5 tem
--     purga pesada recorrente; em :00 só esbarra em diários leves (02:00,
--     04:00, 10:00).
--
-- Jobs com hora fixa diária ficam como estão: medidos em cron.job_run_details,
-- nenhum par de DELETE pesado divide minuto (03:00 soma 0,3 s; 03:17 0,2 s;
-- 04:00 1,4 s). O único diário caro (raw-payload-retention, 27 s) está sozinho
-- às 03:33.
--
-- Contrato de execução, por job:
--   • casa por jobname, nunca por jobid (id não é estável entre ambientes);
--   • job ausente → NOTICE e segue (o repo não descreve os jobs de prod);
--   • agenda atual = depois → no-op (idempotente, reaplicável);
--   • agenda atual = antes → cron.alter_job só com schedule;
--   • qualquer outra agenda → NOTICE e NÃO toca: alguém mudou o job depois
--     do snapshot, e sobrescrever poderia mudar a frequência dele;
--   • jobname duplicado (outro usuário) → NOTICE e NÃO toca.
--
-- O bloco entre os marcadores reescalonamento:inicio/fim é lido pelo teste
-- de contrato e pelo script: uma tupla por linha, (jobname, antes, depois).

DO $$
DECLARE
  alvo   record;
  achado record;
  n      int;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron ausente — reescalonamento ignorado';
    RETURN;
  END IF;

  FOR alvo IN
    SELECT * FROM (VALUES
      -- reescalonamento:inicio
      ('process-outbound-dispatches',      '*/5 * * * *',  '1-59/5 * * * *'),
      ('process-copilot-followups',        '*/5 * * * *',  '1-59/5 * * * *'),
      ('process-followup-automations',     '*/5 * * * *',  '1-59/5 * * * *'),
      ('whatsapp_instance_reaper',         '*/5 * * * *',  '1-59/5 * * * *'),
      ('oraculo-member-briefing',          '*/5 * * * *',  '1-59/5 * * * *'),
      ('whatsapp_dlq_replay',              '*/5 * * * *',  '2-59/5 * * * *'),
      ('process-followup-situations',      '*/5 * * * *',  '2-59/5 * * * *'),
      ('cron_health_check',                '*/5 * * * *',  '3-59/5 * * * *'),
      ('notificame-subscription-repair',   '*/5 * * * *',  '3-59/5 * * * *'),
      ('retry-dead-letter-jobs',           '*/5 * * * *',  '4-59/5 * * * *'),
      ('meta-leadgen-poll',                '*/5 * * * *',  '4-59/5 * * * *'),
      ('send-dedup-log-cleanup',           '*/5 * * * *',  '4-59/5 * * * *'),
      ('voip-webhook-events-cleanup',      '*/5 * * * *',  '4-59/5 * * * *'),
      ('infra-watchdog',                   '*/2 * * * *',  '1-59/2 * * * *'),
      ('billing-provision-worker',         '*/2 * * * *',  '1-59/2 * * * *'),
      ('whatsapp_session_watchdog',        '*/10 * * * *', '5-59/10 * * * *'),
      ('meta-conversion-dispatch',         '*/10 * * * *', '5-59/10 * * * *'),
      ('tinyerp-pull-orders-basic4u',      '*/15 * * * *', '12-59/15 * * * *'),
      ('avisos-varredura-reuniao-proxima', '*/15 * * * *', '3-59/15 * * * *'),
      ('toth-sync-clientes',               '0 * * * *',    '31 * * * *')
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
