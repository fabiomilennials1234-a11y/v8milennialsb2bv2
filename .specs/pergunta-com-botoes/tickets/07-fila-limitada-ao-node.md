# 07 — Serializar perguntas da conversa somente durante o node

## What to build

Duas automações que chegam à mesma Conversa do Lead não enviam perguntas simultâneas. A segunda aguarda e é liberada quando o node anterior termina e encaminha sua saída, sem esperar as ações posteriores do ramo.

## Acceptance criteria

- [ ] Reserva durável por organização e conversa/caixa permite somente uma ocorrência ativa, inclusive com workers concorrentes.
- [ ] Perguntas aguardando aparecem como tal no histórico; o prazo de resposta só começa no aceite de seu próprio envio.
- [ ] Implementar ordem de chegada com desempate estável se aprovada nesta revisão; documentar a política sem introduzir validade comercial arbitrária.
- [ ] Escolha, Outra resposta, Sem resposta e encerramento por falha liberam consistentemente a próxima pergunta, após persistir decisão e encaminhamento; resultado de envio ainda incerto não é finalizado falsamente para liberar fila.
- [ ] Um ramo que continua executando depois do node não segura a fila; ADR-0064 substitui ADR-0060.
- [ ] Conversas em organizações/caixas distintas não se bloqueiam; cliques antigos não resolvem a nova pergunta e mensagens recebidas antes do envio não são consumidas por ela.
- [ ] Reinício, execução cancelada e retomada concorrente não deixam reservas órfãs nem liberam duas perguntas. Preservar cancelamentos existentes sem reativar pergunta cancelada.
- [ ] Reconciliar apenas o tratamento da ocorrência com controles existentes de intervenção humana; não criar bloqueio global, novo botão de liberação de atendimento ou transferência ao Copilot. Se um contrato indispensável não existir, registrar o impedimento específico antes de ampliar escopo.
- [ ] Teste integrado usa concorrência real e observa envios, espera, saídas e histórico, incluindo uma nova pergunta no mesmo fluxo e outra execução concorrente.

## Blocked by

- 06 — Tratar falha e reconciliar envio incerto sem duplicar.
