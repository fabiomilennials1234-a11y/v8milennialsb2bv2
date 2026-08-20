-- Quantos envios de automação cairiam fora da janela de 24 horas — issue #1687.
--
-- ─── PARA QUE ESTA MEDIÇÃO EXISTE ───────────────────────────────────────────
--
-- Fora da janela, a Meta recusa qualquer mensagem livre no canal oficial. Antes
-- de ligar o BLOQUEIO é preciso saber o tamanho do que seria bloqueado: se for
-- quase tudo, ligar sem o escape de template pararia a automação da org.
--
-- O governor em modo `shadow` avalia e registra sem bloquear. Esta consulta lê
-- o registro dele.
--
-- ⚠️ COMO LER O RESULTADO — os dois "fechada" exigem ações OPOSTAS:
--
--   window_resolved = true  + window_open = false
--       → o contato de fato não respondeu. A regra está certa; o bloqueio pode
--         entrar.
--
--   window_resolved = false
--       → não soubemos dizer. Se TODAS as linhas estiverem assim, o feed de
--         entrada daquele canal não está alimentando a leitura — e ligar o
--         bloqueio nesse estado barraria 100% da automação.
--
-- ⚠️ LINHA SEM `provider` É REGISTRO VELHO. Os campos de janela entraram no
-- código em 2026-08-13; edge functions deployadas antes disso registram sem
-- eles. Zero linhas com `provider` significa "a função que enviou está
-- desatualizada", não "nenhum envio caiu fora".

select
  coalesce(o.name, '(sem org)')                       as organizacao,
  rl.payload_snapshot->>'provider'                    as provedor,
  rl.payload_snapshot->>'category'                    as categoria,
  rl.payload_snapshot->>'window_applies'              as janela_se_aplica,
  rl.payload_snapshot->>'window_resolved'             as janela_resolvida,
  rl.payload_snapshot->>'window_open'                 as janela_aberta,
  rl.payload_snapshot->>'window_source'               as origem_da_leitura,
  rl.payload_snapshot->>'would_be'                    as teria_feito,
  rl.payload_snapshot->>'reason'                      as motivo,
  count(*)                                            as envios
from public.runtime_logs rl
left join public.organizations o on o.id = rl.organization_id
where rl.module = 'governor'
  and rl.action = 'governor_decision'
  and rl.created_at > now() - interval '7 days'
group by 1, 2, 3, 4, 5, 6, 7, 8, 9
order by envios desc;
