# 02 — Executar uma pergunta simples e seguir uma única escolha

## What to build

Em ambiente controlado, configurar uma Pergunta com botões mínima no editor, enviar uma opção de resposta, receber o clique e seguir seu destino uma única vez. A pergunta persiste durante espera e reinício, com identidade própria e isolamento por conversa. Não disponibilizar ativação geral enquanto as outras fatias estiverem incompletas.

## Acceptance criteria

- [ ] Pergunta de texto com uma opção e destino configurados percorre editor, configuração persistida, executor, envio, webhook e retomada, com resultado no histórico.
- [ ] Organização e instância são autorizadas no servidor; outra organização, caixa ou pergunta não resolve essa execução.
- [ ] Persistir ocorrência, identidade da opção, vínculo da mensagem, aceite e estado de espera; resposta rápida e reinício não perdem a escolha.
- [ ] Primeira escolha válida fixa resultado; evento repetido, clique posterior e replay não repetem o avanço.
- [ ] Execução vincula versão de configuração e destinos antes do envio; editar fluxo durante espera não redireciona a resposta, respeitando ADR-0050.
- [ ] Reaproveitar ingresso e executor reais na fronteira integrada de teste, com banco real para concorrência e testes positivos/negativos de autorização.
- [ ] Eventos próprios, inválidos ou sem correlação não avançam a pergunta; o resolver genérico de waits não pode resolver a ocorrência nova por telefone apenas.
- [ ] O novo contrato é aditivo e controlado; ações de menu, wait e Copilot legadas preservam comportamento. Esquema e tipos evoluem pelos mecanismos suportados.

## Blocked by

- 01 — Comprovar envio e resposta de botões pela Uazapi.
