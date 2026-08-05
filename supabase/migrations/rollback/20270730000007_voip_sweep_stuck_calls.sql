-- Rollback de 20270730000007_voip_sweep_stuck_calls.sql
--
-- Remove o varredor de chamada sem evento terminal. NÃO toca em
-- `voip-reap-authorized` (fundação, seção 7), que é outro job, com outro
-- propósito, e continua valendo.
--
-- CONSEQUÊNCIA DE RODAR ISTO ANTES DE O WEBHOOK EXISTIR: volta o defeito que a
-- migration conserta — chamada `ringing` ou `connected` que não termine pelo
-- botão de desligar fica viva para sempre, e o operador trava em
-- `operator_busy` na próxima tentativa, por causa do UNIQUE parcial
-- `idx_voip_calls_one_live_per_operator`. Este rollback só é seguro quando a
-- transição terminal autoritativa existir do outro lado.
--
-- As linhas JÁ recolhidas não são revertidas de propósito: `status = 'ended'`
-- com `end_reason = 'no_terminal_event'` é um fato observado, não um estado
-- derivado. Ressuscitá-las devolveria ao ledger ligações que não existem mais e
-- travaria os operadores de novo.

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voip-sweep-stuck-calls') THEN
    PERFORM cron.unschedule('voip-sweep-stuck-calls');
  END IF;
END
$cron$;
