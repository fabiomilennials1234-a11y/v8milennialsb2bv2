-- Varredor de chamada sem evento terminal (Fase 1 do contrato TorqueCalls).
-- ROLLBACK pareado: rollback/20270730000007_voip_sweep_stuck_calls.sql
--
-- O PROBLEMA
-- ----------
-- `idx_voip_calls_one_live_per_operator` é UNIQUE parcial sobre
-- (operator_user_id) para status IN ('authorized','ringing','connected'). É a
-- trava que garante uma ligação viva por vendedor.
--
-- Quem sai desse conjunto hoje:
--   - `voip-reap-authorized` (fundação, seção 7) expira SÓ `authorized`, e só
--     depois do TTL de reserva de 12 segundos;
--   - `torquecalls-signal` promove a linha para `ringing` assim que a VPS
--     aceita, e escreve `ended` apenas no clique de desligar da mesma aba.
--
-- Não existe mais nada. A transição autoritativa (`connected`, `ended` com
-- causa real) é do webhook da VPS, que é fatia futura e ainda não existe. Então
-- toda ligação que não termine pelo botão — aba fechada, navegador morto, rede
-- caída, peer que nunca atende — deixa a linha viva PARA SEMPRE, e a próxima
-- reserva daquele operador devolve `operator_busy`. Um vendedor trava depois da
-- primeira ligação e nada o destrava sem SQL manual.
--
-- A CORREÇÃO
-- ----------
-- Um varredor próprio, com nome próprio. NÃO é o `voip-reap-authorized`
-- reaproveitado: aquele é higiene de reserva vencida (12s, status `expired`,
-- `end_reason = 'reservation_expired'`) e o caminho crítico de devolução de
-- cota é a própria fn_voip_call_reserve. Este é outra coisa — é a rede de
-- segurança que devolve o OPERADOR quando o evento terminal nunca chega.
--
-- OS DOIS NÚMEROS SÃO FOLGADOS DE PROPÓSITO
-- -----------------------------------------
-- 2 minutos para `ringing` e 2 horas para `connected`. Nenhum dos dois é um
-- limite de produto: são ordens de grandeza acima do caso real (um toque de
-- WhatsApp desiste sozinho em ~30-45 segundos; uma ligação comercial de duas
-- horas é um outlier que ainda assim se prefere não cortar). O varredor existe
-- para DESTRAVAR OPERADOR, não para encerrar ligação viva — se o número for
-- apertado, ele passa a derrubar chamada boa, que é um defeito pior que o que
-- ele conserta. Errar para o lado de destravar tarde é barato: o vendedor
-- espera dois minutos. Errar para o lado de cortar cedo custa a venda.
--
-- ESTE VARREDOR É TRANSITÓRIO
-- ---------------------------
-- Quando o webhook da VPS existir, ele passa a escrever a transição terminal
-- com a causa verdadeira (`no_answer`, `rejected`, `hangup_peer`, ...) no
-- instante em que ela acontece, e este cron deixa de recolher qualquer coisa —
-- não porque foi desligado, mas porque nunca mais vai achar linha elegível. Aí
-- ele é removido, e o rollback pareado deste arquivo é o procedimento.
--
-- `end_reason = 'no_terminal_event'` é motivo PRÓPRIO, e é o ponto inteiro da
-- escolha: na auditoria, uma linha recolhida por este varredor tem que ser
-- distinguível de um desligamento normal (`user_ended`), de uma recusa
-- (`rejected`) e de uma reserva vencida (`reservation_expired`). Contar
-- `no_terminal_event` ao longo do tempo é a métrica que diz quanto o webhook
-- ainda falta — e, depois que ele existir, é o alarme de que ele parou.

DO $cron$
BEGIN
  -- Idempotente: `unschedule` antes de `schedule`, para o arquivo sobreviver a
  -- `db reset` (que reaplica todas as migrations num banco onde o job pode já
  -- ter sido criado por uma execução anterior). Mesmo padrão da seção 7 da
  -- fundação.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voip-sweep-stuck-calls') THEN
    PERFORM cron.unschedule('voip-sweep-stuck-calls');
  END IF;

  PERFORM cron.schedule(
    'voip-sweep-stuck-calls',
    '* * * * *',
    $sweep$
    UPDATE public.voip_calls
       SET status = 'ended',
           end_reason = 'no_terminal_event',
           ended_at = now(),
           updated_at = now()
     WHERE (
             -- COALESCE porque `ringing_at` só é escrito por torquecalls-signal
             -- quando a VPS aceita. Linha que virou `ringing` por outro caminho
             -- (ou que teve o UPDATE parcialmente aplicado) ficaria eterna com
             -- a comparação crua: `NULL < x` é NULL, e NULL não recolhe nada.
             -- `authorized_at` é NOT NULL DEFAULT now(), então sempre há âncora.
             status = 'ringing'
             AND COALESCE(ringing_at, authorized_at) < now() - interval '2 minutes'
           )
        OR (
             -- Mesma razão, e mais uma: hoje NADA escreve `connected` — esse
             -- ramo nasce mirando o mundo pós-webhook. Se o webhook escrever o
             -- status sem o carimbo, a âncora anterior segura, e o recolhimento
             -- continua sendo de pelo menos 2 horas de vida.
             status = 'connected'
             AND COALESCE(connected_at, ringing_at, authorized_at) < now() - interval '2 hours'
           )
    $sweep$
  );
END
$cron$;
