# Envio incerto e fila — implementação de 2026-09-21

## Comportamento implementado

- Dispatch distingue `not_sent`, `rejected`, `uncertain` e `accepted` para menus. A classificação `uncertain` começa quando o callback de transporte foi invocado; exceções posteriores nunca autorizam retry. Provider efetivo precisa ser Uazapi, incluindo override da organização.
- Falha comprovada encaminha `send_failure` atomicamente com o cursor e o registro do passo. Replay, cancelamento e resposta válida anterior não geram segundo resultado. Motivos persistidos são códigos fechados, sem texto bruto do provedor.
- Aceite usa ID original e timestamp original da Uazapi, preservando milissegundos. Mensagem livre anterior ao aceite não resolve a pergunta. Botão autenticado e correlacionado pode chegar antes da persistência do aceite.
- Worker consulta `/message/find` por ocorrência, origem e conversa. Resultado precisa ser único, próprio, correlacionado, com ID/horário válidos. Ausência ou ambiguidade mantém ocorrência incerta.
- Consultas: primeira após dois minutos do início do envio; lote máximo cinco; cinco minutos entre consultas da mesma ocorrência; máximo doze tentativas. Cada HTTP de consulta tem timeout de dez segundos e nenhum retry interno. Rate limit persistente: cinco consultas por organização/instância por minuto; falha do limitador bloqueia consulta. Estes limites são orçamento operacional do produto, não limites declarados pela Uazapi.
- Esgotamento permanece `uncertain`, retém reserva da conversa e não muda para timeout/falha nem reenvia. `send_check_count`, `next_send_check_at` e `last_send_check` registram progresso. Interface operacional implementada: fila, verificação, esgotamento e resultado sem botão de reenvio incerto.
- Fila por organização + instância + telefone normalizado. Ordem `(created_at,id)`; uma ocorrência ativa. Reserva por advisory lock de conversa, protegida adicionalmente por índice único. Execução em fila permanece pausada e sem deadline.
- Promoção transacional concede envio a um worker; envia conteúdo congelado, pelo mesmo dispatch/governor da pergunta inicial. Reinício após promoção entra em reconciliação, nunca repete o envio. `send_started_at` é renovado na promoção, impedindo que tempo em fila seja confundido com envio perdido.
- Resolução/falha/cancelamento libera a próxima ocorrência sem aguardar o ramo posterior. Pergunta incerta conserva a fila. Cancelamento abrange também ocorrências ainda em fila.

## Evidências

Ciclos red→green: falha explícita sem RPC de conclusão; recovery worker sem consulta; reserva concorrente violando índice antigo; worker sem promoção; relógio baseado em hora local; texto anterior ao envio consumido indevidamente. As falhas foram observadas antes das implementações correspondentes.

- 265 testes passaram em 13 arquivos: provider/cliente, gateway, executor novo/legado, recovery worker, ingress e imagem no envio.
- Banco de produção, transações encerradas com rollback: `evidencia-falha-rollback.json`, `evidencia-fila-rollback.json`. Nenhuma organização, tabela ou coluna candidata permaneceu.
- Schema isolado com mesmas migrations: clique/texto vs timeout em três sessões e disputa da fila em duas sessões. Claims da fila `[1,0]`; primeira da fila assumida; próxima liberada ao concluir node. Schema removido. `evidencia-concorrencia.json`.
- Clones `LIKE` não copiam triggers/FKs legados; testes de rollback no schema público complementam essa limitação. Concorrência comprova propriedade de envio no banco, não entrega WhatsApp exatamente uma vez.

## Pendências para liberação

Matriz de clientes e ciclo real completo com executor/worker/webhook implantados. Histórico, portabilidade, referências no servidor e falhas anteriores à reserva implementados e verificados conforme `implementacao-tdd.md`. Nenhum deploy, ativação de flag ou fechamento dos tickets 06/07 enquanto critérios restantes não estiverem comprovados.
