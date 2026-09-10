# Janela Comercial — contrato e correções

Implementação na branch `codex/workflow-business-window-contract`, ainda sem publicação em produção.

- Saída padrão não aciona mais conexões de janelas nomeadas.
- Selecionar uma saída própria cria uma chave estável; renomear a janela mantém a conexão.
- Editor explica liberação do fluxo, espera, prioridade, horários noturnos e atraso de retomada; permite ordenar as janelas.
- Ativação valida configuração e conexões, incluindo o desenho direto de duas janelas na mesma saída que interrompia os ramos da Pesco. Rascunhos continuam permitidos.
- Mantida, por decisão do CTO, a prioridade de janelas da saída padrão quando o fluxo está fora de todos os horários. Sem janela padrão, continua usando as janelas nomeadas.

Contrato detalhado em `docs/workflow-business-window.md`. O executor continua com um único ponto de retomada; esta correção não adiciona ramos paralelos independentes nem altera o nó Condicional. Não houve alteração dos workflows de clientes ou disparo de mensagens para testes.
