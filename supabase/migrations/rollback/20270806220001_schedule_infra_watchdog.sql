-- ROLLBACK de 20270806220001_schedule_infra_watchdog.sql
--
-- Desagenda o watchdog e remove sua função de disparo.
--
-- Não apaga as chaves `watchdog_last_alert_*` de `cron_config`: são carimbos de
-- cooldown, inertes sem a função, e preservá-los evita uma enxurrada de avisos
-- repetidos caso o watchdog volte a ser agendado logo em seguida.

SELECT cron.unschedule('infra-watchdog')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'infra-watchdog');

DROP FUNCTION IF EXISTS public.invoke_infra_watchdog();
