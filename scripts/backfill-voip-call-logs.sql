-- Backfill: as chamadas de voz JÁ encerradas viram registro no histórico.
-- Pareado com a migration 20270801000000_voip_call_log_projection.sql.
--
-- POR QUE ISTO NÃO ESTÁ NA MIGRATION
-- ----------------------------------
-- Migration é só schema. Um `db push` disparado de um checkout atrasado re-roda
-- todo `DO` de backfill que a migration carregar — e nesta base isso já
-- reescreveu dado de cliente sem que ninguém pedisse. Backfill é ato separado,
-- deliberado, com um humano olhando.
--
-- QUANDO RODAR
-- ------------
-- DEPOIS da migration. Antes dela, `fn_voip_project_call_log` não existe e este
-- arquivo falha alto (o que é o comportamento certo).
--
-- O gatilho cobre daqui para a frente; este arquivo cobre o que já passou. Sem
-- ele, as chamadas encerradas antes do deploy nunca aparecem em tela nenhuma.
--
-- SEGURANÇA DE REEXECUÇÃO
-- -----------------------
-- Idempotente por construção: passa pelo mesmo `ON CONFLICT (voip_call_id)` da
-- projeção viva. Rodar duas vezes produz exatamente o mesmo estado, e a segunda
-- passada não ecoa em `lead_history` (o gatilho de histórico é AFTER INSERT, e
-- `ON CONFLICT DO UPDATE` não dispara trigger de INSERT).
--
-- EFEITO COLATERAL QUE VOCÊ PRECISA QUERER
-- ----------------------------------------
-- Cada chamada projetada COM lead vinculado gera UMA entrada em `lead_history`
-- (`action = 'call_logged'`, `source = 'system'`). Isso é o ponto — é o que faz
-- a ligação aparecer na linha do tempo do lead. Mas é escrita em histórico de
-- cliente: confira a contagem do relatório abaixo antes de confirmar.
--
-- COMO RODAR (transação explícita, com o relatório ANTES do commit)
-- -----------------------------------------------------------------
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/backfill-voip-call-logs.sql
--
-- O arquivo abre e fecha a própria transação. Para ensaiar sem gravar, troque
-- o COMMIT final por ROLLBACK.

BEGIN;

-- Antes: quantas chamadas encerradas existem e quantas já têm registro.
SELECT
  count(*)                                             AS chamadas_encerradas,
  count(*) FILTER (WHERE cl.id IS NOT NULL)            AS ja_registradas,
  count(*) FILTER (WHERE cl.id IS NULL)                AS a_registrar
FROM public.voip_calls c
LEFT JOIN public.call_logs cl ON cl.voip_call_id = c.id::text
WHERE c.status = 'ended';

-- A projeção. Ordenada por `authorized_at` só para o relatório sair legível —
-- a ordem não muda o resultado.
SELECT count(*) AS projetadas
FROM (
  SELECT public.fn_voip_project_call_log(c.id) AS log_id
    FROM public.voip_calls c
   WHERE c.status = 'ended'
   ORDER BY c.authorized_at
) t
WHERE t.log_id IS NOT NULL;

-- Depois: o desfecho por resultado, para conferir que o mapeamento produziu o
-- que se espera do ledger de voz (e não uma parede de `failed`).
SELECT cl.outcome,
       count(*)                                        AS registros,
       count(cl.duration_seconds)                      AS com_duracao,
       round(avg(cl.duration_seconds))                 AS duracao_media_s
  FROM public.call_logs cl
 WHERE cl.voip_provider = 'torquecalls'
 GROUP BY cl.outcome
 ORDER BY registros DESC;

-- E quantas entradas de linha do tempo isto criou.
SELECT count(*) AS entradas_de_historico
  FROM public.lead_history
 WHERE action = 'call_logged' AND source = 'system';

COMMIT;
