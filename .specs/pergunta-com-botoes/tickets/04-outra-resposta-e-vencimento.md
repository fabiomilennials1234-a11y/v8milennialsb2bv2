# 04 — Tratar mensagens livres e vencimento sem disputar caminhos

## What to build

Configurar prazo e executar caminhos Outra resposta ou Sem resposta corretamente, mesmo com resposta perto do vencimento, atraso interno ou eventos repetidos. O operador vê qual resultado concluiu o node.

## Acceptance criteria

- [ ] Prazo configurável, com padrão 24 horas, começa no aceite válido do envio; não conta tempo anterior nem depende de leitura.
- [ ] Texto, áudio, foto, documento, figurinha e demais mídias seguem Outra resposta sem interpretar conteúdo como botão.
- [ ] Entrega, leitura e reações não encerram a espera; clique antigo ou inválido não vira resposta livre para uma nova pergunta.
- [ ] Sem resposta só é decidido sem resposta elegível já recebida; usar recebimento no Torque, conforme ADR-0063.
- [ ] Resposta recebida antes do prazo vence atraso interno de processamento; resposta recebida após vencimento não reabre o node, mesmo com horário de clique anterior.
- [ ] Concorrência real entre clique, mensagem livre e timeout resulta em um único resultado persistido e um avanço; reinício/replay preserva decisão.
- [ ] Tests demonstram recebimento durável e retomada pelo código real com banco de teste; mock de RPC não é evidência de atomicidade.
- [ ] Editor, histórico e validação server-side refletem prazo e saídas; erro de consulta não é tratado como silêncio do contato.

## Blocked by

- 03 — Configurar três botões e validar todas as saídas.
